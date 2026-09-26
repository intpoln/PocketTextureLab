// ---------------------------------------------------------------------------
// window.PTL — programmatic API for scripts and AI agents. Every mutating call
// updates the UI and is one undo step (use PTL.batch(fn) to group several).
// See the embedded guide (#ptl-agent-guide) or PTL.help().
// ---------------------------------------------------------------------------
const PTL = (() => {
  let batchDepth = 0, batchDirty = false;

  function need(id) {
    const n = Graph.nodes.get(id);
    if (!n) throw new Error(`PTL: нет ноды "${id}". Существующие: ${[...Graph.nodes.keys()].join(', ') || '(пусто)'}`);
    return n;
  }

  function after(structure = true) {
    if (batchDepth > 0) { batchDirty = true; return; }
    App.commit();
    App.afterLoad();
  }

  function paramInfo(d) {
    const o = { key: d.key, type: d.type, default: d.def };
    if (d.label) o.label = d.label;
    if (d.min != null) { o.min = d.hardMin ?? d.min; o.max = d.hardMax ?? d.max; }
    if (d.options) o.options = d.options.map(([v, t]) => ({ value: v, label: t }));
    if (d.help) o.help = d.help;
    return o;
  }

  function checkParams(type, params) {
    const defs = Object.fromEntries(NODES[type].params.map((d) => [d.key, d]));
    const out = {};
    for (const k of Object.keys(params || {})) {
      const d = defs[k];
      if (!d) throw new Error(`PTL: у ноды "${type}" нет параметра "${k}". Есть: ${Object.keys(defs).join(', ')}`);
      let v = params[k];
      if (d.type === 'float' || d.type === 'int') {
        v = Number(v);
        if (!isFinite(v)) throw new Error(`PTL: параметр ${k} должен быть числом`);
        v = Math.min(d.hardMax ?? d.max, Math.max(d.hardMin ?? d.min, v));
        if (d.type === 'int') v = Math.round(v);
      } else if (d.type === 'enum') {
        if (!d.options.some(([ov]) => ov === v)) throw new Error(`PTL: ${k} = "${v}" недопустимо. Варианты: ${d.options.map((o) => o[0]).join(', ')}`);
      } else if (d.type === 'bool') v = !!v;
      else if (d.type === 'color') {
        if (!Array.isArray(v) || v.length < 3) throw new Error(`PTL: ${k} — массив [r,g,b,a] 0..1 (sRGB)`);
        v = [0, 1, 2, 3].map((i) => Math.min(1, Math.max(0, i < v.length ? +v[i] : 1)));
      } else if (d.type === 'ramp') {
        if (!Array.isArray(v) || v.length < 2 || v.length > 8) throw new Error(`PTL: ${k} — от 2 до 8 точек {p, c:[r,g,b,a]}`);
        v = v.map((s) => ({ p: Math.min(1, Math.max(0, +s.p)), c: [0, 1, 2, 3].map((i) => Math.min(1, Math.max(0, i < s.c.length ? +s.c[i] : 1))) }));
      } else if (d.type === 'text' || d.type === 'code') v = String(v);
      out[k] = v;
    }
    return out;
  }

  function toBytes(src) {
    if (src instanceof Uint8Array) return src;
    if (src instanceof ArrayBuffer) return new Uint8Array(src);
    if (typeof src === 'string') {
      const m = /^data:[^;]*;base64,(.*)$/.exec(src);
      return Assets.fromBase64(m ? m[1] : src);
    }
    throw new Error('PTL: изображение — Uint8Array, ArrayBuffer, base64 или data:URL');
  }

  const api = {
    version: '1.0',
    help() { const g = document.getElementById('ptl-agent-guide'); return g ? g.textContent.trim() : ''; },

    // ---- discovery
    nodeTypes() {
      return Object.entries(NODES).map(([type, d]) => ({
        type, title: d.title, category: d.cat,
        inputs: d.inputs.map((p, k) => ({ index: k, label: p.label, whenUnconnected: p.defText })),
        outputs: d.outputs.map((o, k) => ({ index: k, label: o })),
        params: d.params.map(paramInfo), presets: (d.presets || []).map((p) => p.label), help: d.help || '',
      }));
    },
    getGraph() { return JSON.parse(JSON.stringify(Graph.toJSON())); },
    getNode(id) { const n = need(id); return { id: n.id, type: n.type, x: n.x, y: n.y, params: JSON.parse(JSON.stringify(n.params)), error: Engine.errors.get(id) || null }; },
    getParams(id) { return JSON.parse(JSON.stringify(need(id).params)); },
    errors() { App.flush(); return Object.fromEntries(Engine.errors); },
    info() {
      return { resolution: Graph.state.resolution, previewResolution: App.previewRes(), floatTextures: GPU.float, precision: GPU.precisionNote,
        selected: App.state.selected, activeOutput: Graph.state.activeOutput, nodeCount: Graph.nodes.size, canUndo: History.canUndo(), canRedo: History.canRedo() };
    },

    // ---- editing
    addNode(type, opts = {}) {
      if (!NODES[type]) throw new Error(`PTL: неизвестный тип "${type}". Есть: ${Object.keys(NODES).join(', ')}`);
      let { x, y } = opts;
      if (x == null || y == null) {
        const xs = [...Graph.nodes.values()];
        x = xs.length ? Math.max(...xs.map((n) => n.x)) + 230 : 0;
        y = 0;
      }
      const n = Graph.addNode(type, x, y, checkParams(type, opts.params || {}));
      if (opts.select !== false && batchDepth === 0) App.state.selected = n.id;
      after();
      return n.id;
    },
    removeNode(id) { need(id); Graph.removeNode(id); if (App.state.selected === id) App.state.selected = null; after(); },
    duplicate(id) { const n = need(id); return api.addNode(n.type, { x: n.x + 30, y: n.y + 30, params: n.params }); },
    setParams(id, patch) {
      const n = need(id);
      const v = checkParams(n.type, patch);
      const def = NODES[n.type];
      if (def.presetParam && v[def.presetParam] && def.presetValues[v[def.presetParam]]) Object.assign(n.params, def.presetValues[v[def.presetParam]]);
      Object.assign(n.params, v);
      Graph.touch(n);
      after();
      return api.getParams(id);
    },
    applyPreset(id, label) {
      const n = need(id), pr = (NODES[n.type].presets || []).find((p) => p.label === label);
      if (!pr) throw new Error(`PTL: пресет "${label}" не найден. Есть: ${(NODES[n.type].presets || []).map((p) => p.label).join(' | ')}`);
      Object.assign(n.params, pr.apply); Graph.touch(n); after();
    },
    moveNode(id, x, y) { const n = need(id); n.x = Math.round(x); n.y = Math.round(y); after(); },
    connect(fromId, fromPort, toId, toPort) {
      need(fromId); need(toId);
      const err = Graph.connect(fromId, fromPort | 0, toId, toPort | 0);
      if (err) throw new Error('PTL: ' + err);
      after();
    },
    disconnect(toId, toPort) { need(toId); const ok = Graph.disconnect(toId, toPort | 0); after(); return ok; },
    select(id) { if (id != null) need(id); App.select(id || null); },
    setActiveOutput(id) { const n = need(id); if (n.type !== 'output') throw new Error('PTL: активным может быть только узел output'); Graph.state.activeOutput = id; after(); },
    setResolution(r) { App.setResolution(+r); },
    undo() { App.undo(); return History.canUndo(); },
    redo() { App.redo(); return History.canRedo(); },
    batch(fn) {
      batchDepth++;
      try { return fn(api); } finally {
        batchDepth--;
        if (batchDepth === 0 && batchDirty) { batchDirty = false; App.commit(); App.afterLoad(); }
      }
    },
    autoLayout() { App.autoLayout(); after(); },
    newProject() { App.newProject(); },
    loadExample(i) { App.loadExample(i | 0); },
    examples() { return EXAMPLES.map((e, i) => ({ index: i, title: e.title })); },

    // ---- images & projects
    async importImage(src, opts = {}) {
      const nodeId = opts.nodeId || null;
      if (nodeId) need(nodeId);
      const id = await App.loadImageBytes(toBytes(src), opts.name || 'image.png', nodeId, opts.x != null ? { x: opts.x, y: opts.y } : null);
      if (!id) throw new Error('PTL: не удалось загрузить изображение');
      if (opts.interp || opts.fit) api.setParams(id, { ...(opts.interp && { interp: opts.interp }), ...(opts.fit && { fit: opts.fit }) });
      return id;
    },
    saveProject() { return App.projectData(); },
    async loadProject(data) { await App.loadProjectData(typeof data === 'string' ? data : JSON.parse(JSON.stringify(data))); },

    // ---- rendering (fresh evaluation at the requested size, like export)
    render(id, opts = {}) {
      need(id);
      const size = opts.size || Graph.state.resolution;
      if (![256, 512, 1024, 2048].includes(size) && !(size >= 1 && size <= 4096)) throw new Error('PTL: size 1..4096');
      const r = Engine.renderBytes(id, opts.port || 0, size);
      return { width: size, height: size, space: r.space, rgba: r.bytes };
    },
    async renderPNG(id, opts = {}) {
      need(id);
      const size = opts.size || Graph.state.resolution;
      return (await App.encodeNode(id, opts.port || 0, size)).png;
    },
    async renderPNGBase64(id, opts) { return Assets.toBase64(await api.renderPNG(id, opts)); },
    async renderDataURL(id, opts) { return 'data:image/png;base64,' + (await api.renderPNGBase64(id, opts)); },
    pixel(id, x, y, opts = {}) {
      const r = api.render(id, opts);
      const o = (y * r.width + x) * 4;
      return Array.from(r.rgba.subarray(o, o + 4));
    },
    stats(id, opts = {}) {
      const r = api.render(id, { size: opts.size || 256, port: opts.port });
      const min = [255, 255, 255, 255], max = [0, 0, 0, 0], sum = [0, 0, 0, 0];
      for (let i = 0; i < r.rgba.length; i += 4) for (let c = 0; c < 4; c++) {
        const v = r.rgba[i + c]; if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v; sum[c] += v;
      }
      const n = r.rgba.length / 4;
      return { size: r.width, space: r.space, min, max, mean: sum.map((s) => +(s / n).toFixed(2)) };
    },
    async exportPNG(id, opts = {}) {
      id = id || Graph.state.activeOutput;
      need(id);
      await App.exportNode(id, opts.port || 0);
    },

    // ---- view
    setView(o) { Preview.setView(o || {}); },
    fitGraph() { GraphView.fit(); },
    whenIdle() { return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))); },

    // ---- testing hooks (used by the automated test suite)
    _test: {
      renderRaw(id, size, uvOff) {
        const r = Engine.renderBytes(id, 0, size, { uvOff: uvOff || [0, 0] });
        return { bytes: r.bytes, space: r.space };
      },
      cached(id, port) { return Engine.readCachedBytes(id, port || 0, App.state.displayRes); },
      liveTextures: () => GPU.liveTextures,
      historySize: () => History.size,
    },
  };
  return api;
})();
window.PTL = PTL;
