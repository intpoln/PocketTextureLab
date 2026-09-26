// ---------------------------------------------------------------------------
// Quick add: drop a wire on empty graph space (or press Tab over the graph)
// and a small searchable node menu opens right there. Type a name (English
// or Russian), pick with ↑/↓ + Enter or a click: the node is created at that
// spot with the wire already plugged into its first compatible port.
// ---------------------------------------------------------------------------
const QuickAdd = (() => {
  let box = null, input = null, listEl = null, ctx = null, items = [], sel = 0;

  const kindOk = (a, b) => a === 'any' || b === 'any' || a === b;

  function candidates() {
    const all = [];
    for (const [type, d] of Object.entries(NODES)) {
      if (ctx.from && !d.inputs.length) continue;
      if (ctx.to && !d.outputs.length) continue;
      if (type === 'output') continue;   // added below together with the typed Output entries
      all.push({ type, title: d.title, ru: d.ru, cat: d.cat, text: App.nodeSearchText(type) });
    }
    if (!ctx.to) {
      all.push({ type: 'output', title: 'Output', ru: 'Выход', cat: 'Выход', text: App.nodeSearchText('output') });
      CATALOG_EXTRA.forEach((x) => all.push({ type: x.type, title: x.title, ru: x.desc, cat: NODES[x.type].cat, params: x.params, text: (x.title + ' ' + x.desc + ' ' + App.nodeSearchText(x.type)).toLowerCase() }));
    }
    return all;
  }

  function filter() {
    const q = input.value.trim().toLowerCase();
    const all = candidates();
    if (!q) {
      const order = ['Источники', 'Узоры', 'Эффекты', 'Обработка', 'Размытие', 'Нормали', 'Каналы', 'Код', 'Выход'];
      items = all.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
    } else {
      const score = (it) => {
        const t = it.title.toLowerCase(), r = (it.ru || '').toLowerCase();
        if (t.startsWith(q) || r.startsWith(q)) return 0;
        if (t.split(/[\s/:]+/).some((w) => w.startsWith(q)) || r.split(/[\s/:()]+/).some((w) => w.startsWith(q))) return 1;
        if (t.includes(q) || r.includes(q)) return 2;
        return it.text.includes(q) ? 3 : 9;
      };
      items = all.map((it) => ({ it, s: score(it) })).filter((x) => x.s < 9).sort((a, b) => a.s - b.s).map((x) => x.it);
    }
    sel = 0;
    render();
  }

  function render() {
    listEl.textContent = '';
    let cat = null;
    const q = input.value.trim();
    items.forEach((it, k) => {
      if (!q && it.cat !== cat) {
        cat = it.cat;
        const h = document.createElement('div'); h.className = 'qa-cat'; h.textContent = I18N.cat(cat); listEl.append(h);
      }
      const row = document.createElement('div');
      row.className = 'qa-item' + (k === sel ? ' on' : '');
      row.innerHTML = '<span></span><small></small>';
      row.firstChild.textContent = it.title;
      row.lastChild.textContent = it.ru && it.ru.length < 40 ? it.ru : '';
      row.addEventListener('pointerdown', (e) => { e.preventDefault(); pick(k); });
      row.addEventListener('pointermove', () => { if (sel !== k) { sel = k; mark(); } });
      listEl.append(row);
    });
    if (!items.length) { const e = document.createElement('div'); e.className = 'qa-empty'; e.textContent = 'Ничего не найдено'; listEl.append(e); }
  }
  function mark() {
    const rows = listEl.querySelectorAll('.qa-item');
    rows.forEach((r, k) => r.classList.toggle('on', k === sel));
    if (rows[sel]) rows[sel].scrollIntoView({ block: 'nearest' });
  }

  function pick(k) {
    const it = items[k];
    if (!it) return;
    const c = ctx;
    close();
    App.quickAddNode(it.type, it.params, c);
  }

  // ctx: { x, y (graph coords of the drop), from?: {id, port}, to?: {id, port} }
  function open(clientX, clientY, context) {
    close();
    ctx = context;
    box = document.createElement('div');
    box.id = 'quickadd';
    box.innerHTML = '<input type="search" placeholder="Нода… (Enter — добавить, Esc — отмена)"><div class="qa-list"></div>';
    document.body.append(box);
    input = box.querySelector('input'); listEl = box.querySelector('.qa-list');
    const w = 260, h = 340;
    box.style.left = Math.max(4, Math.min(clientX, innerWidth - w - 4)) + 'px';
    box.style.top = Math.max(4, Math.min(clientY, innerHeight - h - 4)) + 'px';
    input.addEventListener('input', filter);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      e.stopPropagation();
    });
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    filter();
    input.focus();
  }
  function outside(e) { if (box && !box.contains(e.target)) close(); }
  function close() {
    document.removeEventListener('pointerdown', outside, true);
    if (box) box.remove();
    box = null; ctx = null;
    GraphView.clearTempWire();
  }
  const isOpen = () => !!box;

  // First port of the new node that accepts / produces the dragged wire's kind.
  function matchPort(node, dir, kind) {
    const n = (dir === 'in' ? NODES[node.type].inputs : NODES[node.type].outputs).length;
    for (let k = 0; k < n; k++) if (kindOk(portKind(node, dir, k), kind)) return k;
    return n ? 0 : -1;
  }

  return { open, close, isOpen, matchPort };
})();
