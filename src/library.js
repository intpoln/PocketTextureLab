// ---------------------------------------------------------------------------
// User library in the browser's localStorage: node parameter presets and
// whole-project templates. localStorage is per site (per origin) and stays on
// this computer/browser only; export/import to a JSON file moves it elsewhere.
// ---------------------------------------------------------------------------
const Library = (() => {
  const KEY_P = 'ptl.nodePresets.v1', KEY_T = 'ptl.templates.v1';

  function available() {
    try {
      const k = 'ptl.__test';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  }
  function read(key, def) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? def : v; } catch (e) { return def; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) {
      if (!available()) throw new Error('Хранилище браузера недоступно (приватный режим или запрет сайта). Используйте «Экспорт библиотеки» в файл.');
      throw new Error('Не хватает места в хранилище браузера (обычно ~5 МБ). Удалите старые шаблоны или сохраните проект файлом.');
    }
  }

  // ---- node presets: { [type]: [{ name, params }] }
  function nodePresets(type) { return (read(KEY_P, {})[type] || []).slice(); }
  function saveNodePreset(type, name, params) {
    name = String(name || '').trim();
    if (!name) throw new Error('Введите имя пресета.');
    const all = read(KEY_P, {});
    const p = JSON.parse(JSON.stringify(params));
    delete p.asset; // images are project data, not presets
    const list = (all[type] || []).filter((x) => x.name !== name);
    list.push({ name, params: p });
    list.sort((a, b) => a.name.localeCompare(b.name));
    all[type] = list;
    write(KEY_P, all);
  }
  function deleteNodePreset(type, name) {
    const all = read(KEY_P, {});
    all[type] = (all[type] || []).filter((x) => x.name !== name);
    if (!all[type].length) delete all[type];
    write(KEY_P, all);
  }

  // ---- templates: [{ name, saved, project }]
  function templates() { return read(KEY_T, []); }
  function saveTemplate(name, project) {
    name = String(name || '').trim();
    if (!name) throw new Error('Введите имя шаблона.');
    const list = templates().filter((t) => t.name !== name);
    list.push({ name, saved: new Date().toISOString(), project });
    list.sort((a, b) => a.name.localeCompare(b.name));
    write(KEY_T, list);
  }
  function deleteTemplate(name) { write(KEY_T, templates().filter((t) => t.name !== name)); }

  function exportAll() { return { format: 'ptl-library', version: 1, nodePresets: read(KEY_P, {}), templates: templates() }; }
  function importAll(obj) {
    if (!obj || obj.format !== 'ptl-library') throw new Error('Это не файл библиотеки Pocket Texture Lab.');
    const all = read(KEY_P, {});
    let n = 0;
    for (const type of Object.keys(obj.nodePresets || {})) {
      if (!NODES[type]) continue;
      for (const pr of obj.nodePresets[type]) {
        all[type] = (all[type] || []).filter((x) => x.name !== pr.name).concat([{ name: pr.name, params: pr.params }]);
        n++;
      }
    }
    write(KEY_P, all);
    const list = templates();
    for (const t of obj.templates || []) {
      if (!t || !t.name || !t.project) continue;
      const k = list.findIndex((x) => x.name === t.name);
      if (k >= 0) list[k] = t; else list.push(t);
      n++;
    }
    write(KEY_T, list);
    return n;
  }

  function usedBytes() {
    try { return ((localStorage.getItem(KEY_P) || '').length + (localStorage.getItem(KEY_T) || '').length) * 2; } catch (e) { return 0; }
  }

  return { available, nodePresets, saveNodePreset, deleteNodePreset, templates, saveTemplate, deleteTemplate, exportAll, importAll, usedBytes };
})();
