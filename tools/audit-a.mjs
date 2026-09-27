// Stage A probes: reproduce (or refute) image-operation issues on the GPU with exact
// fixture images built by the GLSL Code node. Prints one JSON line per probe.
//   node tools/audit-a.mjs            (uses texture-lab.html)
import { chromium } from 'playwright';
import path from 'node:path';

const FILE = process.argv[2] || 'texture-lab.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + path.resolve(FILE));
await page.waitForFunction(() => window.PTL);

const results = await page.evaluate(() => {
  const S = 64, out = {};
  PTL.setResolution(256);
  const code = (glsl, space = 'data') => PTL.addNode('code', { params: { code: glsl, space } });
  const px = (r, x, y) => { const i = (y * r.width + x) * 4; return [r.rgba[i], r.rgba[i + 1], r.rgba[i + 2], r.rgba[i + 3]]; };
  const has = (type, key, val) => NODES[type].params.find((q) => q.key === key)?.options?.some(([v]) => v === val);
  PTL.newProject();

  // 1) Black opaque input -> Glow, "glow only" output, threshold 0: must stay fully transparent.
  {
    const blk = code('vec4 process(vec2 uv, ivec2 px) { return vec4(0.0, 0.0, 0.0, 1.0); }');
    for (const knee of [0.15, 0]) {
      const g = PTL.addNode('glow', { params: { threshold: 0, knee, radius: 4, intensity: 1.5 } });
      PTL.connect(blk, 0, g, 0);
      const r = PTL.render(g, { size: S, port: 1 });
      let maxA = 0, bad = 0;
      for (let i = 0; i < r.rgba.length; i += 4) { maxA = Math.max(maxA, r.rgba[i + 3]); if (!Number.isFinite(r.rgba[i])) bad++; }
      out['glow_black_knee' + knee] = { maxAlpha: maxA, nonFinite: bad, error: PTL.errors()[g] || null };
    }
  }

  // 2) Warp (gradient mode, Clamp): map = horizontal ramp, source = horizontal ramp.
  //    With a clamped map the left/right columns must not see the opposite edge.
  {
    const ramp = code('vec4 process(vec2 uv, ivec2 px) { return vec4(uv.x, uv.x, uv.x, 1.0); }');
    const w = PTL.addNode('warp', { params: { mode: 'gradient', intensity: 0.02, wrap: 'clamp' } });
    PTL.connect(ramp, 0, w, 0); PTL.connect(ramp, 0, w, 1);
    const r = PTL.render(w, { size: S });
    const row = S / 2;
    out.warp_clamp_edges = { col0: px(r, 0, row)[0], col1: px(r, 1, row)[0], col2: px(r, 2, row)[0], mid: px(r, S / 2, row)[0], last: px(r, S - 1, row)[0], prev: px(r, S - 2, row)[0] };
  }

  // 3) Alpha-aware Directional Blur: left half opaque red, right half invisible BRIGHT BLUE.
  //    Hidden blue must not leak into visible pixels.
  for (const node of ['dirblur', 'radialblur', 'gaussian']) {
    const src = code('vec4 process(vec2 uv, ivec2 px) { return uv.x < 0.5 ? vec4(1.0, 0.0, 0.0, 1.0) : vec4(0.0, 0.0, 1.0, 0.0); }');
    const params = node === 'dirblur' ? { length: 9, angle: 0, alphaAware: true, wrap: 'clamp' }
      : node === 'radialblur' ? { mode: 'spin', strength: 0.3, centerX: 0.5, centerY: 0.1, quality: 32, alphaAware: true, wrap: 'clamp' }
        : { sigma: 3, alphaAware: true, wrap: 'clamp' };
    const b = PTL.addNode(node, { params });
    PTL.connect(src, 0, b, 0);
    const r = PTL.render(b, { size: S });
    let maxBlue = 0, at = null;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const c = px(r, x, y); if (c[3] >= 8 && c[2] > maxBlue) { maxBlue = c[2]; at = [x, y, ...c]; } }
    out['hiddenRGB_' + node] = { maxBlueInVisible: maxBlue, at };
  }

  // 4) Impulse in column 0 -> Gaussian: Repeat wraps to the last column, Clamp extends the edge,
  //    Border (if available) must do neither.
  {
    const imp = code('vec4 process(vec2 uv, ivec2 px) { return px.x == 0 ? vec4(1.0) : vec4(0.0, 0.0, 0.0, 1.0); }');
    const modes = ['repeat', 'clamp', ...(has('gaussian', 'wrap', 'border') ? ['border'] : [])];
    for (const wrap of modes) {
      const b = PTL.addNode('gaussian', { params: { sigma: 2, wrap } });
      PTL.connect(imp, 0, b, 0);
      const r = PTL.render(b, { size: 256 });
      out['impulse_' + wrap] = { col0: px(r, 0, 8)[0], col1: px(r, 1, 8)[0], col3: px(r, 3, 8)[0], lastCol: px(r, 255, 8)[0], last3: px(r, 253, 8)[0] };
    }
    out.borderModeAvailable = has('gaussian', 'wrap', 'border');
  }

  // 5) Flare edge fade: a wide round glow (no rays) must stay round near the frame edge —
  //    compare alpha on the axis and on the diagonal at the same radius (0.9 of the half-frame).
  {
    const f = PTL.addNode('flare', { params: { ...flarePreset({ glowI: 1, glowSize: 1.4, glowFall: 2, glowColor: [1, 1, 1, 1] }), background: 'transparent' } });
    const r = PTL.render(f, { size: 256 });
    let edgeMax = 0; for (let k = 0; k < 256; k++) edgeMax = Math.max(edgeMax, px(r, k, 0)[3], px(r, 0, k)[3], px(r, k, 255)[3], px(r, 255, k)[3]);
    const c = 128, R = 0.9 * 128, d = Math.round(R / Math.SQRT2);
    out.flare_round_glow = { edgeMaxAlpha: edgeMax, alphaAxisR09: px(r, c + Math.round(R), c)[3], alphaDiagR09: px(r, c + d, c + d)[3] };
  }
  return out;
});

for (const [k, v] of Object.entries(results)) console.log(k.padEnd(26), JSON.stringify(v));
if (errors.length) console.log('page errors:', errors);
await browser.close();
