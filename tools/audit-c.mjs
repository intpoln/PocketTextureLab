// Stage C probes: aliasing against a supersampled reference and sparse-sample banding.
// For each case: MAE (0..255) between the 256 px render and the 2048 px render box-downsampled
// to 256 px — how far a pixel is from the true area average of the pattern.
//   node tools/audit-c.mjs [file.html]
import { chromium } from 'playwright';
import path from 'node:path';

const FILE = process.argv[2] || 'texture-lab.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + path.resolve(FILE));
await page.waitForFunction(() => window.PTL);

const r = await page.evaluate(() => {
  const out = {};
  const gray = (id, size, ch = 0) => { const px = PTL.render(id, { size }).rgba; const g = new Float32Array(size * size); for (let i = 0; i < g.length; i++) g[i] = px[i * 4 + ch]; return g; };
  const down = (g, S, k) => { const s = S / k, o = new Float32Array(s * s); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) o[Math.floor(y / k) * s + Math.floor(x / k)] += g[y * S + x] / (k * k); return o; };
  const mae = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return +(d / a.length).toFixed(2); };
  const vsRef = (build) => { PTL.newProject(); PTL.setResolution(2048); const id = build(); return mae(gray(id, 256), down(gray(id, 2048), 2048, 8)); };
  const code = (glsl) => PTL.addNode('code', { params: { code: glsl, space: 'data' } });

  out.waves_square_31x7 = vsRef(() => PTL.addNode('waves', { params: { shape: 'square', countX: 31, countY: 7 } }));
  out.waves_saw_rings40 = vsRef(() => PTL.addNode('waves', { params: { shape: 'saw', mode: 'rings', rings: 40 } }));
  out.waves_sine_x96 = vsRef(() => PTL.addNode('waves', { params: { shape: 'sine', countX: 96 } }));
  out.shape_thin_rect = vsRef(() => PTL.addNode('shape', { params: { shape: 'rect', sizeX: 0.9, sizeY: 0.006, rotation: 7, softness: 0 } }));
  out.voronoi_border_40 = vsRef(() => PTL.addNode('voronoi', { params: { mode: 'border', scale: 40 } }));
  out.tiler_discs_40 = vsRef(() => PTL.addNode('tiler', { params: { pattern: 'disc', countX: 40, countY: 40, sizeX: 0.8, sizeY: 0.8, bevel: 0 } }));
  // Transform minification: fine checker scaled down 4x
  out.transform_min4 = vsRef(() => {
    const c = code('vec4 process(vec2 uv, ivec2 px) { vec2 q = floor(uv * 64.0); float v = mod(q.x + q.y, 2.0); return vec4(v, v, v, 1.0); }');
    const t = PTL.addNode('transform', { params: { scaleX: 0.23, scaleY: 0.23, rotation: 13 } }); PTL.connect(c, 0, t, 0); return t;
  });
  // Polar: 32 stripes wrapped into a circle (centre concentrates all columns)
  out.polar_stripes32 = vsRef(() => {
    const w = PTL.addNode('waves', { params: { shape: 'sine', countX: 32 } });
    const p = PTL.addNode('polar', { params: {} }); PTL.connect(w, 0, p, 0); return p;
  });

  // Sparse sampling: patterns that a correct blur turns into flat 50 % gray. Remaining ripple (max − min
  // over the flat region) is the banding left by too few samples along the path.
  {
    PTL.newProject(); PTL.setResolution(512);
    const bars = code('vec4 process(vec2 uv, ivec2 px) { float v = float((px.x / 2) % 2); return vec4(v, v, v, 1.0); }');
    const b = PTL.addNode('dirblur', { params: { length: 300, angle: 0, wrap: 'repeat' } }); PTL.connect(bars, 0, b, 0);
    const px = PTL.render(b, { size: 512 }).rgba;
    let lo = 1e9, hi = 0; for (let x = 0; x < 512; x++) { const v = px[(100 * 512 + x) * 4]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
    out.dirblur_ripple = hi - lo;
    const wedges = code('vec4 process(vec2 uv, ivec2 px) { vec2 d = uv - 0.5; float v = step(0.5, fract(atan(d.y, d.x) / 6.2831853 * 64.0)); return vec4(v, v, v, 1.0); }');
    const rb = PTL.addNode('radialblur', { params: { mode: 'spin', strength: 0.5, quality: 32, wrap: 'clamp' } }); PTL.connect(wedges, 0, rb, 0);
    const p2 = PTL.render(rb, { size: 512 }).rgba;
    let l2 = 1e9, h2 = 0; for (let k = 0; k < 400; k++) { const a = k / 400 * 6.2831853, x = Math.round(256 + 200 * Math.cos(a)), y = Math.round(256 + 200 * Math.sin(a)); const v = p2[(y * 512 + x) * 4]; l2 = Math.min(l2, v); h2 = Math.max(h2, v); }
    out.radial_ripple_r200 = h2 - l2;
  }
  return out;
});
for (const [k, v] of Object.entries(r)) console.log(k.padEnd(22), JSON.stringify(v));
if (errors.length) console.log('page errors', errors);
await browser.close();
