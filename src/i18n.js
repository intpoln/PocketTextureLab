// ---------------------------------------------------------------------------
// Industry-standard English names for nodes, ports, parameters, options and
// presets (as in Substance Designer, Houdini, After Effects, Photoshop).
// Applied once at load: the English name becomes the display name, the
// Russian one is kept in `.ru` and is shown as a tooltip and matched by
// search, so both «размытие» and «blur» find Gaussian Blur. Stored projects
// only hold node types, parameter keys and option values, so nothing changes
// for existing files. The UI chrome and help texts stay in Russian.
// ---------------------------------------------------------------------------
const I18N = (() => {
  const TITLE = {
    image: 'Image', constant: 'Uniform Color', noise: 'Noise', voronoi: 'Voronoi', shape: 'Shape', gradient: 'Gradient',
    waves: 'Waves', tiler: 'Tile Sampler', splatter: 'Splatter', levels: 'Levels', invert: 'Invert', grayscale: 'Grayscale',
    ramp: 'Gradient Map', hsv: 'Hue / Saturation', blend: 'Blend', transform: 'Transform 2D', warp: 'Warp',
    gaussian: 'Gaussian Blur', dirblur: 'Directional Blur', radialblur: 'Radial Blur', glow: 'Glow', normal: 'Height to Normal',
    split: 'Split RGBA', combine: 'Combine RGBA', code: 'GLSL Code', fx: 'FX Effect', flare: 'Optical Flare', polar: 'Polar Coordinates', output: 'Output',
  };
  const CAT = {
    'Источники': 'Generators', 'Узоры': 'Patterns', 'Эффекты': 'Effects', 'Обработка': 'Adjustments', 'Размытие': 'Blur & Glow',
    'Нормали': 'Normal', 'Каналы': 'Channels', 'Код': 'Code', 'Выход': 'Output',
  };
  const PORT = {
    'Цвет': 'Color', 'Значение': 'Value', 'Шум': 'Noise', 'Ячейки': 'Cells', 'Маска': 'Mask', 'Градиент': 'Gradient', 'Волны': 'Waves',
    'Узор': 'Pattern', 'Случайное': 'Random', 'Выход': 'Output', 'Серый': 'Gray', 'Только свечение': 'Glow Only', 'Интенсивность': 'Intensity',
    'Искажение': 'Warp Map', 'Вход': 'Input', 'A (фон)': 'Background (A)', 'B (слой)': 'Foreground (B)', 'Карта': 'Map', 'Высота': 'Height',
  };
  const LABEL = {
    'Файл': 'File', 'Интерпретация': 'Color Space', 'Приведение к размеру проекта': 'Fit to Project Size', 'Края при фильтрации': 'Filter Edges',
    'Режим': 'Mode', 'Значение': 'Value', 'Цвет': 'Color', 'Тип': 'Type', 'Фрактал': 'Fractal', 'Бесшовный (Tileable)': 'Tileable',
    'Масштаб (Scale)': 'Scale', 'Размер зерна (px проекта)': 'Grain Size (px)', 'Растяжение по Y (×)': 'Stretch Y', 'Seed': 'Seed',
    'Детализация (Detail, октавы)': 'Octaves', 'Шероховатость шума (Persistence)': 'Roughness', 'Лакунарность (×частота на октаву)': 'Lacunarity',
    'Искажение (Domain Warp)': 'Domain Warp', 'Масштаб искажения': 'Warp Scale', 'Эволюция (анимация)': 'Evolution', 'Контраст (Contrast)': 'Contrast',
    'Инвертировать': 'Invert', 'Метрика расстояния': 'Distance Metric', 'Случайность (Randomness)': 'Disorder', 'Фигура': 'Shape',
    'Размер X': 'Size X', 'Размер Y': 'Size Y', 'Позиция X': 'Position X', 'Позиция Y (вниз)': 'Position Y', 'Поворот, °': 'Rotation',
    'Мягкость края': 'Edge Softness', 'Толщина кольца': 'Ring Thickness', 'Переносить через края (Repeat)': 'Wrap Around',
    'Центр X': 'Center X', 'Центр Y (вниз)': 'Center Y', 'Повторение': 'Repeat', 'Инвертировать (Invert)': 'Invert', 'Форма': 'Shape',
    'Раскладка': 'Layout', 'Периодов по X': 'Frequency X', 'Периодов по Y': 'Frequency Y', 'Колец': 'Rings', 'Фаза': 'Phase',
    'Заполнение меандра': 'Duty Cycle', 'Сила искажения': 'Distortion', 'Копий по X': 'X Amount', 'Копий по Y': 'Y Amount',
    'Сдвиг чётных рядов (доля ячейки)': 'Row Offset', 'Размер X (доля ячейки)': 'Scale X', 'Размер Y (доля ячейки)': 'Scale Y',
    'Фаска (Bevel)': 'Bevel', 'Случайная позиция': 'Position Random', 'Случайный размер': 'Size Random', 'Случайный поворот, ±°': 'Rotation Random',
    'Поворот только на 90°': 'Rotation Snap 90°', 'Случайная яркость': 'Luminance Random', 'Заполненность': 'Density',
    'Наложение копий': 'Blending Mode', 'Количество': 'Amount', 'Размер (доля текстуры)': 'Size', 'Вытянутость (Y/X)': 'Aspect Ratio',
    'Фаска / мягкость': 'Bevel / Softness', 'Вход: чёрная точка': 'Input Black', 'Вход: белая точка': 'Input White', 'Гамма (Gamma)': 'Gamma',
    'Выход: чёрный': 'Output Black', 'Выход: белый': 'Output White', 'Применять к альфе': 'Affect Alpha', 'Источник': 'Source',
    'Сохранить альфу': 'Keep Alpha', 'Точки': 'Gradient Stops', 'Интерполяция': 'Interpolation', 'Входное значение': 'Input Space',
    'Выход': 'Output Space', 'Тон (Hue), °': 'Hue', 'Насыщенность (Saturation) ×': 'Saturation', 'Яркость (Value) ×': 'Lightness',
    'Сила (Opacity)': 'Opacity', 'Альфа': 'Alpha Blending', 'Смещение X': 'Offset X', 'Смещение Y (вниз)': 'Offset Y', 'Масштаб X': 'Scale X',
    'Масштаб Y': 'Scale Y', 'Края': 'Tiling Mode', 'Сила': 'Intensity', 'Угол, °': 'Angle', 'Радиус (σ, px проекта)': 'Radius (σ, px)',
    'С учётом альфы (для цветных изображений с прозрачностью)': 'Alpha Aware', 'Длина (px проекта)': 'Length (px)', 'С учётом альфы': 'Alpha Aware',
    'Качество (выборок)': 'Quality (Samples)', 'Порог яркости': 'Threshold', 'Мягкость порога': 'Threshold Knee', 'Оттенок свечения': 'Glow Tint',
    'Свечение расширяет альфу (спрайты)': 'Extend Alpha', 'Источник высоты': 'Height Source', 'Сила (Strength)': 'Intensity',
    'Предв. сглаживание (σ, px проекта)': 'Pre-Blur (σ, px)', 'Инвертировать высоту': 'Invert Height', 'Соглашение Y': 'Normal Format',
    'Дополнительно инвертировать X (красный)': 'Invert X (Red)', 'Пресет': 'Preset',
    'R: источник': 'R Source', 'R: константа / по умолчанию': 'R Default', 'R: инвертировать (1−x)': 'R Invert',
    'G: источник': 'G Source', 'G: константа / по умолчанию': 'G Default', 'G: инвертировать (1−x)': 'G Invert',
    'B: источник': 'B Source', 'B: константа / по умолчанию': 'B Default', 'B: инвертировать (1−x)': 'B Invert',
    'A: источник': 'A Source', 'A: константа / по умолчанию': 'A Default', 'A: инвертировать (1−x)': 'A Invert',
    'GLSL-код': 'GLSL Code', 'Эффект': 'Effect', 'Палитра (интенсивность → цвет и альфа)': 'Color Gradient', 'Яркость': 'Brightness',
    'Размер': 'Size', 'Циклов за анимацию': 'Loops', 'Детализация (октавы)': 'Octaves', 'Количество (искры, лучи, рукава, смены формы)': 'Count',
    'Толщина': 'Thickness', 'Искажение': 'Distortion', 'Закрутка / поворот': 'Twist', 'Фон': 'Background',
    'Источник: X': 'Light Position X', 'Источник: Y': 'Light Position Y', 'Общая яркость': 'Brightness', 'Общий оттенок': 'Global Tint',
    'Поворот (°)': 'Rotation', 'Анаморфность (растяжение по X)': 'Anamorphic', 'Мерцание яркости': 'Flicker', 'Гасить к краям кадра (спрайты)': 'Edge Fade',
    'Сила свечения': 'Glow Intensity', 'Радиус свечения': 'Glow Radius', 'Спад (больше — плотнее к центру)': 'Glow Falloff', 'Цвет свечения': 'Glow Color',
    'Яркость ядра': 'Hotspot Intensity', 'Размер ядра': 'Hotspot Size', 'Сила лучей': 'Rays Intensity', 'Число лучей': 'Rays Count', 'Длина': 'Length',
    'Острота': 'Sharpness', 'Случайность длины и яркости': 'Randomness', 'Угол (°)': 'Angle', 'Вращение (шагов за цикл)': 'Spin (steps per loop)',
    'Цвет лучей': 'Rays Color', 'Сила мерцающих лучей': 'Shimmer Intensity', 'Плотность лучиков': 'Shimmer Density', 'Резкость': 'Sharpness',
    'Скорость (0 — неподвижно)': 'Speed', 'Сила полосы': 'Streak Intensity', 'Дымка вокруг полосы': 'Haze', 'Число полос (крест, звезда)': 'Streak Count',
    'Цвет полосы': 'Streak Color', 'Сила кольца': 'Ring Intensity', 'Радиус': 'Radius', 'Ширина': 'Width', 'Радужная кайма': 'Chromatic Fringe',
    'Цвет кольца': 'Ring Color', 'Сила отражений': 'Ghosts Intensity', 'Начало на оси': 'Axis Start', 'Конец на оси': 'Axis End',
    'Центр объектива: X': 'Lens Center X', 'Центр объектива: Y': 'Lens Center Y', 'Разброс размеров': 'Size Random',
    'Лепестков диафрагмы (углов)': 'Aperture Blades', 'Скругление углов': 'Roundness', 'Только контур (кольцо)': 'Outline',
    'Окраска': 'Coloring', 'Цвет отражений': 'Ghosts Color', 'Хроматическая аберрация': 'Chromatic Aberration', 'Сила искр': 'Sparkles Intensity',
    'Разлёт вокруг источника': 'Spread', 'Мигание': 'Twinkle', 'Сила грязи на линзе': 'Lens Dirt Intensity', 'Масштаб пятен': 'Dirt Scale',
    'Радиус подсветки': 'Illumination Radius', 'Повторов по кругу': 'Repeat Around', 'Назначение': 'Usage', 'Соглашение нормали для 3D': 'Normal Format (3D)',
    'Имя файла': 'File Name',
    'Семейство': 'Family', 'Сдвиг X': 'Offset X', 'Сдвиг Y': 'Offset Y', 'Поворот градиентов, °': 'Gradient Rotation',
    'Адвекция (снос деталей)': 'Advection', 'Элемент': 'Element', 'Размер элемента (доля клетки)': 'Element Size',
    'Жёсткость края': 'Edge Hardness', 'Вытянутость': 'Elongation', 'Плотность (доля клеток с элементом)': 'Density',
    'Элементов в клетке': 'Elements per Cell', 'Разброс размера': 'Size Variation', 'Разброс положения': 'Position Variation',
    'Направление, °': 'Direction', 'Разброс направления': 'Direction Variation', 'Разброс яркости': 'Luminance Variation',
    'Смешивание в слое': 'Blend within Layer', 'Смешивание слоёв': 'Blend Layers', 'Мягкость стыков': 'Blend Smoothness',
    'Гасить неразличимую деталь (LOD)': 'Anti-alias Detail (LOD)', 'Уровней искажения': 'Warp Levels', 'Эволюция (morph)': 'Evolution (Morph)',
    'Искажение тоже эволюционирует': 'Evolve Warp', 'Течение: оборотов за цикл': 'Flow Turns per Loop', 'Баланс (сдвиг яркости)': 'Balance',
    'Ограничить 0…1': 'Clamp 0–1',
  };
  const OPT = {
    'Цвет sRGB (Color)': 'Color (sRGB)', 'Данные каналов (Data)': 'Data (linear)', 'Растянуть (Stretch)': 'Stretch', 'Заполнить с обрезкой (Cover)': 'Cover (crop)',
    '1:1 без масштаба, повтор (Tile)': 'Tile 1:1', 'Повтор (Repeat)': 'Repeat', 'Край (Clamp)': 'Clamp', 'Прозрачно за краем (Border)': 'Border (transparent)', 'Серое значение (данные)': 'Grayscale',
    'Цвет RGBA (sRGB)': 'Color RGBA', 'Градиентный (Perlin)': 'Perlin', 'Клеточный (Worley)': 'Worley', 'Белый шум (White)': 'White Noise',
    'Обычный (fBM) — облака': 'fBM', 'Гребни (Ridged) — горы, трещины': 'Ridged', 'Клубы (Billow) — камни, дым': 'Billow',
    'Расстояние до точки (F1)': 'F1 Distance', 'До второй точки (F2)': 'F2 Distance', 'Трещины (F2 − F1)': 'Crackle (F2 − F1)',
    'Границы ячеек (Borders)': 'Borders', 'Значение ячейки (Cell)': 'Cell Value', 'Евклидова — круглые': 'Euclidean', 'Манхэттен — ромбы': 'Manhattan',
    'Чебышёв — квадраты': 'Chebyshev', 'Круг / эллипс': 'Disc', 'Прямоугольник': 'Square', 'Кольцо': 'Ring', 'Линейный (Linear)': 'Linear',
    'Радиальный (Radial)': 'Radial', 'Угловой (Angular)': 'Angular', 'Нет (Clamp)': 'Clamp', 'Зеркально (Mirror)': 'Mirror', 'Синус': 'Sine',
    'Треугольник': 'Triangle', 'Пила': 'Sawtooth', 'Меандр (Square)': 'Square', 'Линейные (бесшовно)': 'Linear (tileable)', 'Кольца от центра': 'Concentric',
    'Круг': 'Disc', 'Мягкое пятно': 'Gaussian', 'Со входа «Узор»': 'From Pattern Input', 'Максимум (Max)': 'Max (Lighten)', 'Сложение (Add)': 'Add (Linear Dodge)',
    'Сверху — случайный порядок': 'Copy (random order)', 'Яркость (Luminance)': 'Luminance', 'Линейная (Linear)': 'Linear', 'Плавная (Smooth)': 'Smooth',
    'Ступенчатая (Constant)': 'Constant', 'Канал R': 'R Channel', 'Цвет sRGB': 'Color (sRGB)', 'Данные': 'Data (linear)', 'Замена (Mix)': 'Normal (Copy)',
    'Умножение (Multiply)': 'Multiply', 'Экран (Screen)': 'Screen', 'Минимум (Min)': 'Min (Darken)', 'Та же формула, что для RGB': 'Blend Like RGB',
    'Взять из A': 'Keep Background', 'Направленный (Directional)': 'Directional', 'По градиенту карты (Warp)': 'Gradient (Slope)', 'Приближение (Zoom)': 'Zoom',
    'Вращение (Spin)': 'Spin', 'OpenGL (+Y, зелёный вверх)': 'OpenGL (Y+)', 'DirectX (−Y, зелёный вниз)': 'DirectX (Y−)',
    'ORM (R=AO, G=Roughness, B=Metallic, A=1)': 'ORM (AO, Roughness, Metallic)', 'Unity HDRP Mask (R=Metallic, G=AO, B=Detail, A=Smoothness)': 'Unity HDRP Mask Map',
    'Свой (Custom RGBA)': 'Custom', 'R входа': 'Input R', 'G входа': 'Input G', 'B входа': 'Input B', 'A входа': 'Input A', 'Яркость входа': 'Input Luminance',
    'Константа': 'Constant', 'Данные (числа каналов)': 'Data (linear)',
    'Пламя (свеча)': 'Candle Flame', 'Огонь (стена)': 'Fire Wall', 'Взрыв (однократно)': 'Explosion', 'Дым (клуб, однократно)': 'Smoke Puff',
    'Дым (столб, петля)': 'Smoke Column', 'Искры (разлёт)': 'Sparks Burst', 'Искры (фонтан, петля)': 'Sparks Fountain', 'Молния': 'Lightning',
    'Электрические дуги': 'Electric Arcs', 'Вспышка / солнце': 'Sun Flash', 'Блик-звезда (мерцание)': 'Twinkle Star', 'Ударная волна (однократно)': 'Shockwave',
    'Магический круг': 'Magic Circle', 'Энергетическая сфера': 'Energy Orb', 'Портал / вихрь': 'Portal Vortex', 'Лазерный луч': 'Laser Beam',
    'Удар / слэш (однократно)': 'Slash', 'Облако': 'Cloud', 'Каустика (вода)': 'Caustics',
    'Прозрачный (альфа из палитры)': 'Transparent', 'Чёрный (для аддитивного смешивания)': 'Black (additive)',
    'Чёрный (аддитивное смешивание, как в VFX)': 'Black (additive)', 'Прозрачный (альфа = яркость)': 'Transparent (alpha = luminance)',
    'Многоугольник (диафрагма)': 'Polygon (aperture)', 'Один цвет': 'Single Color', 'Радуга по порядку': 'Rainbow', 'Случайные оттенки': 'Random Hue',
    'Полоса → круг': 'Rectangular to Polar', 'Круг → полоса': 'Polar to Rectangular', 'Обычная карта': 'Generic', 'Base Color (альбедо)': 'Base Color',
    'Авто (по ноде Height to Normal)': 'Auto (from Height to Normal)',
    'Текучий (Flow)': 'Flow', 'Фрактал пятен (Splat Fractal)': 'Splat Fractal', 'Конус': 'Cone', 'Штрих (вытянутый)': 'Streak',
    'Сложение (мягкое насыщение)': 'Add (soft saturation)', 'Плавный максимум (Smooth Max)': 'Smooth Max', 'Взвешенная сумма (как fBM)': 'Weighted Sum (fBM)',
  };
  const GROUP = {
    'Зацикленные': 'Looping', 'Однократные': 'One-shot', 'Оптические блики (Optical Flares)': 'Optical Flares',
    'Мягкие': 'Soft', 'Рельеф': 'Ridges & Relief', 'Органика': 'Organic', 'Клетки': 'Cells', 'Зерно': 'Grain', 'Вытянутые': 'Anisotropic',
  };
  const NOISE = {
    'Мягкий Perlin': 'Soft Perlin', 'Мелкий Perlin': 'Fine Perlin', 'Прожилки / вены': 'Veins', 'Турбулентность': 'Turbulence', 'Мрамор': 'Marble',
    'Туман / дым': 'Fog', 'Грязь / гранж': 'Grunge', 'Пятна': 'Spots', 'Клеточный fBM': 'Cellular fBM', 'Белый шум': 'White Noise',
    'Зерно / плёнка': 'Film Grain', 'Пиксельный шум': 'Pixel Noise', 'Шлифованный металл': 'Brushed Metal', 'Волокна дерева': 'Wood Fibers',
    'Штрихи / дождь': 'Streaks / Rain', 'Дюны / песок': 'Dunes', 'Ячейки (F1)': 'Cells (F1)', 'Трещины (F2−F1)': 'Crackle', 'Камни / плитняк': 'Flagstones',
    'Мозаика': 'Mosaic', 'Кристаллы (Чебышёв)': 'Crystals', 'Полосы': 'Stripes',
  };
  // «Русское (English)» -> English
  const paren = (s) => { const m = /^(.*?)\s*\(([^()]*[A-Za-z][^()]*)\)\s*$/.exec(s); return m ? m[2] : null; };
  const tr = (map, s) => map[s] || paren(s) || s;
  const ruOnly = (s) => s.replace(/\s*\(([^()]*[A-Za-z][^()]*)\)\s*$/, '');   // «Размытие по Гауссу (Gaussian Blur)» -> «Размытие по Гауссу»

  for (const [type, d] of Object.entries(NODES)) {
    d.ru = ruOnly(d.title);
    d.title = TITLE[type] || tr({}, d.title);
    d.outputsRu = d.outputs;
    d.outputs = d.outputs.map((o) => PORT[o] || o);
    for (const inp of d.inputs) { if (PORT[inp.label]) { inp.ru = inp.label; inp.label = PORT[inp.label]; } }
    for (const q of d.params) {
      if (LABEL[q.label]) { q.ru = ruOnly(q.label); q.label = LABEL[q.label]; }
      if (q.options) q.options = q.options.map(([v, l]) => [v, OPT[l] || l]);
      if (q.section) q.section = paren(q.section) || q.section;
    }
  }
  NODES.output.titleFn = (p) => ({ basecolor: 'Output: Base Color', normal: 'Output: Normal', orm: 'Output: ORM' })[p.usage] || 'Output';
  for (const x of CATALOG_EXTRA) x.title = x.title.replace('Выход:', 'Output:');
  for (const fx of FX_LIST) { fx.ru = fx.title; fx.title = OPT[fx.title] || fx.title; }
  for (const n of NOISE_PRESETS) { n[5] = ruOnly(n[0]); n[0] = NOISE[n[0]] || paren(n[0]) || n[0]; n[4] = GROUP[n[4]] || n[4]; }
  for (const f of FLARE_PRESETS) { f[3] = ruOnly(f[0]); f[0] = paren(f[0]) || f[0]; }
  NODES.flare.presets.forEach((pr, k) => { pr.ru = FLARE_PRESETS[k][3]; pr.label = FLARE_PRESETS[k][0]; });

  return { cat: (c) => CAT[c] || c, group: (g) => GROUP[g] || g };
})();
