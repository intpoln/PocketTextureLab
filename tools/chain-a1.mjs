// Stage A1: Flare → Glow → Transform → Output, rendered with two builds and composited
// over black / gray / white, plus the alpha channel. Writes one comparison image.
//   node tools/chain-a1.mjs old.html new.html docs/img/quality/a1-flare-chain.jpg
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const [OLD, NEW, OUT] = process.argv.slice(2);
const S = 256;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

async function chain(file, extra = {}) {
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(file));
  await page.waitForFunction(() => window.PTL);
  const png = await page.evaluate(async ([S, extra]) => {
    PTL.newProject(); PTL.setResolution(256);
    // same parameters in both builds; each build uses its own defaults for boundary modes
    const f = PTL.addNode('flare', { params: { ...flarePreset(FLARE_PRESETS[0][2]), scale: 1.25, background: 'transparent' } });
    const g = PTL.addNode('glow', { params: { threshold: 0.2, radius: 10, intensity: 1.5 } });
    const t = PTL.addNode('transform', { params: { rotation: 20, scaleX: 0.85, scaleY: 0.85, offsetX: 0.08, ...extra } });
    const o = PTL.addNode('output');
    PTL.connect(f, 0, g, 0); PTL.connect(g, 0, t, 0); PTL.connect(t, 0, o, 0);
    Anim.t = 0.3;
    const bytes = await PTL.renderPNG(o, { size: S });
    let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
  }, [S, extra]);
  await page.close();
  return png;
}
const imgs = [await chain(OLD), await chain(NEW), await chain(NEW, { wrap: 'border' })];
const page = await browser.newPage();
const cell = (b64, bg, label) => `<figure style="margin:0;font:12px sans-serif;color:#ccc;text-align:center">
  <div style="width:${S}px;height:${S}px;background:${bg}"><img src="data:image/png;base64,${b64}" style="display:block;width:${S}px;height:${S}px${bg === 'alpha' ? ';filter:brightness(0) invert(1)' : ''}"></div>${label}</figure>`;
const row = (b64, name) => `<div style="display:flex;gap:8px;align-items:center"><b style="width:110px;color:#fff;font:14px sans-serif">${name}</b>
  ${cell(b64, '#000', 'поверх чёрного')}${cell(b64, '#808080', 'поверх серого')}${cell(b64, '#fff', 'поверх белого')}${cell(b64, 'alpha', 'альфа (белым)')}</div>`;
await page.setContent(`<body style="margin:0;padding:10px;background:#1b1d22;display:flex;flex-direction:column;gap:10px">
  ${row(imgs[0], 'до (0.3.2)')}${row(imgs[1], 'после, Transform: Repeat')}${row(imgs[2], 'после, Transform: Border')}</body>`);
await page.setViewportSize({ width: 80 + 4 * (S + 8) + 20, height: 3 * (S + 30) + 50 });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await page.screenshot({ path: OUT, type: 'jpeg', quality: 88 });
await browser.close();
console.log('written', OUT);
