// ---------------------------------------------------------------------------
// Preview panel: draws the selected node's cached GPU result on the WebGL
// canvas (no readback), channel views, 3x3 tiling, half offset, normal
// lighting, zoom/pan, a pixel probe (single-pixel readback on hover) and the
// 3D material view (layouts 2D / 3D / 2D+3D in the same canvas).
// ---------------------------------------------------------------------------
const Preview = (() => {
  const $ = (s) => document.querySelector(s);
  const st = {
    view: 0, tile3: false, half: false, zoom: 1, pan: [0, 0], az: 135, el: 40, conv: 'auto', probe: null,
    layout: '2d', r2d: null, r3d: null,
    m: { mesh: 'cube', tiling: 1, yaw: 0.6, pitch: 0.45, dist: 4.2, az: 35, el: 40, light: 2.2, env: 0.9, nStrength: 1, autoRot: false },
  };
  let canvas, wrap, info, raf = 0, rotRaf = 0;

  function init() {
    canvas = $('#view'); wrap = $('#canvas-wrap'); info = $('#pinfo');
    document.querySelectorAll('#preview [data-view]').forEach((b) => b.addEventListener('click', () => setView({ mode: +b.dataset.view })));
    document.querySelectorAll('#preview [data-layout]').forEach((b) => b.addEventListener('click', () => { setView({ layout: b.dataset.layout }); if (b.dataset.layout !== '2d') App.quickMark('viewed'); }));
    $('#btn-tile').onclick = () => setView({ tile3: !st.tile3 });
    $('#btn-half').onclick = () => setView({ half: !st.half });
    $('#btn-vfit').onclick = () => { st.zoom = 1; st.pan = [0, 0]; draw(); };
    $('#l-az').oninput = () => { st.az = +$('#l-az').value; draw(); };
    $('#l-el').oninput = () => { st.el = +$('#l-el').value; draw(); };
    $('#l-conv').onchange = () => { st.conv = $('#l-conv').value; draw(); };
    $('#view-port').onchange = () => { App.state.viewPort = +$('#view-port').value; App.requestEval(); };
    $('#m-mesh').onchange = () => { st.m.mesh = $('#m-mesh').value; draw(); };
    $('#m-tiling').onchange = () => { st.m.tiling = +$('#m-tiling').value; draw(); };
    $('#m-az').oninput = () => { st.m.az = +$('#m-az').value; draw(); };
    $('#m-el').oninput = () => { st.m.el = +$('#m-el').value; draw(); };
    $('#m-light').oninput = () => { st.m.light = +$('#m-light').value; draw(); };
    $('#m-rot').onchange = () => { st.m.autoRot = $('#m-rot').checked; spin(); };
    new ResizeObserver(resize).observe(wrap);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = local(e);
      if (in3d(p)) { st.m.dist = Math.min(12, Math.max(2, st.m.dist * Math.exp(e.deltaY * 0.001))); draw(); return; }
      if (!st.r2d) return;
      const r = st.r2d;
      const mx = p[0] - r.x - r.w / 2, my = p[1] - r.y - r.h / 2;
      const z = Math.min(32, Math.max(0.1, st.zoom * Math.exp(-e.deltaY * 0.0015)));
      st.pan = [mx - ((mx - st.pan[0]) * z) / st.zoom, my - ((my - st.pan[1]) * z) / st.zoom];
      st.zoom = z;
      draw();
    }, { passive: false });
    canvas.addEventListener('pointerdown', (e) => {
      const p0 = local(e), dpr = devicePixelRatio || 1, sx = e.clientX, sy = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      let mv;
      if (in3d(p0)) {
        const m0 = { ...st.m };
        mv = (ev) => {
          const dx = ev.clientX - sx, dy = ev.clientY - sy;
          if (ev.shiftKey) {   // move the light
            st.m.az = ((m0.az + dx * 0.5 + 540) % 360) - 180; st.m.el = Math.min(90, Math.max(5, m0.el - dy * 0.3));
            $('#m-az').value = st.m.az; $('#m-el').value = st.m.el;
          } else { st.m.yaw = m0.yaw + dx * 0.01; st.m.pitch = Math.min(1.5, Math.max(-1.5, m0.pitch + dy * 0.01)); }
          draw();
        };
      } else {
        const pan0 = st.pan.slice();
        mv = (ev) => { st.pan = [pan0[0] + (ev.clientX - sx) * dpr, pan0[1] + (ev.clientY - sy) * dpr]; draw(); };
      }
      const up = () => { canvas.removeEventListener('pointermove', mv); canvas.removeEventListener('pointerup', up); };
      canvas.addEventListener('pointermove', mv);
      canvas.addEventListener('pointerup', up);
    });
    canvas.addEventListener('dblclick', (e) => {
      if (in3d(local(e))) { Object.assign(st.m, { yaw: 0.6, pitch: 0.45, dist: 4.2 }); } else { st.zoom = 1; st.pan = [0, 0]; }
      draw();
    });
    canvas.addEventListener('mousemove', (e) => { st.probe = [e.clientX, e.clientY]; scheduleInfo(); });
    canvas.addEventListener('mouseleave', () => { st.probe = null; scheduleInfo(); });
    syncButtons();
  }

  function local(e) {
    const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
  }
  const inR = (p, r) => r && p[0] >= r.x && p[1] >= r.y && p[0] < r.x + r.w && p[1] < r.y + r.h;
  const in3d = (p) => inR(p, st.r3d);

  function setView(o) {
    if ('mode' in o) st.view = o.mode;
    if ('tile3' in o) st.tile3 = !!o.tile3;
    if ('half' in o) st.half = !!o.half;
    if ('zoom' in o) st.zoom = o.zoom;
    if ('layout' in o && ['2d', '3d', 'split'].includes(o.layout)) { st.layout = o.layout; App.requestEval(); }
    if (o.material) Object.assign(st.m, o.material);
    syncButtons();
    spin();
    draw();
  }

  function syncButtons() {
    document.querySelectorAll('#preview [data-view]').forEach((b) => b.classList.toggle('on', +b.dataset.view === st.view));
    document.querySelectorAll('#preview [data-layout]').forEach((b) => b.classList.toggle('on', b.dataset.layout === st.layout));
    $('#btn-tile').classList.toggle('on', st.tile3);
    $('#btn-half').classList.toggle('on', st.half);
    $('#lightbar').classList.toggle('show', st.view === 6 && st.layout !== '3d');
    $('#bar3d').classList.toggle('show', st.layout !== '2d');
    $('#m-mesh').value = st.m.mesh; $('#m-tiling').value = st.m.tiling; $('#m-rot').checked = st.m.autoRot;
  }

  function spin() {
    cancelAnimationFrame(rotRaf);
    if (!st.m.autoRot || st.layout === '2d') return;
    let last = performance.now();
    const step = (now) => { st.m.yaw += (now - last) * 0.0006; last = now; draw(); rotRaf = requestAnimationFrame(step); };
    rotRaf = requestAnimationFrame(step);
  }

  function resize() {
    const dpr = devicePixelRatio || 1;
    const w = Math.max(1, Math.round(wrap.clientWidth * dpr)), h = Math.max(1, Math.round(wrap.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    draw();
  }

  // The result currently shown: selected node (or active output), chosen port.
  function current() {
    const id = App.viewedId();
    if (!id) return null;
    const node = Graph.nodes.get(id);
    const e = entryOf(id);
    if (!e) { const c = App.cachedFrame(); return c ? { id, node, entry: { key: 'frame' }, out: c, port: 0 } : { id, node, entry: null }; }
    const port = NODES[node.type].outputs.length > 1 ? Math.min(App.state.viewPort, e.outs.length - 1) : 0;
    const cached = App.cachedFrame();
    return { id, node, entry: e, out: cached || e.outs[port], port };
  }
  function entryOf(id) { return Engine.get(id, App.state.displayRes) || Engine.get(id, App.previewRes()); }

  // ---- material (3D) ----
  function outputByUsage(u) { return [...Graph.nodes.values()].find((n) => n.type === 'output' && n.params.usage === u) || null; }
  function materialIds() {
    if (st.layout === '2d') return [];
    return ['basecolor', 'normal', 'orm'].map(outputByUsage).filter(Boolean).map((n) => n.id);
  }
  function normalIsDX(outNode) {
    if (outNode.params.normalY === 'gl') return false;
    if (outNode.params.normalY === 'dx') return true;
    for (const id of Graph.upstream(outNode.id)) {
      const n = Graph.nodes.get(id);
      if (n && n.type === 'normal') return n.params.convention === 'dx';
    }
    return false;
  }
  function material(cur) {
    const m = { base: null, normal: null, orm: null, from: {} };
    const pick = (u) => {
      const n = outputByUsage(u);
      const e = n && entryOf(n.id);
      return e ? { node: n, out: e.outs[0], key: e.key } : null;
    };
    const b = pick('basecolor'), nn = pick('normal'), o = pick('orm');
    if (b) { m.base = { out: b.out, key: b.key, linear: b.out.space === 'color' }; m.from.base = b.node.params.filename; }
    else if (cur && cur.out) { m.base = { out: cur.out, key: cur.entry.key + ':' + cur.port, linear: cur.out.space === 'color' }; m.from.base = '(выбранная нода)'; }
    if (nn) { m.normal = { out: nn.out, key: nn.key, dx: normalIsDX(nn.node) }; m.from.normal = nn.node.params.filename; }
    if (o) { m.orm = { out: o.out, key: o.key }; m.from.orm = o.node.params.filename; }
    return m;
  }

  function normalConv(cur) {
    if (st.conv !== 'auto') return st.conv === 'dx';
    return !!(cur && cur.node && cur.node.type === 'normal' && cur.node.params.convention === 'dx');
  }

  function draw() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; drawNow(); });
  }

  function lightVec() {
    const a = (st.az * Math.PI) / 180, e = (st.el * Math.PI) / 180;
    return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
  }

  function layoutRegions() {
    const W = canvas.width, H = canvas.height;
    if (st.layout === '2d') return { r2d: { x: 0, y: 0, w: W, h: H }, r3d: null };
    if (st.layout === '3d') return { r2d: null, r3d: { x: 0, y: 0, w: W, h: H } };
    if (W >= H) { const a = Math.floor(W / 2); return { r2d: { x: 0, y: 0, w: a, h: H }, r3d: { x: a, y: 0, w: W - a, h: H } }; }
    const a = Math.floor(H / 2);
    return { r2d: { x: 0, y: 0, w: W, h: a }, r3d: { x: 0, y: a, w: W, h: H - a } };
  }

  function drawNow() {
    if (GPU.isLost()) return;
    const cur = current();
    const sel = $('#view-port');
    if (cur && cur.node && NODES[cur.node.type].outputs.length > 1) {
      const outs = NODES[cur.node.type].outputs;
      if (sel.options.length !== outs.length || sel.dataset.node !== cur.id) {
        sel.textContent = '';
        outs.forEach((o, k) => { const op = document.createElement('option'); op.value = k; op.textContent = 'Выход ' + o; sel.append(op); });
        sel.dataset.node = cur.id;
      }
      sel.value = App.state.viewPort;
      sel.style.display = '';
    } else sel.style.display = 'none';
    Object.assign(st, layoutRegions());
    const H = canvas.height;
    if (st.r2d) {
      const r = st.r2d;
      GPU.run('display', null, {
        u_tex: cur && cur.out ? cur.out.tex : null, u_has: !!(cur && cur.out), u_isColor: !!(cur && cur.out && cur.out.space === 'color'),
        u_view: st.view, u_canvas: [r.w, r.h], u_origin: [r.x, H - r.y - r.h], u_zoom: st.zoom, u_pan: st.pan,
        u_tile3: st.tile3, u_half: st.half, u_flip: true, u_ndx: normalConv(cur), u_light: lightVec(), u_bg: [0.063, 0.067, 0.078],
      }, { width: canvas.width, height: canvas.height, viewport: [r.x, H - r.y - r.h, r.w, r.h], samplers: { u_tex: 'repeat' } });
    }
    if (st.r3d) {
      const r = st.r3d;
      st.mat = material(cur);
      Material3D.draw([r.x, H - r.y - r.h, r.w, r.h], st.mat, st.m);
    }
    scheduleInfo();
  }

  let infoRaf = 0;
  function scheduleInfo() { if (!infoRaf) infoRaf = requestAnimationFrame(() => { infoRaf = 0; updateInfo(); }); }

  function updateInfo() {
    const cur = current();
    info.textContent = '';
    const add = (t, title) => { const s = document.createElement('span'); s.textContent = t; if (title) s.title = title; info.append(s); };
    if (st.layout !== '2d' && st.mat) {
      const f = st.mat.from;
      add(`3D: Base ${f.base || '—'} · Normal ${f.normal || '—'} · ORM ${f.orm || '—'}`,
        'Материал собирается из нод Output с назначением Base Color / Normal / ORM. Мышь: вращать, Shift+мышь: свет, колесо: приблизить, двойной щелчок: сброс.');
      if (st.layout === '3d') return;
    }
    if (!cur) { info.textContent = 'Нет выбранной ноды и основного Output.'; return; }
    if (cur.id === App.pinnedId()) {
      const b = document.createElement('button');
      b.className = 'pin-badge'; b.textContent = '📌 ' + nodeTitle(cur.node) + ' ✕';
      b.title = 'Превью закреплено за этой нодой: можно выбирать и настраивать другие ноды, а смотреть на неё. Щелчок — открепить (или двойной щелчок по ноде).';
      b.onclick = () => App.pinPreview(null);
      info.append(b);
    } else add(nodeTitle(cur.node) + (cur.id === App.state.selected ? '' : ' (основной выход)'), 'Двойной щелчок по ноде закрепляет её в превью.');
    if (!cur.out) return;
    const res = cur.out.tex.size;
    add(`${res}×${res}` + (res !== Graph.state.resolution ? ` (проект ${Graph.state.resolution})` : ''));
    add(cur.out.space === 'color' ? 'цвет sRGB' : 'данные', cur.out.space === 'color' ? 'Внутри — линейный свет; в файле и на экране — sRGB.' : 'Числа каналов записываются в файл без гамма-коррекции.');
    const texel = probeTexel(res);
    if (texel && !GPU.isLost()) {
      const raw = GPU.read(cur.out.tex, texel[0], texel[1], 1, 1);
      const b = ColorUtil.toBytes(raw, cur.out.space);
      add(`(${texel[0]}, ${texel[1]}): ${b[0]} ${b[1]} ${b[2]} ${b[3]}`, 'Значения пикселя как в экспортируемом 8-битном PNG (R G B A)');
    }
  }

  // Inverse of the display mapping: canvas point -> texel (x, y down).
  function probeTexel(res) {
    if (!st.probe || !st.r2d) return null;
    const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1, R = st.r2d;
    const fx = (st.probe[0] - r.left) * dpr - R.x, fy = (st.probe[1] - r.top) * dpr - R.y;
    if (fx < 0 || fy < 0 || fx >= R.w || fy >= R.h) return null;
    const size = Math.min(R.w, R.h) * st.zoom;
    let u = (fx - (R.w / 2 + st.pan[0])) / size + 0.5;
    let v = (fy - (R.h / 2 + st.pan[1])) / size + 0.5;
    if (st.tile3) { u = (u - 0.5) * 3 + 0.5; v = (v - 0.5) * 3 + 0.5; }
    const lim = st.tile3 ? 1 : 0;
    if (u < -lim || v < -lim || u >= 1 + lim || v >= 1 + lim) return null;
    if (st.half) { u += 0.5; v += 0.5; }
    u -= Math.floor(u); v -= Math.floor(v);
    return [Math.min(res - 1, Math.floor(u * res)), Math.min(res - 1, Math.floor(v * res))];
  }

  return { init, draw, resize, setView, materialIds, state: st };
})();
