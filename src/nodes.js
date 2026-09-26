// ---------------------------------------------------------------------------
// Node definitions. Each node declares ports, parameters, UI hints and an
// eval(ctx) that runs GPU passes and returns [{ tex, space }] per output.
//
// Spaces: 'color' = linear-light RGB inside (sRGB in files and on screen),
//         'data'  = raw channel numbers (masks, height, normals, packed maps).
// ---------------------------------------------------------------------------
const BLACK = [0, 0, 0, 1];
const WRAP_OPTS = [['repeat', 'Повтор (Repeat)'], ['clamp', 'Край (Clamp)']];
const CHAN_OPTS = [['L', 'Яркость (Luminance)'], ['R', 'R'], ['G', 'G'], ['B', 'B'], ['A', 'A']];
const CHAN_IDX = { R: 0, G: 1, B: 2, A: 3, L: 4, C: 5 };
const CLAMP_SEAM = 'Режим Clamp не берёт соседей с противоположного края — при повторе текстуры появится шов.';

const f = (key, label, min, max, def, extra = {}) => ({ key, label, type: 'float', min, max, def, step: extra.step || 0.01, ...extra });
const i = (key, label, min, max, def, extra = {}) => ({ key, label, type: 'int', min, max, def, step: 1, ...extra });
const e = (key, label, options, def, extra = {}) => ({ key, label, type: 'enum', options, def, ...extra });
const b = (key, label, def, extra = {}) => ({ key, label, type: 'bool', def, ...extra });

// conv code for reading an input: 'native' keeps storage, 'data' gives file values,
// 'color' gives linear colour.
function convCode(space, want) {
  if (!space || want === 'native' || want === space) return 0;
  return want === 'data' ? 1 : 2;
}

const CODE_SNIPPET_TITLES = { stripes: 'Полосы', bricks: 'Кирпичи', checker: 'Шахматка', threshold: 'Порог A по p1', mixmask: 'A/B по маске C' };
const CODE_SNIPPETS = {
  stripes: `// Полосы: p1 — частота (×16 полос), p2 — доля белого.
// Целое число полос на текстуру => бесшовно.
vec4 process(vec2 uv, ivec2 px) {
  float n = floor(p1 * 16.0 + 0.5);
  float v = step(fract(uv.x * max(n, 1.0)), p2);
  return vec4(vec3(v), 1.0);
}`,
  bricks: `// Кирпичная кладка: p1 — число рядов (×16), p2 — ширина шва.
vec4 process(vec2 uv, ivec2 px) {
  float rows = max(1.0, floor(p1 * 16.0 + 0.5));
  vec2 g = vec2(uv.x * rows * 0.5, uv.y * rows);
  if (mod(floor(g.y), 2.0) == 1.0) g.x += 0.5;
  vec2 f = fract(g);
  float m = p2 * 0.25;
  float v = step(m, f.x) * step(f.x, 1.0 - m) * step(m * 2.0, f.y) * step(f.y, 1.0 - m * 2.0);
  return vec4(vec3(v), 1.0);
}`,
  checker: `// Шахматка: p1 — число клеток (×16).
vec4 process(vec2 uv, ivec2 px) {
  float n = max(1.0, floor(p1 * 16.0 + 0.5));
  vec2 c = floor(uv * n);
  float v = mod(c.x + c.y, 2.0);
  return vec4(vec3(v), 1.0);
}`,
  threshold: `// Порог: белое там, где яркость A >= p1; p2 — мягкость.
vec4 process(vec2 uv, ivec2 px) {
  float y = dot(in0(px).rgb, LUMA);
  float v = smoothstep(p1 - p2 * 0.5, p1 + p2 * 0.5 + 1e-5, y);
  return vec4(vec3(v), 1.0);
}`,
  mixmask: `// Смешать A и B по яркости маски C (все 4 канала).
vec4 process(vec2 uv, ivec2 px) {
  float m = dot(in2(px).rgb, LUMA);
  return mix(in0(px), in1(px), m);
}`,
};

const NODES = {
  // ---------------------------------------------------------------- sources
  image: {
    title: 'Изображение (Image)', cat: 'Источники', outputs: ['Цвет'], inputs: [],
    params: [
      { key: 'asset', label: 'Файл', type: 'image', def: null },
      e('interp', 'Интерпретация', [['srgb', 'Цвет sRGB (Color)'], ['data', 'Данные каналов (Data)']], 'srgb',
        { help: 'Цвет: значения считаются sRGB и переводятся в линейное пространство для размытия/смешивания. Данные: числа каналов используются как есть (маски, height, normal, упакованные карты).' }),
      e('fit', 'Приведение к размеру проекта', [['stretch', 'Растянуть (Stretch)'], ['cover', 'Заполнить с обрезкой (Cover)'], ['tile', '1:1 без масштаба, повтор (Tile)']], 'stretch',
        { help: 'Stretch: вся картинка масштабируется в квадрат проекта (при совпадении размеров — точная копия пикселей). Cover: сохраняет пропорции и обрезает лишнее по центру. Tile: пиксели 1:1 от левого верхнего угла, повтор при нехватке.' }),
      e('wrap', 'Края при фильтрации', WRAP_OPTS, 'repeat'),
    ],
    seam: 'Загруженное изображение бесшовно только если оно было бесшовным изначально. Cover и Tile с неподходящим размером почти всегда дают шов.',
    eval(ctx) {
      const p = ctx.params, a = Assets.get(p.asset);
      const out = ctx.alloc();
      const srgb = p.interp === 'srgb';
      if (!a) {
        ctx.pass('constant', out, { u_color: BLACK });
        return [{ tex: out, space: 'data' }];
      }
      const exact = p.fit === 'stretch' && a.width === ctx.res && a.height === ctx.res;
      ctx.pass('image', out, {
        u_img: Assets.texture(a, srgb), u_imgSize: [a.width, a.height],
        u_fit: { stretch: 0, cover: 1, tile: 2 }[p.fit], u_exact: exact,
      }, { u_img: p.wrap === 'clamp' ? 'mipClamp' : 'mipRepeat' });
      return [{ tex: out, space: srgb ? 'color' : 'data' }];
    },
  },

  constant: {
    title: 'Константа (Constant)', cat: 'Источники', outputs: ['Значение'], inputs: [],
    params: [
      e('mode', 'Режим', [['gray', 'Серое значение (данные)'], ['color', 'Цвет RGBA (sRGB)']], 'gray'),
      f('value', 'Значение', 0, 1, 0.5, { visible: (p) => p.mode === 'gray' }),
      { key: 'color', label: 'Цвет', type: 'color', def: [0.8, 0.45, 0.2, 1], visible: (p) => p.mode === 'color' },
    ],
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      if (p.mode === 'gray') {
        ctx.pass('constant', out, { u_color: [p.value, p.value, p.value, 1] });
        return [{ tex: out, space: 'data' }];
      }
      const c = p.color;
      ctx.pass('constant', out, { u_color: [ColorUtil.toLin(c[0]), ColorUtil.toLin(c[1]), ColorUtil.toLin(c[2]), c[3]] });
      return [{ tex: out, space: 'color' }];
    },
  },

  noise: {
    title: 'Шум (Noise)', cat: 'Источники', outputs: ['Шум'], inputs: [],
    params: [
      e('type', 'Тип', [['perlin', 'Градиентный (Perlin)'], ['value', 'Value Noise']], 'perlin'),
      b('tile', 'Бесшовный (Tileable)', true, { help: 'В режиме Tileable масштаб — целое число: период каждой октавы равен целому числу клеток, шум математически периодичен по u и v.' }),
      f('scale', 'Масштаб (Scale)', 1, 64, 4, { step: 1, intWhen: (p) => p.tile }),
      i('seed', 'Seed', 0, 99999, 1),
      i('octaves', 'Детализация (Detail, октавы)', 1, 8, 5),
      f('persistence', 'Шероховатость шума (Persistence)', 0, 1, 0.5, { help: 'Вклад каждой следующей октавы относительно предыдущей. Не путать с PBR roughness.' }),
      f('contrast', 'Контраст (Contrast)', 0, 4, 1),
    ],
    seamFn: (p) => (p.tile ? '' : 'Tileable выключен — шум не периодичен, при повторе будет шов.'),
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      ctx.pass('noise', out, {
        u_type: p.type === 'value' ? 0 : 1, u_seed: p.seed, u_oct: p.octaves, u_scale: p.scale,
        u_pers: p.persistence, u_contrast: p.contrast, u_tile: p.tile,
      });
      return [{ tex: out, space: 'data' }];
    },
  },

  voronoi: {
    title: 'Вороной (Voronoi)', cat: 'Источники', outputs: ['Ячейки'], inputs: [],
    params: [
      e('mode', 'Режим', [['f1', 'Расстояние до точки (F1)'], ['border', 'Границы ячеек (Borders)'], ['cell', 'Значение ячейки (Cell)']], 'f1'),
      b('tile', 'Бесшовный (Tileable)', true, { help: 'В режиме Tileable масштаб — целое число клеток на текстуру.' }),
      f('scale', 'Масштаб (Scale)', 1, 64, 8, { step: 1, intWhen: (p) => p.tile }),
      i('seed', 'Seed', 0, 99999, 1),
      f('randomness', 'Случайность (Randomness)', 0, 1, 1),
    ],
    seamFn: (p) => (p.tile ? '' : 'Tileable выключен — узор не периодичен, при повторе будет шов.'),
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      ctx.pass('voronoi', out, {
        u_seed: p.seed, u_mode: { f1: 0, border: 1, cell: 2 }[p.mode], u_scale: p.scale,
        u_rand: p.randomness, u_tile: p.tile,
      });
      return [{ tex: out, space: 'data' }];
    },
  },

  shape: {
    title: 'Фигура (Shape)', cat: 'Источники', outputs: ['Маска'], inputs: [],
    params: [
      e('shape', 'Фигура', [['ellipse', 'Круг / эллипс'], ['rect', 'Прямоугольник'], ['ring', 'Кольцо']], 'ellipse'),
      f('sizeX', 'Размер X', 0, 1, 0.5), f('sizeY', 'Размер Y', 0, 1, 0.5),
      f('posX', 'Позиция X', 0, 1, 0.5), f('posY', 'Позиция Y (вниз)', 0, 1, 0.5),
      f('rotation', 'Поворот, °', -180, 180, 0, { step: 1 }),
      f('softness', 'Мягкость края', 0, 0.5, 0.01, { step: 0.001 }),
      f('thickness', 'Толщина кольца', 0, 0.5, 0.08, { step: 0.001, visible: (p) => p.shape === 'ring' }),
      b('repeat', 'Переносить через края (Repeat)', true),
    ],
    seamFn: (p) => (p.repeat ? '' : 'Без переноса через края фигура обрезается границей текстуры — возможен шов.'),
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      ctx.pass('shape', out, {
        u_shape: { ellipse: 0, rect: 1, ring: 2 }[p.shape], u_pos: [p.posX, p.posY], u_size: [p.sizeX, p.sizeY],
        u_rot: p.rotation, u_soft: p.softness, u_thick: p.thickness, u_rep: p.repeat,
      });
      return [{ tex: out, space: 'data' }];
    },
  },

  gradient: {
    title: 'Градиент (Gradient)', cat: 'Источники', outputs: ['Градиент'], inputs: [],
    params: [
      e('type', 'Тип', [['linear', 'Линейный (Linear)'], ['radial', 'Радиальный (Radial)'], ['angular', 'Угловой (Angular)']], 'linear'),
      f('centerX', 'Центр X', 0, 1, 0.5), f('centerY', 'Центр Y (вниз)', 0, 1, 0.5),
      f('rotation', 'Поворот, °', -180, 180, 0, { step: 1, help: '0° — слева направо, 90° — снизу вверх.' }),
      f('scale', 'Масштаб (Scale)', 0.05, 10, 1, { visible: (p) => p.type !== 'angular' }),
      e('repeat', 'Повторение', [['clamp', 'Нет (Clamp)'], ['repeat', 'Повтор (Repeat)'], ['mirror', 'Зеркально (Mirror)']], 'clamp', { visible: (p) => p.type !== 'angular' }),
      b('invert', 'Инвертировать (Invert)', false),
    ],
    seam: 'Градиенты в общем случае не бесшовны: край текстуры при повторе даёт скачок значения.',
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      ctx.pass('gradient', out, {
        u_type: { linear: 0, radial: 1, angular: 2 }[p.type], u_rep: { clamp: 0, repeat: 1, mirror: 2 }[p.repeat],
        u_center: [p.centerX, p.centerY], u_rot: p.rotation, u_scale: p.scale, u_inv: p.invert,
      });
      return [{ tex: out, space: 'data' }];
    },
  },

  // ---------------------------------------------------------------- adjust
  levels: {
    title: 'Уровни (Levels)', cat: 'Обработка', outputs: ['Выход'],
    inputs: [{ label: 'Вход', def: BLACK, defText: 'чёрный (0,0,0,1)' }],
    params: [
      f('inBlack', 'Вход: чёрная точка', 0, 1, 0), f('inWhite', 'Вход: белая точка', 0, 1, 1),
      f('gamma', 'Гамма (Gamma)', 0.1, 10, 1, { help: '>1 — светлее, <1 — темнее.' }),
      f('outBlack', 'Выход: чёрный', 0, 1, 0), f('outWhite', 'Выход: белый', 0, 1, 1),
      b('alpha', 'Применять к альфе', false),
    ],
    help: 'Работает с числами каналов как в файле (для цветных — со значениями sRGB). Если чёрная и белая точки совпадают, выполняется порог.',
    eval(ctx) { return pointwise(ctx, 'levels', { u_ib: ctx.params.inBlack, u_iw: ctx.params.inWhite, u_gamma: ctx.params.gamma, u_ob: ctx.params.outBlack, u_ow: ctx.params.outWhite, u_alpha: ctx.params.alpha }); },
  },

  invert: {
    title: 'Инверсия (Invert)', cat: 'Обработка', outputs: ['Выход'],
    inputs: [{ label: 'Вход', def: BLACK, defText: 'чёрный (0,0,0,1)' }],
    params: [b('r', 'R', true), b('g', 'G', true), b('b', 'B', true), b('a', 'A', false)],
    eval(ctx) { const p = ctx.params; return pointwise(ctx, 'invert', { u_ch: [p.r, p.g, p.b, p.a] }); },
  },

  grayscale: {
    title: 'Оттенки серого (Grayscale)', cat: 'Обработка', outputs: ['Серый'],
    inputs: [{ label: 'Вход', def: BLACK, defText: 'чёрный (0,0,0,1)' }],
    params: [
      e('source', 'Источник', CHAN_OPTS, 'L', { help: 'Яркость цветного (sRGB) входа: Y = 0.2126R+0.7152G+0.0722B в линейном свете, затем кодируется в sRGB (серый 128 → 128). Для входа-данных — те же веса по числам каналов. R/G/B/A — чтение числового канала как в файле.' }),
      b('keepAlpha', 'Сохранить альфу', false),
    ],
    eval(ctx) {
      const out = ctx.alloc(), u = { u_src: CHAN_IDX[ctx.params.source], u_keepA: ctx.params.keepAlpha, u_inv: false };
      ctx.bindIn(u, 0, 0, 'native');
      ctx.pass('gray', out, u);
      return [{ tex: out, space: 'data' }];
    },
  },

  ramp: {
    title: 'Цветовая шкала (Color Ramp)', cat: 'Обработка', outputs: ['Цвет'],
    inputs: [{ label: 'Серый', def: BLACK, defText: '0' }],
    params: [
      { key: 'stops', label: 'Точки', type: 'ramp', def: [{ p: 0, c: [0, 0, 0, 1] }, { p: 1, c: [1, 1, 1, 1] }] },
      e('interp', 'Интерполяция', [['linear', 'Линейная (Linear)'], ['smooth', 'Плавная (Smooth)'], ['constant', 'Ступенчатая (Constant)']], 'linear'),
      e('source', 'Входное значение', [['L', 'Яркость (Luminance)'], ['R', 'Канал R']], 'L'),
      e('space', 'Выход', [['color', 'Цвет sRGB'], ['data', 'Данные']], 'color', { help: 'Цвет: точки задаются в sRGB, размытие/смешивание дальше идут в линейном свете. Данные: значения точек пишутся в каналы как есть.' }),
    ],
    help: 'Интерполяция идёт между значениями точек (в sRGB). При совпадающих позициях получается резкий переход: в самой позиции действует точка, стоящая в списке позже.',
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      const stops = sortStops(p.stops);
      const pos = new Array(8).fill(1), cols = [];
      for (let k = 0; k < 8; k++) {
        const s = stops[Math.min(k, stops.length - 1)];
        pos[k] = s.p; cols.push(s.c.slice(0, 4));
      }
      const u = { u_n: stops.length, u_interp: { constant: 0, linear: 1, smooth: 2 }[p.interp], u_src: p.source === 'R' ? 1 : 0, u_pos: pos, u_cols: cols };
      ctx.bindIn(u, 0, 0, 'native');
      ctx.pass('ramp', out, u, null, p.space === 'color' ? 2 : 0);
      return [{ tex: out, space: p.space === 'color' ? 'color' : 'data' }];
    },
  },

  hsv: {
    title: 'Тон/Насыщенность (HSV)', cat: 'Обработка', outputs: ['Выход'],
    inputs: [{ label: 'Вход', def: BLACK, defText: 'чёрный (0,0,0,1)' }],
    params: [
      f('hue', 'Тон (Hue), °', -180, 180, 0, { step: 1 }),
      f('saturation', 'Насыщенность (Saturation) ×', 0, 2, 1),
      f('value', 'Яркость (Value) ×', 0, 2, 1),
    ],
    help: 'Работает со значениями sRGB. Альфа не изменяется.',
    eval(ctx) { const p = ctx.params; return pointwise(ctx, 'hsv', { u_h: p.hue, u_s: p.saturation, u_v: p.value }); },
  },

  blend: {
    title: 'Смешивание (Blend)', cat: 'Обработка', outputs: ['Выход'],
    inputs: [
      { label: 'A (фон)', def: BLACK, defText: 'чёрный (0,0,0,1)' },
      { label: 'B (слой)', def: BLACK, defText: 'чёрный (0,0,0,1)' },
      { label: 'Маска', def: [1, 1, 1, 1], defText: 'белая (1) — везде полная сила' },
    ],
    params: [
      e('mode', 'Режим', [['mix', 'Замена (Mix)'], ['add', 'Сложение (Add)'], ['multiply', 'Умножение (Multiply)'], ['screen', 'Экран (Screen)'], ['min', 'Минимум (Min)'], ['max', 'Максимум (Max)']], 'mix'),
      f('opacity', 'Сила (Opacity)', 0, 1, 1),
      e('alpha', 'Альфа', [['same', 'Та же формула, что для RGB'], ['keepA', 'Взять из A']], 'same'),
    ],
    help: 'Результат = mix(A, op(A, B), сила × маска) — отдельно для каждого канала. Альфа не используется как прозрачность (нет скрытого alpha compositing): она либо считается той же формулой, либо берётся из A. Маска — яркость входа маски. Если A цветной, а B — данные (или наоборот), B приводится к пространству A.',
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      const sp = ctx.space(0) || ctx.space(1) || 'data';
      const u = { u_mode: ['mix', 'add', 'multiply', 'screen', 'min', 'max'].indexOf(p.mode), u_opacity: p.opacity, u_keepA: p.alpha === 'keepA' };
      ctx.bindIn(u, 0, 0, 'native');
      ctx.bindIn(u, 1, 1, sp);
      ctx.bindIn(u, 2, 2, 'native');
      ctx.pass('blend', out, u);
      return [{ tex: out, space: sp }];
    },
  },

  transform: {
    title: 'Трансформация (Transform)', cat: 'Обработка', outputs: ['Выход'],
    inputs: [{ label: 'Вход', def: BLACK, defText: 'чёрный (0,0,0,1)' }],
    params: [
      f('offsetX', 'Смещение X', -1, 1, 0, { step: 0.001 }), f('offsetY', 'Смещение Y (вниз)', -1, 1, 0, { step: 0.001 }),
      f('scaleX', 'Масштаб X', 0.05, 8, 1), f('scaleY', 'Масштаб Y', 0.05, 8, 1),
      f('rotation', 'Поворот, °', -180, 180, 0, { step: 1 }),
      e('wrap', 'Края', WRAP_OPTS, 'repeat'),
    ],
    seamFn: (p) => {
      const w = [];
      const r = ((p.rotation % 90) + 90) % 90;
      if (r > 1e-6 && 90 - r > 1e-6) w.push('Поворот не кратен 90° — периодичность нарушается, возможен шов.');
      const okScale = (s) => { const k = 1 / s; return Math.abs(k - Math.round(k)) < 1e-4; };
      if (!okScale(p.scaleX) || !okScale(p.scaleY)) w.push('Масштаб не равен 1/n — содержимое не укладывается целое число раз, возможен шов.');
      if (p.wrap === 'clamp') w.push(CLAMP_SEAM);
      return w.join(' ');
    },
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      const u = { u_off: [p.offsetX, p.offsetY], u_scl: [p.scaleX || 1e-3, p.scaleY || 1e-3], u_rot: p.rotation };
      ctx.bindIn(u, 0, 0, 'native');
      ctx.pass('transform', out, u, { u_in0: p.wrap });
      return [{ tex: out, space: ctx.space(0) || 'data' }];
    },
  },

  // ---------------------------------------------------------------- blur
  gaussian: {
    title: 'Размытие по Гауссу (Gaussian Blur)', cat: 'Размытие', outputs: ['Выход'],
    inputs: [{ label: 'Вход', def: BLACK, defText: 'чёрный (0,0,0,1)' }],
    params: [
      f('sigma', 'Радиус (σ, px проекта)', 0, 64, 4, { step: 0.1, help: 'Сигма в пикселях при разрешении проекта. Ядро ±3σ, два прохода (горизонталь + вертикаль). В уменьшенном предпросмотре масштабируется пропорционально.' }),
      e('wrap', 'Края', WRAP_OPTS, 'repeat'),
      b('alphaAware', 'С учётом альфы (для цветных изображений с прозрачностью)', false, { help: 'Выключено: каналы RGBA размываются независимо, как числа. Включено: RGB взвешивается альфой (premultiply → blur → unpremultiply), чтобы прозрачные пиксели не «пачкали» цвет.' }),
    ],
    seamFn: (p) => (p.wrap === 'clamp' ? CLAMP_SEAM : ''),
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      gaussianInto(ctx, ctx.input(0), 0, out, ctx.px(p.sigma), p.wrap === 'repeat', p.alphaAware);
      return [{ tex: out, space: ctx.space(0) || 'data' }];
    },
  },

  dirblur: {
    title: 'Направленное размытие (Directional Blur)', cat: 'Размытие', outputs: ['Выход'],
    inputs: [{ label: 'Вход', def: BLACK, defText: 'чёрный (0,0,0,1)' }],
    params: [
      f('length', 'Длина (px проекта)', 0, 256, 16, { step: 0.5 }),
      f('angle', 'Угол, °', -180, 180, 0, { step: 1 }),
      e('wrap', 'Края', WRAP_OPTS, 'repeat'),
      b('alphaAware', 'С учётом альфы', false),
    ],
    help: 'Равномерное усреднение вдоль отрезка длиной L по обе стороны пикселя; число выборок ≈ L+1 (не более 128), с билинейной фильтрацией.',
    seamFn: (p) => (p.wrap === 'clamp' ? CLAMP_SEAM : ''),
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      const u = {};
      ctx.bindIn(u, 0, 0, 'native');
      if (p.length <= 0) { ctx.pass('copy', out, u); return [{ tex: out, space: ctx.space(0) || 'data' }]; }
      const a = (p.angle * Math.PI) / 180, L = p.length / ctx.projRes;
      Object.assign(u, { u_vec: [Math.cos(a) * L, -Math.sin(a) * L], u_n: Math.min(128, Math.max(2, Math.ceil(p.length) + 1)), u_aa: p.alphaAware });
      ctx.pass('dirblur', out, u, { u_in0: p.wrap });
      return [{ tex: out, space: ctx.space(0) || 'data' }];
    },
  },

  radialblur: {
    title: 'Радиальное размытие (Radial Blur)', cat: 'Размытие', outputs: ['Выход'],
    inputs: [{ label: 'Вход', def: BLACK, defText: 'чёрный (0,0,0,1)' }],
    params: [
      e('mode', 'Режим', [['zoom', 'Приближение (Zoom)'], ['spin', 'Вращение (Spin)']], 'zoom'),
      f('centerX', 'Центр X', 0, 1, 0.5), f('centerY', 'Центр Y (вниз)', 0, 1, 0.5),
      f('strength', 'Сила', 0, 1, 0.2, { step: 0.005, help: 'Zoom: доля расстояния до центра. Spin: 1 = ±90°. При 0 результат точно равен входу.' }),
      i('quality', 'Качество (выборок)', 4, 128, 32),
      e('wrap', 'Края', WRAP_OPTS, 'repeat'),
      b('alphaAware', 'С учётом альфы', false),
    ],
    seam: 'Радиальное размытие привязано к центру и в общем случае не периодично — возможен шов.',
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      const u = { u_mode: p.mode === 'spin' ? 1 : 0, u_n: p.quality, u_center: [p.centerX, p.centerY], u_strength: p.strength, u_aa: p.alphaAware };
      ctx.bindIn(u, 0, 0, 'native');
      ctx.pass('radial', out, u, { u_in0: p.wrap });
      return [{ tex: out, space: ctx.space(0) || 'data' }];
    },
  },

  // ---------------------------------------------------------------- normal
  normal: {
    title: 'Высота → Нормаль (Height to Normal)', cat: 'Нормали', outputs: ['Normal'],
    inputs: [{ label: 'Высота', def: BLACK, defText: '0 (плоская поверхность)' }],
    params: [
      e('source', 'Источник высоты', CHAN_OPTS, 'L'),
      f('strength', 'Сила (Strength)', 0, 100, 10, { step: 0.1, help: 'Перепад высоты 0→1 равен strength % от ширины текстуры. Производные берутся в единицах UV, поэтому смена разрешения не меняет рельеф.' }),
      f('blur', 'Предв. сглаживание (σ, px проекта)', 0, 16, 0, { step: 0.1 }),
      b('invert', 'Инвертировать высоту', false),
      e('convention', 'Соглашение Y', [['gl', 'OpenGL (+Y, зелёный вверх)'], ['dx', 'DirectX (−Y, зелёный вниз)']], 'gl'),
      b('invertX', 'Дополнительно инвертировать X (красный)', false),
      e('wrap', 'Края', WRAP_OPTS, 'repeat'),
    ],
    presets: [
      { label: 'Unity / OpenGL +Y', apply: { convention: 'gl', invertX: false } },
      { label: 'Unreal / DirectX −Y', apply: { convention: 'dx', invertX: false } },
    ],
    help: 'Центральные разности. UV: u вправо, v вниз по изображению (строка 0 — верх). Нормаль: X вправо, Y вверх по изображению (OpenGL), Z из поверхности; нормализуется и кодируется как n·0.5+0.5. DirectX отличается только знаком Y (инверсия зелёного). Постоянная высота → (128,128,255).',
    seamFn: (p) => (p.wrap === 'clamp' ? CLAMP_SEAM : ''),
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      const h = ctx.temp();
      const u = { u_src: CHAN_IDX[p.source], u_keepA: false, u_inv: p.invert };
      ctx.bindIn(u, 0, 0, 'native');
      ctx.pass('gray', h, u);
      let hsrc = h;
      const s = ctx.px(p.blur);
      if (s > 0.05) {
        const h2 = ctx.temp();
        gaussianInto(ctx, { tex: h, space: 'data' }, 0, h2, s, p.wrap === 'repeat', false);
        hsrc = h2;
      }
      const un = { u_k: p.strength / 100, u_rep: p.wrap === 'repeat', u_dx: p.convention === 'dx', u_invx: p.invertX };
      ctx.bindTex(un, 0, { tex: hsrc, space: 'data' }, 'native');
      ctx.pass('normal', out, un);
      return [{ tex: out, space: 'data' }];
    },
  },

  // ---------------------------------------------------------------- channels
  split: {
    title: 'Разделить RGBA (Split)', cat: 'Каналы', outputs: ['R', 'G', 'B', 'A'],
    inputs: [{ label: 'Вход', def: BLACK, defText: 'чёрный (0,0,0,1)' }],
    params: [],
    help: 'Четыре серых выхода с числовыми значениями каналов (для цветного входа — значения sRGB, как в файле). Альфа выходов = 1.',
    eval(ctx) {
      return [0, 1, 2, 3].map((c) => {
        const out = ctx.alloc(), u = { u_src: c, u_keepA: false, u_inv: false };
        ctx.bindIn(u, 0, 0, 'native');
        ctx.pass('gray', out, u);
        return { tex: out, space: 'data' };
      });
    },
  },

  combine: {
    title: 'Собрать RGBA (Combine)', cat: 'Каналы', outputs: ['RGBA'],
    inputs: [
      { label: 'R', def: BLACK, defText: 'константа канала R' }, { label: 'G', def: BLACK, defText: 'константа канала G' },
      { label: 'B', def: BLACK, defText: 'константа канала B' }, { label: 'A', def: BLACK, defText: 'константа канала A' },
    ],
    params: [
      e('preset', 'Пресет', [['orm', 'ORM (R=AO, G=Roughness, B=Metallic, A=1)'], ['hdrp', 'Unity HDRP Mask (R=Metallic, G=AO, B=Detail, A=Smoothness)'], ['custom', 'Свой (Custom RGBA)']], 'orm'),
      ...['r', 'g', 'b', 'a'].flatMap((c, k) => [
        e(c + 'Src', `${'RGBA'[k]}: источник`, [['R', 'R входа'], ['G', 'G входа'], ['B', 'B входа'], ['A', 'A входа'], ['L', 'Яркость входа'], ['C', 'Константа']], k === 3 ? 'C' : 'R', { group: 'RGBA'[k] }),
        f(c + 'Val', `${'RGBA'[k]}: константа / по умолчанию`, 0, 1, [1, 0.5, 0, 1][k], { group: 'RGBA'[k] }),
        b(c + 'Inv', `${'RGBA'[k]}: инвертировать (1−x)`, false, { group: 'RGBA'[k] }),
      ]),
    ],
    presetParam: 'preset',
    presetValues: {
      orm: { rSrc: 'R', rVal: 1, rInv: false, gSrc: 'R', gVal: 0.5, gInv: false, bSrc: 'R', bVal: 0, bInv: false, aSrc: 'C', aVal: 1, aInv: false },
      hdrp: { rSrc: 'R', rVal: 0, rInv: false, gSrc: 'R', gVal: 1, gInv: false, bSrc: 'R', bVal: 0, bInv: false, aSrc: 'R', aVal: 0.5, aInv: false },
      custom: {},
    },
    portLabels: {
      orm: ['R·AO', 'G·Rough', 'B·Metal', 'A (—)'],
      hdrp: ['R·Metal', 'G·AO', 'B·Detail', 'A·Smooth'],
      custom: ['R', 'G', 'B', 'A'],
    },
    help: 'Каждый выходной канал берётся из своего входа (канал, яркость) или из константы. Неподключённый вход заменяется константой канала. 1−x применяется только если включена инверсия: например, для HDRP подключите Roughness к A и включите «A: инвертировать», чтобы получить Smoothness.',
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      const cs = ['r', 'g', 'b', 'a'];
      const u = { u_src: cs.map((c) => CHAN_IDX[p[c + 'Src']]), u_const: cs.map((c) => p[c + 'Val']), u_inv: cs.map((c) => p[c + 'Inv']) };
      for (let k = 0; k < 4; k++) ctx.bindIn(u, k, k, 'native');
      ctx.pass('combine', out, u);
      return [{ tex: out, space: 'data' }];
    },
  },

  // ---------------------------------------------------------------- code
  code: {
    title: 'Код (GLSL)', cat: 'Код', outputs: ['Выход'],
    inputs: ['A', 'B', 'C', 'D'].map((l) => ({ label: l, def: BLACK, defText: 'чёрный (0,0,0,1)' })),
    params: [
      { key: 'code', label: 'GLSL-код', type: 'code', def: CODE_SNIPPETS.stripes },
      e('space', 'Выход', [['data', 'Данные (числа каналов)'], ['color', 'Цвет sRGB']], 'data', { help: 'Данные: вернувшиеся числа пишутся в каналы как есть. Цвет: результат считается sRGB-значениями (как в файле) и дальше обрабатывается как цвет.' }),
      f('p1', 'p1', 0, 1, 0.5, { hardMin: -1e4, hardMax: 1e4 }),
      f('p2', 'p2', 0, 1, 0.5, { hardMin: -1e4, hardMax: 1e4 }),
      f('p3', 'p3', 0, 1, 0.5, { hardMin: -1e4, hardMax: 1e4 }),
      f('p4', 'p4', 0, 1, 0.5, { hardMin: -1e4, hardMax: 1e4 }),
    ],
    presets: Object.keys(CODE_SNIPPET_TITLES).map((k) => ({ label: CODE_SNIPPET_TITLES[k], apply: { code: CODE_SNIPPETS[k] } })),
    help: 'Опишите функцию GLSL ES 3.00: vec4 process(vec2 uv, ivec2 px). uv — центр пикселя (u вправо, v вниз, 0..1), px — целые координаты. Входы: in0(px)…in3(px) (точная выборка), in0UV(uv)…in3UV(uv) (билинейно, с повтором). Значения входов — числа каналов как в файле (цвет — в sRGB). Параметры: p1…p4. Доступны u_res (размер), PI, LUMA, toLin/toSrgb, pcg3 (хеш), wrapPx. Неподключённый вход = (0,0,0,1). Ctrl+Enter — применить.',
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      const name = SHADERS.registerCustom(String(p.code || ''));
      const u = { u_p: [p.p1, p.p2, p.p3, p.p4] };
      for (let k = 0; k < 4; k++) ctx.bindIn(u, k, k, 'data');
      ctx.pass(name, out, u, { u_in0: 'repeat', u_in1: 'repeat', u_in2: 'repeat', u_in3: 'repeat' }, p.space === 'color' ? 2 : 0);
      return [{ tex: out, space: p.space === 'color' ? 'color' : 'data' }];
    },
  },

  // ---------------------------------------------------------------- output
  output: {
    title: 'Выход (Output)', cat: 'Выход', outputs: [],
    inputs: [{ label: 'Карта', def: BLACK, defText: 'чёрный (0,0,0,1)' }],
    params: [
      { key: 'filename', label: 'Имя файла', type: 'text', def: 'texture' },
    ],
    help: 'Экспорт PNG 8 бит RGBA без потерь. Цветные карты кодируются в sRGB, карты-данные записываются как есть. Экспорт всегда пересчитывает граф в выбранном разрешении.',
    eval(ctx) {
      const out = ctx.alloc(), u = {};
      ctx.bindIn(u, 0, 0, 'native');
      ctx.pass('copy', out, u);
      return [{ tex: out, space: ctx.space(0) || 'data' }];
    },
  },
};

// Levels / Invert / HSV: operate on file values; colour inputs are
// sRGB-encoded on read and linearised again on write.
function pointwise(ctx, shader, u) {
  const out = ctx.alloc(), sp = ctx.space(0) || 'data';
  ctx.bindIn(u, 0, 0, 'data');
  ctx.pass(shader, out, u, null, sp === 'color' ? 2 : 0);
  return [{ tex: out, space: sp }];
}

// Two-pass separable Gaussian. sigma in evaluation pixels.
function gaussianInto(ctx, src, _slot, out, sigma, repeat, alphaAware) {
  const u = {};
  ctx.bindTex(u, 0, src, 'native');
  if (!src || sigma <= 0.05) { ctx.pass('copy', out, u); return; }
  const radius = Math.min(512, Math.ceil(sigma * 3));
  const tmp = ctx.temp();
  ctx.pass('gauss', tmp, { ...u, u_dir: [1, 0], u_sigma: sigma, u_radius: radius, u_rep: repeat, u_premul: alphaAware, u_unpremul: false });
  const u2 = {};
  ctx.bindTex(u2, 0, { tex: tmp, space: src.space }, 'native');
  ctx.pass('gauss', out, { ...u2, u_dir: [0, 1], u_sigma: sigma, u_radius: radius, u_rep: repeat, u_premul: false, u_unpremul: alphaAware });
}

// Stable sort by position: coincident stops keep list order.
function sortStops(stops) {
  return stops.map((s, k) => ({ ...s, k })).sort((a, b) => a.p - b.p || a.k - b.k);
}

function defaultParams(type) {
  const p = {};
  for (const d of NODES[type].params) p[d.key] = d.def && typeof d.def === 'object' ? JSON.parse(JSON.stringify(d.def)) : d.def;
  return p;
}

function inputLabel(node, k) {
  const def = NODES[node.type];
  if (def.portLabels) return (def.portLabels[node.params[def.presetParam]] || def.portLabels.custom)[k];
  return def.inputs[k].label;
}
