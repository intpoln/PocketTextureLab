// ---------------------------------------------------------------------------
// Graph view: HTML nodes + SVG wires, pan/zoom, drag to move / connect.
// ---------------------------------------------------------------------------
const GraphView = (() => {
  const $ = (s) => document.querySelector(s);
  let root, inner, nodesEl, wiresEl;
  const view = { x: 40, y: 40, z: 1 };
  const els = new Map();       // id -> { el, ports: {in:[], out:[]}, thumb }
  let tempWire = null;

  function init() {
    root = $('#graph'); inner = $('#graph-inner'); nodesEl = $('#nodes'); wiresEl = $('#wires');
    root.addEventListener('pointerdown', onBgDown);
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('dragover', (e) => { e.preventDefault(); });
    root.addEventListener('drop', onDrop);
    $('#btn-fit').onclick = fit;
    $('#btn-layout').onclick = () => { App.autoLayout(); App.commit(); rebuild(); fit(); };
    applyView();
  }

  function applyView() {
    inner.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    $('#zoom-label').textContent = Math.round(view.z * 100) + '%';
  }

  function toGraph(clientX, clientY) {
    const r = root.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z };
  }
  function center() {
    const r = root.getBoundingClientRect();
    return toGraph(r.left + r.width / 2, r.top + r.height / 2);
  }

  // ---- DOM build ----------------------------------------------------------
  function rebuild() {
    nodesEl.textContent = '';
    els.clear();
    for (const n of Graph.nodes.values()) buildNode(n);
    for (const n of Graph.nodes.values()) measure(n.id);
    refreshMarks();
    drawWires();
    $('#graph-empty').innerHTML = Graph.nodes.size ? '' : 'Граф пуст.<br>Перетащите ноду из каталога слева или выберите пример.';
  }

  function buildNode(n) {
    const def = NODES[n.type];
    const el = document.createElement('div');
    el.className = 'node';
    el.dataset.id = n.id;
    el.dataset.cat = def.cat;
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    const head = document.createElement('div');
    head.className = 'head';
    head.innerHTML = `<span class="t"></span><span class="badge out" title="Основной выход (экспорт)"></span><span class="badge err"></span>`;
    head.querySelector('.t').textContent = def.title;
    head.title = def.title + ' — ' + n.id;
    el.appendChild(head);
    const body = document.createElement('div');
    body.className = 'body';
    const ins = document.createElement('div'); ins.className = 'ins';
    const outs = document.createElement('div'); outs.className = 'outs';
    const rec = { el, ins: [], outs: [], thumb: null, pos: { in: [], out: [] }, thumbKey: null };
    def.inputs.forEach((p, k) => {
      const d = document.createElement('div');
      d.className = 'port in';
      d.innerHTML = '<span class="dot"></span><span class="lbl"></span>';
      d.querySelector('.lbl').textContent = inputLabel(n, k);
      d.dataset.port = k;
      d.querySelector('.dot').addEventListener('pointerdown', (e) => startWireFromIn(e, n.id, k));
      ins.appendChild(d);
      rec.ins.push(d);
    });
    const thumb = document.createElement('canvas');
    thumb.className = 'thumb'; thumb.width = thumb.height = 64;
    rec.thumb = thumb;
    def.outputs.forEach((label, k) => {
      const d = document.createElement('div');
      d.className = 'port out';
      d.innerHTML = '<span class="lbl"></span><span class="dot"></span>';
      d.querySelector('.lbl').textContent = label;
      d.dataset.port = k;
      d.querySelector('.dot').addEventListener('pointerdown', (e) => startWireFromOut(e, n.id, k));
      outs.appendChild(d);
      rec.outs.push(d);
    });
    body.append(ins, thumb, outs);
    el.appendChild(body);
    head.addEventListener('pointerdown', (e) => startMove(e, n.id));
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (!e.target.classList.contains('dot')) App.select(n.id);
    });
    el.addEventListener('dragover', (e) => { if (n.type === 'image') e.preventDefault(); });
    el.addEventListener('drop', (e) => {
      if (n.type !== 'image') return;
      e.preventDefault(); e.stopPropagation();
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) App.loadImageFile(file, n.id);
    });
    nodesEl.appendChild(el);
    els.set(n.id, rec);
  }

  // Port centres relative to the node's top-left, in graph units.
  function measure(id) {
    const rec = els.get(id);
    if (!rec) return;
    const nr = rec.el.getBoundingClientRect();
    const c = (d) => {
      const r = d.querySelector('.dot').getBoundingClientRect();
      return { x: (r.left + r.width / 2 - nr.left) / view.z, y: (r.top + r.height / 2 - nr.top) / view.z };
    };
    rec.pos.in = rec.ins.map(c);
    rec.pos.out = rec.outs.map(c);
  }

  function updateLabels(id) {
    const n = Graph.nodes.get(id), rec = els.get(id);
    if (!n || !rec) return;
    rec.ins.forEach((d, k) => { d.querySelector('.lbl').textContent = inputLabel(n, k); });
  }

  function refreshMarks() {
    for (const [id, rec] of els) {
      rec.el.classList.toggle('sel', id === App.state.selected);
      rec.el.querySelector('.badge.out').textContent = id === Graph.state.activeOutput ? '★' : '';
      const err = Engine.errors.get(id);
      const be = rec.el.querySelector('.badge.err');
      be.textContent = err ? '⚠' : '';
      be.title = err || '';
      const node = Graph.nodes.get(id), def = NODES[node.type];
      rec.ins.forEach((d, k) => {
        const kind = portKind(node, 'in', k), dot = d.querySelector('.dot');
        dot.className = 'dot k-' + kind + (Graph.inputLink(id, k) ? ' on' : '');
        d.title = `${inputLabel(node, k)} — принимает: ${KIND_TEXT[kind]}${kind === 'gray' ? ' (цвет будет сведён к яркости/каналу)' : ''}. Не подключён: ${def.inputs[k].defText}`;
      });
      rec.outs.forEach((d, k) => {
        const kind = portKind(node, 'out', k), dot = d.querySelector('.dot');
        dot.className = 'dot k-' + kind + (Graph.links.some((l) => l.from === id && l.fromPort === k) ? ' on' : '');
        d.title = `${def.outputs[k]} — выдаёт: ${KIND_TEXT[kind]}`;
      });
    }
  }

  function portPos(id, kind, k) {
    const n = Graph.nodes.get(id), rec = els.get(id);
    if (!n || !rec || !rec.pos[kind][k]) return { x: n ? n.x : 0, y: n ? n.y : 0 };
    return { x: n.x + rec.pos[kind][k].x, y: n.y + rec.pos[kind][k].y };
  }

  function curve(a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  }

  function drawWires() {
    const ns = 'http://www.w3.org/2000/svg';
    wiresEl.textContent = '';
    const sel = App.state.selectedLink;
    for (const l of Graph.links) {
      const d = curve(portPos(l.from, 'out', l.fromPort), portPos(l.to, 'in', l.toPort));
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      const src = Graph.nodes.get(l.from);
      p.setAttribute('class', 'w k-' + (src ? portKind(src, 'out', l.fromPort) : 'any') + (sel && sel.to === l.to && sel.toPort === l.toPort ? ' sel' : ''));
      const h = document.createElementNS(ns, 'path');
      h.setAttribute('d', d);
      h.setAttribute('class', 'hit');
      h.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (e.altKey) { Graph.disconnect(l.to, l.toPort); App.changed({ commit: true, structure: true }); return; }
        App.selectLink({ to: l.to, toPort: l.toPort });
      });
      h.addEventListener('contextmenu', (e) => { e.preventDefault(); Graph.disconnect(l.to, l.toPort); App.changed({ commit: true, structure: true }); });
      h.addEventListener('dblclick', (e) => { e.stopPropagation(); Graph.disconnect(l.to, l.toPort); App.changed({ commit: true, structure: true }); });
      const t = document.createElementNS(ns, 'title');
      t.textContent = 'Связь: щелчок — выбрать (Delete — удалить), двойной щелчок / ПКМ / Alt+щелчок — удалить';
      h.appendChild(t);
      wiresEl.append(p, h);
    }
    if (tempWire) {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', curve(tempWire.a, tempWire.b));
      p.setAttribute('class', 'temp');
      wiresEl.appendChild(p);
    }
  }

  // ---- interactions -------------------------------------------------------
  function drag(e, onMove, onUp) {
    const target = e.currentTarget || e.target;
    try { target.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    const move = (ev) => onMove(ev);
    const up = (ev) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      onUp(ev);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  function startMove(e, id) {
    if (e.button !== 0) return;
    e.stopPropagation();
    App.select(id);
    const n = Graph.nodes.get(id), rec = els.get(id);
    const sx = e.clientX, sy = e.clientY, ox = n.x, oy = n.y;
    let moved = false;
    drag(e, (ev) => {
      const dx = (ev.clientX - sx) / view.z, dy = (ev.clientY - sy) / view.z;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      n.x = Math.round(ox + dx); n.y = Math.round(oy + dy);
      rec.el.style.left = n.x + 'px'; rec.el.style.top = n.y + 'px';
      drawWires();
    }, () => { if (moved) App.commit(); });
  }

  function portUnder(x, y, kind) {
    const el = document.elementFromPoint(x, y);
    const port = el && el.closest && el.closest('.port.' + kind);
    if (!port) return null;
    const node = port.closest('.node');
    return { id: node.dataset.id, port: +port.dataset.port, el: port };
  }

  function highlight(hit) {
    document.querySelectorAll('.dot.target').forEach((d) => d.classList.remove('target'));
    if (hit) hit.el.querySelector('.dot').classList.add('target');
  }

  function startWireFromOut(e, id, port) {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    tempWire = { a: portPos(id, 'out', port), b: toGraph(e.clientX, e.clientY) };
    drawWires();
    drag(e, (ev) => { tempWire.b = toGraph(ev.clientX, ev.clientY); highlight(portUnder(ev.clientX, ev.clientY, 'in')); drawWires(); }, (ev) => {
      tempWire = null; highlight(null);
      const hit = portUnder(ev.clientX, ev.clientY, 'in');
      if (hit) App.tryConnect(id, port, hit.id, hit.port);
      else drawWires();
    });
  }

  // Dragging from an input: if connected, pick up the existing wire (drop on
  // empty space removes it); otherwise draw a wire back to an output.
  function startWireFromIn(e, id, port) {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const link = Graph.inputLink(id, port);
    if (link) {
      Graph.disconnect(id, port);
      tempWire = { a: portPos(link.from, 'out', link.fromPort), b: toGraph(e.clientX, e.clientY) };
      drawWires();
      drag(e, (ev) => { tempWire.b = toGraph(ev.clientX, ev.clientY); highlight(portUnder(ev.clientX, ev.clientY, 'in')); drawWires(); }, (ev) => {
        tempWire = null; highlight(null);
        const hit = portUnder(ev.clientX, ev.clientY, 'in');
        if (hit) {
          const err = Graph.connect(link.from, link.fromPort, hit.id, hit.port);
          if (err) { Graph.connect(link.from, link.fromPort, id, port); App.toast(err, 'err'); }
        }
        App.changed({ commit: true, structure: true });
      });
      return;
    }
    tempWire = { a: toGraph(e.clientX, e.clientY), b: portPos(id, 'in', port) };
    drag(e, (ev) => { tempWire.a = toGraph(ev.clientX, ev.clientY); highlight(portUnder(ev.clientX, ev.clientY, 'out')); drawWires(); }, (ev) => {
      tempWire = null; highlight(null);
      const hit = portUnder(ev.clientX, ev.clientY, 'out');
      if (hit) App.tryConnect(hit.id, hit.port, id, port);
      else drawWires();
    });
  }

  function onBgDown(e) {
    if (e.target.closest('.node') || e.target.closest('#graph-hud')) return;
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    root.focus({ preventScroll: true });
    if (e.button === 0) { App.select(null); App.selectLink(null); }
    const sx = e.clientX, sy = e.clientY, ox = view.x, oy = view.y;
    root.classList.add('panning');
    drag(e, (ev) => { view.x = ox + ev.clientX - sx; view.y = oy + ev.clientY - sy; applyView(); }, () => root.classList.remove('panning'));
  }

  function onWheel(e) {
    e.preventDefault();
    const r = root.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const z = Math.min(2.5, Math.max(0.2, view.z * Math.exp(-e.deltaY * 0.0015)));
    view.x = mx - ((mx - view.x) * z) / view.z;
    view.y = my - ((my - view.y) * z) / view.z;
    view.z = z;
    applyView();
  }

  function onDrop(e) {
    e.preventDefault();
    const pos = toGraph(e.clientX, e.clientY);
    const type = e.dataTransfer.getData('text/ptl-node');
    if (type) { App.addNode(type, pos.x - 88, pos.y - 20); return; }
    const files = [...(e.dataTransfer.files || [])];
    for (const [k, file] of files.entries()) {
      if (/\.json$/i.test(file.name)) App.openProjectFile(file);
      else App.loadImageFile(file, null, { x: pos.x + k * 30, y: pos.y + k * 30 });
    }
  }

  function fit() {
    const r = root.getBoundingClientRect();
    if (!Graph.nodes.size) { view.x = 40; view.y = 40; view.z = 1; applyView(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of Graph.nodes.values()) {
      const rec = els.get(n.id);
      const h = rec ? rec.el.offsetHeight : 100;
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + (rec ? rec.el.offsetWidth : 176)); y1 = Math.max(y1, n.y + h);
    }
    const pad = 40;
    const z = Math.min(1.25, Math.max(0.2, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0))));
    view.z = z;
    view.x = (r.width - (x1 - x0) * z) / 2 - x0 * z;
    view.y = (r.height - (y1 - y0) * z) / 2 - y0 * z;
    applyView();
  }

  function setThumb(id, rgba, key) {
    const rec = els.get(id);
    if (!rec) return;
    rec.thumbKey = key;
    const s = rec.thumb.width;
    const g = rec.thumb.getContext('2d');
    g.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, s * s * 4), s, s), 0, 0);
  }
  function thumbKey(id) { const r = els.get(id); return r ? r.thumbKey : null; }

  return { init, rebuild, drawWires, refreshMarks, updateLabels, measure, center, fit, setThumb, thumbKey, view, applyView };
})();
