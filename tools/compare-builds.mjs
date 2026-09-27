// Renders every built-in example output with two builds and reports pixel differences.
//   node tools/compare-builds.mjs old.html new.html [size]
import { chromium } from 'playwright';
import path from 'node:path';
const [A, B, SIZE = '256'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function renderAll(file) {
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(file));
  await page.waitForFunction(() => window.PTL);
  const r = await page.evaluate(async (size) => {
    const res = {};
    window.setTimeout = () => 0;   // no delayed auto-play from loadExample: time stays fixed
    for (let k = 0; k < EXAMPLES.length; k++) {
      App.loadExample(k); App.stop && App.stop(); Anim.t = 0.25;
      for (const n of PTL.getGraph().nodes.filter((x) => x.type === 'output')) {
        const px = PTL.render(n.id, { size }).rgba;
        res[EXAMPLES[k].title + ' / ' + n.params.filename] = Array.from(px);
      }
    }
    return res;
  }, +SIZE);
  await page.close();
  return r;
}
const a = await renderAll(A), b = await renderAll(B);
for (const k of Object.keys(a)) {
  if (!b[k]) { console.log('missing in B:', k); continue; }
  let diff = 0, max = 0, maxPre = 0;
  for (let i = 0; i < a[k].length; i++) { const d = Math.abs(a[k][i] - b[k][i]); if (d) diff++; max = Math.max(max, d); }
  // light over black in LINEAR space (RGB→linear × A), as engines blend in linear mode;
  // reported back in 0..255 of linear light
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  for (let i = 0; i < a[k].length; i += 4) for (let c = 0; c < 3; c++) maxPre = Math.max(maxPre, 255 * Math.abs(lin(a[k][i + c]) * a[k][i + 3] - lin(b[k][i + c]) * b[k][i + 3]) / 255);
  console.log((diff ? 'DIFF ' : 'same ') + k.padEnd(70) + (diff ? ` ${(100 * diff / a[k].length).toFixed(2)}% values, max Δ ${max}, linear light over black max Δ ${maxPre.toFixed(1)}` : ''));
}
await browser.close();
