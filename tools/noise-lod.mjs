// LOD check: 256 px noise vs. the 2048 px render box-downsampled to 256 (mean abs error, 0..255).
//   node tools/noise-lod.mjs
import { chromium } from 'playwright'; import path from 'node:path';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage(); await p.goto('file://' + path.resolve('texture-lab.html')); await p.waitForFunction(() => window.PTL);
const r = await p.evaluate(() => {
  PTL.newProject(); PTL.setResolution(2048);
  const gray = (id, size) => { const px = PTL.render(id, { size }).rgba; const g = new Float32Array(size * size); for (let i = 0; i < g.length; i++) g[i] = px[i * 4]; return g; };
  const down = (g, S, k) => { const s = S / k, o = new Float32Array(s * s); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) o[Math.floor(y / k) * s + Math.floor(x / k)] += g[y * S + x] / (k * k); return o; };
  const mae = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; };
  const cfgs = { mild: { type: 'perlin', scale: 16, octaves: 8, persistence: 0.65 }, harsh: { type: 'perlin', scale: 64, octaves: 8, lacunarity: 4, persistence: 0.7 }, ridged: { type: 'perlin', fractal: 'ridged', scale: 32, octaves: 8, persistence: 0.7 }, worley: { type: 'worley', scale: 32, octaves: 6, persistence: 0.7 }, value: { type: 'value', scale: 32, octaves: 8, stretch: 4, persistence: 0.7 } };
  const out = {};
  // reference: 2048 without LOD box-downsampled to 256 (a proper supersampled image)
  const ref = {}; for (const [k, c] of Object.entries(cfgs)) ref[k] = down(gray(PTL.addNode('noise', { params: { ...c, lod: false } }), 2048), 2048, 8);
  const rowL = {}; for (const [k, c] of Object.entries(cfgs)) rowL[k] = +mae(gray(PTL.addNode('noise', { params: { ...c, lod: true } }), 256), ref[k]).toFixed(2);
  out.lod = rowL;
  const row = {}; for (const [k, c] of Object.entries(cfgs)) row[k] = +mae(gray(PTL.addNode('noise', { params: { ...c, lod: false } }), 256), ref[k]).toFixed(2);
  out.off = row;
  return out;
});
console.table(r);
await b.close();
