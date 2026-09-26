// ---------------------------------------------------------------------------
// 3D material preview: renders Base Color + Normal + ORM (from Output nodes
// with the matching "usage") on a mesh with a metallic/roughness PBR shader
// (GGX specular, Lambert diffuse, one directional light + simple sky/ground
// environment, ACES tone mapping). Uses the same WebGL2 context and the
// cached preview textures (copied into mipmapped textures for clean filtering).
//
// Tangent frame: T = direction of +u, B = direction of +v where v points DOWN
// the image (row 0 = top). OpenGL (+Y) normal maps have green pointing UP the
// image, i.e. along −B; DirectX (−Y) along +B.
// ---------------------------------------------------------------------------
const Material3D = (() => {
  const VS = `#version 300 es
in vec3 a_pos; in vec3 a_nrm; in vec4 a_tan; in vec2 a_uv;
uniform mat4 u_mvp; uniform mat4 u_model;
out vec3 v_wpos; out vec3 v_n; out vec4 v_t; out vec2 v_uv;
void main() {
  vec4 w = u_model * vec4(a_pos, 1.0);
  v_wpos = w.xyz;
  v_n = mat3(u_model) * a_nrm;
  v_t = vec4(mat3(u_model) * a_tan.xyz, a_tan.w);
  v_uv = a_uv;
  gl_Position = u_mvp * vec4(a_pos, 1.0);
}`;
  const FS = `#version 300 es
precision highp float;
in vec3 v_wpos; in vec3 v_n; in vec4 v_t; in vec2 v_uv;
uniform sampler2D u_base; uniform sampler2D u_nrm; uniform sampler2D u_orm;
uniform bool u_hasBase, u_hasN, u_hasORM, u_baseLinear, u_ndx;
uniform float u_tiling, u_lightI, u_envI, u_nStrength;
uniform vec3 u_L, u_cam, u_sky, u_ground;
out vec4 fragColor;
const float PI = 3.14159265;
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 env(vec3 d, float rough) {
  float h = d.y;
  vec3 sky = mix(u_sky * 1.2, u_sky * 0.6, clamp(h, 0.0, 1.0));
  vec3 c = mix(u_ground, sky, smoothstep(-0.25 - rough * 0.5, 0.25 + rough * 0.5, h));
  float sun = pow(max(dot(d, u_L), 0.0), mix(400.0, 4.0, rough)) * mix(6.0, 0.4, rough);
  return c + sun * vec3(1.0, 0.95, 0.85);
}
void main() {
  vec2 uv = v_uv * u_tiling;
  vec3 base = vec3(0.6);
  float alpha = 1.0;
  if (u_hasBase) { vec4 b = texture(u_base, uv); base = u_baseLinear ? b.rgb : toLin(b.rgb); alpha = b.a; }
  vec3 orm = u_hasORM ? texture(u_orm, uv).rgb : vec3(1.0, 0.5, 0.0);
  float ao = orm.r, rough = clamp(orm.g, 0.04, 1.0), metal = clamp(orm.b, 0.0, 1.0);
  vec3 N = normalize(v_n);
  vec3 T = normalize(v_t.xyz - N * dot(N, v_t.xyz));
  vec3 B = cross(N, T) * v_t.w;                  // +v (image down)
  if (u_hasN) {
    vec3 n = texture(u_nrm, uv).rgb * 2.0 - 1.0;
    if (!u_ndx) n.y = -n.y;                      // OpenGL: +Y up the image = -B
    n.xy *= u_nStrength;
    N = normalize(T * n.x + B * n.y + N * n.z);
  }
  vec3 V = normalize(u_cam - v_wpos), L = normalize(u_L), H = normalize(V + L);
  float NdL = max(dot(N, L), 0.0), NdV = max(dot(N, V), 1e-4), NdH = max(dot(N, H), 0.0), VdH = max(dot(V, H), 0.0);
  float a = rough * rough, a2 = a * a;
  float D = a2 / (PI * pow(NdH * NdH * (a2 - 1.0) + 1.0, 2.0));
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = (NdV / (NdV * (1.0 - k) + k)) * (NdL / (NdL * (1.0 - k) + k));
  vec3 F0 = mix(vec3(0.04), base, metal);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdH, 5.0);
  vec3 spec = D * G * F / max(4.0 * NdV * NdL, 1e-4);
  vec3 kd = (1.0 - F) * (1.0 - metal);
  vec3 direct = (kd * base / PI + spec) * NdL * u_lightI * vec3(1.0, 0.97, 0.92) * PI;
  vec3 Fv = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - NdV, 5.0);
  vec3 irr = mix(u_ground, u_sky, 0.5 + 0.5 * N.y);
  vec3 ambient = (kd * base * irr + Fv * env(reflect(-V, N), rough)) * ao * u_envI;
  vec3 c = aces(direct + ambient);
  fragColor = vec4(toSrgb(c), 1.0);
}`;

  const st = { gen: -1, prog: null, loc: {}, meshes: {}, sampler: null, mips: {}, aniso: null };

  // ---------------------------------------------------------------- meshes
  function pushFace(out, N, U, V, center, half, seg) {
    // U = +u direction, V = +v (image down) on this face; w = handedness of B = cross(N,T)*w
    const cr = [N[1] * U[2] - N[2] * U[1], N[2] * U[0] - N[0] * U[2], N[0] * U[1] - N[1] * U[0]];
    const w = cr[0] * V[0] + cr[1] * V[1] + cr[2] * V[2] >= 0 ? 1 : -1;
    const base = out.pos.length / 3;
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) {
      const u = i / seg, v = j / seg;
      for (let c = 0; c < 3; c++) out.pos.push(center[c] + (u - 0.5) * 2 * half * U[c] + (v - 0.5) * 2 * half * V[c]);
      out.nrm.push(...N); out.tan.push(...U, w); out.uv.push(u, v);
    }
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
      const a = base + j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
      out.idx.push(a, c, b, b, c, d);
    }
  }
  function orient(out) {
    // make triangles counter-clockwise when seen from the normal side
    for (let t = 0; t < out.idx.length; t += 3) {
      const [i0, i1, i2] = [out.idx[t], out.idx[t + 1], out.idx[t + 2]];
      const p = (i) => out.pos.slice(i * 3, i * 3 + 3);
      const a = p(i0), b = p(i1), c = p(i2);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const nn = out.nrm.slice(i0 * 3, i0 * 3 + 3);
      if (n[0] * nn[0] + n[1] * nn[1] + n[2] * nn[2] < 0) { out.idx[t + 1] = i2; out.idx[t + 2] = i1; }
    }
    return out;
  }
  function cube() {
    const o = { pos: [], nrm: [], tan: [], uv: [], idx: [] };
    const faces = [ // N, U (+u), V (+v = image down)
      [[0, 0, 1], [1, 0, 0], [0, -1, 0]], [[0, 0, -1], [-1, 0, 0], [0, -1, 0]],
      [[1, 0, 0], [0, 0, -1], [0, -1, 0]], [[-1, 0, 0], [0, 0, 1], [0, -1, 0]],
      [[0, 1, 0], [1, 0, 0], [0, 0, 1]], [[0, -1, 0], [1, 0, 0], [0, 0, -1]],
    ];
    for (const [N, U, V] of faces) pushFace(o, N, U, V, N.map((x) => x * 0.8), 0.8, 1);
    return orient(o);
  }
  function plane() {
    const o = { pos: [], nrm: [], tan: [], uv: [], idx: [] };
    pushFace(o, [0, 1, 0], [1, 0, 0], [0, 0, 1], [0, 0, 0], 1.2, 1);
    return orient(o);
  }
  function sphere(nu = 96, nv = 48) {
    const o = { pos: [], nrm: [], tan: [], uv: [], idx: [] };
    for (let j = 0; j <= nv; j++) {
      const v = j / nv, th = v * Math.PI;                  // from north pole down
      for (let i = 0; i <= nu; i++) {
        const u = i / nu, ph = u * 2 * Math.PI;
        const n = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
        o.pos.push(n[0], n[1], n[2]); o.nrm.push(...n);
        const t = [Math.cos(ph), 0, -Math.sin(ph)];        // +u (east)
        o.tan.push(...t, 1); o.uv.push(u * 2, v);           // 2:1 so texels stay square
      }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      o.idx.push(a, c, b, b, c, d);
    }
    // handedness: B must be dP/dv (south); fix w per vertex
    for (let k = 0; k < o.nrm.length / 3; k++) {
      const n = o.nrm.slice(k * 3, k * 3 + 3), t = o.tan.slice(k * 4, k * 4 + 3);
      const cr = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
      o.tan[k * 4 + 3] = cr[1] <= 0 ? 1 : -1;               // south has negative y
    }
    return orient(o);
  }
  function cylinder(nu = 96) {
    const o = { pos: [], nrm: [], tan: [], uv: [], idx: [] };
    for (let j = 0; j <= 1; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, ph = u * 2 * Math.PI, y = j === 0 ? 1 : -1;
      const n = [Math.sin(ph), 0, Math.cos(ph)];
      o.pos.push(n[0] * 0.8, y, n[2] * 0.8); o.nrm.push(...n); o.tan.push(Math.cos(ph), 0, -Math.sin(ph), 0); o.uv.push(u * 2, j);
    }
    for (let i = 0; i < nu; i++) { const a = i, b = i + 1, c = a + nu + 1, d = c + 1; o.idx.push(a, c, b, b, c, d); }
    for (let k = 0; k < o.nrm.length / 3; k++) {
      const n = o.nrm.slice(k * 3, k * 3 + 3), t = o.tan.slice(k * 4, k * 4 + 3);
      const cr = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
      o.tan[k * 4 + 3] = cr[1] <= 0 ? 1 : -1;
    }
    pushFace(o, [0, 1, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], 0.8, 1);
    o.idx.splice(o.idx.length - 6);   // replace square cap by a disc fan below
    const capBase = o.pos.length / 3;
    for (const y of [1, -1]) {
      const c0 = o.pos.length / 3;
      o.pos.push(0, y, 0); o.nrm.push(0, y, 0); o.tan.push(1, 0, 0, 1); o.uv.push(0.5, 0.5);
      for (let i = 0; i <= nu; i++) {
        const ph = (i / nu) * 2 * Math.PI, x = Math.sin(ph) * 0.8, z = Math.cos(ph) * 0.8;
        o.pos.push(x, y, z); o.nrm.push(0, y, 0); o.tan.push(1, 0, 0, y > 0 ? 1 : -1); o.uv.push(0.5 + x / 1.6, 0.5 + (y > 0 ? z : -z) / 1.6);
      }
      for (let i = 0; i < nu; i++) o.idx.push(c0, c0 + 1 + i, c0 + 2 + i);
    }
    void capBase;
    return orient(o);
  }

  // ---------------------------------------------------------------- GL setup
  function setup() {
    const gl = GPU.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error('3D shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(p, 0, 'a_pos'); gl.bindAttribLocation(p, 1, 'a_nrm'); gl.bindAttribLocation(p, 2, 'a_tan'); gl.bindAttribLocation(p, 3, 'a_uv');
    gl.linkProgram(p);
    st.prog = p;
    st.loc = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); st.loc[u.name] = gl.getUniformLocation(p, u.name); }
    st.meshes = {};
    for (const [name, gen] of Object.entries({ cube, sphere, plane, cylinder })) {
      const m = gen(), vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      [[m.pos, 3], [m.nrm, 3], [m.tan, 4], [m.uv, 2]].forEach(([arr, size], k) => {
        const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(k); gl.vertexAttribPointer(k, size, gl.FLOAT, false, 0, 0);
      });
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(m.idx), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      st.meshes[name] = { vao, count: m.idx.length };
    }
    st.sampler = gl.createSampler();
    gl.samplerParameteri(st.sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.samplerParameteri(st.sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.samplerParameteri(st.sampler, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.samplerParameteri(st.sampler, gl.TEXTURE_WRAP_T, gl.REPEAT);
    st.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (st.aniso) gl.samplerParameterf(st.sampler, st.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(st.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    st.mips = {};
    st.gen = GPU.gen;
  }

  // Copy a cached result into a mipmapped texture (only when it changed).
  function mipOf(slot, out, key) {
    const gl = GPU.gl;
    let m = st.mips[slot];
    const size = out.tex.size;
    if (!m || m.size !== size) {
      if (m) gl.deleteTexture(m.tex);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, Math.log2(size) + 1, GPU.float ? gl.RGBA16F : gl.RGBA8, size, size);
      m = st.mips[slot] = { tex, size, key: null };
    }
    if (m.key !== key) {
      GPU.run('copy', { tex: m.tex, size, fmt: 'mip', gen: GPU.gen }, { u_in0: out.tex, u_has0: true, u_col0: false, u_conv0: 0, u_def0: [0, 0, 0, 1], u_res: [size, size], u_outConv: 0 });
      gl.bindTexture(gl.TEXTURE_2D, m.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);
      m.key = key;
    }
    return m.tex;
  }

  // ---------------------------------------------------------------- math
  const mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
  const persp = (fov, asp, n, f) => { const t = 1 / Math.tan(fov / 2); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]); };
  const rotY = (a) => new Float32Array([Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]);
  const rotX = (a) => new Float32Array([1, 0, 0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 0, 1]);
  const trans = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

  // ---------------------------------------------------------------- draw
  // region: [x, y, w, h] in GL canvas pixels (y from bottom). m: { base, normal, orm } = { out, key, linear, dx } | null
  function draw(region, m, o) {
    if (GPU.isLost()) return;
    if (st.gen !== GPU.gen) setup();
    const gl = GPU.gl;
    const [x, y, w, h] = region;
    // prepare mipmapped copies first (offscreen passes must not be scissored)
    const slots = [['base', 'u_base', 'u_hasBase'], ['normal', 'u_nrm', 'u_hasN'], ['orm', 'u_orm', 'u_hasORM']];
    const texs = slots.map(([k]) => (m[k] ? mipOf(k, m[k].out, m[k].key) : null));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(x, y, w, h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, w, h);
    gl.clearColor(0.075, 0.08, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.useProgram(st.prog);
    const L = st.loc;
    const model = mul(rotX(o.pitch), rotY(o.yaw));
    const view = trans(0, 0, -o.dist);
    const proj = persp(0.7, w / h, 0.1, 50);
    gl.uniformMatrix4fv(L.u_mvp, false, mul(proj, mul(view, model)));
    gl.uniformMatrix4fv(L.u_model, false, model);
    gl.uniform3f(L.u_cam, 0, 0, o.dist);
    const az = (o.az * Math.PI) / 180, el = (o.el * Math.PI) / 180;
    gl.uniform3f(L.u_L, Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    gl.uniform1f(L.u_lightI, o.light); gl.uniform1f(L.u_envI, o.env); gl.uniform1f(L.u_tiling, o.tiling); gl.uniform1f(L.u_nStrength, o.nStrength);
    gl.uniform3f(L.u_sky, 0.55, 0.62, 0.72); gl.uniform3f(L.u_ground, 0.16, 0.14, 0.12);
    slots.forEach(([k, su, hu], unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      const src = m[k];
      gl.bindTexture(gl.TEXTURE_2D, texs[unit]);
      gl.bindSampler(unit, st.sampler);
      gl.uniform1i(L[su], unit);
      gl.uniform1i(L[hu], src ? 1 : 0);
    });
    gl.uniform1i(L.u_baseLinear, m.base && m.base.linear ? 1 : 0);
    gl.uniform1i(L.u_ndx, m.normal && m.normal.dx ? 1 : 0);
    const mesh = st.meshes[o.mesh] || st.meshes.cube;
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    for (let u = 0; u < 3; u++) { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, null); gl.bindSampler(u, null); }
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
  }

  return { draw };
})();
