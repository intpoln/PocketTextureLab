// ---------------------------------------------------------------------------
// Application controller: wiring between model, engine and UI.
// ---------------------------------------------------------------------------
const App = (() => {
  const $ = (s) => document.querySelector(s);
  const state = { selected: null, selectedLink: null, viewPort: 0, interactive: false, displayRes: 512, dirty: false, ready: false };
  let evalRaf = 0, idleTimer = 0, thumbQueue = [], thumbTimer = 0;
  const CAT_ORDER = ['Источники', 'Узоры', 'Обработка', 'Размытие', 'Нормали', 'Каналы', 'Код', 'Выход'];
  const KEYWORDS = {
    image: 'png jpeg jpg файл картинка', constant: 'color цвет value', noise: 'perlin value fbm шум worley white ridged billow облака clouds', voronoi: 'cells worley клетки трещины crackle камни',
    shape: 'circle rect ring круг квадрат кольцо эллипс', gradient: 'ramp linear radial angular', levels: 'уровни контраст',
    invert: 'инверсия negative', grayscale: 'desaturate luminance канал channel', ramp: 'colorize градиент палитра gradient map',
    hsv: 'hue saturation value оттенок', blend: 'mix add multiply screen смешать', transform: 'move scale rotate offset сдвиг поворот',
    gaussian: 'blur размытие', dirblur: 'blur motion размытие', radialblur: 'blur zoom spin размытие', normal: 'normal map bump высота',
    split: 'channels каналы', waves: 'stripes sine полосы дерево мрамор wood marble', tiler: 'tile sampler bricks кирпичи плитка паркет сетка', splatter: 'scatter разброс камни гравий пятна листья царапины stones', warp: 'distort искажение деформация', combine: 'pack orm hdrp mask упаковка', code: 'glsl shader шейдер custom скрипт', output: 'export экспорт',
  };

  // ---------------------------------------------------------------- init
  function init() {
    const canvas = $('#view');
    let ok = false;
    try { ok = GPU.init(canvas, { forceRGBA8: /[?&]rgba8\b/.test(location.search) }); } catch (e) { console.error(e); }
    if (!ok) { fatal(); return false; }
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      $('#lost').classList.add('show');
      Engine.dropGpu(); Assets.dropGpu();
      status('Контекст WebGL потерян. Граф и параметры не затронуты.', true);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      GPU.setup({ forceRGBA8: /[?&]rgba8\b/.test(location.search) });
      $('#lost').classList.remove('show');
      status('Контекст WebGL восстановлен, граф пересчитан.');
      GraphView.rebuild();
      requestEval();
    });
    GraphView.init(); ParamsPanel.init(); Preview.init();
    buildCatalog(); bindToolbar(); bindKeys(); bindSplitters();
    $('#status-gpu').textContent = GPU.precisionNote;
    $('#status-gpu').title = GPU.precisionNote;
    window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
    loadGraph(EXAMPLES[0].graph);
    History.reset();
    state.dirty = false;
    state.ready = true;
    updateUndo();
    requestAnimationFrame(() => GraphView.fit());
    return true;
  }

  function fatal() {
    const box = $('#fatal-box');
    box.innerHTML = `<h2 style="margin-top:0;color:var(--err)">WebGL2 недоступен</h2>
      <p>Pocket Texture Lab выполняет всю обработку изображений на видеокарте через WebGL2, а этот браузер не смог создать контекст WebGL2.</p>
      <ul><li>Используйте современный Chrome, Edge, Thorium или Firefox.</li>
      <li>Включите аппаратное ускорение в настройках браузера и перезапустите его.</li>
      <li>В Chromium проверьте страницу <code>chrome://gpu</code> — WebGL2 должен быть «Hardware accelerated».</li>
      <li>Видеодрайвер может быть в чёрном списке браузера — обновите драйвер.</li></ul>
      <p>Программная (CPU) обработка в этой версии не предусмотрена.</p>`;
    $('#fatal').classList.add('show');
  }

  // ---------------------------------------------------------------- UI bits
  function buildCatalog() {
    const list = $('#catalog-list'), search = $('#search');
    const render = () => {
      const q = search.value.trim().toLowerCase();
      list.textContent = '';
      let first = true;
      for (const cat of CAT_ORDER) {
        const items = Object.keys(NODES).filter((t) => NODES[t].cat === cat &&
          (!q || (NODES[t].title + ' ' + t + ' ' + (KEYWORDS[t] || '')).toLowerCase().includes(q)));
        if (!items.length) continue;
        const h = document.createElement('h4'); h.textContent = cat; list.append(h);
        for (const t of items) {
          const it = document.createElement('div');
          it.className = 'item' + (q && first ? ' hl' : '');
          first = false;
          it.textContent = NODES[t].title;
          it.dataset.type = t;
          it.title = (NODES[t].desc ? NODES[t].desc + '\n\n' : '') + 'Щелчок — добавить в центр графа, или перетащите на граф';
          it.draggable = true;
          it.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/ptl-node', t); e.dataTransfer.effectAllowed = 'copy'; });
          it.addEventListener('click', () => { const c = GraphView.center(); addNode(t, c.x - 88 + (Math.random() * 40 - 20), c.y - 50 + (Math.random() * 40 - 20)); });
          list.append(it);
        }
      }
    };
    search.addEventListener('input', render);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const it = list.querySelector('.item'); if (it) it.click(); }
      if (e.key === 'Escape') { search.value = ''; render(); }
    });
    render();
  }

  function bindToolbar() {
    const ex = $('#examples');
    refreshExamplesMenu();
    ex.onchange = () => {
      const v = ex.value;
      ex.value = '';
      if (v.startsWith('ex:')) loadExample(+v.slice(3));
      else if (v.startsWith('tpl:')) loadUserTemplate(v.slice(4));
    };
    $('#btn-lib').onclick = () => showLibrary();
    $('#btn-new').onclick = () => newProject();
    $('#btn-open').onclick = () => $('#file-project').click();
    $('#file-project').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openProjectFile(f); };
    $('#btn-save').onclick = () => saveProject();
    $('#btn-undo').onclick = undo;
    $('#btn-redo').onclick = redo;
    $('#res').onchange = () => setResolution(+$('#res').value);
    $('#pres').onchange = () => requestEval();
    $('#btn-export').onclick = () => exportActive();
    $('#btn-export-sel').onclick = () => { if (state.selected) exportNode(state.selected, state.viewPort); else toast('Сначала выберите ноду.', 'warn'); };
    $('#btn-help').onclick = () => showHelp();
    $('#btn-api').onclick = () => showApi();
    $('#modal-close').onclick = () => $('#modal').classList.remove('show');
    $('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') $('#modal').classList.remove('show'); });
    $('#file-image').onchange = (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (f) loadImageFile(f, pendingImageNode);
    };
    // Drop projects / images anywhere outside the graph too.
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (/\.json$/i.test(f.name)) openProjectFile(f);
      else { const c = GraphView.center(); loadImageFile(f, null, c); }
    });
  }

  function isTyping(t) {
    return t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['checkbox', 'range', 'color', 'button'].includes(t.type)));
  }

  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      if ($('#modal').classList.contains('show') && e.key === 'Escape') { $('#modal').classList.remove('show'); return; }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return; }
      if (isTyping(e.target)) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (state.selected) duplicate(state.selected); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedLink) {
          Graph.disconnect(state.selectedLink.to, state.selectedLink.toPort);
          state.selectedLink = null;
          changed({ commit: true, structure: true });
        } else if (state.selected) removeNode(state.selected);
        e.preventDefault();
        return;
      }
      if (!mod && e.key.toLowerCase() === 'f') GraphView.fit();
    });
  }

  function bindSplitters() {
    const root = document.documentElement;
    const sv = $('#split-v'), sh = $('#split-h');
    sv.addEventListener('pointerdown', (e) => {
      sv.setPointerCapture(e.pointerId);
      const mv = (ev) => { root.style.setProperty('--right-w', Math.min(window.innerWidth - 360, Math.max(260, window.innerWidth - ev.clientX)) + 'px'); };
      const up = () => { sv.removeEventListener('pointermove', mv); sv.removeEventListener('pointerup', up); };
      sv.addEventListener('pointermove', mv); sv.addEventListener('pointerup', up);
    });
    sh.addEventListener('pointerdown', (e) => {
      sh.setPointerCapture(e.pointerId);
      const top = $('#preview').getBoundingClientRect().top;
      const mv = (ev) => { root.style.setProperty('--preview-h', Math.min(window.innerHeight - 180, Math.max(140, ev.clientY - top)) + 'px'); };
      const up = () => { sh.removeEventListener('pointermove', mv); sh.removeEventListener('pointerup', up); };
      sh.addEventListener('pointermove', mv); sh.addEventListener('pointerup', up);
    });
  }

  // ---------------------------------------------------------------- messages
  function toast(msg, kind = 'info', ms = 4500) {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    $('#toasts').append(t);
    setTimeout(() => t.remove(), kind === 'err' ? ms * 1.6 : ms);
    status(msg, kind === 'err');
  }
  function status(msg, isErr) {
    const s = $('#status-msg');
    s.textContent = msg;
    s.style.color = isErr ? 'var(--err)' : '';
  }

  function modal(title, html) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = html;
    $('#modal').classList.add('show');
  }

  function showHelp() {
    modal('Справка', `
      <h3>Граф</h3>
      <ul>
      <li><b>Добавить ноду</b>: щелчок по пункту каталога слева (или перетаскивание на граф). Поиск + <kbd>Enter</kbd> добавляет первую найденную.</li>
      <li><b>Соединить</b>: потяните от кружка выхода (справа у ноды) к кружку входа (слева). Можно и наоборот. Один выход может идти в несколько входов; циклы запрещены.</li>
      <li><b>Разорвать связь</b>: потяните за подключённый вход и отпустите в пустом месте; или щёлкните провод и нажмите <kbd>Delete</kbd>; или двойной щелчок / правая кнопка по проводу.</li>
      <li><b>Переместить</b> ноду — за заголовок. <b>Удалить</b> — <kbd>Delete</kbd>, <b>дублировать</b> — <kbd>Ctrl+D</kbd>.</li>
      <li><b>Вид графа</b>: перетаскивание пустого места — сдвиг, колесо — масштаб, <kbd>F</kbd> — показать всё.</li>
      <li><b>Отмена / повтор</b>: <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Shift+Z</kbd> (<kbd>Ctrl+Y</kbd>). Одно перетаскивание ползунка — один шаг отмены.</li>
      <li>Число можно ввести точно в поле рядом с ползунком; <b>↺</b> сбрасывает параметр к значению по умолчанию.</li>
      </ul>
      <h3>Предпросмотр</h3>
      <ul>
      <li>Выбранная нода показывается справа вверху (без выбора — основной Output ★). Кнопки <b>R G B A</b> показывают отдельный канал, <b>RGBA</b> — с прозрачностью на шахматке, <b>Normal</b> — освещённую плоскость по normal map (свет регулируется).</li>
      <li><b>Проверка швов</b>: <b>3×3</b> повторяет текстуру, <b>½</b> сдвигает её на половину — края оказываются в центре. Колесо — масштаб, двойной щелчок — вписать.</li>
      <li>При наведении внизу видны значения пикселя (8 бит, как в экспортируемом PNG).</li>
      <li>Во время движения ползунка предпросмотр считается в уменьшенном разрешении, после отпускания — в полном.</li>
      </ul>
      <h3>Файлы</h3>
      <ul>
      <li><b>Сохранить</b> — скачивает проект .json со встроенными изображениями; <b>Открыть…</b> — загружает его обратно (или перетащите .json в окно).</li>
      <li><b>Экспорт PNG</b> — основной Output ★ в выбранном размере; <b>PNG выбранной</b> — результат выделенной ноды. Экспорт всегда пересчитывает граф заново в полном размере, 8 бит RGBA без потерь, RGB сохраняется и при A=0.</li>
      <li>Изображения: PNG/JPEG через ноду «Изображение» (кнопка или перетаскивание). Режим «Цвет sRGB» — для фотографий/альбедо, «Данные» — для масок, height, normal, упакованных карт.</li>
      </ul>
      <h3>Цвет и данные</h3>
      <p>Карты-данные (маски, высота, нормали, упакованные каналы) никогда не проходят гамма-коррекцию. Цветные изображения внутри хранятся в линейном свете (размытие и смешивание физически корректны) и кодируются в sRGB при показе и экспорте. Levels, Invert, HSV, Grayscale и Color Ramp работают со значениями как в файле (sRGB).</p>
      <h3>Бесшовность</h3>
      <p>Шумы и Voronoi в режиме Tileable математически периодичны (целый масштаб). Размытия и Height to Normal в режиме Repeat берут соседей с противоположного края. Поворот, градиенты, Clamp, радиальное размытие и произвольные картинки могут давать шов — у таких нод есть подсказка.</p>
      <p style="color:var(--fg3)">${GPU.precisionNote} PNG: UPNG.js (MIT, © Photopea) + pako (MIT/Zlib, © Vitaly Puzrin, Andrei Tuputcyn). Полные тексты лицензий — в исходнике страницы.</p>`);
  }

  function refreshExamplesMenu() {
    const ex = $('#examples');
    ex.textContent = '';
    const opt = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; };
    ex.append(opt('', 'Примеры и шаблоны…'));
    const groups = [['Примеры', (e) => !e.template], ['Шаблоны текстур (Albedo + Normal + ORM)', (e) => e.template]];
    for (const [label, test] of groups) {
      const g = document.createElement('optgroup');
      g.label = label;
      EXAMPLES.forEach((e, k) => { if (test(e)) g.append(opt('ex:' + k, e.title)); });
      if (g.children.length) ex.append(g);
    }
    const mine = Library.available() ? Library.templates() : [];
    if (mine.length) {
      const g = document.createElement('optgroup');
      g.label = 'Мои шаблоны (в этом браузере)';
      for (const t of mine) g.append(opt('tpl:' + t.name, t.name));
      ex.append(g);
    }
  }

  async function loadUserTemplate(name) {
    const t = Library.templates().find((x) => x.name === name);
    if (!t) return;
    try { await loadProjectData(t.project); toast(`Открыт шаблон «${name}». Предыдущий граф можно вернуть через Отмену.`); }
    catch (e) { toast('Не удалось открыть шаблон: ' + e.message, 'err'); }
  }

  function showLibrary() {
    modal('Библиотека: мои пресеты и шаблоны', '');
    const body = $('#modal-body');
    const h = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...kids); return e; };
    const render = () => {
      body.textContent = '';
      if (!Library.available()) {
        body.append(h('p', { textContent: 'Хранилище браузера недоступно (приватный режим или запрет сайта). Пресеты и шаблоны можно переносить только файлами проекта.' }));
        return;
      }
      body.append(h('p', { style: 'color:var(--fg2)', textContent: 'Пресеты и шаблоны хранятся в этом браузере (localStorage для этого адреса: у file:// и у сайта на GitHub Pages — разные хранилища). Чтобы перенести их на другой компьютер или сделать резервную копию — «Экспорт библиотеки».' }));
      const name = h('input', { type: 'text', placeholder: 'название шаблона', style: 'width:240px' });
      const withImg = h('input', { type: 'checkbox', checked: true });
      body.append(h('h3', { textContent: 'Сохранить текущий проект как шаблон' }),
        h('div', { className: 'actions' }, name, h('label', {}, withImg, ' со встроенными изображениями'),
          h('button', { className: 'primary', textContent: 'Сохранить шаблон', onclick: () => {
            try {
              const pr = projectData();
              if (!withImg.checked) { pr.assets = {}; for (const n of pr.nodes) if (n.type === 'image') n.params.asset = null; }
              Library.saveTemplate(name.value, pr);
              toast('Шаблон «' + name.value.trim() + '» сохранён. Он в меню «Примеры и шаблоны…».');
              refreshExamplesMenu(); render();
            } catch (e) { toast(e.message, 'err'); }
          } })));
      body.append(h('h3', { textContent: 'Мои шаблоны' }));
      const tl = h('div', { className: 'lib-list' });
      const tpls = Library.templates();
      if (!tpls.length) tl.append(h('div', {}, h('span', { style: 'color:var(--fg3)', textContent: 'пока нет' })));
      for (const t of tpls) tl.append(h('div', {}, h('span', { textContent: `${t.name}  ·  ${new Date(t.saved).toLocaleString()}` }),
        h('button', { textContent: 'Открыть', onclick: () => { $('#modal').classList.remove('show'); loadUserTemplate(t.name); } }),
        h('button', { textContent: 'Удалить', onclick: () => { Library.deleteTemplate(t.name); refreshExamplesMenu(); render(); } })));
      body.append(tl);
      body.append(h('h3', { textContent: 'Мои пресеты нод' }));
      const pl = h('div', { className: 'lib-list' });
      let any = false;
      for (const type of Object.keys(NODES)) for (const pr of Library.nodePresets(type)) {
        any = true;
        pl.append(h('div', {}, h('span', { textContent: `${NODES[type].title}: ${pr.name}` }),
          h('button', { textContent: 'Удалить', onclick: () => { Library.deleteNodePreset(type, pr.name); render(); ParamsPanel.build(); } })));
      }
      if (!any) pl.append(h('div', {}, h('span', { style: 'color:var(--fg3)', textContent: 'пока нет — кнопка «＋ Сохранить пресет» в панели параметров любой ноды' })));
      body.append(pl);
      const imp = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
      imp.onchange = async () => {
        const f = imp.files[0]; if (!f) return;
        try { const n = Library.importAll(JSON.parse(await f.text())); toast(`Импортировано записей: ${n}`); refreshExamplesMenu(); render(); ParamsPanel.build(); }
        catch (e) { toast('Импорт не удался: ' + e.message, 'err'); }
      };
      body.append(h('div', { className: 'actions' },
        h('button', { textContent: 'Экспорт библиотеки в файл', onclick: () => download(JSON.stringify(Library.exportAll()), 'ptl-library.json', 'application/json') }),
        h('button', { textContent: 'Импорт библиотеки…', onclick: () => imp.click() }), imp,
        h('span', { style: 'color:var(--fg3)', textContent: `занято ≈ ${(Library.usedBytes() / 1024).toFixed(0)} КБ` })));
    };
    render();
  }

  function showApi() {
    const g = document.getElementById('ptl-agent-guide');
    const pre = document.createElement('pre');
    pre.textContent = g ? g.textContent.trim() : '';
    modal('API для скриптов и AI-агентов (window.PTL)', '');
    $('#modal-body').append(pre);
  }

  // ---------------------------------------------------------------- model ops
  function updateUndo() {
    $('#btn-undo').disabled = !History.canUndo();
    $('#btn-redo').disabled = !History.canRedo();
  }

  function commit() {
    if (History.commit()) state.dirty = true;
    updateUndo();
  }

  // Central change notification. commit=false => live (interactive) change.
  function changed(o = {}) {
    state.interactive = !!o.interactive;
    if (o.commit) commit();
    if (o.structure) { GraphView.drawWires(); GraphView.refreshMarks(); }
    ParamsPanel.refreshStatus();
    requestEval();
  }

  function tryConnect(a, ap, b, bp) {
    const err = Graph.connect(a, ap, b, bp);
    if (err) { toast(err, 'err'); GraphView.drawWires(); return err; }
    changed({ commit: true, structure: true });
    return null;
  }

  function addNode(type, x, y, params) {
    const n = Graph.addNode(type, x, y, params);
    GraphView.rebuild();
    select(n.id);
    commit();
    requestEval();
    return n;
  }

  function removeNode(id) {
    if (!Graph.nodes.has(id)) return;
    Graph.removeNode(id);
    if (state.selected === id) state.selected = null;
    state.selectedLink = null;
    GraphView.rebuild();
    ParamsPanel.build();
    commit();
    Engine.purge([previewRes(), state.displayRes]);
    requestEval();
  }

  function duplicate(id) {
    const n = Graph.nodes.get(id);
    if (!n) return null;
    return addNode(n.type, n.x + 30, n.y + 30, n.params);
  }

  function select(id) {
    if (id && !Graph.nodes.has(id)) id = null;
    if (state.selected !== id) state.viewPort = 0;
    state.selected = id;
    if (id) state.selectedLink = null;
    GraphView.refreshMarks();
    GraphView.drawWires();
    ParamsPanel.build();
    requestEval();
  }

  function selectLink(l) {
    state.selectedLink = l;
    if (l) { state.selected = null; ParamsPanel.build(); GraphView.refreshMarks(); }
    GraphView.drawWires();
  }

  function viewedId() {
    if (state.selected && Graph.nodes.has(state.selected)) return state.selected;
    return Graph.state.activeOutput && Graph.nodes.has(Graph.state.activeOutput) ? Graph.state.activeOutput : null;
  }

  function afterLoad() {
    if (state.selected && !Graph.nodes.has(state.selected)) state.selected = null;
    state.selectedLink = null;
    $('#res').value = Graph.state.resolution;
    GraphView.rebuild();
    ParamsPanel.build();
    Engine.purge([previewRes()]);
    updateUndo();
    requestEval();
  }

  function undo() { if (History.undo()) { state.dirty = true; afterLoad(); status('Отменено.'); } }
  function redo() { if (History.redo()) { state.dirty = true; afterLoad(); status('Повторено.'); } }

  function loadGraph(data) {
    Graph.load(data);
    state.selected = data.selected && Graph.nodes.has(data.selected) ? data.selected : null;
    afterLoad();
    requestAnimationFrame(() => GraphView.fit());
  }

  function loadExample(k) {
    const ex = EXAMPLES[k];
    if (!ex) return;
    loadGraph(JSON.parse(JSON.stringify(ex.graph)));
    commit();
    status(`Загружен ${ex.template ? 'шаблон' : 'пример'} «${ex.title}». Предыдущий граф можно вернуть через Отмену.`);
    if (ex.template) { state.selected = null; ParamsPanel.build(); GraphView.refreshMarks(); }
  }

  function newProject() {
    loadGraph({ resolution: Graph.state.resolution, nodes: [], links: [] });
    commit();
    status('Новый пустой проект. Предыдущий граф можно вернуть через Отмену.');
  }

  function setResolution(r) {
    if (![256, 512, 1024, 2048].includes(r)) throw new Error('Разрешение должно быть 256, 512, 1024 или 2048.');
    Graph.state.resolution = r;
    $('#res').value = r;
    commit();
    Engine.purge([previewRes()]);
    ParamsPanel.syncAll();
    requestEval();
  }

  function previewRes() {
    const v = $('#pres').value;
    const r = Graph.state.resolution;
    return v === 'project' ? r : Math.min(r, +v);
  }
  function dragRes(p) { return p <= 512 ? p : Math.max(256, p / 4); }

  // ---------------------------------------------------------------- evaluation
  function requestEval() {
    if (!evalRaf) evalRaf = requestAnimationFrame(tick);
  }

  // Run pending evaluation synchronously (used by the API).
  function flush() {
    if (evalRaf) { cancelAnimationFrame(evalRaf); evalRaf = 0; }
    state.interactive = false;
    tick();
  }

  function tick() {
    evalRaf = 0;
    if (GPU.isLost() || !state.ready && !Graph.nodes) return;
    const pres = previewRes();
    const viewed = viewedId();
    const t0 = performance.now();
    if (state.interactive) {
      const r = dragRes(pres);
      state.displayRes = r;
      if (viewed) Engine.evaluate(viewed, r, new Map());
      // settle to full quality shortly after the last live change
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { state.interactive = false; requestEval(); }, 350);
    } else {
      state.displayRes = pres;
      const memo = new Map();
      if (viewed) Engine.evaluate(viewed, pres, memo);
      for (const id of Graph.nodes.keys()) Engine.evaluate(id, pres, memo);
      Engine.purge([pres]);
      queueThumbs(pres);
    }
    state.lastEvalMs = performance.now() - t0;
    GraphView.refreshMarks();
    ParamsPanel.refreshStatus();
    Preview.draw();
  }

  function queueThumbs(res) {
    thumbQueue = [...Graph.nodes.keys()];
    clearTimeout(thumbTimer);
    const step = () => {
      if (GPU.isLost()) return;
      let n = 0;
      while (thumbQueue.length && n < 6) {
        const id = thumbQueue.shift();
        const e = Engine.get(id, res);
        if (!e || GraphView.thumbKey(id) === e.key) continue;
        const o = e.outs[0];
        const px = GPU.renderThumb('display', {
          u_tex: o.tex, u_has: true, u_isColor: o.space === 'color', u_view: 1, u_canvas: [64, 64], u_zoom: 1, u_pan: [0, 0],
          u_tile3: false, u_half: false, u_flip: false, u_ndx: false, u_light: [0, 0, 1], u_bg: [0, 0, 0],
        }, 64, { samplers: { u_tex: 'repeat' } });
        GraphView.setThumb(id, px, e.key);
        n++;
      }
      if (thumbQueue.length) thumbTimer = setTimeout(step, 16);
    };
    thumbTimer = setTimeout(step, 30);
  }

  // ---------------------------------------------------------------- files
  function download(bytes, name, mime) {
    const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function exportRes() {
    const v = $('#exres').value;
    return v === 'project' ? Graph.state.resolution : +v;
  }

  function exportFileName(id, port) {
    const n = Graph.nodes.get(id), def = NODES[n.type];
    if (n.type === 'output') return (n.params.filename || 'texture') + '.png';
    return `${n.type}_${n.id}${def.outputs.length > 1 ? '_' + def.outputs[port || 0] : ''}.png`;
  }

  async function encodeNode(id, port = 0, res = exportRes()) {
    const r = Engine.renderBytes(id, port, res);
    return { png: await PNG.encodeAsync(r.bytes, res, res), ...r };
  }

  async function exportNode(id, port = 0) {
    if (!Graph.nodes.has(id)) return;
    try {
      const res = exportRes();
      const t0 = performance.now();
      status('Экспорт…');
      const { png } = await encodeNode(id, port, res);
      const name = exportFileName(id, port);
      download(png, name, 'image/png');
      toast(`Экспортировано: ${name} (${res}×${res}, ${(png.length / 1024).toFixed(0)} КБ, ${Math.round(performance.now() - t0)} мс)`);
    } catch (e) {
      console.warn(e);
      toast('Ошибка экспорта: ' + e.message, 'err');
    }
  }

  async function exportAll() {
    const outs = [...Graph.nodes.values()].filter((n) => n.type === 'output');
    if (!outs.length) { toast('В графе нет нод Output.', 'warn'); return; }
    for (const o of outs) { await exportNode(o.id, 0); await new Promise((r) => setTimeout(r, 250)); }
  }

  async function exportActive() {
    const id = Graph.state.activeOutput;
    if (!id || !Graph.nodes.has(id)) { toast('В графе нет ноды Output. Добавьте «Выход (Output)» или используйте «PNG выбранной».', 'warn'); return; }
    await exportNode(id, 0);
  }

  function projectData() {
    const g = Graph.toJSON();
    const ids = new Set();
    for (const n of g.nodes) if (n.type === 'image' && n.params.asset) ids.add(n.params.asset);
    return {
      format: 'pocket-texture-lab', version: 1, app: 'Pocket Texture Lab', saved: new Date().toISOString(),
      ...g, selected: state.selected, view: { ...GraphView.view },
      assets: Assets.serialize(ids),
    };
  }

  function saveProject() {
    const data = projectData();
    const out = Graph.nodes.get(Graph.state.activeOutput);
    const name = ((out && out.params.filename) || 'project') + '.ptl.json';
    download(JSON.stringify(data), name, 'application/json');
    state.dirty = false;
    toast('Проект сохранён: ' + name);
  }

  async function loadProjectData(data) {
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { throw new Error('Файл не является корректным JSON.'); }
    }
    if (!data || data.format !== 'pocket-texture-lab') throw new Error('Это не проект Pocket Texture Lab (нет поля format).');
    if (!(data.version >= 1)) throw new Error('Неизвестная версия формата проекта.');
    if (data.version > 1) throw new Error(`Проект сохранён более новой версией формата (${data.version}); эта версия поддерживает 1.`);
    await Assets.loadSerialized(data.assets || {});
    for (const n of data.nodes || []) {
      if (n.type === 'image' && n.params && n.params.asset && !Assets.get(n.params.asset))
        throw new Error('В проекте нет встроенного изображения ' + n.params.asset);
    }
    loadGraph(data);
    commit();
    if (data.view) { Object.assign(GraphView.view, data.view); GraphView.applyView(); }
  }

  async function openProjectFile(file) {
    try {
      const text = await file.text();
      await loadProjectData(text);
      state.dirty = false;
      toast('Проект открыт: ' + file.name);
    } catch (e) {
      console.warn(e);
      toast('Не удалось открыть проект «' + file.name + '»: ' + e.message, 'err');
    }
  }

  let pendingImageNode = null;
  function pickImage(nodeId) { pendingImageNode = nodeId; $('#file-image').click(); }

  async function loadImageBytes(bytes, name, nodeId, pos) {
    const a = await Assets.add(bytes, name);
    let node = nodeId && Graph.nodes.get(nodeId);
    if (!node) {
      const c = pos || GraphView.center();
      node = Graph.addNode('image', c.x - 88, c.y - 40, { asset: a.id, interp: 'srgb' });
      GraphView.rebuild();
    } else {
      node.params.asset = a.id;
      Graph.touch(node);
    }
    select(node.id);
    commit();
    requestEval();
    const note = a.notes.length ? ' ' + a.notes.join(' ') : '';
    toast(`Загружено: ${name} (${a.width}×${a.height}).${note}`, a.notes.length ? 'warn' : 'info');
    return node.id;
  }

  async function loadImageFile(file, nodeId, pos) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return await loadImageBytes(bytes, file.name, nodeId, pos);
    } catch (e) {
      console.warn(e);
      toast('Не удалось загрузить изображение: ' + e.message, 'err');
      return null;
    }
  }

  // Arrange nodes in columns by longest path from sources.
  function autoLayout() {
    const depth = new Map();
    const d = (id, stack = new Set()) => {
      if (depth.has(id)) return depth.get(id);
      if (stack.has(id)) return 0;
      stack.add(id);
      let m = 0;
      for (const l of Graph.links) if (l.to === id) m = Math.max(m, d(l.from, stack) + 1);
      depth.set(id, m);
      return m;
    };
    for (const id of Graph.nodes.keys()) d(id);
    const cols = new Map();
    for (const n of Graph.nodes.values()) {
      const k = depth.get(n.id);
      if (!cols.has(k)) cols.set(k, []);
      cols.get(k).push(n);
    }
    for (const [k, list] of cols) {
      list.sort((a, b) => a.y - b.y);
      let y = 0;
      for (const n of list) {
        n.x = k * 230; n.y = y;
        y += 70 + Math.max(64, 20 * Math.max(NODES[n.type].inputs.length, NODES[n.type].outputs.length)) + 40;
      }
    }
  }

  return {
    init, state, changed, commit, tryConnect, addNode, removeNode, duplicate, select, selectLink, viewedId,
    undo, redo, flush, loadExample, newProject, setResolution, previewRes, requestEval, toast, status,
    exportNode, exportActive, exportAll, refreshExamplesMenu, encodeNode, saveProject, projectData, loadProjectData, openProjectFile,
    pickImage, loadImageFile, loadImageBytes, autoLayout, loadGraph, afterLoad, updateUndo,
  };
})();
