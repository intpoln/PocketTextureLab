// Stage D demo graphs: builds each demo in the current build, saves the project JSON, a 512 px PNG,
// a 4×4 sprite sheet for animated ones, and a comparison sheet (optionally with a "before" render of
// the nearest comparable graph in an older build).
//   node tools/demos.mjs [old.html]      -> docs/demos/*
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OLD = process.argv[2];
const OUT = path.resolve('docs/demos');
fs.mkdirSync(OUT, { recursive: true });

const RAMP_ENERGY = "[{p:0,c:[0,0,0.04,1]},{p:0.4,c:[0.12,0.04,0.45,1]},{p:0.75,c:[0.2,0.6,1,1]},{p:1,c:[0.92,1,1,1]}]";
const DEMOS = [
  {
    id: 'star-flare', title: 'Звёздная вспышка', animated: true, alpha: true,
    knobs: 'Flare: лучи (4, длина 0.78, острота 55) дают звезду, мерцание (Shimmer) — живой ореол, Glow (Border, порог 0.3) — мягкое свечение; прозрачный запас по краям — круглое затухание Flare.',
    build: `(isNew) => {
      const f = PTL.addNode('flare', { params: { ...flarePreset({ glowI: 1.1, glowSize: 0.55, glowFall: 3, glowColor: [1, 0.84, 0.6, 1], coreI: 2.2, coreSize: 0.035, raysI: 1.3, raysCount: 4, raysLen: 0.78, raysSharp: 55, raysRandom: 0, raysColor: [1, 0.94, 0.82, 1], shimI: 0.6, shimCount: 110, shimLen: 0.6, shimSharp: 4, shimSpeed: 2, flicker: 0.1, ringI: 0.06, ringRadius: 0.3, ringWidth: 0.02, ringChroma: 0.8 }), background: 'transparent' } });
      const g = PTL.addNode('glow', { params: { threshold: 0.3, radius: 8, intensity: 1.3 } });
      const o = PTL.addNode('output', { params: { filename: 'star_flare' } });
      PTL.connect(f, 0, g, 0); PTL.connect(g, 0, o, 0);
      if (isNew) { PTL.expose(f, 'raysLen', 'Длина лучей'); PTL.expose(f, 'raysCount', 'Число лучей'); PTL.expose(f, 'shimI', 'Мерцание'); PTL.expose(g, 'radius', 'Радиус свечения'); PTL.expose(f, 'glowColor', 'Цвет'); }
      return o;
    }`,
  },
  {
    id: 'smoke', title: 'Дым: крупные клубы, средние завихрения, дозированная деталь', animated: true, alpha: true,
    knobs: 'Splat Fractal (пятна, Smooth Max) — крупные клубы; Flow (адвекция 0.6, 1 оборот за цикл) — средние завихрения и течение; Warp по градиенту со сглаживанием карты 8 px — клубы «обтекают» течение без рваной мелочи; Multiply с Flow (0.4) — дозированная деталь; Shape — мягкая маска спрайта; Levels + Gradient Map — плотность и альфа.',
    build: `(isNew) => {
      const m = PTL.addNode('noise', { params: isNew ? { type: 'splat', scale: 2, octaves: 4, seed: 12, splSize: 0.8, splHard: 0, splIn: 'smax', splAcross: 'add', persistence: 0.5, splSizeRand: 0.7, splSmooth: 0.7 } : { type: 'perlin', fractal: 'billow', scale: 2, octaves: 4, seed: 12, persistence: 0.5 } });
      const fl = PTL.addNode('noise', { params: isNew ? { type: 'flow', scale: 5, octaves: 4, seed: 3, advect: 0.6, flowSpin: 1, persistence: 0.5 } : { type: 'perlin', scale: 5, octaves: 4, seed: 3, persistence: 0.5 } });
      const w = PTL.addNode('warp', { params: { mode: 'gradient', intensity: 0.1, ...(isNew ? { mapBlur: 8 } : {}) } });
      PTL.connect(m, 0, w, 0); PTL.connect(fl, 0, w, 1);
      const d = PTL.addNode('blend', { params: { mode: 'multiply', opacity: 0.4 } }); PTL.connect(w, 0, d, 0); PTL.connect(fl, 0, d, 1);
      const sh = PTL.addNode('shape', { params: { shape: 'ellipse', sizeX: 0.95, sizeY: 0.95, softness: 0.45, repeat: false } });
      const mul = PTL.addNode('blend', { params: { mode: 'multiply' } }); PTL.connect(d, 0, mul, 0); PTL.connect(sh, 0, mul, 1);
      const lv = PTL.addNode('levels', { params: { inBlack: 0.08, inWhite: isNew ? 0.78 : 0.6, gamma: 1.15 } }); PTL.connect(mul, 0, lv, 0);
      const r = PTL.addNode('ramp', { params: { stops: [{ p: 0, c: [0.08, 0.08, 0.09, 0] }, { p: 0.3, c: [0.3, 0.3, 0.32, 0.45] }, { p: 0.65, c: [0.62, 0.62, 0.64, 0.85] }, { p: 1, c: [0.93, 0.93, 0.93, 1] }] } });
      PTL.connect(lv, 0, r, 0);
      const o = PTL.addNode('output', { params: { filename: 'smoke' } }); PTL.connect(r, 0, o, 0);
      if (isNew) { PTL.expose(m, 'splSize', 'Размер клубов'); PTL.expose(fl, 'advect', 'Завихрения'); PTL.expose(w, 'intensity', 'Течение'); PTL.expose(d, 'opacity', 'Мелкая деталь'); PTL.expose(lv, 'inWhite', 'Плотность'); PTL.expose(m, 'seed', 'Seed клубов'); }
      return o;
    }`,
  },
  {
    id: 'energy-fibers', title: 'Энергетические волокна', animated: true,
    knobs: 'Flow с фракталом Ridged и растяжением 6 — тонкие непрерывные волокна вдоль X (адвекция 0.5 изгибает их по крупным формам, 1 оборот за цикл — течение); Levels (чёрная точка 0.5) — оставляет только гребни; Gradient Map — энергетическая палитра; Glow (Repeat — тайл) — свечение. Бесшовно по UV и по времени.',
    build: `(isNew) => {
      const s = PTL.addNode('noise', { params: isNew ? { type: 'flow', fractal: 'ridged', scale: 2, stretch: 6, octaves: 5, seed: 9, advect: 0.5, persistence: 0.55, flowSpin: 1 } : { type: 'perlin', fractal: 'ridged', scale: 2, stretch: 6, octaves: 5, seed: 9, persistence: 0.55 } });
      const lv = PTL.addNode('levels', { params: { inBlack: 0.5, inWhite: 0.97, gamma: 0.8 } }); PTL.connect(s, 0, lv, 0);
      const r = PTL.addNode('ramp', { params: { stops: ${RAMP_ENERGY} } }); PTL.connect(lv, 0, r, 0);
      const g = PTL.addNode('glow', { params: { threshold: 0.5, radius: 6, intensity: 1.6, wrap: 'repeat' } }); PTL.connect(r, 0, g, 0);
      const o = PTL.addNode('output', { params: { filename: 'energy_fibers' } }); PTL.connect(g, 0, o, 0);
      if (isNew) { PTL.expose(s, 'stretch', 'Вытянутость волокон'); PTL.expose(s, 'advect', 'Изгиб'); PTL.expose(lv, 'inBlack', 'Тонкость'); PTL.expose(g, 'intensity', 'Свечение'); PTL.expose(r, 'stops', 'Палитра'); }
      return o;
    }`,
  },
  {
    id: 'stones', title: 'Камни: управляемые промежутки и мягкие границы', normal: true,
    knobs: 'Voronoi «Границы»: мягкость граней 0.62 — скруглённые камни (0 — острые грани, 1 — отдельная галька), масштаб 5 — размер камней, случайность 0.9 — неправильность; Noise 12 через Multiply 0.25 — мелкая деталь поверхности; Gradient Map — цвет; Height to Normal (сила 5) — рельеф.',
    build: `(isNew) => {
      const v = PTL.addNode('voronoi', { params: { mode: 'border', scale: 5, seed: 21, randomness: 0.9, ...(isNew ? { edgeSmooth: 0.62 } : {}) } });
      const n = PTL.addNode('noise', { params: { type: 'perlin', scale: 12, octaves: 6, seed: 2, persistence: 0.55 } });
      const b = PTL.addNode('blend', { params: { mode: 'multiply', opacity: 0.25 } }); PTL.connect(v, 0, b, 0); PTL.connect(n, 0, b, 1);
      const r = PTL.addNode('ramp', { params: { stops: [{ p: 0, c: [0.18, 0.16, 0.14, 1] }, { p: 0.3, c: [0.35, 0.32, 0.28, 1] }, { p: 1, c: [0.72, 0.68, 0.6, 1] }] } });
      PTL.connect(b, 0, r, 0);
      const nm = PTL.addNode('normal', { params: { strength: 5, blur: 0.5 } }); PTL.connect(b, 0, nm, 0);
      const o = PTL.addNode('output', { params: { filename: 'stones_basecolor', usage: 'basecolor' } }); PTL.connect(r, 0, o, 0);
      const on = PTL.addNode('output', { params: { filename: 'stones_normal', usage: 'normal' } }); PTL.connect(nm, 0, on, 0);
      if (isNew) { PTL.expose(v, 'edgeSmooth', 'Мягкость граней'); PTL.expose(v, 'scale', 'Камней на ширину'); PTL.expose(v, 'randomness', 'Неправильность'); PTL.expose(b, 'opacity', 'Мелкая деталь'); PTL.expose(nm, 'strength', 'Сила нормали'); PTL.expose(r, 'stops', 'Цвета камня'); }
      return o;
    }`,
  },
  {
    id: 'splat-two-looks', title: 'Structured Fractal, один seed: облачные массы и направленные клочья',
    knobs: 'Один и тот же seed 5. Слева: пятна, Smooth Max в слое, взвешенная сумма слоёв — округлые облачные массы. Справа: штрихи (вытянутость 2.5) в растянутой сетке (растяжение 4), разброс направления 0.08, плотность 0.6, контраст 1.5 — направленные клочья с промежутками. Меняются форма элемента, вытянутость, растяжение сетки, плотность и выходной контраст.',
    build: `(isNew) => {
      const a = PTL.addNode('noise', { params: { type: 'splat', scale: 3, octaves: 5, seed: 5, splSize: 0.6, splIn: 'smax', splAcross: 'add', persistence: 0.55 } });
      const b = PTL.addNode('noise', { params: { type: 'splat', scale: 3, stretch: 4, octaves: 3, seed: 5, splShape: 'streak', splAspect: 2.5, splSize: 0.45, splRotRand: 0.08, splDensity: 0.6, splPer: 1, splIn: 'smax', persistence: 0.5, contrast: 1.5, balance: -0.08 } });
      const ra = PTL.addNode('ramp', { params: { stops: [{ p: 0, c: [0.05, 0.06, 0.12, 1] }, { p: 1, c: [0.85, 0.9, 1, 1] }] } }); PTL.connect(a, 0, ra, 0);
      const rb = PTL.addNode('ramp', { params: { stops: [{ p: 0, c: [0.12, 0.05, 0.04, 1] }, { p: 1, c: [1, 0.85, 0.7, 1] }] } }); PTL.connect(b, 0, rb, 0);
      const oa = PTL.addNode('output', { params: { filename: 'splat_clouds' } }); PTL.connect(ra, 0, oa, 0);
      const ob = PTL.addNode('output', { params: { filename: 'splat_wisps' } }); PTL.connect(rb, 0, ob, 0);
      PTL.expose(a, 'splSize', 'Облака: размер элементов'); PTL.expose(b, 'splAspect', 'Клочья: вытянутость'); PTL.expose(b, 'stretch', 'Клочья: растяжение сетки'); PTL.expose(a, 'seed', 'Seed (облака)'); PTL.expose(b, 'seed', 'Seed (клочья)');
      return [oa, ob];
    }`,
    newOnly: true,
  },
];

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function render(file, demo, isNew) {
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(file));
  await page.waitForFunction(() => window.PTL);
  const r = await page.evaluate(async ([src, isNew, animated]) => {
    window.setTimeout = () => 0;
    PTL.newProject(); PTL.setResolution(512);
    let outs = eval(src)(isNew); if (!Array.isArray(outs)) outs = [outs];
    const b64 = (bytes) => { let s = ''; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); };
    Anim.t = 0.3;
    const pngs = []; for (const o of outs) pngs.push(b64(await PTL.renderPNG(o, { size: 512 })));
    const extra = [];
    for (const n of PTL.getGraph().nodes) if (n.type === 'output' && !outs.includes(n.id)) extra.push(b64(await PTL.renderPNG(n.id, { size: 512 })));
    if (isNew) { App.autoLayout(); PTL.setActiveOutput(outs[0]); }
    let sheet = null;
    if (animated && isNew) { Anim.t = 0; const s = await PTL.renderSpriteSheet(outs[0], { frames: 16, frameSize: 128 }); sheet = b64(s.png); }
    return { pngs, extra, sheet, project: isNew ? App.projectData() : null, errors: PTL.errors() };
  }, [demo.build, isNew, !!demo.animated]);
  await page.close();
  if (Object.keys(r.errors).length) console.log(demo.id, isNew ? 'new' : 'old', 'errors', r.errors);
  return r;
}
const cards = [];
const manifest = [];
for (const d of DEMOS) {
  const now = await render('texture-lab.html', d, true);
  fs.writeFileSync(path.join(OUT, d.id + '.ptl.json'), JSON.stringify(now.project, null, 1));
  now.pngs.forEach((p, k) => fs.writeFileSync(path.join(OUT, d.id + (now.pngs.length > 1 ? '-' + (k + 1) : '') + '.png'), Buffer.from(p, 'base64')));
  now.extra.forEach((p, k) => fs.writeFileSync(path.join(OUT, d.id + '-normal.png'), Buffer.from(p, 'base64')));
  if (now.sheet) fs.writeFileSync(path.join(OUT, d.id + '-sheet.png'), Buffer.from(now.sheet, 'base64'));
  manifest.push({ id: d.id, title: d.title, animated: !!d.animated, material: !!d.normal, knobs: d.knobs });
  const before = OLD && !d.newOnly ? await render(OLD, d, false) : null;
  cards.push({ d, now, before });
  console.log('demo', d.id);
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(manifest, null, 1));
// comparison sheet: per demo — before (if any), after at 100 % crop and reduced, extra (normal), sprite sheet
const page = await browser.newPage();
const S = 256;
const img = (b64, bg, w = S, crop = false) => `<div style="width:${w}px;height:${w}px;overflow:hidden;${bg}"><img src="data:image/png;base64,${b64}" style="display:block;${crop ? 'width:512px;height:512px;margin:-128px 0 0 -128px' : `width:${w}px;height:${w}px`}"></div>`;
const html = cards.map(({ d, now, before }) => {
  const bg = d.alpha ? 'background:repeating-conic-gradient(#555 0 25%,#888 0 50%) 0/16px 16px' : 'background:#000';
  const cells = [];
  if (before) cells.push(['до (0.3.2, ближайший граф)', img(before.pngs[0], bg)]);
  now.pngs.forEach((p, k) => cells.push([now.pngs.length > 1 ? (k ? 'клочья' : 'облачные массы') : 'после, уменьшено', img(p, bg)]));
  if (now.pngs.length === 1) cells.push(['после, 100 % (фрагмент)', img(now.pngs[0], bg, S, true)]);
  now.extra.forEach((p) => cells.push(['нормаль', img(p, 'background:#000')]));
  if (now.sheet) cells.push(['флипбук 4×4 (кадры 0…15)', img(now.sheet, bg)]);
  return `<section style="margin-bottom:14px"><div style="color:#fff;font:bold 14px sans-serif;margin:4px 0">${d.title}</div>
    <div style="display:flex;gap:8px">${cells.map(([l, h]) => `<figure style="margin:0;font:11px sans-serif;color:#cfd3da">${h}${l}</figure>`).join('')}</div>
    <div style="color:#aab;font:11px/1.4 sans-serif;max-width:${5 * (S + 8)}px;margin-top:4px">${d.knobs}</div></section>`;
}).join('');
await page.setContent(`<body style="margin:0;padding:12px;background:#1b1d22">${html}</body>`);
await page.setViewportSize({ width: 5 * (S + 8) + 24, height: 400 });
await page.screenshot({ path: path.resolve('docs/img/quality/d-demos.jpg'), type: 'jpeg', quality: 86, fullPage: true });
await browser.close();
console.log('written docs/img/quality/d-demos.jpg');
