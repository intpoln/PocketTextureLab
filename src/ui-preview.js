// ---------------------------------------------------------------------------
// Preview panel: draws the selected node's cached GPU result on the WebGL
// canvas (no readback), channel views, 3x3 tiling, half offset, normal
// lighting, zoom/pan and a pixel probe (single-pixel readback on hover).
// ---------------------------------------------------------------------------
const Preview = (() => {
  const $ = (s) => document.querySelector(s);
  const st = { view: 0, tile3: false, half: false, zoom: 1, pan: [0, 0], az: 135, el: 40, conv: 'auto', probe: null };
  let canvas, wrap, info, raf = 0;

  function init() {
    canvas = $('#view'); wrap = $('#canvas-wrap'); info = $('#pinfo');
    document.querySelectorAll('#preview [data-view]').forEach((b) => b.addEventListener('click', () => setView({ mode: +b.dataset.view })));
    $('#btn-tile').onclick = () => setView({ tile3: !st.tile3 });
    $('#btn-half').onclick = () => setView({ half: !st.half });
    $('#btn-vfit').onclick = () => { st.zoom = 1; st.pan = [0, 0]; draw(); };
    $('#l-az').oninput = () => { st.az = +$('#l-az').value; draw(); };
    $('#l-el').oninput = () => { st.el = +$('#l-el').value; draw(); };
    $('#l-conv').onchange = () => { st.conv = $('#l-conv').value; draw(); };
    $('#view-port').onchange = () => { App.state.viewPort = +$('#view-port').value; draw(); };
    new ResizeObserver(resize).observe(wrap);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
      const mx = (e.clientX - r.left) * dpr - canvas.width / 2, my = (e.clientY - r.top) * dpr - canvas.height / 2;
      const z = Math.min(32, Math.max(0.1, st.zoom * Math.exp(-e.deltaY * 0.0015)));
      st.pan = [mx - ((mx - st.pan[0]) * z) / st.zoom, my - ((my - st.pan[1]) * z) / st.zoom];
      st.zoom = z;
      draw();
    }, { passive: false });
    canvas.addEventListener('pointerdown', (e) => {
      const sx = e.clientX, sy = e.clientY, p0 = st.pan.slice(), dpr = devicePixelRatio || 1;
      canvas.setPointerCapture(e.pointerId);
      const mv = (ev) => { st.pan = [p0[0] + (ev.clientX - sx) * dpr, p0[1] + (ev.clientY - sy) * dpr]; draw(); };
      const up = () => { canvas.removeEventListener('pointermove', mv); canvas.removeEventListener('pointerup', up); };
      canvas.addEventListener('pointermove', mv);
      canvas.addEventListener('pointerup', up);
    });
    canvas.addEventListener('dblclick', () => { st.zoom = 1; st.pan = [0, 0]; draw(); });
    canvas.addEventListener('mousemove', (e) => { st.probe = [e.clientX, e.clientY]; scheduleInfo(); });
    canvas.addEventListener('mouseleave', () => { st.probe = null; scheduleInfo(); });
    syncButtons();
  }

  function setView(o) {
    if ('mode' in o) st.view = o.mode;
    if ('tile3' in o) st.tile3 = !!o.tile3;
    if ('half' in o) st.half = !!o.half;
    if ('zoom' in o) st.zoom = o.zoom;
    syncButtons();
    draw();
  }

  function syncButtons() {
    document.querySelectorAll('#preview [data-view]').forEach((b) => b.classList.toggle('on', +b.dataset.view === st.view));
    $('#btn-tile').classList.toggle('on', st.tile3);
    $('#btn-half').classList.toggle('on', st.half);
    $('#lightbar').classList.toggle('show', st.view === 6);
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
    const e = Engine.get(id, App.state.displayRes) || Engine.get(id, App.previewRes());
    if (!e) return { id, node, entry: null };
    const port = NODES[node.type].outputs.length > 1 ? Math.min(App.state.viewPort, e.outs.length - 1) : 0;
    return { id, node, entry: e, out: e.outs[port], port };
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
    GPU.run('display', null, {
      u_tex: cur && cur.out ? cur.out.tex : null, u_has: !!(cur && cur.out), u_isColor: !!(cur && cur.out && cur.out.space === 'color'),
      u_view: st.view, u_canvas: [canvas.width, canvas.height], u_zoom: st.zoom, u_pan: st.pan,
      u_tile3: st.tile3, u_half: st.half, u_flip: true, u_ndx: normalConv(cur), u_light: lightVec(), u_bg: [0.063, 0.067, 0.078],
    }, { width: canvas.width, height: canvas.height, samplers: { u_tex: 'repeat' } });
    scheduleInfo();
  }

  let infoRaf = 0;
  function scheduleInfo() { if (!infoRaf) infoRaf = requestAnimationFrame(() => { infoRaf = 0; updateInfo(); }); }

  function updateInfo() {
    const cur = current();
    info.textContent = '';
    if (!cur) { info.textContent = 'Нет выбранной ноды и основного Output.'; return; }
    const add = (t, title) => { const s = document.createElement('span'); s.textContent = t; if (title) s.title = title; info.append(s); };
    add(NODES[cur.node.type].title + (cur.id === App.state.selected ? '' : ' (основной выход)'));
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
    if (!st.probe) return null;
    const r = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    const fx = (st.probe[0] - r.left) * dpr, fy = (st.probe[1] - r.top) * dpr;
    const size = Math.min(canvas.width, canvas.height) * st.zoom;
    let u = (fx - (canvas.width / 2 + st.pan[0])) / size + 0.5;
    let v = (fy - (canvas.height / 2 + st.pan[1])) / size + 0.5;
    if (st.tile3) { u = (u - 0.5) * 3 + 0.5; v = (v - 0.5) * 3 + 0.5; }
    const lim = st.tile3 ? 1 : 0;
    if (u < -lim || v < -lim || u >= 1 + lim || v >= 1 + lim) return null;
    if (st.half) { u += 0.5; v += 0.5; }
    u -= Math.floor(u); v -= Math.floor(v);
    return [Math.min(res - 1, Math.floor(u * res)), Math.min(res - 1, Math.floor(v * res))];
  }

  return { init, draw, resize, setView, state: st };
})();
