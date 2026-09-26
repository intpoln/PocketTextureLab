// ---------------------------------------------------------------------------
// Evaluation engine: per-node GPU result cache keyed by resolution. A node is
// recomputed only when its own stamp (params) or the identity of one of its
// input results changed, so editing one node re-runs it and its dependents.
// ---------------------------------------------------------------------------
const Engine = (() => {
  const caches = new Map();   // nodeId -> Map(res -> entry)
  let keyCounter = 1;
  const errors = new Map();   // nodeId -> message

  function freeEntry(e) {
    if (!e || !e.outs) return;
    for (const o of e.outs) if (o) GPU.release(o.tex);
    e.outs = null;
  }

  function makeCtx(node, inputs, res, projRes, opts) {
    const def = NODES[node.type];
    const temps = [];
    const ctx = {
      node, params: Anim.params(node), res, projRes, uvOff: opts.uvOff || [0, 0],
      input: (k) => inputs[k],
      space: (k) => (inputs[k] ? inputs[k].space : null),
      px: (v) => (v * res) / projRes,
      alloc: () => GPU.acquire(res),
      temp: () => { const t = GPU.acquire(res); temps.push(t); return t; },
      bindTex(u, slot, src, want) {
        u['u_in' + slot] = src ? src.tex : null;
        u['u_has' + slot] = !!src;
        u['u_col' + slot] = !!src && src.space === 'color' && want === 'native';
        u['u_conv' + slot] = src ? convCode(src.space, want) : 0;
        u['u_def' + slot] = (def.inputs[slot] && def.inputs[slot].def) || BLACK;
      },
      bindIn(u, slot, k, want) {
        ctx.bindTex(u, slot, inputs[k], want);
        u['u_def' + slot] = (def.inputs[k] && def.inputs[k].def) || BLACK;
      },
      pass(name, target, u, samplers, outConv = 0) {
        GPU.run(name, target, { u_res: [res, res], u_outConv: outConv, u_uvOff: ctx.uvOff, ...u }, { samplers: samplers || {} });
      },
    };
    return { ctx, temps };
  }

  // Evaluate `id` at resolution `res`. memo: Map for this run. store: cache map
  // (the persistent one, or a throwaway one for export).
  function evaluate(id, res, memo, store = caches, opts = {}) {
    if (memo.has(id)) return memo.get(id);
    const node = Graph.nodes.get(id);
    if (!node) return null;
    const def = NODES[node.type];
    const inputs = def.inputs.map((_, k) => {
      const l = Graph.inputLink(id, k);
      if (!l) return null;
      const r = evaluate(l.from, res, memo, store, opts);
      const o = r && r.outs && r.outs[l.fromPort];
      return o ? { tex: o.tex, space: o.space, key: r.key + ':' + l.fromPort } : null;
    });
    const animated = Anim.isAnimated(node);
    const inKey = inputs.map((x) => (x ? x.key : '-')).join('|') + (animated ? '@' + Anim.t : '');
    let m = store.get(id);
    if (!m) store.set(id, (m = new Map()));
    let e = m.get(res);
    if (e && e.outs && e.stamp === node.stamp && e.inKey === inKey && e.gen === GPU.gen && !opts.force) {
      memo.set(id, e);
      return e;
    }
    const { ctx, temps } = makeCtx(node, inputs, res, opts.projRes || Graph.state.resolution, opts);
    let outs;
    try {
      outs = def.eval(ctx);
      errors.delete(id);
    } catch (err) {
      console.warn('eval', node.type, err);
      errors.set(id, err.message || String(err));
      outs = (def.outputs.length ? def.outputs : ['x']).map(() => {
        const t = ctx.alloc();
        ctx.pass('constant', t, { u_color: [0, 0, 0, 1] });
        return { tex: t, space: 'data' };
      });
    }
    for (const t of temps) GPU.release(t);
    if (e && e.gen === GPU.gen) freeEntry(e);
    e = { stamp: node.stamp, inKey, outs, key: keyCounter++, gen: GPU.gen, res };
    m.set(res, e);
    memo.set(id, e);
    return e;
  }

  function get(id, res) {
    const m = caches.get(id);
    const e = m && m.get(res);
    return e && e.outs && e.gen === GPU.gen ? e : null;
  }

  // Drop cached results of other resolutions / removed nodes.
  function purge(keepRes) {
    for (const [id, m] of caches) {
      if (!Graph.nodes.has(id)) { for (const e of m.values()) freeEntry(e); caches.delete(id); continue; }
      for (const [r, e] of m) if (!keepRes.includes(r)) { freeEntry(e); m.delete(r); }
    }
  }

  // After context loss: GPU handles are gone, forget them without deleting.
  function dropGpu() { caches.clear(); }

  // Fresh evaluation at `res` into a temporary store; returns 8-bit RGBA file
  // values. Nothing from the preview cache is reused.
  function renderBytes(id, port, res, opts = {}) {
    const store = opts.store || new Map();
    try {
      const e = evaluate(id, res, new Map(), store, { ...opts, projRes: opts.projRes || Graph.state.resolution });
      if (!e) throw new Error('Нода не найдена');
      const node = Graph.nodes.get(id);
      let o;
      if (NODES[node.type].outputs.length === 0) o = e.outs[0];
      else o = e.outs[port || 0];
      const raw = GPU.read(o.tex);
      return { bytes: ColorUtil.toBytes(raw, o.space), space: o.space, width: res, height: res, raw };
    } finally {
      if (!opts.store) freeStore(store);
    }
  }
  function freeStore(store) { for (const m of store.values()) for (const e of m.values()) freeEntry(e); store.clear(); }

  function readCachedBytes(id, port, res) {
    const e = get(id, res);
    if (!e) return null;
    const o = e.outs[port || 0];
    return { bytes: ColorUtil.toBytes(GPU.read(o.tex), o.space), space: o.space };
  }

  return { evaluate, get, purge, dropGpu, renderBytes, freeStore, readCachedBytes, errors, caches };
})();
