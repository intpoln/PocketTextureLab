// End-to-end tests in real Chromium (Playwright) against the built
// texture-lab.html opened via file:// with the network disabled.
// Exported PNGs are decoded independently with pngjs.
import { chromium } from 'playwright';
import { PNG as PngJS } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FILE = path.join(ROOT, 'texture-lab.html');
const URL_ = 'file://' + FILE;
const OUT = path.join(ROOT, 'test-output');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let current = '';
function ok(cond, msg, extra) {
  results.push({ test: current, ok: !!cond, msg, extra });
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
}
async function test(name, fn) {
  current = name;
  console.log('\n# ' + name);
  try { await fn(); } catch (e) { ok(false, 'exception: ' + (e && e.stack || e)); }
}

function makePng(w, h, fill, opts = {}) {
  const p = new PngJS({ width: w, height: h, ...opts });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fill(x, y); const o = (y * w + x) * 4;
    p.data[o] = c[0]; p.data[o + 1] = c[1]; p.data[o + 2] = c[2]; p.data[o + 3] = c[3];
  }
  return PngJS.sync.write(p, opts);
}
// Independent minimal 16-bit RGBA PNG writer (node:zlib), filter 0.
function makePng16(w, h, fill) {
  const raw = Buffer.alloc((w * 8 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fill(x, y), o = y * (w * 8 + 1) + 1 + x * 8;
    for (let k = 0; k < 4; k++) raw.writeUInt16BE(c[k], o + k * 2);
  }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 16; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const decode = (buf) => PngJS.sync.read(Buffer.from(buf));
const b64 = (buf) => Buffer.from(buf).toString('base64');

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const netRequests = [];
const pageErrors = [];

async function openPage(opts = {}) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 860 }, offline: true });
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  page.on('request', (r) => { const u = r.url(); if (!/^(file|blob|data):/.test(u)) netRequests.push(u); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });
  await page.goto(URL_ + (opts.query || ''));
  if (!opts.noWait) await page.waitForFunction(() => window.PTL && document.querySelectorAll('.node').length > 0);
  await page.waitForTimeout(300);
  return page;
}
const idle = (page) => page.evaluate(() => PTL.whenIdle());

// Render bytes via the page (fresh evaluation), returned as array.
async function render(page, id, size, port = 0) {
  const r = await page.evaluate(([id, size, port]) => { const r = PTL.render(id, { size, port }); return { w: r.width, space: r.space, b: Array.from(r.rgba) }; }, [id, size, port]);
  return r;
}
async function downloadExport(page, clickSelector) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(clickSelector)]);
  const p = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(p);
  return { path: p, name: dl.suggestedFilename(), bytes: fs.readFileSync(p) };
}

// ------------------------------------------------------------------------
await test('Запуск через file:// без сети, пример при первом открытии', async () => {
  const page = await openPage();
  const info = await page.evaluate(() => PTL.info());
  ok(info.nodeCount >= 3, 'при открытии загружен пример', info.nodeCount);
  ok(info.floatTextures, 'RGBA16F доступен и проверен', info.precision);
  const errs = await page.evaluate(() => PTL.errors());
  ok(Object.keys(errs).length === 0, 'нет ошибок нод');
  const st = await page.evaluate(() => PTL.stats(PTL.getGraph().activeOutput));
  ok(st.max[0] - st.min[0] > 50, 'пример даёт непустое изображение', st);
  await page.screenshot({ path: path.join(OUT, 'ui-example1.png') });
  for (let k = 1; k < 3; k++) {
    await page.evaluate((k) => PTL.loadExample(k), k);
    await idle(page); await page.waitForTimeout(300);
    const e = await page.evaluate(() => PTL.errors());
    const s = await page.evaluate(() => PTL.stats(PTL.getGraph().activeOutput));
    ok(Object.keys(e).length === 0 && s.max.some((v, i) => v !== s.min[i]), `пример ${k + 1} работает`, s);
    await page.screenshot({ path: path.join(OUT, `ui-example${k + 1}.png`) });
  }
  await page.context().close();
});

await test('UI: добавить, соединить, запрет цикла, разорвать, удалить, дублировать, undo/redo', async () => {
  const page = await openPage();
  await page.click('#btn-new');
  await idle(page);
  ok(await page.evaluate(() => PTL.getGraph().nodes.length === 0), 'новый проект пуст');
  // add via catalog search + Enter and via click
  await page.fill('#search', 'шум');
  await page.press('#search', 'Enter');
  await page.fill('#search', '');
  await page.click('#catalog .item[data-type="levels"]');
  await page.click('#catalog .item[data-type="output"]');
  await idle(page);
  let g = await page.evaluate(() => PTL.getGraph());
  ok(g.nodes.map((n) => n.type).join() === 'noise,levels,output', 'три ноды добавлены из каталога', g.nodes.map((n) => n.type));
  await page.evaluate(() => { const g = PTL.getGraph(); g.nodes.forEach((n, i) => PTL.moveNode(n.id, i * 240, 60)); PTL.fitGraph(); });
  await idle(page);
  const [noise, levels, output] = g.nodes.map((n) => n.id);
  const dot = (id, kind, k) => `.node[data-id="${id}"] .port.${kind}[data-port="${k}"] .dot`;
  async function dragDot(a, b) {
    const ba = await page.locator(a).boundingBox(), bb = await page.locator(b).boundingBox();
    await page.mouse.move(ba.x + ba.width / 2, ba.y + ba.height / 2);
    await page.mouse.down();
    await page.mouse.move((ba.x + bb.x) / 2, (ba.y + bb.y) / 2 + 30, { steps: 5 });
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 5 });
    await page.mouse.up();
    await idle(page);
  }
  await dragDot(dot(noise, 'out', 0), dot(levels, 'in', 0));
  await dragDot(dot(levels, 'out', 0), dot(output, 'in', 0));
  g = await page.evaluate(() => PTL.getGraph());
  ok(g.links.length === 2, 'две связи созданы перетаскиванием', g.links);
  // fan-out: noise also into... a second levels via duplicate
  await page.click(`.node[data-id="${levels}"] .head`);
  await page.keyboard.press('Control+d');
  await idle(page);
  g = await page.evaluate(() => PTL.getGraph());
  const dup = g.nodes.find((n) => n.id !== levels && n.type === 'levels');
  ok(!!dup, 'Ctrl+D дублирует ноду');
  await page.evaluate((id) => { PTL.moveNode(id, 240, 260); PTL.fitGraph(); }, dup.id);
  await idle(page);
  await dragDot(dot(noise, 'out', 0), dot(dup.id, 'in', 0));
  ok((await page.evaluate(() => PTL.getGraph().links.length)) === 3, 'разветвление: один выход в два входа');
  // cycle: levels.out -> dup.in? dup is fed by noise; make chain levels -> dup, then dup -> levels = cycle
  await dragDot(dot(levels, 'out', 0), dot(dup.id, 'in', 0));
  const before = await page.evaluate(() => PTL.getGraph().links.length);
  await dragDot(dot(dup.id, 'out', 0), dot(levels, 'in', 0));
  const toast = await page.locator('.toast.err').last().textContent().catch(() => '');
  ok(/цикл/i.test(toast), 'цикл запрещён с понятным сообщением', toast);
  ok((await page.evaluate(() => PTL.getGraph().links.length)) === before, 'граф не изменился после попытки цикла');
  let threw = await page.evaluate(([a, b]) => { try { PTL.connect(a, 0, b, 0); return false; } catch (e) { return e.message; } }, [dup.id, levels]);
  ok(/цикл/i.test(threw), 'API тоже запрещает цикл', threw);
  // break link by dragging input out to empty space
  const linksBefore = await page.evaluate(() => PTL.getGraph().links.length);
  const bi = await page.locator(dot(output, 'in', 0)).boundingBox();
  await page.mouse.move(bi.x + 6, bi.y + 6); await page.mouse.down();
  await page.mouse.move(bi.x + 60, bi.y + 200, { steps: 6 }); await page.mouse.up();
  await idle(page);
  ok((await page.evaluate(() => PTL.getGraph().links.length)) === linksBefore - 1, 'связь разорвана перетаскиванием входа в пустоту');
  // undo restores link
  await page.click('#graph', { position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+z');
  await idle(page);
  ok((await page.evaluate(() => PTL.getGraph().links.length)) === linksBefore, 'Ctrl+Z вернул связь');
  await page.keyboard.press('Control+Shift+z');
  await idle(page);
  ok((await page.evaluate(() => PTL.getGraph().links.length)) === linksBefore - 1, 'Ctrl+Shift+Z снова удалил связь');
  await page.keyboard.press('Control+z');
  // delete node with Delete key
  await page.click(`.node[data-id="${dup.id}"] .head`);
  await page.keyboard.press('Delete');
  await idle(page);
  g = await page.evaluate(() => PTL.getGraph());
  ok(!g.nodes.some((n) => n.id === dup.id) && !g.links.some((l) => l.from === dup.id || l.to === dup.id), 'Delete удаляет ноду и её связи');
  // pan & zoom
  const t0 = await page.locator('#graph-inner').evaluate((e) => e.style.transform);
  await page.mouse.move(700, 700); await page.mouse.wheel(0, -300); await page.waitForTimeout(50);
  const box = await page.locator('#graph').boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height - 30); await page.mouse.down(); await page.mouse.move(box.x + 130, box.y + box.height - 80, { steps: 4 }); await page.mouse.up();
  const t1 = await page.locator('#graph-inner').evaluate((e) => e.style.transform);
  ok(t0 !== t1 && /scale\((?!1\))/.test(t1), 'вид графа сдвигается и масштабируется', [t0, t1]);
  // wire click + Delete
  await page.evaluate(() => PTL.fitGraph());
  await idle(page);
  const n0 = await page.evaluate(() => PTL.getGraph().links.length);
  const hit = page.locator('#wires path.hit').first();
  const hb = await hit.boundingBox();
  await page.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.keyboard.press('Delete');
  await idle(page);
  ok((await page.evaluate(() => PTL.getGraph().links.length)) === n0 - 1, 'выбор провода щелчком и удаление Delete');
  await page.screenshot({ path: path.join(OUT, 'ui-editing.png') });
  await page.context().close();
});

await test('Параметры: ползунок = один шаг отмены, точный ввод, сброс, фокус сохраняется', async () => {
  const page = await openPage();
  const noiseId = await page.evaluate(() => PTL.getGraph().nodes.find((n) => n.type === 'noise').id);
  await page.click(`.node[data-id="${noiseId}"] .head`);
  const row = page.locator('#params .prow[data-key="persistence"]');
  const range = row.locator('input[type=range]');
  await range.scrollIntoViewIfNeeded();
  const h0 = await page.evaluate(() => PTL._test.historySize());
  const rb = await range.boundingBox();
  await page.mouse.move(rb.x + rb.width * 0.2, rb.y + rb.height / 2);
  await page.mouse.down();
  for (let k = 0; k < 10; k++) await page.mouse.move(rb.x + rb.width * (0.2 + k * 0.06), rb.y + rb.height / 2);
  const focusedDuring = await page.evaluate(() => document.activeElement && document.activeElement.type);
  await page.mouse.up();
  await idle(page);
  const h1 = await page.evaluate(() => PTL._test.historySize());
  const v = await page.evaluate((id) => PTL.getParams(id).persistence, noiseId);
  ok(h1 === h0 + 1, 'одно перетаскивание = одна запись истории', { h0, h1, v });
  ok(focusedDuring === 'range', 'ползунок остаётся в фокусе во время перетаскивания (панель не пересоздаётся)', focusedDuring);
  ok(await range.evaluate((e) => e.isConnected), 'элемент ползунка тот же после изменения');
  await row.locator('input[type=number]').fill('0.3125');
  await row.locator('input[type=number]').press('Enter');
  await idle(page);
  ok((await page.evaluate((id) => PTL.getParams(id).persistence, noiseId)) === 0.3125, 'точный ввод числа');
  await row.locator('button.reset').click();
  await idle(page);
  ok((await page.evaluate((id) => PTL.getParams(id).persistence, noiseId)) === 0.5, 'сброс к значению по умолчанию');
  await page.keyboard.press('Escape');
  await page.click('#graph', { position: { x: 10, y: 10 } });
  await page.keyboard.press('Control+z');
  await idle(page);
  ok((await page.evaluate((id) => PTL.getParams(id).persistence, noiseId)) === 0.3125, 'undo отменяет сброс');
  await page.context().close();
});

await test('Шум: воспроизводимость seed и математическая периодичность', async () => {
  const page = await openPage();
  const res = await page.evaluate(() => {
    PTL.newProject();
    const out = [];
    const cmp = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
    const cases = [
      ['noise', { type: 'perlin', scale: 5, octaves: 8, seed: 3 }], ['noise', { type: 'value', scale: 7, octaves: 6, seed: 9 }],
      ['voronoi', { mode: 'f1', scale: 6 }], ['voronoi', { mode: 'border', scale: 9, seed: 4 }],
    ];
    for (const [t, p] of cases) {
      const id = PTL.addNode(t, { params: p });
      const a = PTL._test.renderRaw(id, 256).bytes, a2 = PTL._test.renderRaw(id, 256).bytes;
      const u1 = PTL._test.renderRaw(id, 256, [1, 0]).bytes, v1 = PTL._test.renderRaw(id, 256, [0, 1]).bytes, uv1 = PTL._test.renderRaw(id, 256, [3, 2]).bytes;
      PTL.setParams(id, { seed: (p.seed || 1) + 1 });
      const other = PTL._test.renderRaw(id, 256).bytes;
      PTL.setParams(id, { seed: p.seed || 1, tile: false, scale: p.scale + 0.37 });
      const nt = PTL._test.renderRaw(id, 256).bytes, nt1 = PTL._test.renderRaw(id, 256, [1, 0]).bytes;
      out.push({ t, p, same: cmp(a, a2), du: cmp(a, u1), dv: cmp(a, v1), duv: cmp(a, uv1), otherSeed: cmp(a, other), nonTile: cmp(nt, nt1) });
    }
    return out;
  });
  for (const r of res) {
    ok(r.same === 0, `${r.t} ${JSON.stringify(r.p)}: одинаковый seed → одинаковый результат`);
    ok(r.otherSeed > 20, `${r.t}: другой seed → другой результат`, r.otherSeed);
    ok(r.du <= 1 && r.dv <= 1 && r.duv <= 1, `${r.t}: f(u+1,v)=f(u,v+1)=f(u+3,v+2)=f(u,v) (макс. разница, 8 бит)`, [r.du, r.dv, r.duv]);
    ok(r.nonTile > 10, `${r.t}: без Tileable и с дробным масштабом периодичности нет (контроль теста)`, r.nonTile);
  }
  // Seam continuity: difference across the wrap edge is of the same order as inside.
  const seam = await page.evaluate(() => {
    PTL.newProject();
    const id = PTL.addNode('noise', { params: { scale: 4, octaves: 5 } });
    const b = PTL._test.renderRaw(id, 256).bytes, N = 256;
    let inside = 0, edge = 0;
    for (let y = 0; y < N; y++) {
      edge += Math.abs(b[(y * N + N - 1) * 4] - b[(y * N) * 4]);
      inside += Math.abs(b[(y * N + 127) * 4] - b[(y * N + 128) * 4]);
    }
    return { inside: inside / N, edge: edge / N };
  });
  ok(seam.edge < seam.inside * 2 + 1, 'разница соседних пикселей через край ≈ внутри (нет шва)', seam);
  await page.context().close();
});

await test('Просмотр 3×3 и сдвиг ½', async () => {
  const page = await openPage();
  await page.evaluate(() => PTL.loadExample(0));
  await idle(page);
  await page.click('#btn-tile');
  await page.waitForTimeout(300);
  const shot = await page.locator('#view').screenshot();
  fs.writeFileSync(path.join(OUT, 'preview-3x3.png'), shot);
  const img = decode(shot);
  // square area = min(w,h); tiles of size S/3. Compare tile (0,1) vs (1,1) vs (2,1).
  const S = Math.min(img.width, img.height), ox = (img.width - S) / 2, oy = (img.height - S) / 2, T = S / 3;
  // compare 6x6-pixel block means of tile (-1,0) and tile (0,0): identical content up to sub-pixel phase
  const blk = (x0, y0) => { let s = 0; for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) s += img.data[((Math.floor(y0) + y) * img.width + Math.floor(x0) + x) * 4]; return s / 36; };
  let diff = 0, n = 0, spread = 0;
  for (let y = 2; y < T - 8; y += 6) for (let x = 2; x < T - 8; x += 6) {
    const a = blk(ox + x, oy + T + y), b2 = blk(ox + T + x, oy + T + y);
    diff += Math.abs(a - b2); spread += Math.abs(a - blk(ox + T + x + 17, oy + T + y + 23)); n++;
  }
  ok(diff / n < 8 && spread / n > 8 * (diff / n), 'в режиме 3×3 соседние плитки совпадают (средние по блокам 6×6; остаток — фаза передискретизации экрана)', { diff: diff / n, unrelated: spread / n });
  ok(await page.locator('#btn-tile.on').count() === 1, 'кнопка 3×3 активна');
  await page.click('#btn-half');
  await page.waitForTimeout(200);
  await page.locator('#view').screenshot({ path: path.join(OUT, 'preview-3x3-half.png') });
  await page.context().close();
});

await test('Блюр: перенос через границу в Repeat, отсутствие в Clamp', async () => {
  const page = await openPage();
  // white vertical line at x = 0 on black, 256x256
  const png = makePng(256, 256, (x) => (x === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const r = await page.evaluate(async (b) => {
    PTL.newProject(); PTL.setResolution(256);
    const img = await PTL.importImage(b, { name: 'line.png', interp: 'data' });
    const bl = PTL.addNode('gaussian', { params: { sigma: 3, wrap: 'repeat' } });
    PTL.connect(img, 0, bl, 0);
    const rep = PTL.render(bl).rgba;
    PTL.setParams(bl, { wrap: 'clamp' });
    const cl = PTL.render(bl).rgba;
    const at = (a, x) => a[(100 * 256 + x) * 4];
    const src = PTL.render(img).rgba;
    return { rep255: at(rep, 255), rep1: at(rep, 1), rep0: at(rep, 0), cl255: at(cl, 255), cl1: at(cl, 1), srcExact: at(src, 0) === 255 && at(src, 1) === 0,
      alpha: rep[(100 * 256 + 128) * 4 + 3] };
  }, b64(png));
  ok(r.srcExact, 'изображение-данные загружено точно');
  ok(r.rep255 > 20 && Math.abs(r.rep255 - r.rep1) <= 1, 'Repeat: пиксель x=255 получает вклад от линии на x=0 (как x=1)', r);
  ok(r.cl255 === 0 && r.cl1 > 20, 'Clamp: через край вклад не переносится', r);
  ok(r.alpha === 255, 'альфа независима (не смешана с RGB)', r.alpha);
  await page.context().close();
});

await test('Height to Normal: плоская нормаль, знаки, OpenGL/DirectX', async () => {
  const page = await openPage();
  const r = await page.evaluate(() => {
    PTL.newProject(); PTL.setResolution(256);
    const c = PTL.addNode('constant', { params: { mode: 'gray', value: 0.37 } });
    const n = PTL.addNode('normal', { params: { strength: 50, blur: 2 } });
    PTL.connect(c, 0, n, 0);
    const flat = PTL.render(n).rgba;
    let flatBad = 0;
    for (let i = 0; i < flat.length; i += 4) if (flat[i] !== 128 || flat[i + 1] !== 128 || flat[i + 2] !== 255 || flat[i + 3] !== 255) flatBad++;
    // ramps
    const g = PTL.addNode('gradient', { params: { type: 'linear', rotation: 0 } });
    PTL.connect(g, 0, n, 0);
    PTL.setParams(n, { strength: 10, blur: 0, wrap: 'clamp' });
    const px = (id, x, y) => PTL.pixel(id, x, y);
    const right = px(n, 128, 128);                  // height grows to the right
    PTL.setParams(g, { rotation: -90 }); const down = px(n, 128, 128);  // grows downward
    PTL.setParams(g, { rotation: 90 }); const up = px(n, 128, 128);     // grows upward
    PTL.setParams(n, { convention: 'dx' }); const upDX = px(n, 128, 128);
    PTL.setParams(g, { rotation: 0 }); PTL.setParams(n, { invertX: true, convention: 'gl' }); const rightInvX = px(n, 128, 128);
    // GL vs DX over a noise height: only G differs
    const nz = PTL.addNode('noise', { params: { scale: 6 } });
    PTL.connect(nz, 0, n, 0);
    PTL.setParams(n, { invertX: false, convention: 'gl', wrap: 'repeat', strength: 20 });
    const gl = PTL.render(n).rgba;
    PTL.applyPreset(n, 'Unreal / DirectX −Y');
    const dx = PTL.render(n).rgba;
    let rbaDiff = 0, gBad = 0, gChanged = 0;
    for (let i = 0; i < gl.length; i += 4) {
      rbaDiff += (gl[i] !== dx[i]) + (gl[i + 2] !== dx[i + 2]) + (gl[i + 3] !== dx[i + 3]);
      if (Math.abs(gl[i + 1] + dx[i + 1] - 255) > 1) gBad++;
      if (gl[i + 1] !== dx[i + 1]) gChanged++;
    }
    // resolution independence of strength
    PTL.setParams(n, { convention: 'gl' });
    const s256 = PTL.stats(n, { size: 256 }), s1024 = PTL.stats(n, { size: 1024 });
    return { flatBad, right, down, up, upDX, rightInvX, rbaDiff, gBad, gChanged, s256, s1024 };
  });
  ok(r.flatBad === 0, 'постоянная высота → ровно (128,128,255,255) везде', r.flatBad);
  const exp = Math.round((-0.1 / Math.hypot(0.1, 1) * 0.5 + 0.5) * 255);
  ok(r.right[0] === exp && r.right[1] === 128 && r.right[2] > 250, `высота растёт вправо → нормаль влево: R=${exp} (<128), G=128`, r.right);
  ok(r.down[1] > 128 && r.down[0] === 128, 'высота растёт вниз → в OpenGL G>128 (нормаль вверх по изображению)', r.down);
  ok(r.up[1] < 128, 'высота растёт вверх → в OpenGL G<128', r.up);
  ok(r.upDX[1] > 128 && r.upDX[1] + r.up[1] === 255, 'DirectX инвертирует зелёный', [r.up, r.upDX]);
  ok(r.rightInvX[0] === 255 - exp || r.rightInvX[0] === 256 - exp, 'инверсия X меняет знак красного', r.rightInvX);
  ok(r.rbaDiff === 0 && r.gBad === 0 && r.gChanged > 1000, 'OpenGL↔DirectX меняет только G (G_dx = 255 − G_gl ±1)', { rba: r.rbaDiff, gBad: r.gBad, gChanged: r.gChanged });
  ok(Math.abs(r.s256.mean[0] - r.s1024.mean[0]) < 1.5 && Math.abs(r.s256.min[2] - r.s1024.min[2]) < 12, 'сила рельефа не зависит от разрешения (256 vs 1024)', [r.s256, r.s1024]);
  await page.context().close();
});

await test('PNG: точный round-trip RGBA (A=0/1/128), размер, ориентация, независимое декодирование', async () => {
  const page = await openPage();
  // deterministic pseudo-random RGBA with special alphas and an orientation marker
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 255;
  const W = 256;
  const src = makePng(W, W, (x, y) => {
    if (x === 0 && y === 0) return [255, 0, 0, 255];
    if (x === W - 1 && y === W - 1) return [0, 0, 255, 255];
    const a = [0, 1, 128, 255, rnd()][(x + y * 3) % 5];
    return [rnd(), rnd(), rnd(), a];
  });
  fs.writeFileSync(path.join(OUT, 'input-rgba.png'), src);
  const srcPx = decode(src).data;
  // UI path: file chooser on the hidden input
  await page.evaluate(() => { PTL.newProject(); PTL.setResolution(256); });
  await page.setInputFiles('#file-image', path.join(OUT, 'input-rgba.png'));
  await page.waitForFunction(() => PTL.getGraph().nodes.some((n) => n.type === 'image'));
  const ids = await page.evaluate(() => {
    const img = PTL.getGraph().nodes.find((n) => n.type === 'image').id;
    PTL.setParams(img, { interp: 'data' });
    const o = PTL.addNode('output', { params: { filename: 'roundtrip' } });
    PTL.connect(img, 0, o, 0);
    return { img, o };
  });
  await idle(page);
  const dl = await downloadExport(page, '#btn-export');
  const out = decode(dl.bytes);
  ok(dl.name === 'roundtrip.png', 'имя файла из Output', dl.name);
  ok(out.width === 256 && out.height === 256, 'размер сохранён', [out.width, out.height]);
  let mism = 0, a0 = 0, a0rgb = 0;
  for (let i = 0; i < srcPx.length; i++) if (srcPx[i] !== out.data[i]) mism++;
  for (let i = 0; i < srcPx.length; i += 4) if (srcPx[i + 3] === 0) { a0++; if (srcPx[i] || srcPx[i + 1] || srcPx[i + 2]) a0rgb += srcPx[i] === out.data[i] && srcPx[i + 1] === out.data[i + 1] ? 1 : 0; }
  ok(mism === 0, 'все каналы всех пикселей совпадают побайтно (pngjs-декодер)', mism);
  ok(a0 > 1000 && a0rgb > 900, 'RGB сохранён при A=0', { a0, a0rgb });
  ok(out.data[0] === 255 && out.data[2] === 0 && out.data[(256 * 256 - 1) * 4 + 2] === 255, 'ориентация: красный пиксель в (0,0), синий в (255,255) — без переворота');
  // re-import the exported file (our decoder) and compare again
  const again = await page.evaluate(async (b) => {
    const img2 = await PTL.importImage(b, { name: 'again.png', interp: 'data' });
    return Array.from(PTL.render(img2).rgba);
  }, b64(dl.bytes));
  let m2 = 0; for (let i = 0; i < again.length; i++) if (again[i] !== srcPx[i]) m2++;
  ok(m2 === 0, 'повторный импорт экспортированного PNG — точная копия', m2);
  // sRGB colour mode round trip on opaque pixels (linear fp16 inside)
  const col = await page.evaluate((img) => { PTL.setParams(img, { interp: 'srgb' }); return Array.from(PTL.render(img).rgba); }, ids.img);
  let cm = 0; for (let i = 0; i < col.length; i++) if (col[i] !== srcPx[i]) cm++;
  ok(cm === 0, 'режим «Цвет sRGB»: sRGB→linear(fp16)→sRGB тоже без изменений', cm);
  // other bit depths
  const g16 = makePng16(256, 256, (x, y) => [Math.min(65535, x * 257 + 100), y * 257, Math.min(65535, (255 - x) * 257 + 160), 65535]);
  const pal = makePng(256, 256, (x) => [x & 1 ? 255 : 0, 0, 0, 255], { colorType: 2 });
  const r16 = await page.evaluate(async ([a, b]) => {
    const i1 = await PTL.importImage(a, { name: '16bit.png', interp: 'data' });
    const toast = [...document.querySelectorAll('.toast')].pop()?.textContent;
    const i2 = await PTL.importImage(b, { name: 'rgb.png', interp: 'data' });
    return { p16: PTL.pixel(i1, 10, 20), toast, p8: PTL.pixel(i2, 1, 5) };
  }, [b64(g16), b64(pal)]);
  ok(r16.p16.join() === '10,20,246,255', '16-битный PNG преобразован в 8 бит с округлением (v/257)', r16);
  ok(/16-бит/.test(r16.toast || ''), 'предупреждение о преобразовании 16 бит показано');
  ok(r16.p8.join() === '255,0,0,255', 'RGB без альфы (colour type 2) импортирован');
  await page.context().close();
});

await test('Маски без гамма-коррекции; preview совпадает с экспортом', async () => {
  const page = await openPage();
  const r = await page.evaluate(() => {
    PTL.newProject(); PTL.setResolution(256);
    const c = PTL.addNode('constant', { params: { mode: 'gray', value: 0.5 } });
    const g = PTL.addNode('gradient', {});
    const o = PTL.addNode('output');
    PTL.connect(c, 0, o, 0);
    const half = PTL.pixel(o, 5, 5);
    PTL.connect(g, 0, o, 0);
    const row = PTL.render(o).rgba;
    let bad = 0;
    for (let x = 0; x < 256; x++) { const expect = Math.round(((x + 0.5) / 256) * 255); if (Math.abs(row[x * 4] - expect) > 0) bad++; }
    return { half, bad };
  });
  ok(r.half.join() === '128,128,128,255', 'серое 0.5 → 128 (не 188 после sRGB)', r.half);
  ok(r.bad === 0, 'линейный градиент-маска экспортируется линейно (x+0.5)/256·255', r.bad);
  for (let k = 0; k < 3; k++) {
    const d = await page.evaluate(async (k) => {
      PTL.loadExample(k); await PTL.whenIdle(); await PTL.whenIdle();
      const out = [];
      for (const n of PTL.getGraph().nodes) {
        const cached = PTL._test.cached(n.id);
        const fresh = PTL.render(n.id, { size: 512 }).rgba;
        let m = 0; for (let i = 0; i < fresh.length; i++) m = Math.max(m, Math.abs(fresh[i] - cached.bytes[i]));
        out.push(m);
      }
      return out;
    }, k);
    ok(d.every((m) => m === 0), `пример ${k + 1}: предпросмотр (кэш GPU) = экспорт при одинаковом разрешении, все ноды`, d);
  }
  await page.context().close();
});

await test('Сохранение и восстановление проекта со встроенным изображением', async () => {
  const page = await openPage();
  const png = makePng(300, 200, (x, y) => [x % 256, y, (x * y) % 256, x < 150 ? 0 : 200]);
  await page.evaluate(async (b) => {
    PTL.newProject(); PTL.setResolution(256);
    const img = await PTL.importImage(b, { name: 'photo.png', interp: 'data', fit: 'cover' });
    const bl = PTL.addNode('gaussian', { params: { sigma: 2.5 } });
    const o = PTL.addNode('output', { params: { filename: 'saved_proj' } });
    PTL.connect(img, 0, bl, 0); PTL.connect(bl, 0, o, 0);
  }, b64(png));
  await idle(page);
  const before = await page.evaluate(() => Array.from(PTL.render(PTL.getGraph().activeOutput).rgba));
  const dl = await downloadExport(page, '#btn-save');
  const proj = JSON.parse(dl.bytes.toString());
  ok(proj.format === 'pocket-texture-lab' && proj.version === 1, 'формат и версия', { name: dl.name });
  ok(Object.keys(proj.assets).length === 1 && proj.resolution === 256 && proj.activeOutput, 'изображение, разрешение и основной выход в файле');
  await page.context().close();
  const page2 = await openPage();
  await page2.setInputFiles('#file-project', dl.path);
  await page2.waitForFunction(() => PTL.getGraph().nodes.some((n) => n.type === 'image'));
  await idle(page2);
  const after = await page2.evaluate(() => Array.from(PTL.render(PTL.getGraph().activeOutput).rgba));
  let m = 0; for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) m++;
  ok(m === 0 && after.length === before.length, 'после открытия в новом окне результат идентичен', m);
  const g = await page2.evaluate(() => PTL.getGraph());
  ok(g.nodes.find((n) => n.type === 'image').params.fit === 'cover' && g.resolution === 256, 'параметры и позиции восстановлены');
  // corrupted project
  const bad = path.join(OUT, 'broken.ptl.json');
  fs.writeFileSync(bad, dl.bytes.toString().slice(0, 500));
  await page2.setInputFiles('#file-project', bad);
  await page2.waitForSelector('.toast.err');
  const t = await page2.locator('.toast.err').last().textContent();
  ok(/Не удалось открыть проект/.test(t), 'повреждённый проект → понятное сообщение', t);
  ok(await page2.evaluate(() => PTL.getGraph().nodes.length) === 3, 'текущий граф не потерян');
  await page2.context().close();
});

await test('Повреждённые изображения', async () => {
  const page = await openPage();
  const good = makePng(64, 64, () => [1, 2, 3, 255]);
  const trunc = good.subarray(0, good.length - 30);
  const flipped = Buffer.from(good); flipped[45] ^= 0xff;
  const notImg = Buffer.from('hello world, definitely not a png');
  const cases = [['trunc.png', trunc], ['crc.png', flipped], ['text.png', notImg], ['bad.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])]];
  for (const [name, buf] of cases) {
    const p = path.join(OUT, name); fs.writeFileSync(p, buf);
    const n0 = await page.locator('.toast.err').count();
    await page.setInputFiles('#file-image', p);
    await page.waitForFunction((n0) => document.querySelectorAll('.toast.err').length > n0, n0);
    const t = await page.locator('.toast.err').last().textContent();
    ok(/повреж|только PNG и JPEG|не поддерж|обрезан/i.test(t), `${name}: понятное сообщение`, t);
  }
  // JPEG via browser encoder
  const jpg = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const g = c.getContext('2d'); g.fillStyle = '#c04020'; g.fillRect(0, 0, 128, 64);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const id = await PTL.importImage(bytes, { name: 'x.jpg' });
    return PTL.pixel(id, 100, 100);
  });
  ok(Math.abs(jpg[0] - 192) < 4 && Math.abs(jpg[1] - 64) < 4 && jpg[3] === 255, 'JPEG импортируется (растянут до проекта)', jpg);
  await page.context().close();
});

await test('Прочие ноды: Radial 0 = вход, Levels без деления на 0, Color Ramp, Combine, Split, Blend, Code', async () => {
  const page = await openPage();
  const r = await page.evaluate(() => {
    PTL.newProject(); PTL.setResolution(256);
    const same = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
    const nz = PTL.addNode('noise', { params: { scale: 5 } });
    const rb = PTL.addNode('radialblur', { params: { strength: 0 } });
    PTL.connect(nz, 0, rb, 0);
    const radial0 = same(PTL.render(nz).rgba, PTL.render(rb).rgba);
    PTL.setParams(rb, { strength: 0.3 }); const radialOn = same(PTL.render(nz).rgba, PTL.render(rb).rgba);
    const lv = PTL.addNode('levels', { params: { inBlack: 0.5, inWhite: 0.5 } });
    PTL.connect(nz, 0, lv, 0);
    const lvs = PTL.stats(lv);
    const ramp = PTL.addNode('ramp', { params: { interp: 'linear', stops: [{ p: 0, c: [0, 0, 0, 1] }, { p: 0.5, c: [1, 0, 0, 1] }, { p: 0.5, c: [0, 0, 1, 0.5] }, { p: 1, c: [1, 1, 1, 1] }] } });
    const gr = PTL.addNode('gradient', {});
    PTL.connect(gr, 0, ramp, 0);
    const left = PTL.pixel(ramp, 126, 3), right = PTL.pixel(ramp, 128, 3);
    // Combine ORM with defaults
    const cb = PTL.addNode('combine', { params: { preset: 'orm' } });
    const empty = PTL.pixel(cb, 0, 0);
    const c1 = PTL.addNode('constant', { params: { value: 0.2 } }), c2 = PTL.addNode('constant', { params: { value: 0.6 } });
    PTL.connect(c1, 0, cb, 0); PTL.connect(c2, 0, cb, 1);
    const orm = PTL.pixel(cb, 0, 0);
    PTL.setParams(cb, { preset: 'hdrp' });
    PTL.connect(c2, 0, cb, 3); PTL.setParams(cb, { aInv: true });
    const hdrp = PTL.pixel(cb, 0, 0);
    // Split
    const col = PTL.addNode('constant', { params: { mode: 'color', color: [1, 0.5, 0.25, 0.75] } });
    const sp = PTL.addNode('split'); PTL.connect(col, 0, sp, 0);
    const split = [0, 1, 2, 3].map((k) => PTL.render(sp, { port: k }).rgba.slice(0, 4).join());
    // Blend
    const bl = PTL.addNode('blend', { params: { mode: 'multiply', opacity: 1 } });
    PTL.connect(c2, 0, bl, 0); PTL.connect(c2, 0, bl, 1);
    const mult = PTL.pixel(bl, 0, 0);
    // Code node
    const code = PTL.addNode('code', { params: { code: 'vec4 process(vec2 uv, ivec2 px){ return vec4(uv.x, p1, float(px.y)/255.0, 1.0); }', p1: 0.25 } });
    const cp = PTL.pixel(code, 255, 51);
    const cerrBefore = PTL.errors()[code];
    PTL.setParams(code, { code: 'vec4 process(vec2 uv, ivec2 px){ return oops; }' });
    const cerr = PTL.errors()[code];
    return { radial0, radialOn, lvs, left, right, empty, orm, hdrp, split, mult, cp, cerrBefore, cerr };
  });
  ok(r.radial0 === 0, 'Radial Blur с силой 0 точно равен входу', r.radial0);
  ok(r.radialOn > 5, 'Radial Blur с силой 0.3 размывает', r.radialOn);
  ok(r.lvs.min[0] === 0 && r.lvs.max[0] === 255, 'Levels при совпадающих точках = порог, без NaN', r.lvs);
  ok(r.left[0] > 240 && r.left[2] < 5 && r.right[2] > 240 && r.right[3] === 128, 'Color Ramp: совпадающие позиции дают резкий переход (альфа точки учтена)', [r.left, r.right]);
  ok(r.empty.join() === '255,128,0,255', 'Combine ORM без входов: видимые значения по умолчанию (AO=1, R=0.5, M=0, A=1)', r.empty);
  ok(r.orm.join() === '51,153,0,255', 'Combine ORM упаковывает каналы', r.orm);
  ok(r.hdrp[3] === 102, 'HDRP: A = 1−roughness только при явной инверсии', r.hdrp);
  ok(r.split.join('|') === '255,255,255,255|128,128,128,255|64,64,64,255|191,191,191,255', 'Split: R,G,B,A как серые (значения sRGB как в файле)', r.split);
  ok(r.mult.join() === '92,92,92,255', 'Blend Multiply 0.6·0.6 = 0.36', r.mult);
  ok(!r.cerrBefore && r.cp[0] === 255 && r.cp[1] === 64 && r.cp[2] === 51, 'Code (GLSL): свой шейдер работает, uv/px/p1', [r.cp, r.cerrBefore]);
  ok(/oops/.test(r.cerr || ''), 'Code (GLSL): ошибка компиляции видна', r.cerr);
  await page.context().close();
});

await test('Экспорт в другом разрешении и экспорт выбранной ноды', async () => {
  const page = await openPage();
  await page.evaluate(() => PTL.loadExample(1));
  await idle(page);
  await page.selectOption('#exres', '1024');
  const dl = await downloadExport(page, '#btn-export');
  const img = decode(dl.bytes);
  ok(img.width === 1024 && img.height === 1024, 'экспорт пересчитан в 1024×1024 (проект 512)', [img.width, img.height]);
  const normalId = await page.evaluate(() => PTL.getGraph().nodes.find((n) => n.type === 'normal').id);
  await page.click(`.node[data-id="${normalId}"] .head`);
  await page.selectOption('#exres', 'project');
  const dl2 = await downloadExport(page, '#btn-export-sel');
  const img2 = decode(dl2.bytes);
  ok(img2.width === 512 && /normal_/.test(dl2.name), 'PNG выбранной ноды', dl2.name);
  const fresh = await page.evaluate((id) => Array.from(PTL.render(id).rgba), normalId);
  let m = 0; for (let i = 0; i < fresh.length; i++) if (fresh[i] !== img2.data[i]) m++;
  ok(m === 0, 'файл = PTL.render побайтно', m);
  await page.context().close();
});

await test('Потеря WebGL-контекста без потери графа', async () => {
  const page = await openPage();
  const before = await page.evaluate(() => ({ g: JSON.stringify(PTL.getGraph()), px: PTL.pixel(PTL.getGraph().activeOutput, 10, 10) }));
  const lost = await page.evaluate(async () => {
    const gl = document.getElementById('view').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_lose_context');
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 300));
    const shown = document.getElementById('lost').classList.contains('show');
    ext.restoreContext();
    await new Promise((r) => setTimeout(r, 600));
    return shown;
  });
  await idle(page);
  const after = await page.evaluate(() => ({ g: JSON.stringify(PTL.getGraph()), px: PTL.pixel(PTL.getGraph().activeOutput, 10, 10), lost: document.getElementById('lost').classList.contains('show') }));
  ok(lost, 'показано сообщение о потере контекста');
  ok(after.g === before.g && after.px.join() === before.px.join() && !after.lost, 'после восстановления граф и результат те же', [before.px, after.px]);
  await page.screenshot({ path: path.join(OUT, 'after-context-restore.png') });
  await page.context().close();
});

await test('Нет WebGL2 → понятное сообщение', async () => {
  const page = await openPage({
    noWait: true,
    init: () => { const o = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return t === 'webgl2' ? null : o.call(this, t, ...a); }; },
  });
  const vis = await page.locator('#fatal.show').count();
  const txt = await page.locator('#fatal-box').textContent();
  ok(vis === 1 && /WebGL2 недоступен/.test(txt), 'показан экран «WebGL2 недоступен»', txt.slice(0, 60));
  await page.screenshot({ path: path.join(OUT, 'no-webgl2.png') });
  await page.context().close();
});

await test('Режим RGBA8 (без float-текстур)', async () => {
  const page = await openPage({ query: '?rgba8' });
  const r = await page.evaluate(() => {
    const info = PTL.info();
    PTL.newProject(); PTL.setResolution(256);
    const c = PTL.addNode('constant', { params: { value: 0.5 } }), n = PTL.addNode('normal');
    PTL.connect(c, 0, n, 0);
    return { info, flat: PTL.pixel(n, 3, 3), half: PTL.pixel(c, 3, 3) };
  });
  ok(!r.info.floatTextures && /RGBA8/.test(r.info.precision), 'ограничение точности показано', r.info.precision);
  ok(r.flat.join() === '128,128,255,255' && r.half.join() === '128,128,128,255', 'расчёты работают в RGBA8', r);
  await page.context().close();
});

await test('API для агентов: справка, описание нод, ошибки валидации', async () => {
  const page = await openPage();
  const r = await page.evaluate(async () => {
    const help = PTL.help();
    const types = PTL.nodeTypes();
    let e1 = '', e2 = '';
    try { PTL.addNode('nope'); } catch (e) { e1 = e.message; }
    const id = PTL.addNode('noise');
    try { PTL.setParams(id, { type: 'banana' }); } catch (e) { e2 = e.message; }
    const png = await PTL.renderPNG(id, { size: 256 });
    const guideEl = !!document.querySelector('script#ptl-agent-guide');
    const meta = document.querySelector('meta[name=ai-agent-api]')?.content;
    return { helpLen: help.length, types: types.length, e1, e2, pngSig: Array.from(png.slice(0, 8)), guideEl, meta };
  });
  ok(r.helpLen > 2000 && r.guideEl && /PTL/.test(r.meta), 'встроенное руководство доступно (PTL.help, #ptl-agent-guide, meta)', r.helpLen);
  ok(r.types >= 20, 'PTL.nodeTypes() описывает все ноды', r.types);
  ok(/perlin, value|perlin/.test(r.e2) && /Есть:/.test(r.e1), 'понятные ошибки валидации', [r.e1.slice(0, 60), r.e2]);
  ok(r.pngSig.join() === '137,80,78,71,13,10,26,10', 'renderPNG возвращает PNG');
  await page.context().close();
});

await test('Новые шумы и узоры: воспроизводимость и периодичность (Tiler, Splatter, Waves, Worley, Ridged, Warp)', async () => {
  const page = await openPage();
  const res = await page.evaluate(() => {
    PTL.newProject(); PTL.setResolution(256);
    const cmp = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
    const cases = [
      ['noise', { type: 'worley', scale: 5, octaves: 3 }], ['noise', { fractal: 'ridged', scale: 3, octaves: 6, lacunarity: 3 }],
      ['noise', { fractal: 'billow', scale: 4, stretch: 4 }], ['noise', { scale: 3, warp: 0.8, warpScale: 3 }],
      ['noise', { type: 'white', grain: 4, octaves: 2 }], ['voronoi', { mode: 'crackle', metric: 'manhattan', scale: 7 }],
      ['voronoi', { mode: 'f2', scale: 5 }], ['waves', { countX: 3, countY: -2, shape: 'triangle' }],
      ['tiler', { countX: 5, countY: 6, rowOffset: 0.5, posRand: 0.3, sizeRand: 0.3, rotRand: 30, sizeX: 1.3 }],
      ['splatter', { count: 300, size: 0.1, sizeRand: 0.5, blend: 'top' }], ['splatter', { count: 3000, size: 0.3, aspect: 0.05, pattern: 'square' }],
    ];
    const out = [];
    for (const [t, p] of cases) {
      const id = PTL.addNode(t, { params: p });
      const a = PTL._test.renderRaw(id, 256).bytes, a2 = PTL._test.renderRaw(id, 256).bytes;
      const u1 = PTL._test.renderRaw(id, 256, [1, 0]).bytes, v1 = PTL._test.renderRaw(id, 256, [2, -1 + 2]).bytes;
      let sum = 0; for (let i = 0; i < a.length; i += 4) sum += a[i];
      out.push({ t, p, same: cmp(a, a2), du: cmp(a, u1), dv: cmp(a, v1), mean: sum / (a.length / 4) });
    }
    // tiler random output and presets
    const tl = PTL.addNode('tiler'); PTL.applyPreset(tl, 'Кирпичи');
    const rnd = PTL.stats(tl, { port: 1 }), pat = PTL.stats(tl);
    return { out, rnd, pat, errors: PTL.errors() };
  });
  for (const r of res.out) {
    ok(r.same === 0 && r.du <= 1 && r.dv <= 1 && r.mean > 3 && r.mean < 252,
      `${r.t} ${JSON.stringify(r.p)}: детерминирован и периодичен по u+1, v+1`, { du: r.du, dv: r.dv, mean: Math.round(r.mean) });
  }
  ok(res.rnd.max[0] > res.rnd.min[0] + 100 && res.pat.max[0] > 200, 'Tiler: второй выход — случайное значение на копию', res.rnd);
  ok(Object.keys(res.errors).length === 0, 'нет ошибок нод', res.errors);
  await page.context().close();
});

await test('Типы пинов (серый / цвет / любой) и описания нод', async () => {
  const page = await openPage();
  const r = await page.evaluate(() => {
    PTL.newProject();
    const n = PTL.addNode('noise'), ramp = PTL.addNode('ramp'), bl = PTL.addNode('blend'), hsv = PTL.addNode('hsv');
    PTL.connect(n, 0, ramp, 0);
    const q = (id, dir, k) => document.querySelector(`.node[data-id="${id}"] .port.${dir}[data-port="${k}"] .dot`).className;
    const types = PTL.nodeTypes();
    return {
      noiseOut: q(n, 'out', 0), rampIn: q(ramp, 'in', 0), rampOut: q(ramp, 'out', 0), blendA: q(bl, 'in', 0), blendMask: q(bl, 'in', 2), hsvIn: q(hsv, 'in', 0),
      allDesc: types.every((t) => t.description && t.description.length > 20), kinds: types.find((t) => t.type === 'blend').inputs.map((i) => i.accepts),
    };
  });
  ok(/k-gray/.test(r.noiseOut) && /k-gray/.test(r.rampIn) && /k-color/.test(r.rampOut) && /k-any/.test(r.blendA) && /k-gray/.test(r.blendMask) && /k-color/.test(r.hsvIn),
    'пины размечены: шум→серый, Ramp: серый→цвет, Blend A любой, маска серая, HSV цвет', r);
  ok(/\bon\b/.test(r.noiseOut) && !/\bon\b/.test(r.blendA), 'подключённый пин закрашен, свободный — кольцо');
  ok(r.allDesc && r.kinds.join() === 'any,any,gray', 'у каждой ноды есть описание; PTL.nodeTypes() отдаёт типы входов', r.kinds);
  await page.context().close();
});

await test('Шаблоны текстур, пресеты градиентов, вынесенные параметры, библиотека в браузере', async () => {
  const page = await openPage();
  const r = await page.evaluate(async () => {
    const tpl = PTL.examples().filter((e) => /Кирпич|Асфальт|Булыж|Дерев|металл/.test(e.title));
    const res = [];
    for (const e of tpl) {
      PTL.loadExample(e.index);
      const g = PTL.getGraph();
      const outs = g.nodes.filter((n) => n.type === 'output').map((n) => n.params.filename);
      const st = PTL.stats(g.activeOutput);
      res.push({ title: e.title, outs, exposed: PTL.exposed().length, errors: Object.keys(PTL.errors()).length, spread: st.max[0] - st.min[0] });
    }
    // exposed param drives the node
    PTL.loadExample(tpl[0].index);
    const lbl = PTL.exposed()[0].label, before = PTL.exposed()[0].value;
    PTL.setExposed(lbl, before + 1);
    const after = PTL.exposed()[0].value;
    const projPanel = document.querySelectorAll('#params .prow').length;
    // ramp presets
    const ramp = PTL.addNode('ramp');
    PTL.applyPreset(ramp, 'Magma');
    const magma = PTL.getParams(ramp).stops.length;
    PTL.applyPreset(ramp, 'Fire');
    const fire = PTL.getParams(ramp).stops[7].c;
    // library
    localStorage.clear();
    PTL.setParams(ramp, { interp: 'smooth' });
    PTL.library.saveNodePreset(ramp, 'Мой огонь');
    PTL.library.saveTemplate('Моя стена');
    const saved = { presets: PTL.library.nodePresets('ramp').map((p) => p.name), templates: PTL.library.templates().map((t) => t.name) };
    PTL.newProject();
    await PTL.library.loadTemplate('Моя стена');
    const reloaded = PTL.getGraph().nodes.length;
    const menu = [...document.querySelectorAll('#examples option')].map((o) => o.textContent);
    return { res, lbl, before, after, projPanel, magma, fire, saved, reloaded, menu };
  });
  for (const t of r.res) ok(t.outs.length === 3 && t.outs.some((f) => /albedo/.test(f)) && t.outs.some((f) => /normal/.test(f)) && t.outs.some((f) => /orm/.test(f)) && t.exposed >= 5 && t.errors === 0 && t.spread > 40,
    `шаблон «${t.title}»: 3 выхода (albedo, normal, orm), вынесенные параметры, без ошибок`, t);
  ok(r.after === r.before + 1 && r.projPanel >= 5, 'вынесенный параметр меняет ноду; панель «Проект» показывает ползунки', [r.lbl, r.before, r.after, r.projPanel]);
  ok(r.magma === 8 && r.fire.slice(0, 3).join() === '1,1,1', 'пресеты градиентов (Magma, Fire)', r.fire);
  ok(r.saved.presets.includes('Мой огонь') && r.saved.templates.includes('Моя стена') && r.reloaded > 10 && r.menu.includes('Моя стена'),
    'библиотека: пресет ноды и шаблон проекта сохраняются в localStorage и открываются', r.saved);
  // persistence across a page reload (same browser profile)
  await page.reload();
  await page.waitForFunction(() => window.PTL);
  const kept = await page.evaluate(() => PTL.library.templates().map((t) => t.name));
  ok(kept.includes('Моя стена'), 'после перезагрузки страницы шаблон на месте (file://)', kept);
  await page.evaluate(() => localStorage.clear());
  await page.context().close();
});

await browser.close();

console.log('\n# Внешние запросы: ' + (netRequests.length ? netRequests.join(', ') : 'нет'));
ok(netRequests.length === 0, 'ни одного сетевого запроса за все тесты');
const realErrors = pageErrors.filter((e) => !/GL Driver Message|GPU stall/.test(e));
ok(realErrors.length === 0, 'нет JS-ошибок на странице', realErrors.slice(0, 5));
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
console.log(`\nИтого: ${results.length - failed.length}/${results.length} проверок пройдено`);
if (failed.length) { console.log('Провалы:'); for (const f of failed) console.log(' -', f.test, '::', f.msg); process.exit(1); }
