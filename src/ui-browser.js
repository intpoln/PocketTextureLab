// ---------------------------------------------------------------------------
// Preset browser: a side window with preview thumbnails of ready-made noises
// and effects. Click adds the node to the graph centre, or drag it onto the
// graph. Thumbnails are rendered once on the GPU (small, off-graph) and kept.
// ---------------------------------------------------------------------------
const PresetBrowser = (() => {
  const $ = (s) => document.querySelector(s);
  const TH = 88;
  const thumbs = new Map();   // key -> ImageData
  let tab = 'noise', queue = [], timer = 0, gen = -1;

  function items() {
    if (tab === 'noise') {
      return NOISE_PRESETS.map(([title, type, params, desc, group, ru], k) => ({ key: 'n' + k, title, type, params, desc, group, ru }));
    }
    return [
      ...FLARE_PRESETS.map(([title, desc, set, ru], k) => ({ key: 'fl' + k, title, ru, type: 'flare', desc, group: I18N.group('Оптические блики (Optical Flares)'), params: flarePreset(set) })),
      ...FX_LIST.map((fx) => ({
        key: 'fx:' + fx.id, title: fx.title, ru: fx.ru, type: 'fx', desc: fx.note, group: I18N.group(fx.oneShot ? 'Однократные' : 'Зацикленные'),
        params: { effect: fx.id, stops: fxStops(fx.palette), ...fx.defaults },
      })),
    ];
  }

  function init() {
    $('#btn-noises').onclick = () => open('noise');
    $('#btn-effects').onclick = () => open('fx');
    $('#nd-close').onclick = close;
    $('#nd-search').addEventListener('input', render);
    document.querySelectorAll('#noise-drawer [data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#noise-drawer').classList.contains('show')) close(); });
  }

  function open(t) {
    tab = t || tab;
    $('#noise-drawer').classList.add('show');
    render();
    $('#nd-search').focus();
  }
  function close() { $('#noise-drawer').classList.remove('show'); clearTimeout(timer); stopHover(); }
  const isOpen = () => $('#noise-drawer').classList.contains('show');

  function add(it, pos) {
    const c = pos || GraphView.center();
    const n = App.addNode(it.type, c.x - 88 + (pos ? 0 : Math.random() * 60 - 30), c.y - 50 + (pos ? 0 : Math.random() * 60 - 30), JSON.parse(JSON.stringify(it.params)));
    App.toast(`Добавлено: ${it.title}`);
    return n;
  }

  function render() {
    if (gen !== GPU.gen) { thumbs.clear(); gen = GPU.gen; }
    document.querySelectorAll('#noise-drawer [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const q = $('#nd-search').value.trim().toLowerCase();
    const body = $('#nd-body');
    body.textContent = '';
    queue = [];
    const list = items().filter((it) => !q || (it.title + ' ' + (it.ru || '') + ' ' + it.desc + ' ' + it.group).toLowerCase().includes(q));
    const groups = [...new Set(list.map((it) => it.group))];
    for (const g of groups) {
      const h = document.createElement('h4'); h.textContent = g; body.append(h);
      const grid = document.createElement('div'); grid.className = 'nd-grid'; body.append(grid);
      for (const it of list.filter((x) => x.group === g)) {
        const card = document.createElement('div');
        card.className = 'nd-card';
        card.title = (it.ru ? it.ru + ' — ' : '') + it.desc + '\n\nЩелчок — добавить в граф, или перетащите на граф';
        card.draggable = true;
        const cv = document.createElement('canvas'); cv.width = cv.height = TH;
        const lbl = document.createElement('div'); lbl.textContent = it.title;
        card.append(cv, lbl);
        card.addEventListener('click', () => add(it));
        if (it.type === 'fx' || it.type === 'flare') {   // animate the preview while hovered
          card.addEventListener('mouseenter', () => startHover(it, cv));
          card.addEventListener('mouseleave', stopHover);
        }
        card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/ptl-preset', JSON.stringify({ type: it.type, params: it.params, title: it.title })); e.dataTransfer.effectAllowed = 'copy'; });
        grid.append(card);
        if (thumbs.has(it.key)) cv.getContext('2d').putImageData(thumbs.get(it.key), 0, 0);
        else queue.push({ it, cv });
      }
    }
    if (!list.length) body.textContent = 'Ничего не найдено.';
    clearTimeout(timer);
    timer = setTimeout(pump, 20);
  }

  let hover = null;
  function startHover(it, cv) {
    stopHover();
    const t0 = performance.now();
    const step = () => {
      if (!hover || GPU.isLost()) return;
      const saved = Anim.t;
      try {
        Anim.t = ((performance.now() - t0) / 2000) % 1;
        const px = Engine.renderStandalone(it.type, { ...it.params, background: 'black' }, TH);
        cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, TH * TH * 4), TH, TH), 0, 0);
      } catch (e) { /* ignore */ } finally { Anim.t = saved; }
      hover.timer = setTimeout(step, 50);
    };
    hover = { it, cv, timer: 0 };
    step();
  }
  function stopHover() {
    if (!hover) return;
    clearTimeout(hover.timer);
    const { it, cv } = hover;
    hover = null;
    if (thumbs.has(it.key)) cv.getContext('2d').putImageData(thumbs.get(it.key), 0, 0);
  }

  // Render a few thumbnails per tick so the UI stays responsive.
  function pump() {
    if (!isOpen() || GPU.isLost()) return;
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 40) {
      const { it, cv } = queue.shift();
      let img;
      try {
        const saved = Anim.t;
        if (it.type === 'fx' || it.type === 'flare') Anim.t = 0.3;
        GPU.gl.getError();
        const px = Engine.renderStandalone(it.type, { ...it.params, ...(it.type === 'fx' || it.type === 'flare' ? { background: 'black' } : {}) }, TH);
        const glErr = GPU.gl.getError();
        if (glErr) { Anim.t = saved; cv.title = 'Видеодрайвер не смог выполнить этот шейдер (WebGL 0x' + glErr.toString(16) + ')'; continue; }
        Anim.t = saved;
        img = new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, TH * TH * 4), TH, TH);
        if (it.type !== 'fx' && it.type !== 'flare') for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      } catch (e) { console.warn(e); continue; }
      thumbs.set(it.key, img);
      cv.getContext('2d').putImageData(img, 0, 0);
    }
    if (queue.length) timer = setTimeout(pump, 16);
  }

  return { init, open, close, items: () => items() };
})();
