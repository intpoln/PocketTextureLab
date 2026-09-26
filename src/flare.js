// ---------------------------------------------------------------------------
// Optical flare sprite generator ("Optical Flare" node) for game VFX: the
// blinding flash spawned for a few frames on explosions, grenades, muzzle
// flashes, sparks. Only the flare itself (no lens ghosts or dirt): glow and
// hot core, rays (starburst), shimmer (fine animated rays), anamorphic
// streaks and a halo ring with chromatic fringes. Light is additive, computed
// in linear space and may exceed 1 (HDR). Animation (shimmer, flicker, ray
// spin) is periodic in the loop phase, so sprite sheets loop seamlessly.
// ---------------------------------------------------------------------------
SHADERS.define('flare', {
  nin: 0,
  body: FX_HELPERS + `
uniform bool u_edgeFade;
uniform vec2 u_light;
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

vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
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
const FLARE_OFF = { glowI: 0, coreI: 0, raysI: 0, shimI: 0, streakI: 0, ringI: 0, flicker: 0, raysSpin: 0 };

const FLARE_PRESETS = [
  ['Солнце (Sun)', 'Тёплая яркая вспышка: сияние, лучи, мерцающие лучики и лёгкое радужное кольцо.', {
    glowI: 1, glowSize: 0.7, glowFall: 3, glowColor: [1, 0.78, 0.5, 1], coreI: 1.2, coreSize: 0.05,
    raysI: 0.5, raysCount: 8, raysLen: 0.9, raysSharp: 20, raysRandom: 0.5, raysColor: [1, 0.85, 0.6, 1],
    shimI: 0.35, shimCount: 90, shimLen: 0.7, shimSharp: 5, shimSpeed: 1,
    ringI: 0.08, ringRadius: 0.45, ringWidth: 0.025, ringChroma: 0.8, ringColor: [1, 1, 1, 1],
  }],
  ['Анаморфный синий (Anamorphic)', 'Киношная вспышка: длинная синяя горизонтальная полоса и яркое ядро.', {
    anamorph: 1.8, glowI: 0.8, glowSize: 0.35, glowFall: 3, glowColor: [0.55, 0.75, 1, 1], coreI: 1.5, coreSize: 0.03,
    streakI: 1.2, streakLen: 0.95, streakThick: 0.008, streakHaze: 0.35, streakCount: 1, streakColor: [0.35, 0.6, 1, 1],
  }],
  ['Прожектор (Spotlight)', 'Белая вспышка прожектора/фары: широкое сияние, мягкая полоса и кольцо.', {
    glowI: 1.2, glowSize: 0.9, glowFall: 2.5, glowColor: [0.95, 0.97, 1, 1], coreI: 1.5, coreSize: 0.06,
    streakI: 0.5, streakLen: 0.95, streakThick: 0.02, streakHaze: 0.5, streakColor: [0.8, 0.9, 1, 1],
    ringI: 0.2, ringRadius: 0.55, ringWidth: 0.06, ringChroma: 0.3,
    shimI: 0.2, shimCount: 60, shimLen: 0.6, shimSharp: 4, shimSpeed: 1,
  }],
  ['Сварка / вспышка (Welding)', 'Слепящая бело-голубая вспышка с сильным мерцанием — взрыв гранаты, сварка, дульная вспышка.', {
    glowI: 1.3, glowSize: 0.55, glowFall: 3.5, glowColor: [0.75, 0.88, 1, 1], coreI: 2.5, coreSize: 0.04,
    shimI: 0.8, shimCount: 140, shimLen: 0.9, shimSharp: 6, shimSpeed: 4, flicker: 0.5,
  }],
  ['Мягкий огонёк (Soft orb)', 'Простая светящаяся точка — для частиц, огоньков, светлячков.', {
    glowI: 1.2, glowSize: 0.5, glowFall: 2.5, glowColor: [1, 0.9, 0.5, 1], coreI: 1.2, coreSize: 0.06,
  }],
];
