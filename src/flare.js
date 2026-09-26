// ---------------------------------------------------------------------------
// Optical flare generator ("Оптический блик (Optical Flare)" node).
// Built from the classic lens-flare elements (as in Optical Flares / Knoll
// Light Factory): glow and hot core, rays (starburst), shimmer (fine animated
// rays), anamorphic streaks, ring with chromatic fringes, ghosts / multi-iris
// along the optical axis (circles or aperture polygons), sparkles and lens
// dirt. Light is additive, computed in linear space and may exceed 1 (HDR).
// Animation (shimmer, flicker, sparkles, ray spin) is periodic in the loop
// phase, so sprite sheets loop seamlessly; the light position can be animated
// with ⏱ like any parameter — ghosts then travel against it.
// ---------------------------------------------------------------------------
SHADERS.define('flare', {
  nin: 0,
  body: FX_HELPERS + `
uniform bool u_edgeFade;
uniform vec2 u_light;
uniform vec2 u_axis;
uniform vec3 u_tint;
uniform float u_rot, u_anam, u_flicker;
uniform float u_glowI, u_glowSize, u_glowFall, u_coreI, u_coreSize;
uniform vec3 u_glowCol;
uniform float u_raysI, u_raysLen, u_raysSharp, u_raysRand, u_raysAng;
uniform int u_raysN, u_raysSpin;
uniform vec3 u_raysCol;
uniform float u_shimI, u_shimLen, u_shimSharp;
uniform int u_shimN, u_shimSpeed;
uniform float u_strI, u_strLen, u_strThick, u_strAng, u_strHaze;
uniform int u_strN;
uniform vec3 u_strCol;
uniform float u_ringI, u_ringR, u_ringW, u_ringChroma;
uniform vec3 u_ringCol;
uniform float u_ghI, u_ghStart, u_ghSpread, u_ghSize, u_ghSizeRand, u_ghRound, u_ghSoft, u_ghRim, u_ghChroma;
uniform int u_ghN, u_ghBlades, u_ghColMode;
uniform bool u_ghPoly;
uniform vec3 u_ghCol;
uniform float u_spI, u_spSpread, u_spSize, u_spTw;
uniform int u_spN;
uniform float u_dirtI, u_dirtScale, u_dirtR;

vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
// normalized radius of a regular n-gon (vertices at radius 1), blended to a circle by 'rnd'
float polyR(vec2 q, int n, float rnd) {
  float r = length(q), fn = float(max(n, 3)), sec = TAU / fn;
  float a = atan(q.y, abs(q.x) < 1e-7 ? 1e-7 : q.x);
  float m = a - sec * floor(a / sec) - sec * 0.5;
  return mix(r * cos(m) / cos(PI / fn), r, rnd);
}
float ghostShape(float nr) {
  float fill = 1.0 - smoothstep(0.98 - u_ghSoft * 0.7, 1.0, nr);
  float edge = exp(-pow((nr - 0.97) / (0.035 + u_ghSoft * 0.15), 2.0));
  return mix(fill, max(fill * 0.2, edge), u_ghRim);
}
float star4(vec2 q, float s) {
  float r = length(q);
  return exp(-r / (s * 0.35)) + 0.6 * (exp(-abs(q.x) / (s * 0.06)) * exp(-abs(q.y) / (s * 1.4)) + exp(-abs(q.y) / (s * 0.06)) * exp(-abs(q.x) / (s * 1.4)));
}

void main() {
  vec2 uv = pixUV();
  vec2 p = vec2(uv.x - 0.5, 0.5 - uv.y) * 2.0;
  float T = fract(u_t * float(u_loops));
  float S = max(u_scale, 1e-3);
  vec2 d = (p - u_light) / S;              // light-relative, scaled
  vec2 da = vec2(d.x / max(u_anam, 1e-3), d.y);
  float r = length(d), ra = length(da);
  vec3 col = vec3(0.0);

  // glow + hot core
  if (u_glowI > 0.0) {
    float gs = max(u_glowSize, 1e-4), gl = pow(max(1.0 - ra / gs, 0.0), u_glowFall);
    col += u_glowCol * u_glowI * gl * (0.55 + 0.45 * exp(-ra / (gs * 0.08)));   // soft halo + denser inner bloom
  }
  if (u_coreI > 0.0) col += mix(u_glowCol, vec3(1.0), 0.75) * u_coreI * exp(-ra / max(u_coreSize, 1e-4));

  // rays (starburst): n spikes, random lengths, optional spin by whole spike steps
  float a = atan(d.y, abs(d.x) < 1e-7 ? 1e-7 : d.x);   // atan(0,0) is undefined on some GPUs
  if (u_raysI > 0.0 && u_raysLen > 0.0) {
    float n = float(max(u_raysN, 1));
    float ar = a - u_raysAng - u_rot - T * TAU * float(u_raysSpin) / n;
    int k = int(mod(floor(ar / TAU * n + 0.5), n));
    float len = u_raysLen * mix(1.0, 0.25 + 0.75 * hsh1(k, 11), u_raysRand);
    float spike = pow(0.5 + 0.5 * cos(n * ar), u_raysSharp * (1.0 + r * 5.0));
    float fall = pow(max(1.0 - r / len, 0.0), 2.0);
    col += u_raysCol * u_raysI * spike * fall * mix(1.0, 0.4 + 0.6 * hsh1(k, 12), u_raysRand);
  }

  // shimmer: many thin rays from periodic angular noise, evolving over the loop
  if (u_shimI > 0.0 && u_shimLen > 0.0) {
    int M = max(u_shimN, 2);
    float x = fract(a / TAU) * float(M);
    float z = T * float(u_shimSpeed);
    float nz = vn3(vec3(x, 0.5, z), ivec3(M, 0, u_shimSpeed)) * 0.65 + vn3(vec3(x * 2.0, 3.5, z + 7.0), ivec3(M * 2, 0, u_shimSpeed)) * 0.35;
    float lenMod = 0.55 + 0.45 * vn3(vec3(x * 0.5, 9.5, z), ivec3(max(M / 2, 1), 0, u_shimSpeed));
    float fall = pow(max(1.0 - r / (u_shimLen * lenMod), 0.0), 2.0);
    col += mix(u_raysCol, vec3(1.0), 0.3) * u_shimI * pow(nz, u_shimSharp) * fall * (0.35 + 0.65 / (1.0 + r * 6.0)) * 2.0;
  }

  // anamorphic streaks
  if (u_strI > 0.0 && u_strLen > 0.0) {
    int N = max(u_strN, 1);
    for (int j = 0; j < 4; j++) {
      if (j >= N) break;
      vec2 q = rot(d, -(u_strAng + u_rot + float(j) * PI / float(N)));
      float along = pow(max(1.0 - abs(q.x) / u_strLen, 0.0), 1.6);
      float core = exp(-abs(q.y) / max(u_strThick, 1e-4));
      float haze = exp(-abs(q.y) / max(u_strThick * 8.0, 1e-4)) * u_strHaze;
      col += u_strCol * u_strI * along * (core + haze) * (j == 0 ? 1.0 : 0.6);
    }
  }

  // ring around the light, with chromatic fringes
  if (u_ringI > 0.0) {
    vec3 R = u_ringR * (1.0 + u_ringChroma * 0.12 * vec3(-1.0, 0.0, 1.0));
    vec3 w = vec3(max(u_ringW, 1e-4));
    vec3 ring = exp(-((vec3(ra) - R) / w) * ((vec3(ra) - R) / w));
    col += u_ringCol * u_ringI * ring;
  }

  // ghosts / multi-iris along the optical axis (light -> lens centre -> beyond)
  if (u_ghI > 0.0 && u_ghN > 0) {
    vec2 dir = u_axis - u_light;
    for (int k = 0; k < 16; k++) {
      if (k >= u_ghN) break;
      float fk = (float(k) + 0.15 + 0.7 * hsh1(k, 1)) / float(u_ghN);
      float t = mix(u_ghStart, u_ghSpread, fk);
      vec2 G = u_light + dir * t;
      float sz = u_ghSize * S * mix(1.0, 0.25 + 1.5 * hsh1(k, 2), u_ghSizeRand);
      vec3 gc = u_ghColMode == 0 ? u_ghCol : u_ghColMode == 1 ? mix(hue(float(k) / float(u_ghN) * 0.85), vec3(1.0), 0.25) * u_ghCol : mix(hue(hsh1(k, 3)), vec3(1.0), 0.3) * u_ghCol;
      float br = mix(0.35, 1.0, hsh1(k, 4)) * clamp(0.08 / max(sz / S, 1e-3), 0.25, 1.6);   // small ghosts are brighter
      vec2 q = rot(vec2((p.x - G.x) / max(u_anam, 1e-3), p.y - G.y) / max(sz, 1e-4), -u_rot);
      vec2 q0 = q * (1.0 - u_ghChroma * 0.18), q2 = q * (1.0 + u_ghChroma * 0.18);   // chromatic aberration: R, G, B at slightly different scales
      vec3 g = u_ghPoly
        ? vec3(ghostShape(polyR(q0, u_ghBlades, u_ghRound)), ghostShape(polyR(q, u_ghBlades, u_ghRound)), ghostShape(polyR(q2, u_ghBlades, u_ghRound)))
        : vec3(ghostShape(length(q0)), ghostShape(length(q)), ghostShape(length(q2)));
      col += gc * g * br * u_ghI;
    }
  }

  // sparkles: small twinkling glints around the light
  if (u_spI > 0.0 && u_spN > 0) {
    vec3 sc = mix(u_glowCol, vec3(1.0), 0.5);
    for (int k = 0; k < 64; k++) {
      if (k >= u_spN) break;
      float rr = u_spSpread * sqrt(hsh1(k, 21)) * S;
      vec2 pos = u_light + rot(vec2(rr, 0.0), hsh1(k, 22) * TAU);
      float sz = u_spSize * S * (0.4 + 1.2 * hsh1(k, 23));
      float tw = mix(1.0, max(sin(TAU * (T * float(1 + int(hsh1(k, 24) * 3.0)) + hsh1(k, 25))), 0.0), u_spTw);
      col += sc * u_spI * tw * star4(p - pos, sz);
    }
  }

  // lens dirt lit by the light: soft round smudges (dust, drops) + faint smeared fbm film
  if (u_dirtI > 0.0) {
    float sp = 0.0;
    for (int k = 0; k < 40; k++) {
      vec2 c = vec2(hsh1(k, 31), hsh1(k, 32)) * 2.2 - 1.1;
      float rad = (0.03 + 0.12 * hsh1(k, 33) * hsh1(k, 34)) * 6.0 / u_dirtScale;
      float b = 1.0 - smoothstep(rad * (0.3 + 0.5 * hsh1(k, 35)), rad, length(p - c));
      sp += b * (0.3 + 0.7 * hsh1(k, 36));
    }
    vec2 pr = rot(p, 0.6) * vec2(u_dirtScale * 0.35, u_dirtScale * 1.1);
    sp += 0.5 * smoothstep(0.45, 0.8, fbm3(vec3(pr, 3.0), ivec3(0), 4));
    col += mix(u_glowCol, vec3(1.0), 0.4) * u_dirtI * sp * exp(-length(p - u_light) / max(u_dirtR, 1e-3));
  }

  float fl = 1.0 - u_flicker * (0.7 * vn3(vec3(T * 16.0, 3.5, 0.5), ivec3(16, 0, 0)) + 0.3 * vn3(vec3(T * 48.0, 8.5, 0.5), ivec3(48, 0, 0)));
  col *= u_tint * u_int * fl;
  if (u_edgeFade) col *= 1.0 - smoothstep(0.82, 0.98, max(abs(p.x), abs(p.y)));
  col = max(col - 0.002, 0.0);
  float m = max(col.r, max(col.g, col.b));
  if (u_outMode == 1) { float g = clamp(m, 0.0, 1.0); emit(vec4(g, g, g, 1.0)); return; }
  if (u_blackBg) { emit(vec4(col, 1.0)); return; }
  float al = clamp(m, 0.0, 1.0);
  emit(vec4(al > 0.0 ? col / max(al, 1e-6) : vec3(0.0), al));
}`,
});

// Element intensities switched off: presets start from here, so a preset only lists what it uses.
const FLARE_OFF = { glowI: 0, coreI: 0, raysI: 0, shimI: 0, streakI: 0, ringI: 0, ghostI: 0, sparkI: 0, dirtI: 0, flicker: 0, raysSpin: 0 };

const FLARE_PRESETS = [
  ['Солнце (Sun)', 'Тёплое солнце: сияние, лучи, мерцание, шестиугольные отражения и радужное кольцо.', {
    glowI: 1, glowSize: 0.7, glowFall: 3, glowColor: [1, 0.78, 0.5, 1], coreI: 1.2, coreSize: 0.05,
    raysI: 0.5, raysCount: 8, raysLen: 0.9, raysSharp: 20, raysRandom: 0.5, raysColor: [1, 0.85, 0.6, 1],
    shimI: 0.35, shimCount: 90, shimLen: 0.7, shimSharp: 5, shimSpeed: 1,
    ringI: 0.08, ringRadius: 0.45, ringWidth: 0.025, ringChroma: 0.8, ringColor: [1, 1, 1, 1],
    ghostI: 0.4, ghostCount: 7, posX: -0.45, posY: 0.35, ghostShape: 'poly', ghostBlades: 6, ghostRound: 0.15, ghostColorMode: 'rainbow', ghostColor: [1, 0.9, 0.8, 1],
  }],
  ['Анаморфный синий (Anamorphic)', 'Киношный анаморфный блик: длинная синяя полоса, овальные отражения.', {
    anamorph: 1.8, glowI: 0.8, glowSize: 0.35, glowFall: 3, glowColor: [0.55, 0.75, 1, 1], coreI: 1.5, coreSize: 0.03,
    streakI: 1.2, streakLen: 2.2, streakThick: 0.008, streakHaze: 0.35, streakCount: 1, streakColor: [0.35, 0.6, 1, 1],
    ghostI: 0.3, ghostCount: 6, ghostShape: 'circle', ghostSoft: 0.5, ghostRim: 0.5, ghostColorMode: 'tint', ghostColor: [0.4, 0.65, 1, 1],
  }],
  ['Звезда-блик (Star glint)', 'Острая четырёхлучевая звезда — блик на металле, стекле, воде.', {
    glowI: 0.6, glowSize: 0.25, glowFall: 4, glowColor: [1, 1, 1, 1], coreI: 1.8, coreSize: 0.025,
    raysI: 1.2, raysCount: 4, raysLen: 0.9, raysSharp: 60, raysRandom: 0, raysAngle: 0, raysColor: [1, 1, 1, 1],
    edgeFade: true,
  }],
  ['Звезда 6 лучей (Star 6)', 'Шестилучевая звезда с кольцом — «дифракция» от диафрагмы из 6 лепестков.', {
    glowI: 0.7, glowSize: 0.3, glowFall: 3, glowColor: [0.85, 0.92, 1, 1], coreI: 1.4, coreSize: 0.03,
    raysI: 1, raysCount: 6, raysLen: 0.8, raysSharp: 40, raysRandom: 0.2, raysColor: [0.9, 0.95, 1, 1],
    ringI: 0.2, ringRadius: 0.25, ringWidth: 0.02, ringChroma: 0.6,
  }],
  ['Прожектор (Spotlight)', 'Белая фара/прожектор: широкое сияние, мягкая полоса и кольцо.', {
    glowI: 1.2, glowSize: 0.9, glowFall: 2.5, glowColor: [0.95, 0.97, 1, 1], coreI: 1.5, coreSize: 0.06,
    streakI: 0.5, streakLen: 1.5, streakThick: 0.02, streakHaze: 0.5, streakColor: [0.8, 0.9, 1, 1],
    ringI: 0.2, ringRadius: 0.55, ringWidth: 0.06, ringChroma: 0.3,
    shimI: 0.2, shimCount: 60, shimLen: 0.6, shimSharp: 4, shimSpeed: 1,
  }],
  ['Научная фантастика (Sci-Fi)', 'Фиолетово-голубой блик: двойная полоса, много многоугольных отражений.', {
    glowI: 0.9, glowSize: 0.45, glowFall: 3, glowColor: [0.7, 0.5, 1, 1], coreI: 1.4, coreSize: 0.03,
    streakI: 0.9, streakLen: 1.8, streakThick: 0.006, streakHaze: 0.3, streakCount: 2, streakAngle: 0, streakColor: [0.4, 0.8, 1, 1],
    ghostI: 0.45, ghostCount: 12, ghostShape: 'poly', ghostBlades: 8, ghostRound: 0.1, ghostSoft: 0.2, ghostRim: 0.6, ghostColorMode: 'random', ghostColor: [1, 1, 1, 1], ghostChroma: 0.6,
    ringI: 0.3, ringRadius: 0.3, ringWidth: 0.015, ringChroma: 1, ringColor: [0.8, 0.7, 1, 1],
  }],
  ['Тёплая лампа (Warm lamp)', 'Мягкий оранжевый свет лампы или свечи с лёгким мерцанием.', {
    glowI: 1.1, glowSize: 0.6, glowFall: 2.2, glowColor: [1, 0.6, 0.25, 1], coreI: 1, coreSize: 0.05,
    shimI: 0.25, shimCount: 40, shimLen: 0.45, shimSharp: 3, shimSpeed: 2,
    ringI: 0.12, ringRadius: 0.38, ringWidth: 0.08, ringChroma: 0.2, ringColor: [1, 0.7, 0.4, 1], flicker: 0.25,
  }],
  ['Сварка / вспышка (Welding)', 'Слепящая бело-голубая вспышка: сильное мерцание, искры, дрожание яркости.', {
    glowI: 1.3, glowSize: 0.55, glowFall: 3.5, glowColor: [0.75, 0.88, 1, 1], coreI: 2.5, coreSize: 0.04,
    shimI: 0.8, shimCount: 140, shimLen: 0.9, shimSharp: 6, shimSpeed: 4,
    sparkI: 0.5, sparkCount: 30, sparkSpread: 0.45, sparkSize: 0.02, sparkTwinkle: 1, flicker: 0.5,
  }],
  ['Магия (Magic)', 'Розово-фиолетовое сияние с блёстками и радужным кольцом.', {
    glowI: 1, glowSize: 0.5, glowFall: 3, glowColor: [1, 0.45, 0.95, 1], coreI: 1.2, coreSize: 0.04,
    raysI: 0.4, raysCount: 5, raysLen: 0.6, raysSharp: 25, raysRandom: 0.3, raysSpin: 1, raysColor: [1, 0.7, 1, 1],
    ringI: 0.35, ringRadius: 0.35, ringWidth: 0.02, ringChroma: 1, ringColor: [1, 0.8, 1, 1],
    sparkI: 0.6, sparkCount: 36, sparkSpread: 0.7, sparkSize: 0.025, sparkTwinkle: 0.9,
  }],
  ['Объектив с грязью (Dirty lens)', 'Солнце за грязным стеклом: пятна и разводы на линзе подсвечиваются.', {
    glowI: 0.9, glowSize: 0.6, glowFall: 3, glowColor: [1, 0.85, 0.65, 1], coreI: 1.3, coreSize: 0.04,
    shimI: 0.3, shimCount: 80, shimLen: 0.6, shimSharp: 5, shimSpeed: 1,
    ghostI: 0.25, ghostCount: 5, ghostShape: 'poly', ghostBlades: 7, ghostRound: 0.3, ghostColorMode: 'rainbow',
    dirtI: 0.3, dirtScale: 5, dirtRadius: 0.8,
  }],
  ['Кинообъектив (Cinematic)', 'Сдержанный блик: слабое сияние, цепочка семиугольных отражений через кадр.', {
    posX: -0.55, posY: 0.45, glowI: 0.7, glowSize: 0.35, glowFall: 3, glowColor: [1, 0.92, 0.8, 1], coreI: 1, coreSize: 0.03,
    ghostI: 0.4, ghostCount: 9, ghostStart: 0.3, ghostSpread: 2.2, ghostSize: 0.07, ghostSizeRand: 0.8, ghostShape: 'poly', ghostBlades: 7, ghostRound: 0.25, ghostSoft: 0.35, ghostRim: 0.35,
    ghostColorMode: 'rainbow', ghostColor: [1, 0.95, 0.85, 1], ghostChroma: 0.5, edgeFade: false,
  }],
  ['Мягкий огонёк (Soft orb)', 'Простая светящаяся точка — для частиц, огоньков, светлячков.', {
    glowI: 1.2, glowSize: 0.5, glowFall: 2.5, glowColor: [1, 0.9, 0.5, 1], coreI: 1.2, coreSize: 0.06, posX: 0, posY: 0,
  }],
];
