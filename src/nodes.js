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

// Gradient presets for Color Ramp (sRGB hex stops). Scientific maps (viridis,
// magma, inferno, plasma, turbo) are 8-point samples of the matplotlib/Google maps.
const RAMP_PRESETS = {
  'Серый (Grayscale)': ['#000000', '#ffffff'],
  'Magma': ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55964', '#fb8761', '#fcfdbf'],
  'Inferno': ['#000004', '#1f0c48', '#550f6d', '#88226a', '#ba3655', '#e35933', '#f98e09', '#fcffa4'],
  'Plasma': ['#0d0887', '#5302a3', '#8b0aa5', '#b83289', '#db5c68', '#f48849', '#febd2a', '#f0f921'],
  'Viridis': ['#440154', '#46327e', '#365c8d', '#277f8e', '#1fa187', '#4ac16d', '#a0da39', '#fde725'],
  'Turbo': ['#30123b', '#4662d7', '#36aaf9', '#1ae4b6', '#72fe5e', '#c8ef34', '#faba39', '#e6480a'],
  'Огонь (Fire)': ['#000000', '#3b0000', '#8a0a00', '#d42a00', '#ff6a00', '#ffb000', '#ffe45c', '#ffffff'],
  'Лава (Lava)': ['#0a0302', '#2a0703', '#6e1004', '#b82a05', '#f05a0a', '#ff9a1f', '#ffd35a'],
  'Вода (Water)': ['#020b1f', '#06224d', '#0b4a82', '#1478b0', '#27a3c9', '#6fd0de', '#c6f1f2', '#ffffff'],
  'Лёд (Ice)': ['#0b1a2e', '#1d4466', '#3f7ea6', '#86bbd8', '#c9e6f2', '#ffffff'],
  'Земля (Terrain)': ['#0d1f4d', '#1c5c8c', '#1a7f80', '#d9cc8c', '#5a8c33', '#3d6b24', '#8c7a66', '#f2f4f7'],
  'Трава (Grass)': ['#16240a', '#2a4212', '#3f6419', '#5b8424', '#7ea434', '#b1c85a'],
  'Мох (Moss)': ['#1a1d0e', '#34391a', '#4f5a25', '#6f7a34', '#98a054'],
  'Песок (Sand)': ['#5e4a2e', '#8c7048', '#b89a6a', '#d6bf8e', '#efe0b8'],
  'Почва (Dirt)': ['#1e140d', '#3b291b', '#5a3f2a', '#7a5a3f', '#9c7c5c'],
  'Камень (Rock)': ['#1f1d1b', '#3d3a36', '#5e5a54', '#807b73', '#a8a399', '#cfcac0'],
  'Бетон (Concrete)': ['#4a4a48', '#6b6b67', '#8a8984', '#a6a59f', '#c2c1bb'],
  'Кирпич (Brick)': ['#3d140b', '#5c1f10', '#7e2d17', '#9c4024', '#b25a36', '#8c6a58'],
  'Дерево (Wood)': ['#2e1a0e', '#4d2d17', '#6e4424', '#8f5d33', '#b07d4a', '#c99a66'],
  'Ржавчина (Rust)': ['#1f0e07', '#4a1c0a', '#7a320f', '#a64e17', '#c9702b', '#d99a5b'],
  'Медь (Copper)': ['#2b1308', '#6b3417', '#b0602e', '#e0935a', '#f7c9a0'],
  'Золото (Gold)': ['#2e1f05', '#6b4a0c', '#b08617', '#e0b93a', '#fff0a0'],
  'Снег (Snow)': ['#7f8ea3', '#a9b6c8', '#d3dce8', '#f4f7fb', '#ffffff'],
  'Закат (Sunset)': ['#1a1033', '#4b1d5c', '#8c2a63', '#d0485a', '#f57a4a', '#fdbf6f'],
  'Радуга (Rainbow)': ['#ff0000', '#ff9900', '#ccff00', '#33ff00', '#00ff66', '#00ffff', '#0066ff', '#cc00ff'],
  'Холодно–тепло (Coolwarm)': ['#3b4cc0', '#6f92f3', '#aac7fd', '#dddddd', '#f7b89c', '#e7745b', '#b40426'],
};
function rampFromPreset(name) {
  const hex = RAMP_PRESETS[name];
  if (!hex) return null;
  return hex.map((h, k) => ({ p: hex.length > 1 ? +(k / (hex.length - 1)).toFixed(4) : 0, c: [...ColorUtil.fromHex(h), 1] }));
}

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
    desc: 'Процедурный шум: Perlin, Value, клеточный Worley или белый; фракталы fBM/Ridged/Billow, растяжение, доменное искажение. Основа почти любой текстуры.',
    params: [
      e('type', 'Тип', [['perlin', 'Градиентный (Perlin)'], ['value', 'Value Noise'], ['worley', 'Клеточный (Worley)'], ['white', 'Белый шум (White)']], 'perlin'),
      e('fractal', 'Фрактал', [['fbm', 'Обычный (fBM) — облака'], ['ridged', 'Гребни (Ridged) — горы, трещины'], ['billow', 'Клубы (Billow) — камни, дым']], 'fbm',
        { help: 'fBM: сумма октав. Ridged: 1−|2n−1| в квадрате — острые хребты и прожилки. Billow: |2n−1| — округлые «клубы».' }),
      b('tile', 'Бесшовный (Tileable)', true, { help: 'В режиме Tileable масштаб — целое число: период каждой октавы равен целому числу клеток, шум математически периодичен по u и v.' }),
      f('scale', 'Масштаб (Scale)', 1, 64, 4, { step: 1, intWhen: (p) => p.tile, visible: (p) => p.type !== 'white' }),
      i('grain', 'Размер зерна (px проекта)', 1, 64, 1, { visible: (p) => p.type === 'white', help: 'Белый шум: одно случайное значение на квадрат grain×grain пикселей проекта.' }),
      f('stretch', 'Растяжение по Y (×)', 0.125, 8, 1, { step: 0.125, help: 'Частота по Y = масштаб × растяжение (в Tileable округляется до целого). >1 — вытянутые по X волокна (дерево, шлифованный металл), <1 — по Y.' }),
      i('seed', 'Seed', 0, 99999, 1),
      i('octaves', 'Детализация (Detail, октавы)', 1, 8, 5),
      f('persistence', 'Шероховатость шума (Persistence)', 0, 1, 0.5, { help: 'Вклад каждой следующей октавы относительно предыдущей. Не путать с PBR roughness.' }),
      i('lacunarity', 'Лакунарность (×частота на октаву)', 2, 4, 2, { help: 'Во сколько раз растёт частота с каждой октавой. Целое — чтобы шум оставался бесшовным.' }),
      f('warp', 'Искажение (Domain Warp)', 0, 1, 0, { help: 'Сдвигает координаты другим периодическим шумом — «текучие», органические формы (мрамор, грязь, облака). Бесшовность сохраняется.' }),
      i('warpScale', 'Масштаб искажения', 1, 16, 2, { visible: (p) => p.warp > 0 }),
      f('evolution', 'Эволюция (анимация)', 0, 1, 0, { step: 0.001, help: 'Плавно меняет узор, не сдвигая его. Для зацикленной анимации анимируйте 0 → 1 (кривая «Линейно»): последний кадр переходит в первый без скачка.' }),
      f('contrast', 'Контраст (Contrast)', 0, 4, 1),
      b('invert', 'Инвертировать', false),
    ],
    seamFn: (p) => (p.tile ? '' : 'Tileable выключен — шум не периодичен, при повторе будет шов.'),
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      ctx.pass('noise', out, {
        u_type: { value: 0, perlin: 1, worley: 2, white: 3 }[p.type], u_fractal: { fbm: 0, ridged: 1, billow: 2 }[p.fractal],
        u_seed: p.seed, u_oct: p.octaves, u_lac: p.lacunarity, u_scale: p.scale, u_stretch: p.stretch,
        u_grainCells: ctx.projRes / Math.max(1, p.grain), u_pers: p.persistence, u_contrast: p.contrast,
        u_warp: p.warp, u_warpScale: p.warpScale, u_tile: p.tile, u_inv: p.invert, u_evo: p.evolution,
      });
      return [{ tex: out, space: 'data' }];
    },
  },

  voronoi: {
    title: 'Вороной (Voronoi)', cat: 'Источники', outputs: ['Ячейки'], inputs: [],
    desc: 'Клеточный шум: расстояния F1/F2, трещины F2−F1, границы ячеек, случайное значение ячейки; разные метрики. Камни, плитняк, чешуя, трещины, кристаллы.',
    params: [
      e('mode', 'Режим', [['f1', 'Расстояние до точки (F1)'], ['f2', 'До второй точки (F2)'], ['crackle', 'Трещины (F2 − F1)'], ['border', 'Границы ячеек (Borders)'], ['cell', 'Значение ячейки (Cell)']], 'f1'),
      e('metric', 'Метрика расстояния', [['euclid', 'Евклидова — круглые'], ['manhattan', 'Манхэттен — ромбы'], ['chebyshev', 'Чебышёв — квадраты']], 'euclid', { visible: (p) => p.mode !== 'border' && p.mode !== 'cell' }),
      b('tile', 'Бесшовный (Tileable)', true, { help: 'В режиме Tileable масштаб — целое число клеток на текстуру.' }),
      f('scale', 'Масштаб (Scale)', 1, 64, 8, { step: 1, intWhen: (p) => p.tile }),
      i('seed', 'Seed', 0, 99999, 1),
      f('randomness', 'Случайность (Randomness)', 0, 1, 1),
      f('evolution', 'Эволюция (анимация)', 0, 1, 0, { step: 0.001, help: 'Плавно меняет узор, не сдвигая его. Для зацикленной анимации анимируйте 0 → 1 (кривая «Линейно»): последний кадр переходит в первый без скачка.' }),
    ],
    seamFn: (p) => (p.tile ? '' : 'Tileable выключен — узор не периодичен, при повторе будет шов.'),
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      ctx.pass('voronoi', out, {
        u_seed: p.seed, u_mode: { f1: 0, border: 1, cell: 2, f2: 3, crackle: 4 }[p.mode], u_scale: p.scale,
        u_rand: p.randomness, u_tile: p.tile, u_evo: p.evolution, u_metric: { euclid: 0, manhattan: 1, chebyshev: 2 }[p.metric],
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

  // ---------------------------------------------------------------- patterns
  waves: {
    title: 'Волны (Waves)', cat: 'Узоры', outputs: ['Волны'],
    inputs: [{ label: 'Искажение', def: [0.5, 0.5, 0.5, 1], defText: '0.5 (без искажения)' }],
    desc: 'Полосы/волны синус, треугольник, пила, меандр вдоль целого числа периодов; вход искажения даёт дерево, мрамор, песчаные дюны.',
    params: [
      e('shape', 'Форма', [['sine', 'Синус'], ['triangle', 'Треугольник'], ['saw', 'Пила'], ['square', 'Меандр (Square)']], 'sine'),
      e('mode', 'Раскладка', [['linear', 'Линейные (бесшовно)'], ['rings', 'Кольца от центра']], 'linear'),
      i('countX', 'Периодов по X', -32, 32, 8, { visible: (p) => p.mode === 'linear', help: 'Целые числа периодов по X и Y задают направление и частоту — узор всегда бесшовный. (8, 0) — вертикальные полосы, (4, 4) — диагональ.' }),
      i('countY', 'Периодов по Y', -32, 32, 0, { visible: (p) => p.mode === 'linear' }),
      f('rings', 'Колец', 0.5, 64, 8, { step: 0.5, visible: (p) => p.mode === 'rings' }),
      f('centerX', 'Центр X', 0, 1, 0.5, { visible: (p) => p.mode === 'rings' }), f('centerY', 'Центр Y (вниз)', 0, 1, 0.5, { visible: (p) => p.mode === 'rings' }),
      f('phase', 'Фаза', 0, 1, 0),
      f('duty', 'Заполнение меандра', 0, 1, 0.5, { visible: (p) => p.shape === 'square' }),
      f('distort', 'Сила искажения', 0, 8, 1, { step: 0.05, help: 'Сдвиг фазы на (вход − 0.5) × сила периодов. Подключите шум — получите годичные кольца, мрамор.' }),
    ],
    seamFn: (p) => (p.mode === 'rings' ? 'Кольца от центра не периодичны — при повторе будет шов.' : ''),
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      const u = { u_shape: ['sine', 'triangle', 'saw', 'square'].indexOf(p.shape), u_rings: p.mode === 'rings', u_count: [p.countX, p.countY],
        u_ringN: p.rings, u_center: [p.centerX, p.centerY], u_phase: p.phase, u_duty: p.duty, u_distort: p.distort };
      ctx.bindIn(u, 0, 0, 'native');
      ctx.pass('waves', out, u);
      return [{ tex: out, space: 'data' }];
    },
  },

  tiler: {
    title: 'Раскладка (Tile Sampler)', cat: 'Узоры', outputs: ['Узор', 'Случайное'],
    inputs: [{ label: 'Узор', def: [1, 1, 1, 1], defText: 'встроенная фигура (параметр «Фигура»)' }],
    desc: 'Раскладывает фигуру или входное изображение сеткой X×Y со сдвигом рядов и случайными позицией, поворотом, размером и яркостью. Кирпичи, плитка, паркет, соты, заклёпки. Второй выход — случайное значение на каждую копию.',
    params: [
      e('pattern', 'Фигура', [['square', 'Прямоугольник'], ['disc', 'Круг'], ['gauss', 'Мягкое пятно'], ['input', 'Со входа «Узор»']], 'square'),
      i('countX', 'Копий по X', 1, 64, 4), i('countY', 'Копий по Y', 1, 64, 8),
      f('rowOffset', 'Сдвиг чётных рядов (доля ячейки)', -1, 1, 0.5, { help: 'Каждый нечётный ряд сдвигается на эту долю ширины ячейки: 0.5 — кирпичная кладка.' }),
      f('sizeX', 'Размер X (доля ячейки)', 0, 2, 0.94), f('sizeY', 'Размер Y (доля ячейки)', 0, 2, 0.88),
      f('bevel', 'Фаска (Bevel)', 0, 0.5, 0.08, { step: 0.005, visible: (p) => p.pattern !== 'input' && p.pattern !== 'gauss', help: 'Ширина скоса к краю в долях меньшей стороны копии. 0 — резкий край. Даёт рельеф для Height to Normal.' }),
      f('posRand', 'Случайная позиция', 0, 1, 0, { help: 'Смещение копии в пределах ± доли ячейки.' }),
      f('sizeRand', 'Случайный размер', 0, 1, 0),
      f('rotation', 'Поворот, °', -180, 180, 0, { step: 1 }),
      f('rotRand', 'Случайный поворот, ±°', 0, 180, 0, { step: 1 }),
      b('rotSnap', 'Поворот только на 90°', false, { help: 'Случайный поворот кратен 90° — для плитки и паркета.' }),
      f('valRand', 'Случайная яркость', 0, 1, 0.3, { help: 'Каждая копия темнее на случайную долю — разная высота/цвет кирпичей.' }),
      f('density', 'Заполненность', 0, 1, 1, { help: 'Вероятность, что копия есть. <1 — выпавшие кирпичи, пропуски.' }),
      e('blend', 'Наложение копий', [['max', 'Максимум (Max)'], ['add', 'Сложение (Add)'], ['top', 'Сверху — случайный порядок']], 'max'),
      i('seed', 'Seed', 0, 99999, 1),
    ],
    presets: [
      { label: 'Кирпичи', apply: { pattern: 'square', countX: 4, countY: 8, rowOffset: 0.5, sizeX: 0.94, sizeY: 0.86, bevel: 0.1, posRand: 0, sizeRand: 0, rotRand: 0, valRand: 0.35, density: 1 } },
      { label: 'Плитка', apply: { pattern: 'square', countX: 6, countY: 6, rowOffset: 0, sizeX: 0.95, sizeY: 0.95, bevel: 0.04, posRand: 0, sizeRand: 0, rotRand: 0, valRand: 0.15, density: 1 } },
      { label: 'Паркет', apply: { pattern: 'square', countX: 8, countY: 8, rowOffset: 0, sizeX: 0.96, sizeY: 0.3, bevel: 0.2, rotation: 0, rotRand: 90, rotSnap: true, valRand: 0.3, density: 1 } },
      { label: 'Соты / горошек', apply: { pattern: 'disc', countX: 8, countY: 8, rowOffset: 0.5, sizeX: 0.9, sizeY: 0.9, bevel: 0.3, posRand: 0, sizeRand: 0, rotRand: 0, valRand: 0.1, density: 1 } },
      { label: 'Булыжник', apply: { pattern: 'square', countX: 8, countY: 10, rowOffset: 0.5, sizeX: 1.04, sizeY: 0.96, bevel: 0.45, posRand: 0.12, sizeRand: 0.12, rotRand: 10, rotSnap: false, valRand: 0.35, density: 1, blend: 'top' } },
    ],
    seamFn: (p) => (p.countY % 2 && Math.abs(p.rowOffset) > 1e-6 ? 'Сдвиг рядов при нечётном числе рядов: у верхнего/нижнего края чередование рядов нарушится (узор всё равно периодичен).' : ''),
    help: 'Сетка countX×countY всегда целая, поэтому раскладка бесшовна, в том числе со случайностями. Копии могут выходить за ячейку (размер до 2) — соседние ячейки учитываются.',
    eval(ctx) { return scatterEval(ctx, 'tiler'); },
  },

  splatter: {
    title: 'Разброс (Splatter)', cat: 'Узоры', outputs: ['Узор', 'Случайное'],
    inputs: [{ label: 'Узор', def: [1, 1, 1, 1], defText: 'встроенная фигура (параметр «Фигура»)' }],
    desc: 'Разбрасывает N копий фигуры или входного изображения в случайных местах со случайным поворотом, размером и яркостью, бесшовно. Камни, гравий, листья, пятна, капли, царапины, заклёпки.',
    params: [
      e('pattern', 'Фигура', [['disc', 'Круг'], ['gauss', 'Мягкое пятно'], ['square', 'Прямоугольник'], ['input', 'Со входа «Узор»']], 'disc'),
      i('count', 'Количество', 1, 4000, 200),
      f('size', 'Размер (доля текстуры)', 0.002, 1, 0.06, { step: 0.001 }),
      f('aspect', 'Вытянутость (Y/X)', 0.02, 4, 1, { help: 'Маленькое значение с прямоугольником — царапины и волокна.' }),
      f('sizeRand', 'Случайный размер', 0, 1, 0.5),
      f('bevel', 'Фаска / мягкость', 0, 0.5, 0.3, { step: 0.005, visible: (p) => p.pattern !== 'input' && p.pattern !== 'gauss' }),
      f('rotation', 'Поворот, °', -180, 180, 0, { step: 1 }),
      f('rotRand', 'Случайный поворот, ±°', 0, 180, 180, { step: 1 }),
      f('valRand', 'Случайная яркость', 0, 1, 0.5),
      e('blend', 'Наложение копий', [['max', 'Максимум (Max)'], ['add', 'Сложение (Add)'], ['top', 'Сверху — случайный порядок']], 'max'),
      i('seed', 'Seed', 0, 99999, 1),
    ],
    help: 'Копии распределяются по периодической сетке случайно (по одной или нескольку на ячейку) и переносятся через края — результат всегда бесшовный и воспроизводим по seed.',
    eval(ctx) { return scatterEval(ctx, 'splatter'); },
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
    colorPresets: 'stops',
    presets: Object.keys(RAMP_PRESETS).map((name) => ({ label: name, get apply() { return { stops: rampFromPreset(name) }; } })),
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

  warp: {
    title: 'Искажение (Warp)', cat: 'Обработка', outputs: ['Выход'],
    inputs: [{ label: 'Вход', def: BLACK, defText: 'чёрный (0,0,0,1)' }, { label: 'Карта', def: [0.5, 0.5, 0.5, 1], defText: '0.5 (без сдвига)' }],
    desc: 'Сдвигает пиксели входа по серой карте: в заданном направлении или вдоль её градиента. Делает узоры органичными: неровные кирпичи, мрамор, эрозия, «плывущие» пятна.',
    params: [
      e('mode', 'Режим', [['directional', 'Направленный (Directional)'], ['gradient', 'По градиенту карты (Warp)']], 'gradient'),
      f('intensity', 'Сила', 0, 1, 0.1, { step: 0.001, help: 'Направленный: сдвиг (карта−0.5)·2·сила в долях текстуры. По градиенту: сдвиг = градиент карты (на единицу UV) · сила/10.' }),
      f('angle', 'Угол, °', -180, 180, 0, { step: 1, visible: (p) => p.mode === 'directional' }),
      e('wrap', 'Края', WRAP_OPTS, 'repeat'),
    ],
    seamFn: (p) => (p.wrap === 'clamp' ? CLAMP_SEAM : ''),
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      const a = (p.angle * Math.PI) / 180;
      const u = { u_mode: p.mode === 'gradient' ? 1 : 0, u_dir: [Math.cos(a), -Math.sin(a)], u_int: p.intensity, u_rep: p.wrap === 'repeat' };
      ctx.bindIn(u, 0, 0, 'native');
      ctx.bindIn(u, 1, 1, 'native');
      ctx.pass('warp', out, u, { u_in0: p.wrap });
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

  glow: {
    title: 'Свечение (Glow)', cat: 'Размытие', outputs: ['Выход', 'Только свечение'],
    inputs: [{ label: 'Вход', def: BLACK, defText: 'чёрный (0,0,0,1)' }],
    desc: 'Ореол вокруг ярких областей (bloom): порог яркости, мягкое многоуровневое размытие, сила и оттенок. Для эффектов, неона, магии, огня; у спрайтов с прозрачностью свечение расширяет альфу.',
    params: [
      f('threshold', 'Порог яркости', 0, 1, 0.5, { help: 'Светятся пиксели ярче порога (по максимальному из R, G, B). 0 — светится всё.' }),
      f('knee', 'Мягкость порога', 0, 0.5, 0.15),
      f('radius', 'Радиус (σ, px проекта)', 0.5, 64, 10, { step: 0.5, help: 'Складываются три размытия: σ, 2σ и 4σ — плотное ядро и широкий ореол.' }),
      f('intensity', 'Сила', 0, 8, 1.5),
      { key: 'tint', label: 'Оттенок свечения', type: 'color', def: [1, 1, 1, 1] },
      b('alpha', 'Свечение расширяет альфу (спрайты)', true),
      e('wrap', 'Края', WRAP_OPTS, 'clamp'),
    ],
    seamFn: (p) => (p.wrap === 'clamp' ? 'Края в режиме Clamp: для бесшовных текстур выберите Repeat.' : ''),
    eval(ctx) {
      const p = ctx.params, sp = ctx.space(0) || 'data';
      const bright = ctx.temp();
      const u = { u_thr: p.threshold, u_knee: p.knee };
      ctx.bindIn(u, 0, 0, 'native');
      ctx.pass('brightpass', bright, u);
      const rep = p.wrap === 'repeat', wrap = rep ? 'repeat' : 'clamp';
      // bloom pyramid: blur σ·2^k at resolution res/2^(k+1) (same look, a fraction of the cost)
      let prev = bright;
      const blurs = [1, 2, 4].map((m, k) => {
        const size = Math.max(8, ctx.res >> (k + 1));
        const down = ctx.tempAt(size), u2 = {};
        ctx.bindTex(u2, 0, { tex: prev, space: sp }, 'native');
        ctx.pass('downsample', down, u2, { u_in0: wrap });
        const t = ctx.tempAt(size);
        gaussianInto(ctx, { tex: down, space: sp }, 0, t, Math.min(96, ctx.px(p.radius * m) * size / ctx.res), rep, false);
        prev = down;
        return t;
      });
      const tint = sp === 'color' ? p.tint.slice(0, 3).map(ColorUtil.toLin) : p.tint.slice(0, 3);
      return [0, 1].filter((mode) => ctx.used(mode)).map((mode) => {
        const out = ctx.alloc(), w = { u_int: p.intensity, u_tint: tint, u_out: mode, u_alpha: p.alpha };
        ctx.bindIn(w, 0, 0, 'native');
        blurs.forEach((t, k) => ctx.bindTex(w, k + 1, { tex: t, space: sp }, 'native'));
        ctx.pass('glowmix', out, w, { u_in1: wrap, u_in2: wrap, u_in3: wrap });
        return { tex: out, space: sp };
      }).reduce((a, o, _, arr) => (arr.length === 1 ? [o, o] : arr), []);
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

  // ---------------------------------------------------------------- effects
  fx: {
    title: 'Эффект (FX)', cat: 'Эффекты', outputs: ['Цвет', 'Интенсивность'], inputs: [], timeDependent: true,
    desc: 'Готовые анимированные эффекты для частиц и спрайт-шитов: пламя, огонь, взрыв, дым, искры, молния, электричество, вспышка, блик, ударная волна, магический круг, энергосфера, портал, лазер, слэш, облако, каустика. Всегда бесшовная петля по кадрам.',
    params: [
      e('effect', 'Эффект', FX_LIST.map((x) => [x.id, x.title]), 'flame'),
      { key: 'stops', label: 'Палитра (интенсивность → цвет и альфа)', type: 'ramp', def: fxStops('Огонь (Fire)') },
      f('intensity', 'Яркость', 0, 4, 1),
      f('scale', 'Размер', 0.2, 2.5, 1),
      i('loops', 'Циклов за анимацию', 1, 8, 1, { help: 'Сколько раз эффект повторяется за весь цикл кадров (целое — для бесшовной петли).' }),
      i('detail', 'Детализация (октавы)', 1, 8, 5),
      i('count', 'Количество (искры, лучи, рукава, смены формы)', 1, 64, 8, { visible: (p) => fxUses(p.effect, 'count') }),
      f('thick', 'Толщина', 0, 1, 0.5, { visible: (p) => fxUses(p.effect, 'thick') }),
      f('distort', 'Искажение', 0, 2, 1, { visible: (p) => fxUses(p.effect, 'distort') }),
      f('twist', 'Закрутка / поворот', 0, 3, 1, { visible: (p) => fxUses(p.effect, 'twist') }),
      i('seed', 'Seed', 0, 99999, 1),
      e('background', 'Фон', [['transparent', 'Прозрачный (альфа из палитры)'], ['black', 'Чёрный (для аддитивного смешивания)']], 'transparent'),
    ],
    topParams: ['effect'],
    colorPresets: 'stops',
    presetParam: 'effect',
    presetValues: Object.fromEntries(FX_LIST.map((x) => [x.id, { get stops() { return fxStops(x.palette); }, ...x.defaults }])),
    presets: [...Object.keys(FX_PALETTES), ...Object.keys(RAMP_PRESETS)].map((name) => ({ label: name, get apply() { return { stops: fxStops(name) }; } })),
    help: 'Эффект зависит от кадра анимации (таймлайн под предпросмотром появляется сам). Однократные эффекты (взрыв, волна, разлёт искр, слэш) проигрываются от начала до конца за цикл, остальные — бесконечная петля. Выход «Интенсивность» — серая маска для своих Color Ramp, Blend и т.п. Экспорт: кнопка «Спрайт-шит PNG».',
    seamFn: (p) => (FX_LIST.find((x) => x.id === p.effect) || {}).tile ? '' : 'Эффект центрирован в кадре и не предназначен для повторения как тайл.',
    eval(ctx) {
      const p = ctx.params;
      const fx = FX_LIST.find((x) => x.id === p.effect) || FX_LIST[0];
      const st = sortStops(p.stops);
      const pos = [], cols = [];
      for (let k = 0; k < 8; k++) { const s = st[Math.min(k, st.length - 1)]; pos.push(s.p); cols.push(s.c.slice(0, 4)); }
      const u = {
        u_t: Anim.t, u_loops: p.loops, u_seed: p.seed, u_oct: p.detail, u_count: p.count, u_int: p.intensity, u_scale: p.scale,
        u_thick: p.thick, u_distort: p.distort, u_twist: p.twist, u_edge: fx.edge || 0, u_blackBg: p.background === 'black', u_n: st.length, u_pos: pos, u_cols: cols,
      };
      const col = ctx.alloc();
      ctx.pass('fx_' + fx.id, col, { ...u, u_outMode: 0 }, null, 2);
      if (!ctx.used(1)) return [{ tex: col, space: 'color' }, { tex: col, space: 'color' }];
      const gray = ctx.alloc();
      ctx.pass('fx_' + fx.id, gray, { ...u, u_outMode: 1 });
      return [{ tex: col, space: 'color' }, { tex: gray, space: 'data' }];
    },
  },

  flare: {
    title: 'Оптический блик (Optical Flare)', cat: 'Эффекты', outputs: ['Цвет', 'Интенсивность'], inputs: [], timeDependent: true,
    desc: 'Генератор бликов объектива для VFX: сияние и ядро, лучи-звезда, мерцающие лучи, анаморфные полосы, кольцо с радужной каймой, отражения (ghosts / multi-iris) вдоль оптической оси — круги или многоугольники диафрагмы, искры и грязь на линзе. Свет аддитивный, яркость может быть больше 1 (HDR).',
    params: [
      f('posX', 'Источник: X', -1.5, 1.5, -0.3, { help: 'Положение источника света: −1…1 — от левого до правого края кадра. Анимируйте ⏱ — отражения поедут навстречу.' }),
      f('posY', 'Источник: Y', -1.5, 1.5, 0.25, { help: '−1 — низ, 1 — верх кадра.' }),
      f('brightness', 'Общая яркость', 0, 4, 1),
      f('scale', 'Размер', 0.1, 3, 1, { help: 'Масштаб всех элементов вокруг источника.' }),
      { key: 'tint', label: 'Общий оттенок', type: 'color', def: [1, 1, 1, 1] },
      f('rotation', 'Поворот (°)', -180, 180, 0, { help: 'Поворачивает лучи, полосы и многоугольники отражений.' }),
      f('anamorph', 'Анаморфность (растяжение по X)', 1, 4, 1, { help: 'Растягивает сияние, кольцо и отражения по горизонтали, как анаморфный объектив.' }),
      f('flicker', 'Мерцание яркости', 0, 1, 0, { help: 'Случайное дрожание яркости по кадрам (бесшовная петля).' }),
      i('loops', 'Циклов за анимацию', 1, 8, 1),
      i('seed', 'Seed', 0, 99999, 1, { help: 'Случайные длины лучей, размеры и цвета отражений, позиции искр.' }),
      e('background', 'Фон', [['black', 'Чёрный (аддитивное смешивание, как в VFX)'], ['transparent', 'Прозрачный (альфа = яркость)']], 'black'),
      b('edgeFade', 'Гасить к краям кадра (спрайты)', true),

      f('glowI', 'Сила свечения', 0, 4, 1, { section: 'Свечение (Glow)' }),
      f('glowSize', 'Радиус свечения', 0.01, 2, 0.6, { section: 'Свечение (Glow)' }),
      f('glowFall', 'Спад (больше — плотнее к центру)', 0.5, 8, 3, { section: 'Свечение (Glow)' }),
      { key: 'glowColor', label: 'Цвет свечения', type: 'color', def: [1, 0.8, 0.55, 1], section: 'Свечение (Glow)' },
      f('coreI', 'Яркость ядра', 0, 4, 1.2, { section: 'Свечение (Glow)' }),
      f('coreSize', 'Размер ядра', 0.002, 0.3, 0.04, { step: 0.001, section: 'Свечение (Glow)' }),

      f('raysI', 'Сила лучей', 0, 4, 0.5, { section: 'Лучи (Rays)' }),
      i('raysCount', 'Число лучей', 1, 32, 8, { section: 'Лучи (Rays)' }),
      f('raysLen', 'Длина', 0, 2.5, 0.9, { section: 'Лучи (Rays)' }),
      f('raysSharp', 'Острота', 1, 100, 20, { section: 'Лучи (Rays)' }),
      f('raysRandom', 'Случайность длины и яркости', 0, 1, 0.4, { section: 'Лучи (Rays)' }),
      f('raysAngle', 'Угол (°)', -180, 180, 0, { section: 'Лучи (Rays)' }),
      i('raysSpin', 'Вращение (шагов за цикл)', -4, 4, 0, { section: 'Лучи (Rays)', help: 'Лучи поворачиваются на целое число шагов между соседними лучами — петля бесшовна.' }),
      { key: 'raysColor', label: 'Цвет лучей', type: 'color', def: [1, 0.9, 0.7, 1], section: 'Лучи (Rays)' },

      f('shimI', 'Сила мерцающих лучей', 0, 4, 0.3, { section: 'Мерцание (Shimmer)' }),
      i('shimCount', 'Плотность лучиков', 4, 256, 80, { section: 'Мерцание (Shimmer)' }),
      f('shimLen', 'Длина', 0, 2.5, 0.7, { section: 'Мерцание (Shimmer)' }),
      f('shimSharp', 'Резкость', 1, 16, 5, { section: 'Мерцание (Shimmer)' }),
      i('shimSpeed', 'Скорость (0 — неподвижно)', 0, 8, 1, { section: 'Мерцание (Shimmer)' }),

      f('streakI', 'Сила полосы', 0, 4, 0, { section: 'Полоса (Streak)' }),
      f('streakLen', 'Длина', 0, 4, 1.8, { section: 'Полоса (Streak)' }),
      f('streakThick', 'Толщина', 0.001, 0.1, 0.01, { step: 0.001, section: 'Полоса (Streak)' }),
      f('streakHaze', 'Дымка вокруг полосы', 0, 1, 0.3, { section: 'Полоса (Streak)' }),
      i('streakCount', 'Число полос (крест, звезда)', 1, 4, 1, { section: 'Полоса (Streak)' }),
      f('streakAngle', 'Угол (°)', -180, 180, 0, { section: 'Полоса (Streak)' }),
      { key: 'streakColor', label: 'Цвет полосы', type: 'color', def: [0.45, 0.65, 1, 1], section: 'Полоса (Streak)' },

      f('ringI', 'Сила кольца', 0, 4, 0.2, { section: 'Кольцо (Ring)' }),
      f('ringRadius', 'Радиус', 0, 2, 0.42, { section: 'Кольцо (Ring)' }),
      f('ringWidth', 'Ширина', 0.002, 0.4, 0.03, { step: 0.001, section: 'Кольцо (Ring)' }),
      f('ringChroma', 'Радужная кайма', 0, 1, 0.7, { section: 'Кольцо (Ring)' }),
      { key: 'ringColor', label: 'Цвет кольца', type: 'color', def: [1, 1, 1, 1], section: 'Кольцо (Ring)' },

      f('ghostI', 'Сила отражений', 0, 4, 0.35, { section: 'Отражения (Ghosts / Iris)' }),
      i('ghostCount', 'Количество', 0, 16, 7, { section: 'Отражения (Ghosts / Iris)' }),
      f('ghostStart', 'Начало на оси', -1, 2, 0.25, { section: 'Отражения (Ghosts / Iris)', help: 'Ось идёт от источника (0) через центр объектива (1) и дальше (2 — зеркально по другую сторону).' }),
      f('ghostSpread', 'Конец на оси', -1, 3, 2, { section: 'Отражения (Ghosts / Iris)' }),
      f('axisX', 'Центр объектива: X', -1, 1, 0, { section: 'Отражения (Ghosts / Iris)' }),
      f('axisY', 'Центр объектива: Y', -1, 1, 0, { section: 'Отражения (Ghosts / Iris)' }),
      f('ghostSize', 'Размер', 0.005, 0.6, 0.08, { step: 0.001, section: 'Отражения (Ghosts / Iris)' }),
      f('ghostSizeRand', 'Разброс размеров', 0, 1, 0.6, { section: 'Отражения (Ghosts / Iris)' }),
      e('ghostShape', 'Форма', [['circle', 'Круг'], ['poly', 'Многоугольник (диафрагма)']], 'poly', { section: 'Отражения (Ghosts / Iris)' }),
      i('ghostBlades', 'Лепестков диафрагмы (углов)', 3, 12, 6, { section: 'Отражения (Ghosts / Iris)', visible: (p) => p.ghostShape === 'poly' }),
      f('ghostRound', 'Скругление углов', 0, 1, 0.15, { section: 'Отражения (Ghosts / Iris)', visible: (p) => p.ghostShape === 'poly' }),
      f('ghostSoft', 'Мягкость края', 0, 1, 0.3, { section: 'Отражения (Ghosts / Iris)' }),
      f('ghostRim', 'Только контур (кольцо)', 0, 1, 0.3, { section: 'Отражения (Ghosts / Iris)' }),
      e('ghostColorMode', 'Окраска', [['tint', 'Один цвет'], ['rainbow', 'Радуга по порядку'], ['random', 'Случайные оттенки']], 'rainbow', { section: 'Отражения (Ghosts / Iris)' }),
      { key: 'ghostColor', label: 'Цвет отражений', type: 'color', def: [1, 0.92, 0.82, 1], section: 'Отражения (Ghosts / Iris)' },
      f('ghostChroma', 'Хроматическая аберрация', 0, 1, 0.3, { section: 'Отражения (Ghosts / Iris)' }),

      f('sparkI', 'Сила искр', 0, 4, 0, { section: 'Искры (Sparkles)' }),
      i('sparkCount', 'Количество', 1, 64, 24, { section: 'Искры (Sparkles)' }),
      f('sparkSpread', 'Разлёт вокруг источника', 0, 1.5, 0.5, { section: 'Искры (Sparkles)' }),
      f('sparkSize', 'Размер', 0.003, 0.15, 0.02, { step: 0.001, section: 'Искры (Sparkles)' }),
      f('sparkTwinkle', 'Мигание', 0, 1, 0.8, { section: 'Искры (Sparkles)' }),

      f('dirtI', 'Сила грязи на линзе', 0, 2, 0, { section: 'Грязь на линзе (Lens dirt)' }),
      f('dirtScale', 'Масштаб пятен', 1, 20, 6, { section: 'Грязь на линзе (Lens dirt)' }),
      f('dirtRadius', 'Радиус подсветки', 0.1, 3, 0.9, { section: 'Грязь на линзе (Lens dirt)' }),
    ],
    presets: FLARE_PRESETS.map(([label, , set]) => ({ label, get apply() { return flarePreset(set); } })),
    help: 'Каждый элемент включается своей силой (0 — выключен). Свет считается в линейном пространстве и может быть ярче 1: на прозрачном фоне альфа = яркость, на чёрном — удобно для аддитивного смешивания в движке. Анимация (мерцание, вращение лучей, искры) — бесшовная петля; экспорт — «Спрайт-шит PNG».',
    seamFn: () => 'Блик привязан к точке кадра и не предназначен для повторения как тайл.',
    eval(ctx) {
      const p = ctx.params, lin = (c) => c.slice(0, 3).map(ColorUtil.toLin), deg = Math.PI / 180;
      const u = {
        u_t: Anim.t, u_loops: p.loops, u_seed: p.seed, u_int: p.brightness, u_scale: p.scale, u_blackBg: p.background === 'black', u_edgeFade: p.edgeFade,
        u_light: [p.posX, p.posY], u_axis: [p.axisX, p.axisY], u_tint: lin(p.tint), u_rot: p.rotation * deg, u_anam: p.anamorph, u_flicker: p.flicker,
        u_glowI: p.glowI, u_glowSize: p.glowSize, u_glowFall: p.glowFall, u_glowCol: lin(p.glowColor), u_coreI: p.coreI, u_coreSize: p.coreSize,
        u_raysI: p.raysI, u_raysN: p.raysCount, u_raysLen: p.raysLen, u_raysSharp: p.raysSharp, u_raysRand: p.raysRandom, u_raysAng: p.raysAngle * deg, u_raysSpin: p.raysSpin, u_raysCol: lin(p.raysColor),
        u_shimI: p.shimI, u_shimN: p.shimCount, u_shimLen: p.shimLen, u_shimSharp: p.shimSharp, u_shimSpeed: p.shimSpeed,
        u_strI: p.streakI, u_strLen: p.streakLen, u_strThick: p.streakThick, u_strHaze: p.streakHaze, u_strN: p.streakCount, u_strAng: p.streakAngle * deg, u_strCol: lin(p.streakColor),
        u_ringI: p.ringI, u_ringR: p.ringRadius, u_ringW: p.ringWidth, u_ringChroma: p.ringChroma, u_ringCol: lin(p.ringColor),
        u_ghI: p.ghostI, u_ghN: p.ghostCount, u_ghStart: p.ghostStart, u_ghSpread: p.ghostSpread, u_ghSize: p.ghostSize, u_ghSizeRand: p.ghostSizeRand,
        u_ghPoly: p.ghostShape === 'poly', u_ghBlades: p.ghostBlades, u_ghRound: p.ghostRound, u_ghSoft: p.ghostSoft, u_ghRim: p.ghostRim,
        u_ghColMode: { tint: 0, rainbow: 1, random: 2 }[p.ghostColorMode] ?? 1, u_ghCol: lin(p.ghostColor), u_ghChroma: p.ghostChroma,
        u_spI: p.sparkI, u_spN: p.sparkCount, u_spSpread: p.sparkSpread, u_spSize: p.sparkSize, u_spTw: p.sparkTwinkle,
        u_dirtI: p.dirtI, u_dirtScale: p.dirtScale, u_dirtR: p.dirtRadius,
      };
      const col = ctx.alloc();
      ctx.pass('flare', col, { ...u, u_outMode: 0 });
      if (!ctx.used(1)) return [{ tex: col, space: 'color' }, { tex: col, space: 'color' }];
      const gray = ctx.alloc();
      ctx.pass('flare', gray, { ...u, u_outMode: 1 });
      return [{ tex: col, space: 'color' }, { tex: gray, space: 'data' }];
    },
  },

  polar: {
    title: 'Полярные координаты (Polar)', cat: 'Обработка', outputs: ['Выход'],
    inputs: [{ label: 'Вход', def: BLACK, defText: 'чёрный (0,0,0,1)' }],
    desc: 'Сворачивает полосу в кольцо/круг (для магических кругов, порталов, радиальных узоров) или разворачивает круг обратно в полосу.',
    params: [
      e('mode', 'Режим', [['toPolar', 'Полоса → круг'], ['fromPolar', 'Круг → полоса']], 'toPolar'),
      f('turns', 'Повторов по кругу', 1, 16, 1, { step: 1 }),
      f('radius', 'Радиус', 0.1, 1, 1),
    ],
    help: 'Полоса → круг: ось X входа идёт по кругу (целое число повторов — без шва), ось Y — от внешнего края (верх) к центру (низ).',
    eval(ctx) {
      const p = ctx.params, out = ctx.alloc();
      const u = { u_mode: p.mode === 'toPolar' ? 0 : 1, u_turns: Math.round(p.turns), u_radius: p.radius };
      ctx.bindIn(u, 0, 0, 'native');
      ctx.pass('polar', out, u, { u_in0: 'repeat' });
      return [{ tex: out, space: ctx.space(0) || 'data' }];
    },
  },

  // ---------------------------------------------------------------- output
  output: {
    title: 'Выход (Output)', cat: 'Выход', outputs: [],
    inputs: [{ label: 'Карта', def: BLACK, defText: 'чёрный (0,0,0,1)' }],
    params: [
      e('usage', 'Назначение', [['generic', 'Обычная карта'], ['basecolor', 'Base Color (альбедо)'], ['normal', 'Normal'], ['orm', 'ORM (AO · Roughness · Metallic)']], 'generic',
        { help: 'Выходы Base Color, Normal и ORM собираются в материал для 3D-превью (кнопки 3D над предпросмотром). На экспорт не влияет.' }),
      e('normalY', 'Соглашение нормали для 3D', [['auto', 'Авто (по ноде Height to Normal)'], ['gl', 'OpenGL +Y'], ['dx', 'DirectX −Y']], 'auto', { visible: (p) => p.usage === 'normal' }),
      { key: 'filename', label: 'Имя файла', type: 'text', def: 'texture' },
    ],
    titleFn: (p) => ({ basecolor: 'Выход: Base Color', normal: 'Выход: Normal', orm: 'Выход: ORM' })[p.usage] || 'Выход (Output)',
    help: 'Экспорт PNG 8 бит RGBA без потерь. Цветные карты кодируются в sRGB, карты-данные записываются как есть. Экспорт всегда пересчитывает граф в выбранном разрешении.',
    eval(ctx) {
      const out = ctx.alloc(), u = {};
      ctx.bindIn(u, 0, 0, 'native');
      ctx.pass('copy', out, u);
      return [{ tex: out, space: ctx.space(0) || 'data' }];
    },
  },
};

// Shared by Tiler and Splatter: instances on a periodic cell grid.
function scatterEval(ctx, kind) {
  const p = ctx.params;
  let cells, perCell = 1, density, jitter, size, rowOff = 0;
  if (kind === 'tiler') {
    cells = [p.countX, p.countY];
    size = [p.sizeX, p.sizeY];            // in cell units
    density = p.density; jitter = p.posRand; rowOff = p.rowOffset;
  } else {
    const sz = [p.size, p.size * p.aspect];   // in UV
    const reach = Math.hypot(sz[0], sz[1]) * 0.5;
    const gMax = Math.max(1, Math.floor(2.5 / Math.max(reach, 1e-4)));
    let G = Math.max(1, Math.ceil(Math.sqrt(p.count)));
    if (G > gMax) G = gMax;
    perCell = Math.min(32, Math.ceil(p.count / (G * G)));
    density = p.count / (G * G * perCell);
    cells = [G, G]; jitter = 1;
    size = [sz[0] * G, sz[1] * G];
  }
  // search radius (cells) so that every instance overlapping a pixel is visited
  const diag = Math.hypot(size[0] / cells[0], size[1] / cells[1]) * 0.5;
  const ext = Math.max(diag * cells[0] + Math.abs(rowOff), diag * cells[1]) + jitter * 0.5;
  const R = Math.min(4, Math.max(1, Math.ceil(ext)));
  const u = {
    u_cells: cells, u_rowOff: rowOff, u_jitter: jitter, u_size: size, u_sizeRand: p.sizeRand, u_rot: p.rotation,
    u_rotRand: p.rotRand, u_rotSnap: !!p.rotSnap, u_valRand: p.valRand, u_density: density, u_perCell: perCell,
    u_blend: { max: 0, add: 1, top: 2 }[p.blend], u_R: R, u_pattern: { input: 0, square: 1, disc: 2, gauss: 3 }[p.pattern],
    u_bevel: p.bevel || 0, u_seed: p.seed,
  };
  ctx.bindIn(u, 0, 0, 'data');
  const outs = [0, 1].filter((mode) => ctx.used(mode)).map((mode) => {
    const out = ctx.alloc();
    ctx.pass('scatter', out, { ...u, u_out: mode }, { u_in0: 'clamp' });
    return { tex: out, space: 'data' };
  });
  return outs.length === 2 ? outs : [outs[0], outs[0]];
}

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
  const tmp = ctx.tempAt(out.size);
  ctx.pass('gauss', tmp, { ...u, u_dir: [1, 0], u_sigma: sigma, u_radius: radius, u_rep: repeat, u_premul: alphaAware, u_unpremul: false });
  const u2 = {};
  ctx.bindTex(u2, 0, { tex: tmp, space: src.space }, 'native');
  ctx.pass('gauss', out, { ...u2, u_dir: [0, 1], u_sigma: sigma, u_radius: radius, u_rep: repeat, u_premul: false, u_unpremul: alphaAware });
}

// Stable sort by position: coincident stops keep list order.
// Full parameter set for a flare preset: defaults, every element off, then the preset's own values.
function flarePreset(set) {
  const base = Object.fromEntries(NODES.flare.params.map((d) => [d.key, JSON.parse(JSON.stringify(d.def))]));
  return { ...base, ...FLARE_OFF, ...JSON.parse(JSON.stringify(set)) };
}
function fxUses(id, key) { const x = FX_LIST.find((q) => q.id === id); return !!(x && x.uses.includes(key)); }

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

// ---------------------------------------------------------------------------
// Port kinds — what an input expects / what an output produces:
//   'gray'  — one value per pixel (masks, height, noise); colour inputs are
//             reduced to luminance or a channel,
//   'color' — RGB(A) colour,
//   'any'   — works with both and keeps the kind of what comes in.
// Shown as pin colours: grey, pink, half/half.
// ---------------------------------------------------------------------------
const PORT_KINDS = {
  image: { in: [], out: ['any'] },
  constant: { in: [], out: (p) => [p.mode === 'color' ? 'color' : 'gray'] },
  noise: { in: [], out: ['gray'] }, voronoi: { in: [], out: ['gray'] }, shape: { in: [], out: ['gray'] },
  gradient: { in: [], out: ['gray'] },
  waves: { in: ['gray'], out: ['gray'] }, tiler: { in: ['gray'], out: ['gray', 'gray'] }, splatter: { in: ['gray'], out: ['gray', 'gray'] },
  levels: { in: ['any'], out: ['any'] }, invert: { in: ['any'], out: ['any'] }, grayscale: { in: ['any'], out: ['gray'] },
  ramp: { in: ['gray'], out: (p) => [p.space === 'data' ? 'any' : 'color'] }, hsv: { in: ['color'], out: ['color'] },
  blend: { in: ['any', 'any', 'gray'], out: ['any'] }, transform: { in: ['any'], out: ['any'] }, warp: { in: ['any', 'gray'], out: ['any'] },
  gaussian: { in: ['any'], out: ['any'] }, dirblur: { in: ['any'], out: ['any'] }, radialblur: { in: ['any'], out: ['any'] },
  normal: { in: ['gray'], out: ['color'] }, split: { in: ['any'], out: ['gray', 'gray', 'gray', 'gray'] },
  combine: { in: ['gray', 'gray', 'gray', 'gray'], out: ['color'] }, code: { in: ['any', 'any', 'any', 'any'], out: ['any'] },
  output: { in: ['any'], out: [] },
  fx: { in: [], out: ['color', 'gray'] }, flare: { in: [], out: ['color', 'gray'] }, glow: { in: ['any'], out: ['any', 'any'] }, polar: { in: ['any'], out: ['any'] },
};
const KIND_TEXT = { gray: 'оттенки серого', color: 'цвет', any: 'серое или цвет' };
function portKind(node, dir, k) {
  const pk = PORT_KINDS[node.type];
  if (!pk) return 'any';
  const list = typeof pk[dir] === 'function' ? pk[dir](node.params) : pk[dir];
  return (list && list[k]) || 'any';
}

// One-line descriptions (catalog tooltip, PTL.nodeTypes()).
const NODE_DESC = {
  image: 'Загруженный PNG/JPEG: фото, альбедо (Цвет sRGB) или готовые маски/нормали (Данные).',
  constant: 'Однородное серое значение или цвет RGBA.',
  shape: 'Одна фигура: круг/эллипс, прямоугольник, кольцо с мягким краем; для Tiler/Splatter и масок.',
  gradient: 'Линейный, радиальный или угловой градиент — маски перехода, виньетки.',
  levels: 'Уровни: входные чёрная/белая точки, гамма, выходной диапазон; также порог (одинаковые точки).',
  invert: 'Инверсия выбранных каналов (1 − x).',
  grayscale: 'Цвет → серое: яркость или отдельный канал.',
  ramp: 'Раскраска серого по градиенту из 2–8 цветов (gradient map). Главный способ получить цвет из масок.',
  hsv: 'Сдвиг тона, насыщенность и яркость цветного изображения.',
  blend: 'Смешивание двух изображений (Mix/Add/Multiply/Screen/Min/Max) с силой и маской.',
  transform: 'Сдвиг, масштаб и поворот с повтором или обрезкой краёв.',
  gaussian: 'Гауссово размытие в два прохода с переносом через края.',
  dirblur: 'Размытие вдоль направления — штрихи, дождь, шлифовка.',
  radialblur: 'Размытие от центра (Zoom) или по кругу (Spin).',
  normal: 'Карта высот → tangent-space normal map (OpenGL/DirectX).',
  split: 'Разделить RGBA на четыре серые карты.',
  combine: 'Упаковать 4 серые карты в каналы RGBA (ORM, HDRP Mask, свой вариант).',
  code: 'Своя GLSL-функция на пиксель: 4 входа, 4 ползунка — любой узор или операция, которых нет среди нод.',
  output: 'Финальная карта для экспорта в PNG (имя файла).',
};
for (const t in NODES) if (!NODES[t].desc) NODES[t].desc = NODE_DESC[t] || '';

function nodeTitle(node) {
  const def = NODES[node.type];
  return def.titleFn ? def.titleFn(node.params) : def.title;
}

// Extra catalog entries: pre-configured nodes.
const CATALOG_EXTRA = [
  { type: 'output', title: 'Выход: Base Color', params: { usage: 'basecolor', filename: 'basecolor' }, desc: 'Выход цвета (альбедо) материала: экспорт PNG + 3D-превью.' },
  { type: 'output', title: 'Выход: Normal', params: { usage: 'normal', filename: 'normal' }, desc: 'Выход normal map материала: экспорт PNG + 3D-превью.' },
  { type: 'output', title: 'Выход: ORM', params: { usage: 'orm', filename: 'orm' }, desc: 'Выход ORM (R=AO, G=Roughness, B=Metallic): экспорт PNG + 3D-превью.' },
];

// Ready-made noises for the «Шумы» catalog section (regular nodes with tuned parameters).
const NOISE_PRESETS = [
  ['Облака (Clouds)', 'noise', { type: 'perlin', scale: 4, octaves: 7, persistence: 0.55, contrast: 1.35 }, 'Классический fBM Perlin: облака, пятна, вариации цвета.', 'Мягкие'],
  ['Мягкий Perlin', 'noise', { type: 'perlin', scale: 3, octaves: 3, persistence: 0.4 }, 'Крупные плавные пятна без мелкой детали.', 'Мягкие'],
  ['Мелкий Perlin', 'noise', { type: 'perlin', scale: 24, octaves: 4 }, 'Мелкая детализация поверхности, микрорельеф.', 'Мягкие'],
  ['Value Noise', 'noise', { type: 'value', scale: 8, octaves: 5 }, 'Более «квадратный» шум значений.', 'Мягкие'],
  ['Горы / гребни (Ridged)', 'noise', { type: 'perlin', fractal: 'ridged', scale: 3, octaves: 8, persistence: 0.55 }, 'Острые хребты: горы, скалы, прожилки.', 'Рельеф'],
  ['Прожилки / вены', 'noise', { type: 'perlin', fractal: 'ridged', scale: 4, octaves: 5, persistence: 0.35, contrast: 1.6 }, 'Тонкие ветвящиеся линии: вены, молнии, трещины льда.', 'Рельеф'],
  ['Клубы (Billow)', 'noise', { type: 'perlin', fractal: 'billow', scale: 4, octaves: 6 }, 'Округлые «клубы»: камни, дым, кучевые облака.', 'Рельеф'],
  ['Турбулентность', 'noise', { type: 'perlin', fractal: 'billow', scale: 6, octaves: 7, persistence: 0.6, contrast: 1.4 }, 'Бурлящий шум: огонь, вода, энергия.', 'Рельеф'],
  ['Мрамор', 'noise', { type: 'perlin', fractal: 'ridged', scale: 2, octaves: 6, warp: 0.7, warpScale: 2, contrast: 1.3 }, 'Искажённые прожилки мрамора.', 'Органика'],
  ['Текучий (Domain Warp)', 'noise', { type: 'perlin', scale: 3, octaves: 6, warp: 0.6, warpScale: 3 }, 'Органичные «перетекающие» формы: жидкости, туманности.', 'Органика'],
  ['Туман / дым', 'noise', { type: 'perlin', fractal: 'billow', scale: 2, octaves: 7, warp: 0.4, warpScale: 2, contrast: 0.8 }, 'Мягкий клубящийся туман.', 'Органика'],
  ['Грязь / гранж', 'noise', { type: 'perlin', scale: 6, octaves: 8, persistence: 0.6, contrast: 2.4, warp: 0.25 }, 'Контрастные пятна для грязи, износа, ржавчины.', 'Органика'],
  ['Пятна', 'noise', { type: 'worley', scale: 5, octaves: 2, invert: true, contrast: 2 }, 'Круглые пятна: капли, лишайник, плесень.', 'Органика'],
  ['Шум Ворли (Worley)', 'noise', { type: 'worley', scale: 6, octaves: 1 }, 'Клеточный шум расстояний.', 'Клетки'],
  ['Клеточный fBM', 'noise', { type: 'worley', scale: 4, octaves: 4, persistence: 0.5 }, 'Многоуровневые клетки: кожа, губка, пена.', 'Клетки'],
  ['Белый шум', 'noise', { type: 'white', grain: 1, octaves: 1 }, 'Случайное значение на пиксель.', 'Зерно'],
  ['Зерно / плёнка', 'noise', { type: 'white', grain: 1, octaves: 3, contrast: 0.6 }, 'Мелкое зерно: песок, штукатурка, плёнка.', 'Зерно'],
  ['Пиксельный шум', 'noise', { type: 'white', grain: 16, octaves: 1 }, 'Крупные случайные квадраты.', 'Зерно'],
  ['Шлифованный металл', 'noise', { type: 'value', scale: 2, stretch: 8, octaves: 5, persistence: 0.6 }, 'Длинные горизонтальные волокна.', 'Вытянутые'],
  ['Волокна дерева', 'noise', { type: 'perlin', scale: 2, stretch: 6, octaves: 6, warp: 0.2 }, 'Вытянутые волнистые волокна.', 'Вытянутые'],
  ['Штрихи / дождь', 'noise', { type: 'value', scale: 32, stretch: 0.125, octaves: 3, contrast: 1.8 }, 'Вертикальные штрихи: дождь, потёки.', 'Вытянутые'],
  ['Дюны / песок', 'noise', { type: 'perlin', fractal: 'ridged', scale: 2, stretch: 3, octaves: 5, warp: 0.35 }, 'Песчаные гряды.', 'Рельеф'],
  ['Ячейки (F1)', 'voronoi', { mode: 'f1', scale: 8 }, 'Расстояние до ближайшей точки.', 'Клетки'],
  ['Трещины (F2−F1)', 'voronoi', { mode: 'crackle', scale: 6 }, 'Сеть трещин, высохшая земля.', 'Клетки'],
  ['Камни / плитняк', 'voronoi', { mode: 'border', scale: 6, randomness: 0.85 }, 'Выпуклые ячейки с швами.', 'Клетки'],
  ['Мозаика', 'voronoi', { mode: 'cell', scale: 10 }, 'Случайное значение в каждой ячейке.', 'Клетки'],
  ['Кристаллы (Чебышёв)', 'voronoi', { mode: 'f1', metric: 'chebyshev', scale: 7 }, 'Квадратные грани.', 'Клетки'],
  ['Ромбы (Манхэттен)', 'voronoi', { mode: 'f2', metric: 'manhattan', scale: 6 }, 'Ромбовидные ячейки.', 'Клетки'],
  ['Полосы (синус)', 'waves', { shape: 'sine', countX: 8, countY: 0 }, 'Плавные полосы.', 'Полосы'],
  ['Волны с искажением', 'waves', { shape: 'sine', countX: 0, countY: 12, distort: 3 }, 'Полосы, изогнутые шумом (подключите шум ко входу).', 'Полосы'],
];
const NOISE_GROUPS = ['Мягкие', 'Рельеф', 'Органика', 'Клетки', 'Зерно', 'Вытянутые', 'Полосы'];
