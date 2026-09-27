// Renders the README showcase images from the real app (headless Chromium, file://).
//   node tools/readme-shots.mjs      -> docs/img/*.jpg
// Regenerate after UI changes so the README never shows an outdated editor.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('docs/img');
fs.mkdirSync(OUT, { recursive: true });
const URL_ = 'file://' + path.resolve('texture-lab.html');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function open(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.addInitScript(() => { try { localStorage.setItem('ptl.quickHidden', '1'); } catch (e) { /* ignore */ } });
  await page.goto(URL_);
  await page.waitForFunction(() => window.PTL && document.querySelectorAll('.node').length > 0);
  return page;
}
const idle = (page) => page.evaluate(() => PTL.whenIdle());
const exIndex = (page, re) => page.evaluate((src) => EXAMPLES.findIndex((x) => new RegExp(src).test(x.title)), re);
async function load(page, re) {
  await page.evaluate((k) => App.loadExample(k), await exIndex(page, re));
  await idle(page); await page.waitForTimeout(900); await idle(page);
}

// 1) the editor with a material template: graph + 2D|3D preview + template parameters
{
  const page = await open(1600, 900);
  await load(page, 'Кирпич');
  await page.evaluate(() => { Preview.setView({ layout: 'split' }); PTL.select(null); });
  await idle(page); await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'editor.jpg'), type: 'jpeg', quality: 86 });
  await page.close();
}

// 2) four materials on 3D objects (Base Color + Normal + ORM)
{
  const page = await open(1000, 900);
  await page.selectOption('#pres', '1024');
  const shots = [];
  for (const [re, mesh] of [['Кирпич', 'cube'], ['Булыж', 'sphere'], ['Деревян', 'cylinder'], ['металл: сколы', 'sphere']]) {
    await load(page, re);
    await page.evaluate((mesh) => { Preview.setView({ layout: '3d' }); const s = document.getElementById('m-mesh'); s.value = mesh; s.dispatchEvent(new Event('change')); }, mesh);
    await idle(page); await page.waitForTimeout(900);
    shots.push((await page.locator('#view').screenshot({ type: 'png' })).toString('base64'));
  }
  await page.setContent(`<body style="margin:0;background:#15171b;display:flex;gap:6px;padding:6px">${shots.map((b) => `<img src="data:image/png;base64,${b}" style="width:300px;height:300px;object-fit:cover;border-radius:6px">`).join('')}</body>`);
  await page.setViewportSize({ width: 4 * 300 + 5 * 6, height: 312 });
  await page.screenshot({ path: path.join(OUT, 'materials.jpg'), type: 'jpeg', quality: 88 });
  await page.close();
}

// 3) sprite sheets: explosion flipbook 4×4 and a flare, composited on dark (they have alpha)
{
  const page = await open(1200, 800);
  const sheets = [];
  for (const re of ['Взрыв', 'Портал']) {
    await load(page, re);
    await page.evaluate(() => PTL.stop && PTL.stop());
    const png = await page.evaluate(async () => {
      const r = await PTL.renderSpriteSheet(null, { frames: 16, frameSize: 128 });
      let s = ''; for (const b of r.png) s += String.fromCharCode(b); return btoa(s);
    });
    sheets.push(png);
  }
  await page.setContent(`<body style="margin:0;background:#0d0e11;display:flex;gap:10px;padding:10px">${sheets.map((b) => `<img src="data:image/png;base64,${b}" style="width:512px;height:512px;background:#0d0e11">`).join('')}</body>`);
  await page.setViewportSize({ width: 2 * 512 + 30, height: 532 });
  await page.screenshot({ path: path.join(OUT, 'spritesheets.jpg'), type: 'jpeg', quality: 88 });
  await page.close();
}

await browser.close();
for (const f of fs.readdirSync(OUT)) console.log(f, (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB');
