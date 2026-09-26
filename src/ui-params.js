// ---------------------------------------------------------------------------
// Parameter panel. Built once per selection; slider movement only updates the
// model and the sibling number field, so focus and dragging are preserved.
// One slider drag = one undo step (commit on 'change').
// ---------------------------------------------------------------------------
const ParamsPanel = (() => {
  const $ = (s) => document.querySelector(s);
  let lastPreset = null;
  let el, current = null, rows = [], seamEl = null, errEl = null, portsEl = null;

  function init() { el = $('#params'); }

  function h(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    for (const c of kids) if (c != null) e.append(c);
    return e;
  }

  function set(node, key, value, commit) {
    node.params[key] = value;
    const def = NODES[node.type];
    let rebuildAll = false;
    if (def.presetParam === key && def.presetValues && def.presetValues[value]) {
      Object.assign(node.params, def.presetValues[value]);
      rebuildAll = true;
    }
    Graph.touch(node);
    App.changed({ commit, interactive: !commit, node: node.id });
    if (key === 'usage') { GraphView.updateLabels(node.id); Preview.draw(); build(); return; }
    if (rebuildAll) { GraphView.updateLabels(node.id); build(); }
    else refreshDynamic(key);
  }

  function build() {
    const id = App.state.selected;
    const node = id && Graph.nodes.get(id);
    el.textContent = '';
    rows = [];
    current = node || null;
    if (!node) { buildProject(); return; }
    const def = NODES[node.type];
    el.append(h('h3', { text: nodeTitle(node) }), h('div', { class: 'sub', text: `id: ${node.id} · ${def.cat}` }));
    const actions = h('div', { class: 'actions' },
      h('button', { text: 'Дублировать', title: 'Ctrl+D', onclick: () => App.duplicate(node.id) }),
      h('button', { text: 'Удалить', title: 'Delete', onclick: () => App.removeNode(node.id) }),
      h('button', { text: 'Экспорт PNG', title: 'Экспорт результата этой ноды', onclick: () => App.exportNode(node.id, App.state.viewPort) }));
    if (node.type === 'output') {
      actions.append(h('button', {
        text: Graph.state.activeOutput === node.id ? '★ Основной выход' : 'Сделать основным',
        onclick: () => { Graph.state.activeOutput = node.id; App.changed({ commit: true, structure: true }); build(); },
      }));
    }
    el.append(actions);
    const applyParams = (params) => {
      Object.assign(node.params, JSON.parse(JSON.stringify(params)));
      Graph.touch(node); GraphView.updateLabels(node.id); App.changed({ commit: true, node: node.id, structure: true }); build();
    };
    if (def.presets && def.presets.length > 6) {
      const sel = h('select', { title: 'Встроенные пресеты' }, h('option', { value: '', text: 'Пресет…' }));
      def.presets.forEach((pr, k) => sel.append(h('option', { value: k, text: pr.label })));
      sel.addEventListener('change', () => { if (sel.value !== '') applyParams(def.presets[+sel.value].apply); });
      el.append(h('div', { class: 'actions' }, sel));
    } else if (def.presets) {
      el.append(h('div', { class: 'actions' }, ...def.presets.map((pr) => h('button', { text: pr.label, onclick: () => applyParams(pr.apply) }))));
    }
    el.append(userPresetsRow(node, applyParams));
    if (def.desc) el.append(h('div', { class: 'sub', text: def.desc, style: 'color:var(--fg2);font-size:12px' }));
    if (def.help) el.append(h('div', { class: 'hint', text: def.help }));
    seamEl = h('div', { class: 'hint seam' });
    errEl = h('div', { class: 'hint err' });
    el.append(seamEl, errEl);
    if (def.inputs.length) {
      portsEl = h('div', { class: 'ports-list' });
      el.append(h('div', { class: 'group', text: 'Входы' }), portsEl);
    } else portsEl = null;
    let group = null;
    for (const d of def.params) {
      if (d.group && d.group !== group) { group = d.group; el.append(h('div', { class: 'group', text: 'Канал ' + group })); }
      const row = makeRow(node, d);
      rows.push({ d, row });
      el.append(row.el);
    }
    refreshDynamic();
  }

  function labelEl(d, node, text) {
    const l = h('label', { text: text || d.label });
    if (d.help) l.append(h('span', { class: 'q', title: d.help, text: '?' }));
    if (node && d.type !== 'image') {
      const on = Graph.isExposed(node.id, d.key);
      l.append(h('button', {
        class: 'pin' + (on ? ' on' : ''), text: '📌',
        title: on ? 'Убрать из параметров шаблона' : 'Вынести в параметры шаблона (видны, когда ни одна нода не выбрана)',
        onclick: (e) => {
          e.preventDefault();
          if (Graph.isExposed(node.id, d.key)) Graph.unexpose(node.id, d.key); else Graph.expose(node.id, d.key);
          App.commit(); build();
        },
      }));
    }
    return l;
  }

  // ⏱: animate a numeric parameter from its value (start) to an end value.
  function animControls(node, d, wrap, lab, norm) {
    const anim = () => node.anim && node.anim[d.key];
    const btn = h('button', { class: 'pin anim' + (anim() ? ' on' : ''), text: '⏱',
      title: anim() ? 'Убрать анимацию параметра' : 'Анимировать: значение ползунка — начало, ниже задаётся конец',
      onclick: (e) => {
        e.preventDefault();
        node.anim = node.anim || {};
        if (anim()) delete node.anim[d.key];
        else node.anim[d.key] = { to: d.key === 'evolution' || d.key === 'phase' ? node.params[d.key] + 1 : d.max, curve: 'linear' };
        Graph.touch(node); App.changed({ commit: true, node: node.id }); App.animChanged(); build();
      } });
    lab.insertBefore(btn, lab.querySelector('.pin'));
    if (!anim()) return;
    const a = anim();
    const hardMax = Math.max(d.hardMax ?? d.max, d.key === 'evolution' || d.key === 'phase' ? 64 : -Infinity);
    const to = h('input', { type: 'number', step: d.step, value: +(+a.to).toFixed(4), title: 'Значение в конце цикла (последний кадр стремится к нему)' });
    const curve = h('select');
    for (const [v, t] of Anim.CURVE_OPTS) curve.append(h('option', { value: v, text: t }));
    curve.value = a.curve;
    const apply = () => {
      let v = +to.value; if (!isFinite(v)) v = a.to;
      a.to = Math.min(hardMax, Math.max(d.hardMin ?? d.min, v));
      a.curve = curve.value;
      Graph.touch(node); App.changed({ commit: true, node: node.id }); App.animChanged();
    };
    to.addEventListener('change', apply);
    curve.addEventListener('change', apply);
    wrap.append(h('div', { class: 'ctl animrow' }, h('span', { text: '⏱ конец:' }), to, curve));
  }

  // Saved-in-browser presets for this node type.
  function userPresetsRow(node, applyParams) {
    const row = h('div', { class: 'actions' });
    if (!Library.available()) return row;
    const list = Library.nodePresets(node.type);
    const sel = h('select', { title: 'Ваши пресеты (хранятся в этом браузере)' }, h('option', { value: '', text: list.length ? `Мои пресеты (${list.length})…` : 'Мои пресеты: нет' }));
    list.forEach((pr, k) => sel.append(h('option', { value: k, text: pr.name })));
    const keep = list.findIndex((x) => x.name === lastPreset);
    if (keep >= 0) sel.value = keep;
    sel.addEventListener('change', () => {
      if (sel.value === '') return;
      lastPreset = list[+sel.value].name;
      applyParams(list[+sel.value].params);
      App.toast('Применён пресет «' + lastPreset + '»');
    });
    const name = h('input', { type: 'text', placeholder: 'имя пресета', style: 'width:110px;display:none' });
    const save = h('button', { text: '＋ Сохранить пресет', title: 'Сохранить текущие параметры ноды как пресет в браузере' });
    const del = h('button', { text: '✕', title: 'Удалить выбранный в списке пресет' });
    save.addEventListener('click', () => {
      if (name.style.display === 'none') { name.style.display = ''; name.focus(); save.textContent = 'OK'; return; }
      try { Library.saveNodePreset(node.type, name.value, node.params); App.toast('Пресет «' + name.value.trim() + '» сохранён в браузере.'); build(); }
      catch (e) { App.toast(e.message, 'err'); }
    });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); if (e.key === 'Escape') build(); });
    del.addEventListener('click', () => {
      if (sel.value === '') { App.toast('Выберите пресет в списке, затем нажмите ✕.', 'warn'); return; }
      Library.deleteNodePreset(node.type, list[+sel.value].name); build();
    });
    row.append(sel, name, save, list.length ? del : '');
    return row;
  }

  // Nothing selected: template parameters (exposed) + outputs.
  function buildProject() {
    const ex = Graph.state.exposed;
    el.append(h('h3', { text: 'Проект' }), h('div', { class: 'sub', text: `${Graph.nodes.size} нод · ${Graph.state.resolution}×${Graph.state.resolution}` }));
    const outs = [...Graph.nodes.values()].filter((n) => n.type === 'output');
    if (outs.length) {
      el.append(h('div', { class: 'group', text: 'Выходы' }));
      const box = h('div', { class: 'actions' });
      for (const o of outs) box.append(h('button', { text: (o.id === Graph.state.activeOutput ? '★ ' : '') + o.params.filename, title: 'Показать', onclick: () => App.select(o.id) }));
      box.append(h('button', { class: 'primary', text: 'Экспорт всех', onclick: () => App.exportAll() }));
      el.append(box);
    }
    el.append(h('div', { class: 'group', text: 'Параметры шаблона' }));
    if (!ex.length) {
      el.append(h('div', { class: 'hint', text: 'Здесь появляются вынесенные параметры: нажмите 📌 рядом с любым параметром ноды. Так готовый шаблон (например, кирпичная стена) настраивается несколькими ползунками без поиска по графу. Выберите ноду, чтобы увидеть все её параметры.' }));
      return;
    }
    for (const x of ex) {
      const node = Graph.nodes.get(x.node);
      const d = node && NODES[node.type].params.find((q) => q.key === x.key);
      if (!d) continue;
      const row = makeRow(node, { ...d, label: x.label, help: d.help });
      const lab = row.el.querySelector('label');
      lab.style.cursor = 'pointer';
      lab.title = `${NODES[node.type].title} (${node.id}) → ${d.label}. Щелчок — выбрать ноду.`;
      lab.addEventListener('click', (e) => { if (e.target === lab) App.select(node.id); });
      el.append(row.el);
    }
  }

  function resetBtn(onclick) { return h('button', { class: 'reset', title: 'Сбросить к значению по умолчанию', text: '↺', onclick }); }

  function makeRow(node, d) {
    const p = node.params;
    const wrap = h('div', { class: 'prow' });
    wrap.dataset.key = d.key;
    const row = { el: wrap, sync: () => {} };
    if (d.type === 'float' || d.type === 'int') {
      const isInt = () => d.type === 'int' || (d.intWhen && d.intWhen(p));
      const range = h('input', { type: 'range', min: d.min, max: d.max, step: d.step });
      const num = h('input', { type: 'number', min: d.hardMin ?? d.min, max: d.hardMax ?? d.max, step: d.step });
      const norm = (v) => {
        v = +v;
        if (!isFinite(v)) v = d.def;
        v = Math.min(d.hardMax ?? d.max, Math.max(d.hardMin ?? d.min, v));
        return isInt() ? Math.round(v) : v;
      };
      row.sync = () => { range.value = p[d.key]; num.value = +(+p[d.key]).toFixed(4); range.step = isInt() ? 1 : d.step; num.step = range.step; };
      range.addEventListener('input', () => { const v = norm(range.value); num.value = v; set(node, d.key, v, false); });
      range.addEventListener('change', () => { const v = norm(range.value); set(node, d.key, v, true); row.sync(); });
      num.addEventListener('change', () => { const v = norm(num.value); set(node, d.key, v, true); row.sync(); });
      num.addEventListener('keydown', (e) => { if (e.key === 'Enter') num.dispatchEvent(new Event('change')); });
      const lab = labelEl(d, node);
      wrap.append(lab, h('div', { class: 'ctl' }, range, num, resetBtn(() => { set(node, d.key, d.def, true); row.sync(); })));
      animControls(node, d, wrap, lab, norm);
    } else if (d.type === 'enum') {
      const sel = h('select');
      for (const [v, t] of d.options) sel.append(h('option', { value: v, text: t }));
      row.sync = () => { sel.value = p[d.key]; };
      sel.addEventListener('change', () => set(node, d.key, sel.value, true));
      wrap.append(labelEl(d, node), h('div', { class: 'ctl' }, sel, resetBtn(() => { set(node, d.key, d.def, true); row.sync(); })));
    } else if (d.type === 'bool') {
      wrap.classList.add('inline');
      const cb = h('input', { type: 'checkbox' });
      row.sync = () => { cb.checked = !!p[d.key]; };
      cb.addEventListener('change', () => set(node, d.key, cb.checked, true));
      const l = labelEl(d, node);
      l.prepend(cb);
      wrap.append(l, resetBtn(() => { set(node, d.key, d.def, true); row.sync(); }));
    } else if (d.type === 'text') {
      const t = h('input', { type: 'text' });
      t.style.flex = '1';
      row.sync = () => { t.value = p[d.key]; };
      t.addEventListener('change', () => set(node, d.key, t.value.replace(/[\\/:*?"<>|]/g, '_') || d.def, true));
      wrap.append(labelEl(d, node), h('div', { class: 'ctl' }, t));
    } else if (d.type === 'color') {
      const c = h('input', { type: 'color' });
      const a = h('input', { type: 'range', min: 0, max: 1, step: 0.001 });
      const an = h('input', { type: 'number', min: 0, max: 1, step: 0.01 });
      row.sync = () => { c.value = ColorUtil.hex(p[d.key]); a.value = p[d.key][3]; an.value = +p[d.key][3].toFixed(3); };
      const val = () => [...ColorUtil.fromHex(c.value), Math.min(1, Math.max(0, +a.value))];
      c.addEventListener('input', () => set(node, d.key, val(), false));
      c.addEventListener('change', () => set(node, d.key, val(), true));
      a.addEventListener('input', () => { an.value = a.value; set(node, d.key, val(), false); });
      a.addEventListener('change', () => set(node, d.key, val(), true));
      an.addEventListener('change', () => { a.value = Math.min(1, Math.max(0, +an.value || 0)); set(node, d.key, val(), true); row.sync(); });
      wrap.append(labelEl(d, node), h('div', { class: 'ctl' }, c, h('span', { text: 'α' }), a, an,
        resetBtn(() => { set(node, d.key, d.def.slice(), true); row.sync(); })));
    } else if (d.type === 'ramp') {
      buildRamp(node, d, wrap, row);
    } else if (d.type === 'image') {
      buildImage(node, d, wrap, row);
    } else if (d.type === 'code') {
      const ta = h('textarea', { spellcheck: 'false' });
      row.sync = () => { ta.value = p[d.key]; };
      const apply = () => { if (ta.value !== p[d.key]) set(node, d.key, ta.value, true); };
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); }
        else if (e.key === 'Tab') {
          e.preventDefault();
          const s = ta.selectionStart;
          ta.setRangeText('  ', s, ta.selectionEnd, 'end');
        }
      });
      ta.addEventListener('blur', apply);
      wrap.append(labelEl(d, node), ta, h('div', { class: 'ctl' },
        h('button', { class: 'primary', text: 'Применить (Ctrl+Enter)', onclick: apply }),
        resetBtn(() => { set(node, d.key, d.def, true); row.sync(); })));
    }
    row.sync();
    return row;
  }

  // ---- Color Ramp editor --------------------------------------------------
  function buildRamp(node, d, wrap, row) {
    const p = node.params;
    let selIdx = 0;
    const bar = h('div', { class: 'bar', title: 'Двойной щелчок — добавить точку' });
    const cv = h('canvas', { width: 256, height: 1 });
    bar.append(cv);
    const marks = h('div', { class: 'marks' });
    const pos = h('input', { type: 'number', min: 0, max: 1, step: 0.01 });
    const col = h('input', { type: 'color' });
    const al = h('input', { type: 'number', min: 0, max: 1, step: 0.01, title: 'Альфа' });
    const add = h('button', { text: '+ точка' });
    const del = h('button', { text: '− точка' });
    const stops = () => p[d.key];
    const commit = (c) => set(node, d.key, stops(), c);

    function draw() { drawBar(); drawMarks(); }
    function drawBar() {
      const g = cv.getContext('2d');
      const img = g.createImageData(256, 1);
      const s = sortStops(stops());
      const interp = p.interp;
      for (let x = 0; x < 256; x++) {
        const t = (x + 0.5) / 256;
        let c;
        if (t < s[0].p) c = s[0].c;
        else if (t >= s[s.length - 1].p) c = s[s.length - 1].c;
        else {
          for (let k = 0; k < s.length - 1; k++) {
            if (t >= s[k].p && t < s[k + 1].p) {
              let f = (t - s[k].p) / (s[k + 1].p - s[k].p);
              if (interp === 'constant') f = 0; else if (interp === 'smooth') f = f * f * (3 - 2 * f);
              c = s[k].c.map((v, j) => v + (s[k + 1].c[j] - v) * f);
              break;
            }
          }
        }
        for (let j = 0; j < 4; j++) img.data[x * 4 + j] = Math.round(c[j] * 255);
      }
      g.putImageData(img, 0, 0);
    }
    function drawMarks() {
      marks.textContent = '';
      stops().forEach((st, k) => {
        const m = h('div', { class: 'mk' + (k === selIdx ? ' sel' : ''), title: `Точка ${k + 1}: ${st.p.toFixed(3)}` });
        m.style.left = st.p * 100 + '%';
        m.style.background = ColorUtil.hex(st.c);
        m.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          selIdx = k; syncEdit(); draw();
          const r = marks.getBoundingClientRect();
          m.setPointerCapture(e.pointerId);
          let moved = false;
          const mv = (ev) => {
            moved = true;
            stops()[k].p = Math.min(1, Math.max(0, +((ev.clientX - r.left) / r.width).toFixed(4)));
            m.style.left = stops()[k].p * 100 + '%';
            pos.value = stops()[k].p;
            commit(false); redrawBar();
          };
          const up = () => { m.removeEventListener('pointermove', mv); m.removeEventListener('pointerup', up); if (moved) commit(true); draw(); };
          m.addEventListener('pointermove', mv);
          m.addEventListener('pointerup', up);
        });
        marks.append(m);
      });
      add.disabled = stops().length >= 8;
      del.disabled = stops().length <= 2;
    }
    function redrawBar() { drawBar(); }
    function syncEdit() {
      const st = stops()[selIdx] || stops()[0];
      pos.value = +st.p.toFixed(4); col.value = ColorUtil.hex(st.c); al.value = +st.c[3].toFixed(3);
    }
    function colorAt(t) {
      const s = sortStops(stops());
      if (t <= s[0].p) return s[0].c.slice();
      for (let k = 0; k < s.length - 1; k++) if (t >= s[k].p && t <= s[k + 1].p) {
        const f = s[k + 1].p > s[k].p ? (t - s[k].p) / (s[k + 1].p - s[k].p) : 0;
        return s[k].c.map((v, j) => v + (s[k + 1].c[j] - v) * f);
      }
      return s[s.length - 1].c.slice();
    }
    function addAt(t) {
      if (stops().length >= 8) { App.toast('Максимум 8 точек.', 'warn'); return; }
      stops().push({ p: +t.toFixed(4), c: colorAt(t) });
      selIdx = stops().length - 1;
      commit(true); syncEdit(); draw();
    }
    pos.addEventListener('change', () => { stops()[selIdx].p = Math.min(1, Math.max(0, +pos.value || 0)); commit(true); syncEdit(); draw(); });
    col.addEventListener('input', () => { const c = ColorUtil.fromHex(col.value); stops()[selIdx].c = [...c, stops()[selIdx].c[3]]; commit(false); draw(); });
    col.addEventListener('change', () => commit(true));
    al.addEventListener('change', () => { stops()[selIdx].c[3] = Math.min(1, Math.max(0, +al.value || 0)); commit(true); syncEdit(); draw(); });
    add.addEventListener('click', () => {
      const s = sortStops(stops());
      let best = 0, gap = -1;
      for (let k = 0; k < s.length - 1; k++) if (s[k + 1].p - s[k].p > gap) { gap = s[k + 1].p - s[k].p; best = k; }
      addAt(s.length > 1 ? (s[best].p + s[best + 1].p) / 2 : 0.5);
    });
    del.addEventListener('click', () => {
      if (stops().length <= 2) return;
      stops().splice(selIdx, 1);
      selIdx = Math.max(0, selIdx - 1);
      commit(true); syncEdit(); draw();
    });
    bar.addEventListener('dblclick', (e) => { const r = bar.getBoundingClientRect(); addAt(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))); });
    row.sync = () => { if (selIdx >= stops().length) selIdx = 0; syncEdit(); draw(); };
    row.refresh = draw;
    const box = h('div', { class: 'ramp' }, bar, marks,
      h('div', { class: 'edit' }, h('span', { text: 'Позиция' }), pos, col, h('span', { text: 'α' }), al, add, del,
        resetBtn(() => { set(node, d.key, JSON.parse(JSON.stringify(d.def)), true); selIdx = 0; row.sync(); })));
    wrap.append(labelEl(d, node), box);
  }

  // ---- Image loader -------------------------------------------------------
  function buildImage(node, d, wrap, row) {
    const info = h('div');
    const box = h('div', { class: 'imgbox' }, info,
      h('div', {}, h('button', { text: 'Загрузить PNG / JPEG…', onclick: () => App.pickImage(node.id) })),
      h('div', { text: 'или перетащите файл сюда / на ноду', style: 'margin-top:4px;color:var(--fg3)' }));
    box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drag'); });
    box.addEventListener('dragleave', () => box.classList.remove('drag'));
    box.addEventListener('drop', (e) => {
      e.preventDefault(); box.classList.remove('drag');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) App.loadImageFile(file, node.id);
    });
    row.sync = () => {
      const a = Assets.get(node.params[d.key]);
      info.textContent = '';
      if (!a) { info.append(h('div', { text: 'Файл не загружен — выход чёрный (0,0,0,1).' })); return; }
      info.append(h('div', { text: a.name, style: 'color:var(--fg);font-weight:600;word-break:break-all' }),
        h('div', { text: `${a.width}×${a.height} · ${a.mime === 'image/png' ? 'PNG ' + a.bitDepth + ' бит' : 'JPEG'}` }));
      const proj = Graph.state.resolution;
      if (a.width !== proj || a.height !== proj) info.append(h('div', { text: `Отличается от проекта (${proj}×${proj}) — применяется режим приведения ниже.`, style: 'color:var(--warn)' }));
      for (const n of a.notes) info.append(h('div', { text: n, style: 'color:var(--warn)' }));
    };
    wrap.append(labelEl(d, node), box);
  }

  // Visibility conditions, seam hints, input status, errors.
  function refreshDynamic(changedKey) {
    const node = current;
    if (!node || !Graph.nodes.has(node.id)) return;
    const def = NODES[node.type];
    for (const { d, row } of rows) {
      row.el.style.display = d.visible && !d.visible(node.params) ? 'none' : '';
      if (d.intWhen) row.sync();
      if (row.refresh && d.key !== changedKey) row.refresh();
    }
    const seam = [def.seam, def.seamFn && def.seamFn(node.params)].filter(Boolean).join(' ');
    seamEl.textContent = seam ? 'Швы: ' + seam : '';
    seamEl.style.display = seam ? '' : 'none';
    refreshStatus();
  }

  function refreshStatus() {
    const node = current;
    if (!node || !el.contains(errEl)) return;
    const err = Engine.errors.get(node.id);
    errEl.textContent = err ? 'Ошибка: ' + err : '';
    errEl.style.display = err ? '' : 'none';
    if (portsEl) {
      const def = NODES[node.type];
      portsEl.textContent = '';
      def.inputs.forEach((pdef, k) => {
        const l = Graph.inputLink(node.id, k);
        const line = h('div');
        const kind = portKind(node, 'in', k);
        line.append(h('span', { class: 'port', style: 'display:inline-flex;height:auto;vertical-align:middle;margin-right:4px', title: 'Принимает: ' + KIND_TEXT[kind] },
          h('span', { class: 'dot on k-' + kind, style: 'width:10px;height:10px;cursor:default' })));
        if (l) {
          const src = Graph.nodes.get(l.from);
          line.append(`${inputLabel(node, k)} ← ${NODES[src.type].title} (${src.id})`);
        } else line.append(`${inputLabel(node, k)}: не подключён → ${pdef.defText}`);
        portsEl.append(line);
      });
    }
  }

  function syncAll() { for (const { row } of rows) row.sync(); refreshDynamic(); }

  return { init, build, refreshStatus, syncAll, get node() { return current; } };
})();
