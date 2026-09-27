// Measures the mean of one noise octave after the fractal fold, per family × fractal.
// These constants (NOISE_MEANS in src/nodes.js) are what a sub-pixel octave fades to.
//   node tools/noise-means.mjs
import { chromium } from 'playwright';
import path from 'node:path';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto('file://' + path.resolve('texture-lab.html'));
await page.waitForFunction(() => window.PTL);
const r = await page.evaluate(() => {
  PTL.newProject(); PTL.setResolution(1024);
  const out = {};
  for (const [ti, type] of [[0, 'value'], [1, 'perlin'], [2, 'worley'], [3, 'white'], [4, 'flow']]) {
    out[ti] = ['fbm', 'ridged', 'billow'].map((fractal) => {
      let s = 0, n = 0;
      for (const seed of [1, 2, 3, 4]) {
        const id = PTL.addNode('noise', { params: { type, fractal, octaves: 1, scale: 32, grain: 1, lod: false, seed, advect: 0 } });
        const px = PTL.render(id, { size: 1024 }).rgba;
        for (let i = 0; i < px.length; i += 4) { s += px[i]; n++; }
        PTL.removeNode(id);
      }
      return +(s / n / 255).toFixed(4);
    });
  }
  return out;
});
console.log(JSON.stringify(r));
await browser.close();
