// Renders a grid of cases into one image (quality review / docs).
//   node tools/sheet.mjs cases.json out.jpg [file.html]
// cases.json: { "cols": 4, "size": 256, "cases": [ { "label": "...", "script": "JS that returns a node id", "t": 0.25 } ] }
// The script runs inside the page with PTL available; a fresh project (resolution = size) per case.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [CASES, OUT, FILE = 'texture-lab.html'] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(CASES, 'utf8'));
const S = spec.size || 256, cols = spec.cols || 4;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + path.resolve(FILE));
await page.waitForFunction(() => window.PTL);
const imgs = [];
for (const c of spec.cases) {
  const r = await page.evaluate(async ([c, S, res]) => {
    window.setTimeout = window.setTimeout || (() => 0);
    PTL.newProject(); PTL.setResolution(res);
    const id = new Function('PTL', c.script)(PTL);
    Anim.t = c.t ?? 0;
    const png = await PTL.renderPNG(id, { size: c.size || S, port: c.port || 0 });
    const err = PTL.errors()[id];
    let s = ''; for (const b of png) s += String.fromCharCode(b);
    return { b64: btoa(s), err: err || null };
  }, [c, S, spec.resolution || [256, 512, 1024, 2048].find((v) => v >= S) || 2048]);
  if (r.err) console.log('node error in', c.label, r.err);
  imgs.push({ ...r, label: c.label });
}
const view = await browser.newPage();
const bg = spec.background || '#000';
await view.setContent(`<body style="margin:0;padding:8px;background:#1b1d22;display:grid;grid-template-columns:repeat(${cols},${S}px);gap:8px">
  ${imgs.map((x) => `<figure style="margin:0;font:12px/1.3 sans-serif;color:#d8dbe2"><img src="data:image/png;base64,${x.b64}" style="display:block;width:${S}px;height:${S}px;background:${bg};image-rendering:pixelated">${x.label}</figure>`).join('')}</body>`);
const rows = Math.ceil(imgs.length / cols);
await view.setViewportSize({ width: cols * (S + 8) + 8, height: rows * (S + 44) + 8 });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await view.screenshot({ path: OUT, type: OUT.endsWith('.png') ? 'png' : 'jpeg', ...(OUT.endsWith('.png') ? {} : { quality: 88 }), fullPage: true });
await browser.close();
if (errors.length) console.log('page errors:', errors);
console.log('written', OUT);
