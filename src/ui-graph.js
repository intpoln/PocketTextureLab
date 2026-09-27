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
    root.addEventListener('dragstart', (e) => e.preventDefault());   // no native drag of text/thumbnails
    bindTouch();
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
    head.querySelector('.t').textContent = nodeTitle(n);
    head.title = nodeTitle(n) + ' — ' + n.id;
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
      if (!e.target.classList.contains('dot')) App.select(n.id, { toggle: e.ctrlKey || e.metaKey || e.shiftKey, keep: true });
    });
    // double click: pin this node to the preview (again: unpin); single click only selects for editing
    el.addEventListener('dblclick', (e) => { if (!e.target.classList.contains('dot')) App.pinPreview(n.id); });
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
    rec.el.querySelector('.head .t').textContent = nodeTitle(n);
  }

  function refreshMarks() {
    for (const [id, rec] of els) {
      rec.el.classList.toggle('sel', App.state.multi.has(id) || id === App.state.selected);
      rec.el.classList.toggle('primary', id === App.state.selected && App.state.multi.size > 1);
      rec.el.classList.toggle('pinned', id === App.pinnedId());
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
  // Drags listen on the window, not on the grabbed element: a lost pointer capture (element
  // re-rendered, focus/selection elsewhere on the page) must not stop the drag halfway.
  function drag(e, onMove, onUp) {
    const target = e.currentTarget || e.target, pid = e.pointerId;
    try { target.setPointerCapture(pid); } catch (_) { /* optional */ }
    clearTextSelection();
    const move = (ev) => { if (ev.pointerId === pid) onMove(ev); };
    const up = (ev) => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      onUp(ev);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  }
  // A text selection left in another panel makes the browser start its own text drag-and-drop
  // (which cancels our pointer drag after a few pixels) — drop it when a graph drag begins.
  function clearTextSelection() {
    const s = window.getSelection && window.getSelection();
    if (s && s.rangeCount && !s.isCollapsed) s.removeAllRanges();
    const a = document.activeElement;
    if (a && a !== document.body && !root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) a.blur();   // commits a half-typed value
  }

  function startMove(e, id) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();   // no text selection / native drag from the header
    root.focus({ preventScroll: true });
    if (e.ctrlKey || e.metaKey || e.shiftKey) { App.select(id, { toggle: true }); return; }
    App.select(id, { keep: true });
    // move the whole selection when the grabbed node belongs to it
    const ids = App.state.multi.has(id) ? [...App.state.multi] : [id];
    const group = ids.map((k) => ({ n: Graph.nodes.get(k), rec: els.get(k) })).filter((g) => g.n && g.rec);
    const start = group.map((g) => [g.n.x, g.n.y]);
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    drag(e, (ev) => {
      const dx = (ev.clientX - sx) / view.z, dy = (ev.clientY - sy) / view.z;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      group.forEach((g, k) => {
        g.n.x = Math.round(start[k][0] + dx); g.n.y = Math.round(start[k][1] + dy);
        g.rec.el.style.left = g.n.x + 'px'; g.rec.el.style.top = g.n.y + 'px';
      });
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
      highlight(null);
      const hit = portUnder(ev.clientX, ev.clientY, 'in');
      if (hit) { tempWire = null; App.tryConnect(id, port, hit.id, hit.port); return; }
      if (overEmptyGraph(ev)) { QuickAdd.open(ev.clientX, ev.clientY, { ...toGraph(ev.clientX, ev.clientY), from: { id, port } }); return; }   // wire stays until a node is picked
      tempWire = null; drawWires();
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
      highlight(null);
      const hit = portUnder(ev.clientX, ev.clientY, 'out');
      if (hit) { tempWire = null; App.tryConnect(hit.id, hit.port, id, port); return; }
      if (overEmptyGraph(ev)) { QuickAdd.open(ev.clientX, ev.clientY, { ...toGraph(ev.clientX, ev.clientY), to: { id, port } }); return; }
      tempWire = null; drawWires();
    });
  }

  function overEmptyGraph(ev) {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    return !!(el && el.closest('#graph') && !el.closest('.node') && !el.closest('#graph-hud'));
  }
  function clearTempWire() { tempWire = null; drawWires(); }

  // Empty space: left drag = selection rectangle (like a desktop), right/middle drag = pan.
  // Touch: one finger on empty space pans, two fingers pinch-zoom.
  const touches = new Map();
  let pinch = null;
  function bindTouch() {
    root.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') touches.set(e.pointerId, [e.clientX, e.clientY]); }, true);
    root.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size !== 2) return;
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const r = root.getBoundingClientRect();
      if (!pinch) { pinch = { d, mx, my, z: view.z, x: view.x, y: view.y }; return; }
      const z = Math.min(2.5, Math.max(0.2, pinch.z * (d / pinch.d)));
      const gx = (pinch.mx - r.left - pinch.x) / pinch.z, gy = (pinch.my - r.top - pinch.y) / pinch.z;
      view.z = z; view.x = mx - r.left - gx * z; view.y = my - r.top - gy * z;
      applyView();
    }, true);
    const end = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
    root.addEventListener('pointerup', end, true);
    root.addEventListener('pointercancel', end, true);
  }

  function onBgDown(e) {
    if (e.target.closest('.node') || e.target.closest('#graph-hud')) return;
    if (e.pointerType === 'touch') {
      e.preventDefault();
      if (touches.size > 1) return;
      const sx = e.clientX, sy = e.clientY, ox = view.x, oy = view.y;
      let moved = false;
      drag(e, (ev) => {
        if (pinch || touches.size > 1) return;
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 6) moved = true;
        view.x = ox + ev.clientX - sx; view.y = oy + ev.clientY - sy; applyView();
      }, () => { if (!moved && !pinch) { App.select(null); App.selectLink(null); } });
      return;
    }
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    root.focus({ preventScroll: true });
    const sx = e.clientX, sy = e.clientY;
    if (e.button === 0) {
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      const before = add ? [...App.state.multi] : [];
      const r0 = root.getBoundingClientRect();
      const box = document.createElement('div');
      box.id = 'marquee';
      root.append(box);
      let active = false, hits = [];
      drag(e, (ev) => {
        if (!active && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
        active = true;
        const x0 = Math.min(sx, ev.clientX), y0 = Math.min(sy, ev.clientY), x1 = Math.max(sx, ev.clientX), y1 = Math.max(sy, ev.clientY);
        Object.assign(box.style, { left: x0 - r0.left + 'px', top: y0 - r0.top + 'px', width: x1 - x0 + 'px', height: y1 - y0 + 'px', display: 'block' });
        hits = [];
        for (const [id, rec] of els) {
          const b = rec.el.getBoundingClientRect();
          const hit = b.right > x0 && b.left < x1 && b.bottom > y0 && b.top < y1;
          rec.el.classList.toggle('sel', hit || before.includes(id));
          if (hit) hits.push(id);
        }
      }, () => {
        box.remove();
        if (!active) { if (!add) { App.select(null); App.selectLink(null); } return; }
        App.selectMany(hits, add);
      });
      return;
    }
    const ox = view.x, oy = view.y;
    root.classList.add('panning');
    let panned = false;
    drag(e, (ev) => { panned = true; view.x = ox + ev.clientX - sx; view.y = oy + ev.clientY - sy; applyView(); }, () => {
      root.classList.remove('panning');
      if (e.button === 2 && panned) root.addEventListener('contextmenu', (ce) => ce.preventDefault(), { once: true, capture: true });
    });
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
    const preset = e.dataTransfer.getData('text/ptl-preset');
    if (preset) { const pr = JSON.parse(preset); App.addNode(pr.type, pos.x - 88, pos.y - 20, pr.params); return; }
    const type = e.dataTransfer.getData('text/ptl-node');
    if (type) {
      const [t, extra] = type.split('#');
      const ex = extra != null ? CATALOG_EXTRA[+extra] : null;
      App.addNode(t, pos.x - 88, pos.y - 20, ex ? ex.params : undefined);
      return;
    }
    const files = [...(e.dataTransfer.files || [])];
    for (const [k, file] of files.entries()) {
      if (/\.json$/i.test(file.name)) App.openProjectFile(file);
      else App.loadImageFile(file, null, { x: pos.x + k * 30, y: pos.y + k * 30 });
    }
  }

  // Fit the whole graph; with opts.minZoom a large graph is not shrunk below it — the view is
  // anchored on the node `opts.focus` (e.g. the main output) so titles stay readable.
  function fit(opts = {}) {
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
    const f = opts.focus && Graph.nodes.get(opts.focus);
    if (opts.minZoom && z < opts.minZoom && f) {
      view.z = opts.minZoom;
      const fr = els.get(f.id), fw = fr ? fr.el.offsetWidth : 176, fh = fr ? fr.el.offsetHeight : 100;
      view.x = Math.min(r.width - pad - (f.x + fw) * view.z, pad - x0 * view.z);   // focus node near the right edge
      view.x = Math.max(view.x, r.width - pad - x1 * view.z);
      view.y = r.height / 2 - (f.y + fh / 2) * view.z;
    }
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

  return { init, rebuild, drawWires, clearTempWire, toGraph, refreshMarks, updateLabels, measure, center, fit, setThumb, thumbKey, view, applyView };
})();
