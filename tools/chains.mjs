// End-to-end acceptance chains (stage C): each chain is built in the OLD build ("до") and the
// NEW build ("после") with comparable settings and a fixed seed; every intermediate node output
// is shown, plus a sweep of one key parameter in the new build (continuity check).
//   node tools/chains.mjs old.html new.html docs/img/quality
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [OLD, NEW, OUTDIR] = process.argv.slice(2);
const S = 176;

// build(isNew) runs in the page: returns { nodes: [[label, id, port?]], sweep: { label, id, key, values } }
const CHAINS = [
  {
    file: 'chain1-noise-warp-levels', title: '1. Noise → Warp (другой Noise) → Levels: текучие формы и прожилки',
    build: `(isNew) => {
      const n = PTL.addNode('noise', { params: { type: 'perlin', scale: 3, octaves: 6, seed: 11 } });
      const m = PTL.addNode('noise', { params: { type: isNew ? 'flow' : 'perlin', scale: 4, octaves: 5, seed: 23, ...(isNew ? { advect: 0.5 } : {}) } });
      const w = PTL.addNode('warp', { params: { mode: 'gradient', intensity: 0.25 } });
      const l = PTL.addNode('levels', { params: { inBlack: 0.42, inWhite: 0.58 } });
      PTL.connect(n, 0, w, 0); PTL.connect(m, 0, w, 1); PTL.connect(w, 0, l, 0);
      return { nodes: [['Noise', n], ['карта: ' + (isNew ? 'Flow' : 'Perlin'), m], ['Warp', w], ['Levels', l]], sweep: { label: 'Warp: сила', id: w, out: l, key: 'intensity', values: [0.05, 0.12, 0.25, 0.5] } };
    }`,
  },
  {
    file: 'chain2-shape-blur-glow-blend', title: '2. Shape → Gradient Map (спрайт) → Directional Blur → Glow → Blend на фон', alpha: true,
    build: `(isNew) => {
      const s = PTL.addNode('shape', { params: { shape: 'rect', sizeX: 0.55, sizeY: 0.05, rotation: 30, softness: 0.02, repeat: false } });
      const r = PTL.addNode('ramp', { params: { stops: [{ p: 0, c: [0, 0.4, 1, 0] }, { p: 0.5, c: [0.2, 0.8, 1, 1] }, { p: 1, c: [1, 1, 1, 1] }] } });
      const b = PTL.addNode('dirblur', { params: { length: 40, angle: 30, alphaAware: true, wrap: isNew ? 'border' : 'clamp' } });
      const g = PTL.addNode('glow', { params: { threshold: 0.3, radius: 12, intensity: 2, ...(isNew ? { wrap: 'border' } : {}) } });
      const bg = PTL.addNode('gradient', { params: { type: 'linear', rotation: 90 } });
      const bgc = PTL.addNode('ramp', { params: { stops: [{ p: 0, c: [0.05, 0.05, 0.1, 1] }, { p: 1, c: [0.35, 0.3, 0.45, 1] }] } });
      const bl = PTL.addNode('blend', { params: { mode: isNew ? 'over' : 'screen' } });
      PTL.connect(s, 0, r, 0); PTL.connect(r, 0, b, 0); PTL.connect(b, 0, g, 0);
      PTL.connect(bg, 0, bgc, 0); PTL.connect(bgc, 0, bl, 0); PTL.connect(g, 0, bl, 1);
      return { nodes: [['Shape', s], ['Gradient Map', r], ['Directional Blur', b], ['Glow', g], ['Blend ' + (isNew ? 'Over' : 'Screen (Over нет)'), bl]], sweep: { label: 'Glow: радиус', id: g, out: bl, key: 'radius', values: [4, 10, 20, 40] } };
    }`,
  },
  {
    file: 'chain3-waves-warp-polar-ramp', title: '3. Waves → Warp → Polar → Gradient Map: энергетическое кольцо',
    build: `(isNew) => {
      const wv = PTL.addNode('waves', { params: { shape: 'triangle', countX: 0, countY: 5 } });
      const nz = PTL.addNode('noise', { params: { type: 'perlin', scale: 4, octaves: 4, seed: 3 } });
      const wp = PTL.addNode('warp', { params: { mode: 'directional', angle: 90, intensity: 0.06 } });
      const po = PTL.addNode('polar', { params: { turns: 1 } });
      const rp = PTL.addNode('ramp', { params: { stops: [{ p: 0, c: [0, 0, 0.05, 1] }, { p: 0.6, c: [0.4, 0.1, 0.9, 1] }, { p: 0.9, c: [0.4, 0.9, 1, 1] }, { p: 1, c: [1, 1, 1, 1] }] } });
      PTL.connect(wv, 0, wp, 0); PTL.connect(nz, 0, wp, 1); PTL.connect(wp, 0, po, 0); PTL.connect(po, 0, rp, 0);
      return { nodes: [['Waves', wv], ['Noise', nz], ['Warp', wp], ['Polar', po], ['Gradient Map', rp]], sweep: { label: 'Waves: периодов по Y', id: wv, out: rp, key: 'countY', values: [3, 5, 9, 16] } };
    }`,
  },
  {
    file: 'chain4-splatter-blur-levels-warp', title: '4. Splatter → Gaussian Blur → Levels → Warp: слипшиеся органические массы',
    build: `(isNew) => {
      const sp = PTL.addNode('splatter', { params: { pattern: 'square', count: 160, size: 0.07, sizeRand: 0.6, bevel: 0.1, seed: 5 } });
      const gb = PTL.addNode('gaussian', { params: { sigma: 7 } });
      const lv = PTL.addNode('levels', { params: { inBlack: 0.18, inWhite: 0.3 } });
      const nz = PTL.addNode('noise', { params: { type: 'perlin', scale: 5, octaves: 5, seed: 9 } });
      const wp = PTL.addNode('warp', { params: { mode: 'gradient', intensity: 0.12 } });
      PTL.connect(sp, 0, gb, 0); PTL.connect(gb, 0, lv, 0); PTL.connect(lv, 0, wp, 0); PTL.connect(nz, 0, wp, 1);
      return { nodes: [['Splatter (квадраты)', sp], ['Gaussian Blur', gb], ['Levels', lv], ['Warp', wp]], sweep: { label: 'Blur: σ', id: gb, out: wp, key: 'sigma', values: [2, 5, 9, 16] } };
    }`,
  },
  {
    file: 'chain5-voronoi-noise-blend-normal', title: '5. Voronoi + Noise → Blend → Height to Normal: связная поверхность',
    build: `(isNew) => {
      const vo = PTL.addNode('voronoi', { params: { mode: 'border', scale: 6, seed: 4 } });
      const nz = PTL.addNode('noise', { params: { type: 'perlin', scale: 24, octaves: 6, seed: 8, persistence: 0.6 } });
      const bl = PTL.addNode('blend', { params: { mode: 'multiply', opacity: 0.35 } });
      const nm = PTL.addNode('normal', { params: { strength: 6, blur: 0.6 } });
      PTL.connect(vo, 0, bl, 0); PTL.connect(nz, 0, bl, 1); PTL.connect(bl, 0, nm, 0);
      return { nodes: [['Voronoi (границы)', vo], ['Noise 24', nz], ['Blend Multiply', bl], ['Height to Normal', nm]], sweep: { label: 'Normal: сила', id: nm, out: nm, key: 'strength', values: [2, 5, 10, 20] } };
    }`,
  },
];

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function run(file, chain, isNew) {
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(file));
  await page.waitForFunction(() => window.PTL);
  const res = await page.evaluate(async ([src, isNew, S]) => {
    PTL.newProject(); PTL.setResolution(512);
    const spec = eval(src)(isNew);
    const png = async (id, port = 0) => { const b = await PTL.renderPNG(id, { size: S, port }); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
    const row = [];
    for (const [label, id, port] of spec.nodes) row.push({ label, b64: await png(id, port) });
    const sweep = [];
    if (isNew) for (const v of spec.sweep.values) { PTL.setParams(spec.sweep.id, { [spec.sweep.key]: v }); sweep.push({ label: spec.sweep.label + ' = ' + v, b64: await png(spec.sweep.out) }); }
    return { row, sweep, errors: PTL.errors() };
  }, [chain.build, isNew, S]);
  await page.close();
  if (Object.keys(res.errors).length) console.log(chain.file, isNew ? 'new' : 'old', 'node errors', res.errors);
  return res;
}
fs.mkdirSync(OUTDIR, { recursive: true });
for (const chain of CHAINS) {
  const a = await run(OLD, chain, false), b = await run(NEW, chain, true);
  const bg = chain.alpha ? 'background:repeating-conic-gradient(#555 0 25%,#888 0 50%) 0/16px 16px' : 'background:#000';
  const cell = (x) => `<figure style="margin:0;font:11px/1.3 sans-serif;color:#d8dbe2;width:${S}px"><img src="data:image/png;base64,${x.b64}" style="display:block;width:${S}px;height:${S}px;${bg}">${x.label}</figure>`;
  const rowH = (name, xs) => `<div style="display:flex;gap:6px;align-items:flex-start"><b style="width:74px;flex:none;color:#fff;font:13px sans-serif;padding-top:70px">${name}</b>${xs.map(cell).join('')}</div>`;
  const view = await browser.newPage();
  await view.setContent(`<body style="margin:0;padding:10px;background:#1b1d22;display:flex;flex-direction:column;gap:10px">
    <div style="color:#fff;font:bold 14px sans-serif">${chain.title}</div>
    ${rowH('до (0.3.2)', a.row)}${rowH('после', b.row)}${rowH('после: плавность', b.sweep)}</body>`);
  const cols = Math.max(a.row.length, b.row.length, b.sweep.length);
  await view.setViewportSize({ width: 100 + cols * (S + 6), height: 3 * (S + 40) + 70 });
  await view.screenshot({ path: path.join(OUTDIR, chain.file + '.jpg'), type: 'jpeg', quality: 86, fullPage: true });
  await view.close();
  console.log('written', chain.file);
}
await browser.close();
