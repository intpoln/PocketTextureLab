// ---------------------------------------------------------------------------
// GLSL ES 3.00 sources. Every compute shader shares COMMON and gets N input
// slots. Colour spaces: "color" textures hold linear-light RGB, "data"
// textures hold the numbers that end up in the file. u_convN converts an
// input on read (0 none, 1 linear->sRGB, 2 sRGB->linear); u_outConv converts
// the result on write. Alpha is never converted and never premultiplied.
// ---------------------------------------------------------------------------
const SHADERS = (() => {
  const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform vec2 u_res;
uniform vec2 u_uvOff;
uniform int u_outConv;
out vec4 fragColor;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float PI = 3.14159265358979;
float toLin1(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
float toSrgb1(float c) { c = max(c, 0.0); return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
vec3 toLin(vec3 c) { return vec3(toLin1(c.r), toLin1(c.g), toLin1(c.b)); }
vec3 toSrgb(vec3 c) { return vec3(toSrgb1(c.r), toSrgb1(c.g), toSrgb1(c.b)); }
vec4 cconv(vec4 c, int m) {
  if (m == 1) return vec4(toSrgb(c.rgb), c.a);
  if (m == 2) return vec4(toLin(c.rgb), c.a);
  return c;
}
// value as stored in a file ("encoded"): colour inputs are sRGB-encoded first
vec4 enc(vec4 c, bool isColor) { return isColor ? vec4(toSrgb(c.rgb), c.a) : c; }
float lumaEnc(vec4 c, bool isColor) {
  float y = dot(c.rgb, LUMA);
  return isColor ? toSrgb1(y) : y;
}
float pickChan(vec4 c, bool isColor, int src) {
  if (src == 4) return lumaEnc(c, isColor);
  vec4 e = enc(c, isColor);
  return src == 0 ? e.r : src == 1 ? e.g : src == 2 ? e.b : e.a;
}
void emit(vec4 c) { fragColor = cconv(c, u_outConv); }
// premultiplied -> straight (transparent stays transparent black)
vec4 unpremul(vec4 c) { return vec4(c.a > 1e-6 ? c.rgb / c.a : vec3(0.0), c.a); }
ivec2 pix() { return ivec2(gl_FragCoord.xy); }
vec2 pixUV() { return gl_FragCoord.xy / u_res; }
ivec2 wrapPx(ivec2 p, bool rep) {
  ivec2 n = ivec2(u_res);
  return rep ? ((p % n) + n) % n : clamp(p, ivec2(0), n - 1);
}
uvec3 pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
`;

  const inputSlot = (i) => `
uniform sampler2D u_in${i};
uniform bool u_has${i};
uniform bool u_col${i};
uniform int u_conv${i};
uniform vec4 u_def${i};
uniform int u_bnd${i};   // boundary: 0 repeat, 1 clamp, 2 border (zero outside)
vec4 in${i}(ivec2 p) { return u_has${i} ? cconv(texelFetch(u_in${i}, p, 0), u_conv${i}) : u_def${i}; }
vec4 in${i}UV(vec2 uv) { return u_has${i} ? cconv(texture(u_in${i}, uv), u_conv${i}) : u_def${i}; }
// exact texel with the slot's boundary mode (texel coordinates of the INPUT texture)
vec4 in${i}T(ivec2 p) {
  if (!u_has${i}) return u_def${i};
  ivec2 n = textureSize(u_in${i}, 0);
  if (u_bnd${i} == 2 && (p.x < 0 || p.y < 0 || p.x >= n.x || p.y >= n.y)) return vec4(0.0);
  ivec2 q = u_bnd${i} == 0 ? ((p % n) + n) % n : clamp(p, ivec2(0), n - 1);
  return cconv(texelFetch(u_in${i}, q, 0), u_conv${i});
}
// Bilinear read that honours the boundary mode. premul: the four taps are premultiplied by
// their own alpha BEFORE interpolation (image semantics: an invisible texel contributes no
// colour); the result is then premultiplied — divide by .a when done. premul = false keeps
// straight per-channel interpolation (numeric data).
vec4 in${i}B(vec2 uv, bool premul) {
  if (!u_has${i}) { vec4 d = u_def${i}; if (premul) d.rgb *= d.a; return d; }
  vec2 f = uv * vec2(textureSize(u_in${i}, 0)) - 0.5;
  ivec2 i0 = ivec2(floor(f)); vec2 t = f - floor(f);
  vec4 a = in${i}T(i0), b = in${i}T(i0 + ivec2(1, 0)), c = in${i}T(i0 + ivec2(0, 1)), d = in${i}T(i0 + ivec2(1, 1));
  if (premul) { a.rgb *= a.a; b.rgb *= b.a; c.rgb *= c.a; d.rgb *= d.a; }
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
`;

  const S = {};

  S.constant = { nin: 0, body: `
uniform vec4 u_color;
void main() { emit(u_color); }` };

  S.image = { nin: 0, body: `
uniform sampler2D u_img;
uniform vec2 u_imgSize;
uniform int u_fit;      // 0 stretch, 1 cover (crop), 2 1:1 tiled
uniform bool u_exact;   // stretch with identical size -> exact texel copy
void main() {
  if (u_exact) { emit(texelFetch(u_img, pix(), 0)); return; }
  if (u_fit == 2) {
    ivec2 s = ivec2(u_imgSize);
    emit(texelFetch(u_img, pix() % s, 0));
    return;
  }
  vec2 uv = pixUV();
  if (u_fit == 1) {
    float ar = u_imgSize.x / u_imgSize.y;
    if (ar > 1.0) uv.x = 0.5 + (uv.x - 0.5) / ar; else uv.y = 0.5 + (uv.y - 0.5) * ar;
  }
  emit(texture(u_img, uv));
}` };

  // Noise v2. Families: 0 value, 1 gradient (Perlin), 2 cellular (Worley), 3 white, 4 flow
  // (gradient noise with rotating gradients + pseudo-advection), 5 structured splat fractal
  // (multi-scale elements). With u_lod, octaves finer than the pixel fade to their mean
  // instead of aliasing (the footprint accounts for stretch and domain warp). Old graphs run
  // with u_lod = false and neutral new parameters: bit-identical to the pre-v2 shader.
  S.noise = { nin: 0, body: `
uniform int u_type;
uniform int u_fractal;  // 0 fbm, 1 ridged, 2 billow
uniform int u_seed;
uniform int u_oct;
uniform int u_lac;
uniform float u_scale;
uniform float u_stretch;
uniform float u_grainCells;
uniform float u_pers;
uniform float u_contrast;
uniform float u_warp;
uniform int u_warpScale;
uniform int u_warpLevels;
uniform bool u_tile;
uniform bool u_inv;
uniform bool u_lod;
uniform float u_mean;   // mean of one octave after the fractal fold (what a faded octave contributes)
uniform vec2 u_offset;  // texture units; whole numbers keep a tileable noise identical
uniform float u_balance;
uniform bool u_clampOut;
uniform bool u_warpEvo;
// flow
uniform float u_flowRot;
uniform float u_flowT;   // loop phase 0..1
uniform int u_flowSpin;  // whole turns per loop (octave o turns (o+1)·spin times)
uniform float u_advect;
// splat
uniform int u_splShape;  // 0 soft spot, 1 cone, 2 streak
uniform float u_splSize, u_splHard, u_splDensity, u_splSizeRand, u_splPosRand, u_splRotRand, u_splAngle, u_splAspect, u_splValRand, u_splSmooth;
uniform int u_splPer, u_splIn, u_splAcross;
ivec2 wc(ivec2 c, ivec2 P) { return u_tile ? ((c % P) + P) % P : c + 65536; }
uvec3 hh(ivec2 c, int o, uint salt) {
  return pcg3(uvec3(uvec2(c), uint(u_seed) * 747796405u + uint(o) * 2891336453u + salt));
}
float h1(ivec2 c, int o, uint salt) { return float(hh(c, o, salt).x >> 8u) / 16777215.0; }
vec2 h2(ivec2 c, int o) { uvec3 r = hh(c, o, 3u); return vec2(r.xy >> 8u) / 16777215.0; }
vec2 fade(vec2 f) { return f * f * f * (f * (f * 6.0 - 15.0) + 10.0); }
vec2 dfade(vec2 f) { return 30.0 * f * f * (f * (f - 2.0) + 1.0); }
float valueN(vec2 p, ivec2 P, int o, uint salt) {
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p), u = fade(f);
  float a = h1(wc(i, P), o, salt), b = h1(wc(i + ivec2(1, 0), P), o, salt);
  float c = h1(wc(i + ivec2(0, 1), P), o, salt), d = h1(wc(i + ivec2(1, 1), P), o, salt);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float gr(ivec2 c, vec2 d, int o) { float a = h1(c, o, 1u) * 2.0 * PI; return dot(vec2(cos(a), sin(a)), d); }
float gradN(vec2 p, ivec2 P, int o) {
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p), u = fade(f);
  float a = gr(wc(i, P), f, o), b = gr(wc(i + ivec2(1, 0), P), f - vec2(1, 0), o);
  float c = gr(wc(i + ivec2(0, 1), P), f - vec2(0, 1), o), d = gr(wc(i + ivec2(1, 1), P), f - vec2(1, 1), o);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 0.70710678 + 0.5;
}
// Flow noise: each lattice gradient rotates by +ang or -ang (random sign) — the pattern swirls
// in place instead of cross-fading. Returns value (0..1) and its gradient d/dp.
vec2 fgrad(ivec2 c, int o, float ang) {
  float a = h1(c, o, 1u) * 2.0 * PI + (h1(c, o, 5u) < 0.5 ? ang : -ang);
  return vec2(cos(a), sin(a));
}
vec3 flowN(vec2 p, ivec2 P, int o, float ang) {
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p), u = fade(f), du = dfade(f);
  vec2 ga = fgrad(wc(i, P), o, ang), gb = fgrad(wc(i + ivec2(1, 0), P), o, ang);
  vec2 gc = fgrad(wc(i + ivec2(0, 1), P), o, ang), gd = fgrad(wc(i + ivec2(1, 1), P), o, ang);
  float va = dot(ga, f), vb = dot(gb, f - vec2(1, 0)), vc = dot(gc, f - vec2(0, 1)), vd = dot(gd, f - vec2(1, 1));
  float v = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd);
  vec2 dv = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
          + du * (u.yx * (va - vb - vc + vd) + vec2(vb, vc) - va);
  return vec3(v * 0.70710678 + 0.5, dv * 0.70710678);
}
float worleyN(vec2 p, ivec2 P, int o) {
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p);
  float md = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 g = ivec2(x, y);
    vec2 r = vec2(g) + h2(wc(i + g, P), o) - f;
    md = min(md, dot(r, r));
  }
  return clamp(sqrt(md), 0.0, 1.0);
}
uniform float u_evo;
float octave(vec2 p, ivec2 P, int o) {
  if (u_type == 0) return valueN(p, P, o, 1u);
  if (u_type == 1) return gradN(p, P, o);
  if (u_type == 2) return worleyN(p, P, o);
  return h1(wc(ivec2(floor(p)), P), o, 7u);
}
// Evolution (morph): blend between 3 periodic "slices" of the noise with a
// variance-preserving cos/sin crossfade; evolution 0 → 1 loops seamlessly.
float octaveE(vec2 p, ivec2 P, int o) {
  if (u_evo <= 0.0) return octave(p, P, o);
  float z = fract(u_evo) * 3.0;
  int zi = int(floor(z));
  float f = z - float(zi);
  float a = octave(p, P, o + 97 * zi), b = octave(p, P, o + 97 * ((zi + 1) % 3));
  float th = f * f * (3.0 - 2.0 * f) * 1.5707963;
  return 0.5 + (a - 0.5) * cos(th) + (b - 0.5) * sin(th);
}
float warpN0(vec2 uv, int W, uint salt, int slice) {
  float s = 0.0, a = 0.5;
  for (int o = 0; o < 3; o++) { int Pw = W << o; s += a * valueN(uv * float(Pw), ivec2(Pw), 20 + o + 97 * slice, salt); a *= 0.5; }
  return s / 0.875;
}
float warpN(vec2 uv, int W, uint salt) {
  if (!u_warpEvo || u_evo <= 0.0) return warpN0(uv, W, salt, 0);
  float z = fract(u_evo) * 3.0; int zi = int(floor(z)); float f = z - float(zi);
  float th = f * f * (3.0 - 2.0 * f) * 1.5707963;
  return 0.5 + (warpN0(uv, W, salt, zi) - 0.5) * cos(th) + (warpN0(uv, W, salt, (zi + 1) % 3) - 0.5) * sin(th);
}
// ---- structured splat fractal: one layer of elements on a periodic grid
float splatProfile(vec2 q) {
  float r = length(q);
  if (u_splShape == 1) return pow(max(1.0 - r, 0.0), 1.0 + (1.0 - u_splHard) * 2.0);             // cone
  float soft = exp(-r * r * 3.0), hard = 1.0 - smoothstep(0.82, 1.0, r);
  float v = mix(soft, hard, u_splHard);
  if (u_splShape == 2) v *= max(1.0 - abs(q.x), 0.0);                                          // streak tapers along its length
  return v * step(r, 1.0) + (r > 1.0 ? soft * (1.0 - u_splHard) * (1.0 - smoothstep(1.0, 1.6, r)) : 0.0);
}
float splatLayer(vec2 p, ivec2 P, int o) {
  ivec2 ic = ivec2(floor(p)); vec2 f = p - floor(p);
  float aspect = u_splShape == 2 ? max(u_splAspect, 1.0) : u_splAspect;
  float reach = u_splSize * max(aspect, 1.0) * (1.0 + u_splSizeRand) * 1.6 + u_splPosRand * 0.5;
  int R = reach > 1.0 ? 2 : 1;
  float mx = 0.0, sum = 0.0, se = 0.0, k = mix(2.0, 24.0, 1.0 - u_splSmooth);
  for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++) {
    if (abs(dx) > R || abs(dy) > R) continue;
    ivec2 d = ivec2(dx, dy), cell = wc(ic + d, P);
    for (int e = 0; e < 4; e++) {
      if (e >= u_splPer) break;
      uint salt = 40u + uint(e) * 17u;
      uvec3 A = hh(cell, o, salt), B = hh(cell, o, salt + 7u);
      vec3 ra = vec3(A >> 8u) / 16777215.0, rb = vec3(B >> 8u) / 16777215.0;
      if (ra.x >= u_splDensity) continue;
      vec2 c = vec2(d) + 0.5 + (rb.xy - 0.5) * u_splPosRand * 1.0 - f;
      float sz = max(0.02, u_splSize * (1.0 + u_splSizeRand * (ra.y * 2.0 - 1.0)));
      float ang = u_splAngle + u_splRotRand * (ra.z - 0.5) * 2.0 * PI;
      vec2 q = vec2(cos(ang) * c.x + sin(ang) * c.y, -sin(ang) * c.x + cos(ang) * c.y);
      q = vec2(q.x / aspect, q.y) / sz;
      float v = splatProfile(-q) * (1.0 - u_splValRand * rb.z);
      mx = max(mx, v); sum += v; se += exp(k * v) - 1.0;
    }
  }
  if (u_splIn == 0) return 1.0 - exp(-sum * 1.5);      // additive, softly saturated
  if (u_splIn == 1) return mx;
  return clamp(log(1.0 + se) / k, 0.0, 1.0);           // smooth max
}
void main() {
  vec2 uv = pixUV() + u_uvOff + u_offset;
  float sc = u_type == 3 ? u_grainCells : u_scale;
  vec2 base = vec2(sc, sc * u_stretch);
  if (u_tile) base = max(vec2(1.0), floor(base + 0.5));
  float wfoot = 1.0;
  if (u_warp > 0.0) {
    for (int l = 0; l < 3; l++) {
      if (l >= max(u_warpLevels, 1)) break;
      uint s1 = l == 0 ? 101u : 101u + uint(l) * 1000u, s2 = l == 0 ? 202u : 202u + uint(l) * 1000u;
      vec2 w = vec2(warpN(uv, u_warpScale, s1), warpN(uv, u_warpScale, s2));
      uv += (w - 0.5) * u_warp * 0.5;
    }
    wfoot = 1.0 + u_warp * float(u_warpScale) * float(max(u_warpLevels, 1));   // warp compresses the domain locally
  }
  ivec2 P = ivec2(base);
  vec2 freq = base;
  float sum = 0.0, amp = 1.0, norm = 0.0, mxAcc = 0.0, seAcc = 0.0;
  vec2 adv = vec2(0.0);
  float kx = mix(2.0, 24.0, 1.0 - u_splSmooth);
  for (int o = 0; o < 8; o++) {
    if (o >= u_oct) break;
    // pixel footprint: noise cells per output pixel (geometric mean of both axes, so a stretched
    // octave that is still visible along one axis is not dropped), scaled by the warp compression.
    // The octave fades out between 0.3 and 0.8 cells per pixel — tuned against a 2048 px render
    // box-downsampled to 256 px (tools/noise-lod.mjs).
    float cpp = sqrt(freq.x * freq.y) / u_res.x * wfoot * (u_type == 4 ? 1.0 + u_advect : 1.0);
    float w = (u_lod && u_type != 3) ? 1.0 - smoothstep(0.3, 0.8, cpp) : 1.0;
    float n = u_mean;
    if (w > 0.0) {
      if (u_type == 5) {
        n = splatLayer(uv * freq, P, o);
      } else if (u_type == 4) {
        float ang = u_flowRot + u_flowT * 2.0 * PI * float(u_flowSpin * (o + 1));
        vec3 fn = flowN(uv * freq - adv, P, o, ang);
        adv += u_advect * fn.yz * amp;
        n = fn.x;
      } else n = octaveE(uv * freq, P, o);
      if (u_type != 5) {
        if (u_fractal == 1) { n = 1.0 - abs(2.0 * n - 1.0); n *= n; }
        else if (u_fractal == 2) n = abs(2.0 * n - 1.0);
      }
      n = mix(u_mean, n, w);
    }
    if (u_type == 5 && u_splAcross == 1) mxAcc = max(mxAcc, n * amp);
    if (u_type == 5 && u_splAcross == 2) seAcc += exp(kx * n * amp) - 1.0;
    sum += n * amp; norm += amp; amp *= u_pers;
    P *= u_lac; freq *= float(u_lac);
  }
  float v = sum / norm;
  if (u_type == 5 && u_splAcross == 1) v = mxAcc;
  if (u_type == 5 && u_splAcross == 2) v = log(1.0 + seAcc) / kx;
  v = (v - 0.5) * u_contrast + 0.5 + u_balance;
  if (u_clampOut) v = clamp(v, 0.0, 1.0);
  if (u_inv) v = 1.0 - v;
  emit(vec4(v, v, v, 1.0));
}` };

  S.voronoi = { nin: 0, body: `
uniform int u_seed;
uniform int u_mode;     // 0 F1, 1 borders, 2 cell value, 3 F2, 4 F2-F1
uniform int u_metric;   // 0 euclid, 1 manhattan, 2 chebyshev
uniform float u_scale;
uniform float u_rand;
uniform bool u_tile;
uniform float u_edgeSmooth;   // border mode: 0 = exact distance to the nearest edge (creased), >0 = smooth min over edges
ivec2 wc(ivec2 c, int P) { return u_tile ? ((c % P) + P) % P : c + 4096; }
uvec3 hc(ivec2 c) { return pcg3(uvec3(uvec2(c), uint(u_seed) * 747796405u + 12345u)); }
uniform float u_evo;
vec2 pt(ivec2 c) {
  uvec3 r = hc(c);
  vec2 b = 0.5 + (vec2(r.xy >> 8u) / 16777215.0 - 0.5) * u_rand;
  if (u_evo > 0.0) {   // each point orbits a small circle: evolution 0 → 1 loops
    float a0 = float(r.z >> 8u) / 16777215.0 * 6.2831853, a1 = a0 + 6.2831853 * u_evo;
    b += 0.25 * u_rand * (vec2(cos(a1), sin(a1)) - vec2(cos(a0), sin(a0)));
  }
  return b;
}
float dist(vec2 r) {
  if (u_metric == 1) return abs(r.x) + abs(r.y);
  if (u_metric == 2) return max(abs(r.x), abs(r.y));
  return length(r);
}
void main() {
  vec2 uv = pixUV() + u_uvOff;
  float base = u_tile ? max(1.0, floor(u_scale + 0.5)) : u_scale;
  int P = int(base);
  vec2 p = uv * base;
  ivec2 ic = ivec2(floor(p)); vec2 f = fract(p);
  float f1 = 8.0, f2 = 8.0, md = 8.0; vec2 mr = vec2(0); ivec2 mg = ivec2(0);
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    ivec2 g = ivec2(i, j);
    vec2 r = vec2(g) + pt(wc(ic + g, P)) - f;
    float d = dist(r);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    float e = dot(r, r);
    if (e < md) { md = e; mr = r; mg = g; }
  }
  float v;
  if (u_mode == 0) v = clamp(f1, 0.0, 1.0);
  else if (u_mode == 3) v = clamp(f2 * 0.75, 0.0, 1.0);
  else if (u_mode == 4) v = clamp(f2 - f1, 0.0, 1.0);
  else if (u_mode == 2) v = float(hc(wc(ic + mg, P)).z >> 8u) / 16777215.0;
  else {
    float mb = 8.0, sm = 8.0, smc = 8.0, hc = 8.0;
    float w = u_edgeSmooth * 0.5;          // rounding width in cell units: only edges within w of the nearest one matter
    for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
      ivec2 g = mg + ivec2(i, j);
      vec2 r = vec2(g) + pt(wc(ic + g, P)) - f;
      vec2 dd = r - mr;
      if (dot(dd, dd) > 1e-6) {
        float e = dot(0.5 * (mr + r), normalize(dd));   // distance from here to the bisector with this neighbour
        float ec = 0.5 * length(dd);                     // the same distance measured from the cell's own point
        mb = min(mb, e); hc = min(hc, ec);
        if (w > 0.0) {
          // polynomial smooth minimum: rounds the crease where two edges are about equally near
          float h = max(w - abs(sm - e), 0.0) / w;  sm = min(sm, e) - h * h * w * 0.25;
          float hq = max(w - abs(smc - ec), 0.0) / w; smc = min(smc, ec) - hq * hq * w * 0.25;
        }
      }
    }
    if (w > 0.0) {
      // the cell reads as a rounded dome instead of a faceted pyramid; the edge line stays put. Rescaled so the
      // cell point keeps its exact height (bigger cells stay higher) — rounding does not sink the whole cell.
      mb = smc > 1e-5 ? max(sm, 0.0) / smc * hc : 0.0;
    }
    v = clamp(mb * 2.0, 0.0, 1.0);
  }
  emit(vec4(v, v, v, 1.0));
}` };

  // Waves. With u_aa every shape is BOX-FILTERED over the pixel footprint exactly: the value is
  // the mean of the wave over [t − w/2, t + w/2] computed from its closed-form integral, so
  // square / saw / triangle edges are antialiased and patterns finer than a pixel settle to their
  // mean instead of producing moiré. u_aa = false is the legacy point-sampled wave.
  S.waves = { nin: 1, body: `
uniform int u_shape;    // 0 sine, 1 triangle, 2 saw, 3 square
uniform bool u_rings;
uniform vec2 u_count;
uniform float u_ringN;
uniform vec2 u_center;
uniform float u_phase;
uniform float u_duty;
uniform float u_distort;
uniform bool u_aa;
float waveAt(float t) {
  float f = fract(t);
  if (u_shape == 0) return 0.5 - 0.5 * cos(2.0 * PI * t);
  if (u_shape == 1) return 1.0 - abs(2.0 * f - 1.0);
  if (u_shape == 2) return f;
  return f < u_duty ? 1.0 : 0.0;
}
// antiderivative of each wave (continuous, grows by the period mean every period)
float waveInt(float t) {
  float k = floor(t), f = t - k;
  if (u_shape == 0) return t * 0.5 - sin(2.0 * PI * t) / (4.0 * PI);
  if (u_shape == 1) return k * 0.5 + (f < 0.5 ? f * f : -f * f + 2.0 * f - 0.5);
  if (u_shape == 2) return k * 0.5 + f * f * 0.5;
  return k * u_duty + min(f, u_duty);
}
void main() {
  vec2 uv = pixUV() + u_uvOff;
  float d = u_has0 ? lumaEnc(in0(pix()), u_col0) - 0.5 : 0.0;
  float t = u_rings ? length(uv - u_center) * u_ringN : dot(uv, u_count);
  t += u_phase + d * u_distort;
  float v;
  if (!u_aa) v = waveAt(t);
  else {
    float w = length(vec2(dFdx(t), dFdy(t)));   // footprint in periods
    v = w < 1e-4 ? waveAt(t) : (waveInt(t + 0.5 * w) - waveInt(t - 0.5 * w)) / w;
  }
  emit(vec4(v, v, v, 1.0));
}` };

  S.warp = { nin: 2, body: `
uniform int u_mode;     // 0 directional, 1 along map gradient, 2 vector (map RG = offset, 0.5 neutral)
uniform vec2 u_dir;
uniform float u_int;
uniform bool u_premul;  // alpha-aware: interpolate the source premultiplied
uniform bool u_ss;      // area filter where the warp compresses the source
// Area-filtered read of slot 0 for resampling nodes: the output pixel covers the parallelogram
// uv0 + jx·a + jy·b (a, b ∈ [−½, ½]) of the source (jx, jy = screen derivatives of the source UV).
// When it spans more than one source texel, n×n bilinear taps (n ≤ 8) average it — no moiré when
// minifying. premul averages premultiplied colour (result premultiplied, like in0B).
vec4 footprint0(vec2 uv0, vec2 jx, vec2 jy, bool premul, bool ss) {
  if (!ss) return in0B(uv0, premul);
  vec2 tsz = vec2(textureSize(u_in0, 0));
  float fp = max(length(jx * tsz), length(jy * tsz));
  int n = int(clamp(ceil(fp - 0.25), 1.0, 8.0));
  if (n <= 1) return in0B(uv0, premul);
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 8; j++) {
    if (j >= n) break;
    for (int i = 0; i < 8; i++) {
      if (i >= n) break;
      vec2 o = (vec2(i, j) + 0.5) / float(n) - 0.5;
      acc += in0B(uv0 + jx * o.x + jy * o.y, premul);
    }
  }
  return acc / float(n * n);
}
// The map is read with its own boundary mode (u_bnd1: Repeat for tileable graphs, Clamp
// otherwise) — never wrapped behind the user's back.
float mapAt(ivec2 p) { return lumaEnc(in1T(p), u_col1); }
void main() {
  ivec2 p = pix();
  vec2 off;
  if (u_mode == 0) off = (mapAt(p) - 0.5) * 2.0 * u_int * u_dir;
  else if (u_mode == 2) { vec2 v = enc(in1T(p), u_col1).rg - 0.5; off = vec2(v.x, -v.y) * 2.0 * u_int; }   // R → +x (right), G → +y (up)
  else {
    vec2 g = vec2(mapAt(p + ivec2(1, 0)) - mapAt(p - ivec2(1, 0)), mapAt(p + ivec2(0, 1)) - mapAt(p - ivec2(0, 1))) * 0.5 * u_res;
    off = g * u_int * 0.1;
  }
  vec2 uv0 = pixUV() + off;
  vec4 c = footprint0(uv0, dFdx(uv0), dFdy(uv0), u_premul, u_ss);
  emit(u_premul ? unpremul(c) : c);
}` };

  // Tiler / Splatter: instances on a periodic grid of cells (hashes wrap
  // modulo the grid, so the result tiles). p is in cell units.
  S.scatter = { nin: 1, body: `
uniform ivec2 u_cells;
uniform float u_rowOff;
uniform float u_jitter;
uniform vec2 u_size;
uniform float u_sizeRand;
uniform float u_rot;
uniform float u_rotRand;
uniform bool u_rotSnap;
uniform float u_valRand;
uniform float u_density;
uniform int u_perCell;
uniform int u_blend;    // 0 max, 1 add, 2 top
uniform int u_R;
uniform int u_pattern;  // 0 input, 1 square, 2 disc, 3 gauss
uniform float u_bevel;
uniform int u_seed;
uniform int u_out;      // 0 pattern, 1 random value per instance
float r01(uint x) { return float(x >> 8u) / 16777215.0; }
float edge(float e, float minSide) {
  float bw = u_bevel * minSide;
  return bw > 0.0 ? clamp(e / bw, 0.0, 1.0) : clamp(e * u_res.x + 0.5, 0.0, 1.0);
}
float pattern(vec2 q, vec2 szUV) {
  if (u_pattern == 0) return u_has0 ? lumaEnc(in0UV(q + 0.5), false) : 1.0;
  if (u_pattern == 3) return exp(-dot(q, q) * 18.0);
  float m = min(szUV.x, szUV.y);
  if (u_pattern == 1) return edge(min((0.5 - abs(q.x)) * szUV.x, (0.5 - abs(q.y)) * szUV.y), m);
  return edge((0.5 - length(q)) * m, m);
}
void main() {
  vec2 cells = vec2(u_cells);
  vec2 p = (pixUV() + u_uvOff) * cells;
  int rb = int(floor(p.y));
  float acc = 0.0, best = -1.0, id = 0.0, topPri = -1.0, topV = 0.0, topId = 0.0;
  for (int dy = -4; dy <= 4; dy++) {
    if (dy < -u_R || dy > u_R) continue;
    int row = rb + dy;
    int wrow = ((row % u_cells.y) + u_cells.y) % u_cells.y;
    float shift = (wrow & 1) == 1 ? u_rowOff : 0.0;
    int cb = int(floor(p.x - shift));
    for (int dx = -4; dx <= 4; dx++) {
      if (dx < -u_R || dx > u_R) continue;
      int col = cb + dx;
      int wcol = ((col % u_cells.x) + u_cells.x) % u_cells.x;
      for (int k = 0; k < 32; k++) {
        if (k >= u_perCell) break;
        uvec3 h1 = pcg3(uvec3(uint(wcol), uint(wrow), uint(u_seed) * 747796405u + uint(k) * 2654435761u + 99u));
        uvec3 h2 = pcg3(h1 ^ uvec3(0x9e3779b9u, 0x85ebca6bu, 0xc2b2ae35u));
        if (r01(h2.z) >= u_density) continue;
        vec2 c = vec2(float(col) + shift + 0.5, float(row) + 0.5) + (vec2(r01(h1.x), r01(h1.y)) - 0.5) * u_jitter;
        vec2 d = (p - c) / cells;                                   // UV units, y down
        float s = 1.0 - u_sizeRand * r01(h1.z);
        vec2 szUV = max(u_size / cells * s, vec2(1e-6));
        float ang = u_rotSnap ? radians(u_rot) + floor(r01(h2.x) * 4.0) * 0.5 * PI * step(0.5, u_rotRand)
                              : radians(u_rot + (r01(h2.x) * 2.0 - 1.0) * u_rotRand);
        vec2 q = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * d / szUV;
        if (abs(q.x) > 0.5 || abs(q.y) > 0.5) continue;
        float rv = r01(h2.y);
        float v = pattern(q, szUV) * (1.0 - u_valRand * rv);
        if (v <= 0.0) continue;
        float rid = r01(h1.x ^ h2.z);
        if (u_blend == 1) { acc += v; if (v > best) { best = v; id = rid; } }
        else if (u_blend == 2) { float pri = r01(h1.y ^ h2.x); if (pri > topPri) { topPri = pri; topV = v; topId = rid; } }
        else if (v > acc) { acc = v; id = rid; }
      }
    }
  }
  if (u_blend == 2) { acc = topV; id = topId; }
  float o = u_out == 0 ? acc : (acc > 0.0 ? max(id, 1.0 / 255.0) : 0.0);
  emit(vec4(o, o, o, 1.0));
}` };

  S.shape = { nin: 0, body: `
uniform int u_shape;    // 0 ellipse, 1 rectangle, 2 ring
uniform vec2 u_pos;
uniform vec2 u_size;
uniform float u_rot;
uniform float u_soft;
uniform float u_thick;
uniform bool u_rep;
void main() {
  vec2 d = pixUV() - u_pos;
  if (u_rep) d -= floor(d + 0.5);
  vec2 q = vec2(d.x, -d.y);                    // y up
  float a = radians(u_rot);
  q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q; // inverse rotation (CCW shape)
  vec2 r = max(u_size * 0.5, vec2(1e-5));
  float sd;
  if (u_shape == 1) { vec2 k = abs(q) - r; sd = length(max(k, 0.0)) + min(max(k.x, k.y), 0.0); }
  else {
    float e = (length(q / r) - 1.0) * min(r.x, r.y);
    sd = u_shape == 2 ? abs(e) - u_thick * 0.5 : e;
  }
  float w = max(u_soft, 0.0) * 0.5 + 0.5 / u_res.x;
  float v = 1.0 - smoothstep(-w, w, sd);
  emit(vec4(v, v, v, 1.0));
}` };

  S.gradient = { nin: 0, body: `
uniform int u_type;     // 0 linear, 1 radial, 2 angular
uniform int u_rep;      // 0 clamp, 1 repeat, 2 mirror
uniform vec2 u_center;
uniform float u_rot;
uniform float u_scale;
uniform bool u_inv;
void main() {
  vec2 d = pixUV() - u_center;
  vec2 q = vec2(d.x, -d.y);
  float a = radians(u_rot), t;
  if (u_type == 0) t = dot(q, vec2(cos(a), sin(a))) * u_scale + 0.5;
  else if (u_type == 1) t = length(q) * 2.0 * u_scale;
  else t = fract(atan(q.y, q.x) / (2.0 * PI) - u_rot / 360.0);
  if (u_rep == 1) t = fract(t);
  else if (u_rep == 2) t = 1.0 - abs(fract(t * 0.5) * 2.0 - 1.0);
  t = clamp(t, 0.0, 1.0);
  if (u_inv) t = 1.0 - t;
  emit(vec4(t, t, t, 1.0));
}` };

  S.levels = { nin: 1, body: `
uniform float u_ib, u_iw, u_gamma, u_ob, u_ow;
uniform bool u_alpha;
float lv(float x) {
  float d = u_iw - u_ib;
  float t = abs(d) < 1e-6 ? step(u_ib, x) : clamp((x - u_ib) / d, 0.0, 1.0);
  t = pow(t, 1.0 / max(u_gamma, 1e-3));
  return mix(u_ob, u_ow, t);
}
void main() {
  vec4 c = in0(pix());
  vec4 o = vec4(lv(c.r), lv(c.g), lv(c.b), u_alpha ? lv(c.a) : c.a);
  emit(o);
}` };

  S.invert = { nin: 1, body: `
uniform bvec4 u_ch;
void main() { vec4 c = in0(pix()); emit(mix(c, 1.0 - c, vec4(u_ch))); }` };

  // Grayscale / channel extraction (also used by Split RGBA and Height to Normal).
  S.gray = { nin: 1, body: `
uniform int u_src;      // 0 R, 1 G, 2 B, 3 A, 4 luminance
uniform bool u_keepA;
uniform bool u_inv;
void main() {
  vec4 c = in0(pix());
  float v = u_has0 ? pickChan(c, u_col0, u_src) : pickChan(u_def0, false, u_src);
  if (u_inv) v = 1.0 - v;
  emit(vec4(v, v, v, u_keepA ? c.a : 1.0));
}` };

  S.ramp = { nin: 1, body: `
uniform int u_n;
uniform int u_interp;   // 0 constant, 1 linear, 2 smooth
uniform int u_src;      // 0 luminance, 1 R
uniform float u_pos[8];
uniform vec4 u_cols[8];
void main() {
  vec4 c = in0(pix());
  float t = u_src == 0 ? lumaEnc(c, u_col0 && u_has0) : enc(c, u_col0 && u_has0).r;
  vec4 r = u_cols[0];
  if (t < u_pos[0]) r = u_cols[0];
  else if (t >= u_pos[u_n - 1]) r = u_cols[u_n - 1];
  else {
    for (int i = 0; i < 7; i++) {
      if (i + 1 >= u_n) break;
      float a = u_pos[i], b = u_pos[i + 1];
      if (t >= a && t < b) {
        float f = (t - a) / (b - a);
        if (u_interp == 0) f = 0.0;
        else if (u_interp == 2) f = f * f * (3.0 - 2.0 * f);
        r = mix(u_cols[i], u_cols[i + 1], f);
        break;
      }
    }
  }
  emit(r);
}` };

  S.hsv = { nin: 1, body: `
uniform float u_h, u_s, u_v;
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y), e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
void main() {
  vec4 c = in0(pix());
  vec3 h = rgb2hsv(max(c.rgb, 0.0));
  h.x = fract(h.x + u_h / 360.0);
  h.y = clamp(h.y * u_s, 0.0, 1.0);
  h.z *= u_v;
  emit(vec4(hsv2rgb(h), c.a));
}` };

  S.blend = { nin: 3, body: `
uniform int u_mode;     // 0 mix, 1 add, 2 multiply, 3 screen, 4 min, 5 max, 6 over, 7 subtract, 8 difference, 9 overlay, 10 soft light
uniform float u_opacity;
uniform bool u_keepA;
uniform bool u_isColor; // colour inputs are linear inside; overlay / soft light work on display (sRGB) values
vec3 enc3(vec3 c) { return u_isColor ? toSrgb(c) : c; }
vec3 dec3(vec3 c) { return u_isColor ? toLin(c) : c; }
vec3 overlay(vec3 a, vec3 b) { return mix(2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b), step(0.5, a)); }
vec3 softlight(vec3 a, vec3 b) {   // W3C / Photoshop soft light
  vec3 d = mix(sqrt(a), ((16.0 * a - 12.0) * a + 4.0) * a, step(a, vec3(0.25)));
  return mix(a + (2.0 * b - 1.0) * (d - a), a - (1.0 - 2.0 * b) * a * (1.0 - a), step(b, vec3(0.5)));
}
void main() {
  ivec2 p = pix();
  vec4 A = in0(p), B = in1(p);
  float m = u_has2 ? lumaEnc(in2(p), u_col2) : 1.0;
  float k = clamp(u_opacity * m, 0.0, 1.0);
  if (u_mode == 6) {
    // B OVER A (Porter–Duff, premultiplied): B's own alpha × opacity × mask is its coverage
    float ba = B.a * k;
    float oa = ba + A.a * (1.0 - ba);
    vec3 prem = B.rgb * ba + A.rgb * A.a * (1.0 - ba);
    vec4 o = vec4(oa > 1e-6 ? prem / oa : vec3(0.0), oa);
    if (u_keepA) o.a = A.a;
    emit(o); return;
  }
  vec4 r;
  if (u_mode == 0) r = B;
  else if (u_mode == 1) r = A + B;
  else if (u_mode == 2) r = A * B;
  else if (u_mode == 3) r = 1.0 - (1.0 - A) * (1.0 - B);
  else if (u_mode == 4) r = min(A, B);
  else if (u_mode == 5) r = max(A, B);
  else if (u_mode == 7) r = A - B;
  else if (u_mode == 8) r = abs(A - B);
  else if (u_mode == 9) r = vec4(dec3(overlay(clamp(enc3(A.rgb), 0.0, 1.0), clamp(enc3(B.rgb), 0.0, 1.0))), overlay(vec3(A.a), vec3(B.a)).x);
  else r = vec4(dec3(softlight(clamp(enc3(A.rgb), 0.0, 1.0), clamp(enc3(B.rgb), 0.0, 1.0))), softlight(vec3(A.a), vec3(B.a)).x);
  vec4 o = mix(A, r, k);
  if (u_keepA) o.a = A.a;
  emit(o);
}` };

  S.transform = { nin: 1, body: `
uniform vec2 u_off;
uniform vec2 u_scl;
uniform float u_rot;
uniform bool u_premul;
uniform bool u_ss;      // area filter when minifying
// Area-filtered read of slot 0 for resampling nodes: the output pixel covers the parallelogram
// uv0 + jx·a + jy·b (a, b ∈ [−½, ½]) of the source (jx, jy = screen derivatives of the source UV).
// When it spans more than one source texel, n×n bilinear taps (n ≤ 8) average it — no moiré when
// minifying. premul averages premultiplied colour (result premultiplied, like in0B).
vec4 footprint0(vec2 uv0, vec2 jx, vec2 jy, bool premul, bool ss) {
  if (!ss) return in0B(uv0, premul);
  vec2 tsz = vec2(textureSize(u_in0, 0));
  float fp = max(length(jx * tsz), length(jy * tsz));
  int n = int(clamp(ceil(fp - 0.25), 1.0, 8.0));
  if (n <= 1) return in0B(uv0, premul);
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 8; j++) {
    if (j >= n) break;
    for (int i = 0; i < 8; i++) {
      if (i >= n) break;
      vec2 o = (vec2(i, j) + 0.5) / float(n) - 0.5;
      acc += in0B(uv0 + jx * o.x + jy * o.y, premul);
    }
  }
  return acc / float(n * n);
}
void main() {
  vec2 d = pixUV() - 0.5 - u_off;
  vec2 q = vec2(d.x, -d.y);
  float a = radians(u_rot);
  q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
  q /= u_scl;
  vec2 uv0 = vec2(q.x, -q.y) + 0.5;
  vec4 c = footprint0(uv0, dFdx(uv0), dFdy(uv0), u_premul, u_ss);
  emit(u_premul ? unpremul(c) : c);
}` };

  S.polar = { nin: 1, body: `
uniform int u_mode;     // 0 strip -> circle, 1 circle -> strip
uniform int u_turns;
uniform float u_radius;
uniform bool u_premul;
uniform bool u_ss;
// Area-filtered read of slot 0 for resampling nodes: the output pixel covers the parallelogram
// uv0 + jx·a + jy·b (a, b ∈ [−½, ½]) of the source (jx, jy = screen derivatives of the source UV).
// When it spans more than one source texel, n×n bilinear taps (n ≤ 8) average it — no moiré when
// minifying. premul averages premultiplied colour (result premultiplied, like in0B).
vec4 footprint0(vec2 uv0, vec2 jx, vec2 jy, bool premul, bool ss) {
  if (!ss) return in0B(uv0, premul);
  vec2 tsz = vec2(textureSize(u_in0, 0));
  float fp = max(length(jx * tsz), length(jy * tsz));
  int n = int(clamp(ceil(fp - 0.25), 1.0, 8.0));
  if (n <= 1) return in0B(uv0, premul);
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 8; j++) {
    if (j >= n) break;
    for (int i = 0; i < 8; i++) {
      if (i >= n) break;
      vec2 o = (vec2(i, j) + 0.5) / float(n) - 0.5;
      acc += in0B(uv0 + jx * o.x + jy * o.y, premul);
    }
  }
  return acc / float(n * n);
}
void main() {
  vec2 uv = pixUV();
  vec2 src, jx, jy; float r = 0.0;
  if (u_mode == 0) {
    vec2 d = vec2(uv.x - 0.5, 0.5 - uv.y);
    r = length(d) * 2.0 / u_radius;
    float a = atan(d.y, d.x) / (2.0 * PI) + 0.5;
    // x (angle) wraps; y (radius) is clamped to the strip's first/last row centre, so the
    // centre does not blend in the opposite edge of the strip (no torn centre)
    float h = float(textureSize(u_in0, 0).y);
    src = vec2(fract(a * float(u_turns)), clamp(1.0 - r, 0.5 / h, 1.0 - 0.5 / h));
    // exact screen derivatives of (angle·turns, 1 − r): no seam, correct up to the very centre
    float rr2 = max(dot(d, d), 1e-12), rl = sqrt(rr2), T = float(u_turns) / (2.0 * PI);
    vec2 px = 1.0 / u_res;                                   // one pixel in uv (image y down → d.y decreases)
    jx = vec2(-d.y / rr2 * T, -d.x / rl * 2.0 / u_radius) * px.x;
    jy = vec2(-d.x / rr2 * T, d.y / rl * 2.0 / u_radius) * px.y;
  } else {
    float a = (uv.x / float(u_turns) - 0.5) * 2.0 * PI, rr = (1.0 - uv.y) * 0.5 * u_radius;
    src = vec2(0.5 + rr * cos(a), 0.5 - rr * sin(a));
    jx = dFdx(src); jy = dFdy(src);
  }
  vec4 c = footprint0(src, jx, jy, u_premul, u_ss);
  if (u_mode == 0 && r > 1.0) { emit(vec4(0.0)); return; }
  emit(u_premul ? unpremul(c) : c);
}` };

  // Glow: bright pass (alpha-weighted so invisible pixels do not glow) ...
  S.brightpass = { nin: 1, body: `
uniform float u_thr;
uniform float u_knee;
void main() {
  vec4 c = in0(pix());
  float l = max(max(c.r, c.g), c.b);
  // knee = 0 is an explicit hard threshold (smoothstep with equal edges is undefined)
  float k = u_knee > 0.0 ? smoothstep(u_thr - u_knee, u_thr + u_knee, l) : step(u_thr, l);
  // Light energy only: premultiplied RGB of the bright part. Its alpha is the energy's
  // brightest channel (clamped), so black or invisible pixels can never create opacity.
  vec3 e = max(c.rgb, 0.0) * c.a * k;
  emit(vec4(e, clamp(max(max(e.r, e.g), e.b), 0.0, 1.0)));
}` };
  // ... and combine: base (straight alpha) + premultiplied glow of 3 blur radii.
  S.glowmix = { nin: 4, body: `
uniform float u_int;
uniform vec3 u_tint;
uniform int u_out;      // 0 image + glow, 1 glow only
uniform bool u_alpha;   // glow extends alpha (sprites)
void main() {
  ivec2 p = pix();
  vec4 b = in0(p);
  vec2 uv = pixUV();
  vec4 g = (in1B(uv, false) + in2B(uv, false) * 0.7 + in3B(uv, false) * 0.45) / 2.15 * u_int;
  g.rgb *= u_tint;
  if (u_out == 1) { float a = clamp(g.a, 0.0, 1.0); emit(vec4(a > 1e-5 ? g.rgb / a : vec3(0.0), a)); return; }
  vec3 prem = b.rgb * b.a + g.rgb;
  // coverage of the base plus the glow — and never less than the brightest premultiplied
  // channel, so straight RGB stays <= 1 where possible and 8-bit export keeps the light
  // energy exactly (composite over black == base + glow)
  float a = u_alpha ? clamp(max(b.a + g.a * (1.0 - b.a), max(max(prem.r, prem.g), prem.b)), 0.0, 1.0) : b.a;
  vec3 rgb = a > 1e-5 ? prem / max(a, 1e-5) : vec3(0.0);
  if (!u_alpha) rgb = b.rgb + g.rgb;
  emit(vec4(rgb, a));
}` };

  // 2x box downsample of the input (the bilinear tap lands between 4 texels), honouring
  // the boundary mode of slot 0
  S.downsample = { nin: 1, body: `
void main() { emit(in0B(pixUV(), false)); }` };

  S.copy = { nin: 1, body: `
void main() { emit(in0(pix())); }` };

  S.gauss = { nin: 1, body: `
uniform ivec2 u_dir;
uniform float u_sigma;
uniform int u_radius;
uniform bool u_premul;
uniform bool u_unpremul;
void main() {
  ivec2 p = pix();
  vec4 acc = vec4(0.0); float ws = 0.0;
  float k2 = 1.0 / (2.0 * u_sigma * u_sigma);
  for (int k = -u_radius; k <= u_radius; k++) {
    float w = exp(-float(k * k) * k2);
    vec4 c = in0T(p + u_dir * k);     // Repeat / Clamp / Border per slot 0
    if (u_premul) c.rgb *= c.a;
    acc += c * w; ws += w;
  }
  acc /= ws;
  if (u_unpremul) acc.rgb = acc.a > 1e-6 ? acc.rgb / acc.a : vec3(0.0);
  emit(acc);
}` };

  S.dirblur = { nin: 1, body: `
uniform vec2 u_vec;     // full blur length in UV (image y down)
uniform int u_n;
uniform bool u_aa;      // alpha-aware
void main() {
  vec2 uv = pixUV();
  vec4 acc = vec4(0.0);
  for (int k = 0; k < 256; k++) {
    if (k >= u_n) break;
    float t = u_n == 1 ? 0.0 : float(k) / float(u_n - 1) - 0.5;
    acc += in0B(uv + u_vec * t, u_aa);   // alpha-aware: premultiplied before interpolation
  }
  acc /= float(u_n);
  emit(u_aa ? unpremul(acc) : acc);
}` };

  S.radial = { nin: 1, body: `
uniform int u_mode;     // 0 zoom, 1 spin
uniform int u_n;
uniform vec2 u_center;
uniform float u_strength;
uniform bool u_aa;
uniform bool u_adapt;   // at least one sample per pixel of the path (no dotted arcs far from the centre)
void main() {
  if (u_strength <= 0.0) { emit(in0(pix())); return; }
  vec2 uv = pixUV(), d = uv - u_center;
  int n = u_n;
  if (u_adapt) {
    float rpx = length(d) * u_res.x;
    float path = u_mode == 0 ? u_strength * rpx : u_strength * PI * rpx;   // length of the blur path in pixels
    n = int(clamp(max(float(u_n), ceil(path) + 1.0), 2.0, 256.0));
  }
  vec4 acc = vec4(0.0);
  for (int k = 0; k < 256; k++) {
    if (k >= n) break;
    float t = float(k) / float(max(n - 1, 1));
    vec2 s;
    if (u_mode == 0) s = u_center + d * (1.0 - u_strength * t);
    else {
      float a = (t - 0.5) * u_strength * PI;
      s = u_center + mat2(cos(a), sin(a), -sin(a), cos(a)) * d;
    }
    acc += in0B(s, u_aa);
  }
  acc /= float(n);
  emit(u_aa ? unpremul(acc) : acc);
}` };

  // Height (in .r, 0..1) -> tangent-space normal. Derivatives are taken per
  // UV unit (value difference * resolution / 2), so strength is resolution
  // independent: u_k = strength / 100 = relief height as a fraction of the
  // texture width. Image y points down; tangent +Y (OpenGL) points up.
  S.normal = { nin: 1, body: `
uniform float u_k;
uniform bool u_rep;
uniform bool u_dx;
uniform bool u_invx;
void main() {
  ivec2 p = pix();
  float hl = in0(wrapPx(p + ivec2(-1, 0), u_rep)).r;
  float hr = in0(wrapPx(p + ivec2(1, 0), u_rep)).r;
  float hu = in0(wrapPx(p + ivec2(0, -1), u_rep)).r;
  float hd = in0(wrapPx(p + ivec2(0, 1), u_rep)).r;
  float dhdx = (hr - hl) * 0.5 * u_res.x;
  float dhdy = (hd - hu) * 0.5 * u_res.y;   // per UV, image-down
  vec3 n = normalize(vec3(-u_k * dhdx, u_k * dhdy, 1.0));
  if (u_invx) n.x = -n.x;
  if (u_dx) n.y = -n.y;
  emit(vec4(n * 0.5 + 0.5, 1.0));
}` };

  S.combine = { nin: 4, body: `
uniform int u_src[4];   // 0 R, 1 G, 2 B, 3 A, 4 luminance, 5 constant
uniform float u_const[4];
uniform bool u_inv[4];
float ch(int i, bool has, vec4 c, bool col) {
  float v = (u_src[i] == 5 || !has) ? u_const[i] : pickChan(c, col, u_src[i]);
  return u_inv[i] ? 1.0 - v : v;
}
void main() {
  ivec2 p = pix();
  emit(vec4(ch(0, u_has0, in0(p), u_col0), ch(1, u_has1, in1(p), u_col1),
            ch(2, u_has2, in2(p), u_col2), ch(3, u_has3, in3(p), u_col3)));
}` };

  // On-screen display (default framebuffer) and thumbnails.
  S.display = { nin: 0, body: `
uniform sampler2D u_tex;
uniform bool u_has;
uniform bool u_isColor;
uniform int u_view;     // 0 RGB, 1 RGBA over checker, 2 R, 3 G, 4 B, 5 A, 6 normal lit
uniform vec2 u_canvas;
uniform vec2 u_origin;
uniform float u_zoom;
uniform vec2 u_pan;
uniform bool u_tile3;
uniform bool u_half;
uniform bool u_flip;
uniform bool u_ndx;
uniform vec3 u_light;
uniform vec3 u_bg;
vec3 checker(vec2 fc) { vec2 c = floor(fc / 8.0); return mod(c.x + c.y, 2.0) < 1.0 ? vec3(0.42) : vec3(0.58); }
void main() {
  vec2 fc = gl_FragCoord.xy - u_origin;
  if (u_flip) fc.y = u_canvas.y - fc.y;
  float size = min(u_canvas.x, u_canvas.y) * u_zoom;
  vec2 uv = (fc - (u_canvas * 0.5 + u_pan)) / size + 0.5;
  if (u_tile3) uv = (uv - 0.5) * 3.0 + 0.5;
  float lim = u_tile3 ? 1.0 : 0.0;
  if (!u_has || any(lessThan(uv, vec2(-lim))) || any(greaterThanEqual(uv, vec2(1.0 + lim)))) {
    fragColor = vec4(u_bg, 1.0); return;
  }
  if (u_half) uv += 0.5;
  float texPerPx = float(textureSize(u_tex, 0).x) / size * (u_tile3 ? 3.0 : 1.0);
  vec4 c;
  if (texPerPx <= 1.0) {
    ivec2 ts = textureSize(u_tex, 0);
    ivec2 t = ivec2(floor(fract(uv) * vec2(ts)));
    c = texelFetch(u_tex, clamp(t, ivec2(0), ts - 1), 0);
  } else {
    // minification: box filter over the pixel footprint (n x n bilinear taps)
    int n = int(min(8.0, ceil(texPerPx * 0.5)));
    float fp = (u_tile3 ? 3.0 : 1.0) / size;
    c = vec4(0.0);
    for (int j = 0; j < 8; j++) {
      if (j >= n) break;
      for (int i = 0; i < 8; i++) {
        if (i >= n) break;
        c += texture(u_tex, uv + (vec2(float(i), float(j)) + 0.5) / float(n) * fp - 0.5 * fp);
      }
    }
    c /= float(n * n);
  }
  if (u_isColor) c.rgb = toSrgb(c.rgb);
  c = clamp(c, 0.0, 1.0);
  vec3 o;
  if (u_view == 0) o = c.rgb;
  else if (u_view == 1) o = mix(checker(fc), c.rgb, c.a);
  else if (u_view == 2) o = vec3(c.r);
  else if (u_view == 3) o = vec3(c.g);
  else if (u_view == 4) o = vec3(c.b);
  else if (u_view == 5) o = vec3(c.a);
  else {
    vec3 n = c.rgb * 2.0 - 1.0;
    if (u_ndx) n.y = -n.y;
    n = normalize(n + vec3(0.0, 0.0, 1e-6));
    float l = max(dot(n, normalize(u_light)), 0.0);
    o = toSrgb(vec3(0.03 + 0.97 * l) * vec3(0.8, 0.78, 0.74));
  }
  fragColor = vec4(o, 1.0);
}` };

  // User GLSL ("Код (GLSL)" node). The user writes
  //   vec4 process(vec2 uv, ivec2 px) { ... }
  // with in0..in3(px) / in0UV..in3UV(uv) readers and p1..p4 parameters.
  const custom = new Map();
  function registerCustom(code) {
    let h = 5381;
    for (let k = 0; k < code.length; k++) h = ((h * 33) ^ code.charCodeAt(k)) >>> 0;
    const name = 'code_' + h.toString(36) + '_' + code.length;
    if (!custom.has(name)) {
      let src = COMMON;
      for (let k = 0; k < 4; k++) src += inputSlot(k);
      src += 'uniform float u_p[4];\n#define p1 u_p[0]\n#define p2 u_p[1]\n#define p3 u_p[2]\n#define p4 u_p[3]\n';
      src += '#line 1\n' + code + '\nvoid main() { emit(process(pixUV() + u_uvOff, pix())); }\n';
      custom.set(name, src);
    }
    return name;
  }

  function build(name) {
    if (custom.has(name)) return custom.get(name);
    const s = S[name];
    if (!s) throw new Error('Нет шейдера ' + name);
    let src = COMMON;
    for (let i = 0; i < s.nin; i++) src += inputSlot(i);
    return src + s.body;
  }

  function define(name, def) { S[name] = def; }

  return { build, registerCustom, define, names: Object.keys(S), nin: (n) => S[n].nin };
})();
