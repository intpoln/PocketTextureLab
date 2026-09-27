// ---------------------------------------------------------------------------
// Effect generators for particle sprites / flipbooks ("Эффект (FX)" node).
// Each effect is a GLSL function float fx(vec2 p, float T) returning an
// intensity (can exceed 1), p = centred coordinates (-1..1, y up), T = loop
// phase 0..1. Everything that moves is periodic in T (time is a periodic axis
// of the noise, scrolling/rotation goes by whole periods), so T = 1 equals
// T = 0 and sprite-sheet loops are seamless. "One-shot" effects (explosion,
// shockwave, burst, slash) play from start to end over the loop.
// ---------------------------------------------------------------------------
const FX_HELPERS = `
uniform float u_t;
uniform int u_loops;
uniform int u_seed;
uniform int u_oct;
uniform int u_count;
uniform float u_int;
uniform float u_scale;
uniform float u_thick;
uniform float u_distort;
uniform float u_twist;
uniform int u_outMode;
uniform bool u_blackBg;
uniform int u_edge;      // 0 fade to all frame edges, 1 only top/bottom, 2 none (tileable)
uniform bool u_roundFade; // fade to the inscribed circle (engine 4) instead of the square frame
uniform int u_n;
uniform float u_pos[8];
uniform vec4 u_cols[8];
const float TAU = 6.28318530718;
// cheap 1-lane PCG hash of an integer lattice point (8 per noise sample)
float hsh(ivec3 c) {
  uint h = uint(c.x) * 73856093u ^ uint(c.y) * 19349663u ^ uint(c.z) * 83492791u ^ (uint(u_seed) * 2654435761u + 1u);
  uint st = h * 747796405u + 2891336453u;
  uint w = ((st >> ((st >> 28u) + 4u)) ^ st) * 277803737u;
  w = (w >> 22u) ^ w;
  return float(w >> 8u) / 16777215.0;
}
float hsh1(int i, int k) { return hsh(ivec3(i, k, 977)); }
// Wrap lattice coordinates by period P (P <= 0: no wrap). Written without any
// division by zero even in unused branches: HLSL (ANGLE on Windows) evaluates
// both sides of ?: and some drivers then refuse to run the shader.
ivec3 wr(ivec3 c, ivec3 P) {
  ivec3 q = max(P, ivec3(1));
  ivec3 m = ((c % q) + q) % q;
  bvec3 w = greaterThan(P, ivec3(0));
  return ivec3(w.x ? m.x : c.x + 65536, w.y ? m.y : c.y + 65536, w.z ? m.z : c.z + 65536);
}
// value noise, periodic along axes with P > 0 (P = 0: not periodic)
float vn3(vec3 p, ivec3 P) {
  ivec3 i = ivec3(floor(p)); vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hsh(wr(i, P)), b = hsh(wr(i + ivec3(1, 0, 0), P));
  float c = hsh(wr(i + ivec3(0, 1, 0), P)), d = hsh(wr(i + ivec3(1, 1, 0), P));
  float e = hsh(wr(i + ivec3(0, 0, 1), P)), f2 = hsh(wr(i + ivec3(1, 0, 1), P));
  float g = hsh(wr(i + ivec3(0, 1, 1), P)), h = hsh(wr(i + ivec3(1, 1, 1), P));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f2, u.x), mix(g, h, u.x), u.y), u.z);
}
float fbm3(vec3 p, ivec3 P, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int o = 0; o < 8; o++) {
    if (o >= oct) break;
    s += a * vn3(p, P); n += a; a *= 0.5; p = p * 2.0 + vec3(13.0, 7.0, 0.0); P *= 2;
  }
  return s / n;
}
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0); return length(pa - ba * h); }
float glowL(float d, float w) { return w / (d + w); }
float bandMask(float d, float r, float w) { return exp(-pow((d - r) / max(w, 1e-4), 2.0)); }
float easeOut(float t) { return 1.0 - pow(1.0 - t, 3.0); }
`;

const FX_LIST = [
  { id: 'flame', title: 'Пламя (свеча)', palette: 'Огонь (Fire)', uses: ['distort'], defaults: { distort: 1 },
    note: 'Язык пламени, дрожит и поднимается вверх. Петля.', glsl: `
float fx(vec2 p, float T) {
  vec2 q = p / u_scale;
  float y = (q.y + 0.8) / 1.65;
  float n = fbm3(vec3(q.x * 2.2, q.y * 2.0 - T * 6.0, T * 3.0), ivec3(0, 6, 3), u_oct);
  float m = fbm3(vec3(q.x * 5.0, q.y * 4.0 - T * 12.0, T * 3.0 + 5.0), ivec3(0, 12, 3), 3);
  float w = 0.3 * pow(max(1.0 - y, 0.0), 0.75) * smoothstep(-0.02, 0.2, y);
  float dx = q.x + (n - 0.5) * 0.55 * u_distort * y;
  float body = 1.0 - smoothstep(w * 0.25, w + 0.03, abs(dx));
  float fade = 1.0 - smoothstep(0.45, 1.05, y + (m - 0.5) * 0.5 * u_distort);
  float core = exp(-pow(dx * 6.0, 2.0)) * (1.0 - smoothstep(0.05, 0.55, y));
  float base = smoothstep(0.0, 0.12, y);
  return (body * fade * (0.45 + 0.55 * n) + core * body * 0.45) * base;
}` },
  { id: 'fire', edge: 1, title: 'Огонь (стена)', palette: 'Огонь (Fire)', uses: ['distort'], defaults: { distort: 1 },
    note: 'Широкий бушующий огонь снизу вверх. Петля, по горизонтали бесшовен.', glsl: `
float fx(vec2 p, float T) {
  vec2 q = p / u_scale;
  float y01 = (q.y + 1.0) * 0.5;
  float n = fbm3(vec3((p.x + 1.0) * 4.0, q.y * 1.5 - T * 6.0, T * 3.0), ivec3(8, 6, 3), u_oct);
  float m = fbm3(vec3((p.x + 1.0) * 8.0, q.y * 3.0 - T * 12.0, T * 3.0 + 3.0), ivec3(16, 12, 3), 4);
  float tongues = n * 0.75 + m * 0.25;
  float h = (1.0 - y01) * 1.25;
  float v = h * h * (0.35 + 1.3 * tongues * u_distort) - (1.0 - tongues) * 0.35;
  return clamp(v, 0.0, 1.6) * smoothstep(-0.02, 0.1, y01 + 0.02);
}` },
  { id: 'explosion', title: 'Взрыв (однократно)', palette: 'Огонь (Fire)', oneShot: true, uses: ['distort'], defaults: { distort: 1 },
    note: 'Огненный шар: вспышка, рост, остывание и исчезновение за один цикл.', glsl: `
float fx(vec2 p, float T) {
  vec2 q = p / u_scale;
  float d = length(q);
  float r = 0.12 + 0.72 * sqrt(T);
  float n = fbm3(vec3(q * 2.6, T * 3.0), ivec3(0, 0, 3), u_oct);
  float n2 = fbm3(vec3(q * 6.0 + 4.0, T * 3.0 + 7.0), ivec3(0, 0, 3), 4);
  float edge = r * (0.7 + 0.6 * n * u_distort);
  float ball = 1.0 - smoothstep(edge * 0.55, edge, d);
  float heat = mix(1.3, 0.25, smoothstep(0.0, 0.85, T));
  float body = ball * heat * (0.45 + 0.9 * n2) * (1.0 - smoothstep(0.7, 1.0, T));
  float flash = exp(-d * 5.0) * (1.0 - smoothstep(0.0, 0.18, T)) * 1.6;
  return body + flash;
}` },
  { id: 'smoke', title: 'Дым (клуб, однократно)', palette: 'Дым (Smoke)', oneShot: true, uses: ['distort'], defaults: { distort: 1 },
    note: 'Клуб дыма расширяется, поднимается и рассеивается.', glsl: `
float fx(vec2 p, float T) {
  vec2 q = p / u_scale - vec2(0.0, T * 0.35);
  float d = length(q);
  float r = 0.25 + 0.55 * easeOut(T);
  float n = fbm3(vec3(q * 2.2, T * 3.0), ivec3(0, 0, 3), u_oct);
  float b = abs(2.0 * n - 1.0);
  float puff = 1.0 - smoothstep(r * 0.4, r * (0.9 + 0.5 * n * u_distort), d);
  return puff * (0.35 + 0.9 * (1.0 - b)) * (1.0 - smoothstep(0.35, 1.0, T)) * smoothstep(0.0, 0.08, T);
}` },
  { id: 'smokeloop', title: 'Дым (столб, петля)', palette: 'Дым (Smoke)', uses: ['distort'], defaults: { distort: 1 },
    note: 'Поднимающийся столб дыма. Петля.', glsl: `
float fx(vec2 p, float T) {
  vec2 q = p / u_scale;
  float y01 = (q.y + 1.0) * 0.5;
  float n = fbm3(vec3(q.x * 2.0, q.y * 2.0 - T * 4.0, T * 3.0), ivec3(0, 4, 3), u_oct);
  float w = 0.18 + 0.35 * y01;
  float dx = q.x + (n - 0.5) * 0.8 * u_distort * y01;
  float col = 1.0 - smoothstep(w * 0.3, w, abs(dx));
  return col * (0.3 + n) * (1.0 - smoothstep(0.6, 1.0, y01)) * smoothstep(0.0, 0.15, y01);
}` },
  { id: 'sparks', title: 'Искры (разлёт)', palette: 'Огонь (Fire)', oneShot: true, uses: ['count', 'thick'], defaults: { count: 28, thick: 0.5 },
    note: 'Искры разлетаются от центра и гаснут.', glsl: `
float fx(vec2 p, float T) {
  vec2 q = p / u_scale;
  float v = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= u_count) break;
    float a = hsh1(i, 1) * TAU, sp = 0.35 + 0.65 * hsh1(i, 2);
    vec2 dir = vec2(cos(a), sin(a));
    float tt = easeOut(T) * sp;
    vec2 head = dir * tt * 0.95 - vec2(0.0, T * T * 0.25 * hsh1(i, 3));
    vec2 tail = head - dir * (0.05 + 0.25 * sp) * (1.0 - T);
    float d = sdSeg(q, tail, head);
    v += glowL(d, 0.004 + 0.01 * u_thick) * 0.35 * pow(1.0 - T, 1.3);
  }
  v += exp(-length(q) * 8.0) * (1.0 - smoothstep(0.0, 0.2, T)) * 1.5;
  return v;
}` },
  { id: 'sparkloop', title: 'Искры (фонтан, петля)', palette: 'Огонь (Fire)', uses: ['count', 'thick'], defaults: { count: 40, thick: 0.5 },
    note: 'Непрерывный поток искр вверх. Петля.', glsl: `
float fx(vec2 p, float T) {
  vec2 q = p / u_scale;
  float v = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= u_count) break;
    float ph = fract(T + hsh1(i, 4));
    float a = 1.5708 + (hsh1(i, 1) - 0.5) * 1.2, sp = 0.8 + 0.8 * hsh1(i, 2);
    vec2 vel = vec2(cos(a), sin(a)) * sp;
    vec2 head = vec2(0.0, -0.9) + vel * ph * 1.3 - vec2(0.0, ph * ph * 1.1);
    vec2 tail = head - normalize(vel - vec2(0.0, ph * 2.2)) * 0.08;
    v += glowL(sdSeg(q, tail, head), 0.004 + 0.01 * u_thick) * 0.4 * (1.0 - ph);
  }
  return v;
}` },
  { id: 'lightning', title: 'Молния', palette: 'Электричество (Electric)', uses: ['count', 'distort', 'thick'], defaults: { count: 4, distort: 1, thick: 0.5 },
    note: 'Ломаный разряд сверху вниз с ветвлением; меняет форму «Количество» раз за цикл.', glsl: `
float bolt(vec2 q, int k, float off, float amp, float y0, float y1) {
  if (q.y > y0 || q.y < y1) return 0.0;
  float x = (fbm3(vec3(q.y * 3.0, float(k) * 7.3 + off, 0.0), ivec3(0), 6) - 0.5) * 1.1 * amp;
  return glowL(abs(q.x - x), 0.004 + 0.012 * u_thick) * smoothstep(y1, y1 + 0.1, q.y) * (1.0 - smoothstep(y0 - 0.1, y0, q.y));
}
float fx(vec2 p, float T) {
  vec2 q = p / u_scale;
  int k = int(floor(T * float(u_count)));
  float f = fract(T * float(u_count));
  float flick = (0.6 + 0.4 * hsh1(k, 9)) * (1.0 - 0.75 * f);
  float v = bolt(q, k, 0.0, u_distort, 0.95, -0.95);
  float by = mix(0.4, -0.2, hsh1(k, 3));
  float bx = (fbm3(vec3(by * 3.0, float(k) * 7.3, 0.0), ivec3(0), 6) - 0.5) * 1.1 * u_distort;
  v += 0.6 * bolt(vec2(q.x - bx - (by - q.y) * (hsh1(k, 5) - 0.5) * 1.2, q.y), k, 3.1, u_distort * 0.6, by, by - 0.6);
  v += exp(-abs(q.x) * 3.0) * 0.15;
  return v * flick;
}` },
  { id: 'electric', title: 'Электрические дуги', palette: 'Электричество (Electric)', uses: ['count', 'distort', 'thick'], defaults: { count: 6, distort: 1, thick: 0.4 },
    note: 'Разряды от центра во все стороны. Петля.', glsl: `
float fx(vec2 p, float T) {
  vec2 q = p / u_scale;
  float r = length(q), a = atan(q.y, q.x);
  float v = exp(-r * 7.0) * 1.2;
  int k = int(floor(T * 8.0));
  for (int i = 0; i < 16; i++) {
    if (i >= u_count) break;
    float a0 = (float(i) + hsh1(i, k)) / float(u_count) * TAU;
    float off = (fbm3(vec3(r * 4.0, float(i) * 5.1, T * 8.0), ivec3(0, 0, 8), 5) - 0.5) * 0.9 * u_distort;
    float da = abs(mod(a - a0 - off + 3.14159265, TAU) - 3.14159265);
    float len = 0.45 + 0.45 * hsh1(i, k + 31);
    v += glowL(da * r, 0.003 + 0.01 * u_thick) * 0.6 * (1.0 - smoothstep(len * 0.6, len, r));
  }
  return v;
}` },
  { id: 'flare', title: 'Вспышка / солнце', palette: 'Солнце (Sun)', uses: ['count', 'twist'], defaults: { count: 24, twist: 1 },
    note: 'Яркое ядро, ореол и лучи, медленно вращающиеся. Петля.', glsl: `
float fx(vec2 p, float T) {
  vec2 q = p / u_scale;
  float d = length(q), a = atan(q.y, q.x) / TAU + 0.5;
  float N = float(u_count);
  float turns = floor(u_twist + 0.5);
  float rays = fbm3(vec3(a * N + T * N * turns, d * 1.5, T * 3.0), ivec3(u_count, 0, 3), 3);
  float rr = fbm3(vec3(a * N * 2.0, 0.0, T * 3.0 + 9.0), ivec3(u_count * 2, 0, 3), 2);
  float r = pow(rays, 3.0) * 1.6 + pow(rr, 6.0);
  float core = exp(-d * d * 30.0) * 1.6;
  float halo = 0.06 / (d + 0.06);
  return core + halo * 0.8 + r * halo * 1.8 * (1.0 - smoothstep(0.4, 1.0, d));
}` },
  { id: 'star', title: 'Блик-звезда (мерцание)', palette: 'Солнце (Sun)', uses: ['count', 'thick'], defaults: { count: 4, thick: 0.5 },
    note: 'Острые лучи-блики, пульсирующие. Петля.', glsl: `
float fx(vec2 p, float T) {
  float pulse = 0.55 + 0.45 * sin(T * TAU);
  vec2 q = p / (u_scale * (0.6 + 0.4 * pulse));
  float d = length(q), a = atan(q.y, q.x);
  float N = float(u_count);
  float spikes = pow(abs(cos(a * N * 0.5)), 60.0 / (0.3 + u_thick)) * exp(-d * 2.2);
  float spikes2 = pow(abs(cos(a * N * 0.5 + 3.14159 / N)), 120.0) * exp(-d * 5.0) * 0.5;
  return (spikes + spikes2) * 1.4 + exp(-d * d * 60.0) * 1.5 + 0.02 / (d + 0.02) * 0.4 * pulse;
}` },
  { id: 'shockwave', title: 'Ударная волна (однократно)', palette: 'Энергия (Energy)', oneShot: true, uses: ['thick', 'distort'], defaults: { thick: 0.5, distort: 0.5 },
    note: 'Расширяющееся кольцо, истончается и гаснет.', glsl: `
float fx(vec2 p, float T) {
  vec2 q = p / u_scale;
  float d = length(q);
  float r = 0.08 + 0.85 * easeOut(T);
  float n = fbm3(vec3(q * 4.0, T * 3.0), ivec3(0, 0, 3), u_oct);
  float w = mix(0.14, 0.02, T) * (0.4 + u_thick);
  float ring = bandMask(d + (n - 0.5) * 0.08 * u_distort, r, w);
  float inner = (1.0 - smoothstep(0.0, r, d)) * 0.25 * (1.0 - T);
  return (ring * 1.4 + inner) * pow(1.0 - T, 1.2);
}` },
  { id: 'magic', title: 'Магический круг', palette: 'Магия (Magic)', uses: ['count', 'thick'], defaults: { count: 5, thick: 0.5 },
    note: 'Кольца, руны и звезда, вращающиеся в разные стороны. Петля.', glsl: `
float star(vec2 q, float R, int n) {
  float best = 1e9;
  for (int i = 0; i < 12; i++) {
    if (i >= n) break;
    int stp = n % 2 == 1 ? (n - 1) / 2 : max(1, n / 2 - 1);
    float a0 = float(i) / float(n) * TAU + 1.5708, a1 = float(i + stp) / float(n) * TAU + 1.5708;
    best = min(best, sdSeg(q, R * vec2(cos(a0), sin(a0)), R * vec2(cos(a1), sin(a1))));
  }
  return best;
}
float fx(vec2 p, float T) {
  vec2 q = p / u_scale;
  float d = length(q);
  float w = 0.004 + 0.008 * u_thick;
  float v = 0.0;
  v += glowL(abs(d - 0.92), w) + glowL(abs(d - 0.8), w) + glowL(abs(d - 0.56), w) + glowL(abs(d - 0.5), w) * 0.7;
  vec2 q1 = rot(q, T * TAU);
  float a1 = atan(q1.y, q1.x) / TAU + 0.5;
  float cells = 48.0;
  float cid = floor(a1 * cells);
  float glyph = step(0.35, hsh1(int(cid), 11)) * step(0.15, fract(a1 * cells)) * step(fract(a1 * cells), 0.8);
  float band = step(0.82, d) * step(d, 0.9);
  float gy = fract((d - 0.82) / 0.08 * 2.0);
  v += band * glyph * step(0.2, gy) * step(gy, 0.8) * 0.9;
  vec2 q2 = rot(q, -T * TAU / float(max(u_count, 1)));
  v += glowL(star(q2, 0.5, u_count), w) * 0.9;
  vec2 q3 = rot(q, T * TAU);
  float a3 = atan(q3.y, q3.x) / TAU + 0.5;
  v += step(0.62, d) * step(d, 0.74) * step(0.5, fract(a3 * float(u_count) * 2.0)) * step(abs(d - 0.68), 0.01) * 1.2;
  v += glowL(abs(d - 0.68), w * 0.6) * 0.4;
  return v * 0.8 * (0.85 + 0.15 * sin(T * TAU * 2.0));
}` },
  { id: 'orb', title: 'Энергетическая сфера', palette: 'Энергия (Energy)', uses: ['distort', 'thick'], defaults: { distort: 1, thick: 0.5 },
    note: 'Шар с бегущими по поверхности разрядами и свечением. Петля.', glsl: `
float fx(vec2 p, float T) {
  vec2 q = p / u_scale;
  float d = length(q);
  float R = 0.6;
  float inside = 1.0 - smoothstep(R - 0.02, R, d);
  float z = sqrt(max(R * R - d * d, 0.0));
  vec3 s = vec3(rot(q, T * TAU), z) * 2.5;
  float n = fbm3(s, ivec3(0, 0, 0), u_oct);
  float n2 = fbm3(vec3(rot(q, -T * TAU) * 3.0, T * 3.0), ivec3(0, 0, 3), u_oct);
  float arcs = pow(1.0 - abs(2.0 * n2 - 1.0), 8.0 / (0.3 + u_thick)) * u_distort;
  float body = inside * (0.25 + 0.35 * n + arcs * 1.2);
  float rim = glowL(abs(d - R), 0.02) * 0.6;
  float glow = 0.04 / (max(d - R, 0.0) + 0.04) * (1.0 - inside) * 0.5;
  return body + rim + glow * step(R, d);
}` },
  { id: 'vortex', title: 'Портал / вихрь', palette: 'Магия (Magic)', uses: ['count', 'twist', 'distort'], defaults: { count: 4, twist: 1, distort: 0.6 },
    note: 'Спиральные рукава, закручивающиеся к центру. Петля.', glsl: `
float fx(vec2 p, float T) {
  vec2 q = p / u_scale;
  float r = length(q), a = atan(q.y, q.x) / TAU;
  float N = float(u_count);
  float n = fbm3(vec3(a * 8.0 + T * 8.0, r * 3.0, T * 3.0), ivec3(8, 0, 3), u_oct);
  float s = fract(a * N + log(r + 0.05) * u_twist * 2.0 - T + (n - 0.5) * u_distort);
  float arms = pow(1.0 - abs(2.0 * s - 1.0), 3.0);
  float ring = smoothstep(0.08, 0.3, r) * (1.0 - smoothstep(0.7, 0.95, r));
  float hole = 1.0 - smoothstep(0.0, 0.25, r);
  return arms * ring * (0.6 + 0.8 * n) + glowL(abs(r - 0.25), 0.03) * 0.6 - hole * 0.3 + 0.05;
}` },
  { id: 'laser', edge: 1, title: 'Лазерный луч', palette: 'Энергия (Energy)', uses: ['thick', 'distort'], defaults: { thick: 0.5, distort: 0.7 },
    note: 'Горизонтальный луч с ядром и мерцающим ореолом; бесшовен по X. Петля.', glsl: `
float fx(vec2 p, float T) {
  float y = p.y / u_scale;
  float n = fbm3(vec3((p.x + 1.0) * 4.0 - T * 16.0, y * 6.0, T * 3.0), ivec3(8, 0, 3), u_oct);
  float w = 0.03 + 0.08 * u_thick;
  float wob = y + (n - 0.5) * 0.12 * u_distort;
  float core = exp(-pow(wob / (w * 0.35), 2.0)) * 1.5;
  float halo = exp(-pow(wob / (w * 2.5), 2.0)) * (0.35 + 0.6 * n);
  return core + halo;
}` },
  { id: 'slash', title: 'Удар / слэш (однократно)', palette: 'Энергия (Energy)', oneShot: true, uses: ['thick', 'twist'], defaults: { thick: 0.5, twist: 0.5 },
    note: 'Дуга удара оружием: быстро прочерчивается и тает.', glsl: `
float fx(vec2 p, float T) {
  vec2 q = rot(p / u_scale, -0.5 + u_twist);
  float r = length(q), a = atan(q.y, q.x);
  float sweep = mix(-1.6, 2.0, easeOut(min(T * 1.6, 1.0)));
  float tailLen = 1.6;
  float along = clamp((sweep - a) / tailLen, 0.0, 1.0) * step(a, sweep) * step(-1.7, a);
  float w = (0.02 + 0.08 * u_thick) * (1.0 - along) * (1.0 - T * 0.5);
  float band = exp(-pow((r - 0.7) / max(w, 1e-3), 2.0));
  float fade = 1.0 - smoothstep(0.45, 1.0, T);
  return band * (1.0 - along) * 1.6 * fade * step(0.0001, 1.0 - along);
}` },
  { id: 'cloud', title: 'Облако', palette: 'Дым (Smoke)', uses: ['distort'], defaults: { distort: 1 },
    note: 'Мягкое клубящееся облако, медленно меняется. Петля.', glsl: `
float fx(vec2 p, float T) {
  vec2 q = p / u_scale;
  float n = fbm3(vec3(q * 1.8, T * 3.0), ivec3(0, 0, 3), u_oct);
  float b = 1.0 - abs(2.0 * fbm3(vec3(q * 3.5 + 11.0, T * 3.0 + 2.0), ivec3(0, 0, 3), u_oct) - 1.0);
  float mask = 1.0 - smoothstep(0.35, 0.95 + (n - 0.5) * 0.6 * u_distort, length(q * vec2(0.8, 1.2)));
  return mask * (0.3 + n * 0.8 + b * 0.4);
}` },
  { id: 'caustics', edge: 2, title: 'Каустика (вода)', palette: 'Вода (Water)', tile: true, uses: ['count', 'thick'], defaults: { count: 5, thick: 0.5 },
    note: 'Световая сетка на дне воды. Бесшовна по UV и по времени. Петля.', glsl: `
float cellF(vec2 uv, int N, float T, int layer) {
  vec2 g = uv * float(N);
  ivec2 ic = ivec2(floor(g)); vec2 f = fract(g);
  float f1 = 9.0, f2 = 9.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 c = ((ic + ivec2(i, j)) % N + N) % N;
    float h1 = hsh(ivec3(c, layer)), h2 = hsh(ivec3(c, layer + 50)), h3 = hsh(ivec3(c, layer + 99));
    float ang = h3 * TAU + T * TAU * (h1 > 0.5 ? 1.0 : -1.0);
    vec2 o = vec2(0.5) + 0.3 * vec2(cos(ang), sin(ang)) + (vec2(h1, h2) - 0.5) * 0.3;
    float d = length(vec2(i, j) + o - f);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return f2 - f1;
}
float fx(vec2 p, float T) {
  vec2 uv = pixUV();
  int N = max(1, u_count);
  float w = 0.05 + 0.15 * u_thick;
  float a = 1.0 - smoothstep(0.0, w, cellF(uv, N, T, 1));
  float b = 1.0 - smoothstep(0.0, w * 0.6, cellF(uv, N * 2, T, 7));
  return pow(a, 1.5) * 0.9 + pow(b, 3.0) * 0.2 + 0.1;
}` },
];

const FX_PALETTES = {
  'Дым (Smoke)': ['#1c1c1c', '#4a4a4a', '#8a8a8a', '#c8c8c8', '#f0f0f0'],
  'Электричество (Electric)': ['#000010', '#1a1a80', '#3b6cff', '#9fd4ff', '#ffffff'],
  'Солнце (Sun)': ['#200500', '#8a2200', '#ff7a00', '#ffd060', '#fff8e0', '#ffffff'],
  'Энергия (Energy)': ['#000814', '#063a70', '#1f8fff', '#6ff3ff', '#ffffff'],
  'Магия (Magic)': ['#0a0014', '#3a0a6e', '#9a2dff', '#ff6af0', '#ffe6ff'],
};

for (const fx of FX_LIST) {
  SHADERS.define('fx_' + fx.id, {
    nin: 0,
    body: FX_HELPERS + fx.glsl + `
void main() {
  vec2 uv = pixUV();
  vec2 p = vec2(uv.x - 0.5, 0.5 - uv.y) * 2.0;
  float T = fract(u_t * float(u_loops));
  float v = max(fx(p, T), 0.0) * u_int;
  // sprites must end exactly transparent at the frame border (no faint square in engines)
  float e = u_edge == 0 ? (u_roundFade ? length(p) : max(abs(p.x), abs(p.y))) : u_edge == 1 ? abs(p.y) : 0.0;
  v *= 1.0 - smoothstep(0.82, 0.98, e);
  v = max(v - 0.004, 0.0) / 0.996;
  if (u_outMode == 1) { float g = clamp(v, 0.0, 1.0); emit(vec4(g, g, g, 1.0)); return; }
  float t = clamp(v, 0.0, 1.0);
  vec4 c = u_cols[0];
  if (t >= u_pos[u_n - 1]) c = u_cols[u_n - 1];
  else for (int i = 0; i < 7; i++) {
    if (i + 1 >= u_n) break;
    if (t >= u_pos[i] && t < u_pos[i + 1]) { c = mix(u_cols[i], u_cols[i + 1], (t - u_pos[i]) / (u_pos[i + 1] - u_pos[i])); break; }
  }
  if (u_blackBg) c = vec4(c.rgb * c.a, 1.0);
  emit(c);
}`,
  });
}

// Palette stops for an effect: colours from a gradient preset, alpha ramps up
// from transparent (straight, not premultiplied alpha).
function fxStops(name) {
  const hex = FX_PALETTES[name] || RAMP_PRESETS[name] || RAMP_PRESETS['Огонь (Fire)'];
  return hex.map((h, k) => {
    const p = hex.length > 1 ? k / (hex.length - 1) : 0;
    return { p: +p.toFixed(4), c: [...ColorUtil.fromHex(h), Math.min(1, +(p * 2.2).toFixed(3))] };
  });
}
