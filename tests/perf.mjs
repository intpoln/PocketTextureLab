// Rough timing (note: headless Chromium here uses SwiftShader = CPU rendering,
// so GPU numbers are far slower than on real hardware).
import { chromium } from 'playwright';
import path from 'node:path';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto('file://' + path.resolve('texture-lab.html'));
await page.waitForTimeout(800);
console.log(JSON.stringify(await page.evaluate(async () => {
  const out = {};
  PTL.loadExample(1);
  const g = PTL.getGraph();
  for (const res of [512, 1024, 2048]) {
    let t = performance.now(); const r = PTL.render(g.activeOutput, { size: res }); out['gpuEvalAndReadback' + res] = Math.round(performance.now() - t);
    t = performance.now(); await PNG.encodeAsync(r.rgba, res, res); out['pngEncodeNative' + res] = Math.round(performance.now() - t);
    t = performance.now(); PNG.encode(r.rgba, res, res); out['pngEncodePako' + res] = Math.round(performance.now() - t);
  }
  return out;
}), null, 1));
await browser.close();
