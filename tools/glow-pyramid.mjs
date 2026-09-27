// A6: Glow's downsampled pyramid vs. the direct sum of full-resolution Gaussians with the same
// weights ((σ + 0.7·2σ + 0.45·4σ) / 2.15 · intensity). Prints MAE (0..255) of the glow-only RGB.
//   node tools/glow-pyramid.mjs
import { chromium } from 'playwright'; import path from 'node:path';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage(); await p.goto('file://' + path.resolve('texture-lab.html')); await p.waitForFunction(() => window.PTL);
console.log(JSON.stringify(await p.evaluate(() => {
  const out = {};
  for (const [name, radius, shape] of [['disc r=0.1, σ=6', 6, 'ellipse'], ['disc r=0.1, σ=16', 16, 'ellipse'], ['thin line, σ=4', 4, 'rect']]) {
    PTL.newProject(); PTL.setResolution(512);
    const s = PTL.addNode('shape', { params: shape === 'rect' ? { shape, sizeX: 0.6, sizeY: 0.004, rotation: 17, repeat: false } : { shape, sizeX: 0.2, sizeY: 0.2, repeat: false } });
    const g = PTL.addNode('glow', { params: { threshold: 0, knee: 0, radius, intensity: 1, wrap: 'border' } }); PTL.connect(s, 0, g, 0);
    const gs = [1, 2, 4].map((m) => { const n = PTL.addNode('gaussian', { params: { sigma: radius * m, wrap: 'border' } }); PTL.connect(s, 0, n, 0); return n; });
    const a = PTL.render(g, { size: 512, port: 1 }).rgba;
    const G = gs.map((id) => PTL.render(id, { size: 512 }).rgba);
    const r = new Float32Array(a.length); for (let i = 0; i < a.length; i += 4) r[i] = (G[0][i] + 0.7 * G[1][i] + 0.45 * G[2][i]) / 2.15;
    let e = 0, mx = 0, n = 0; for (let i = 0; i < a.length; i += 4) { const d = Math.abs(a[i] * a[i + 3] / 255 - r[i]); e += d; mx = Math.max(mx, d); n++; }
    out[name] = { mae: +(e / n).toFixed(2), max: +mx.toFixed(1) };
  }
  return out;
}), null, 1));
await b.close();
