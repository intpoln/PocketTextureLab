// ---------------------------------------------------------------------------
// GPU: one WebGL2 context, offscreen framebuffer passes, texture pool.
//
// Orientation convention (used everywhere, no hidden flips):
//   texel (x, y) == image pixel (x, y), y = 0 is the TOP row of the image.
//   Fragment shaders write texel (x, y) at gl_FragCoord.xy = (x+.5, y+.5),
//   uploads use UNPACK_FLIP_Y = false, readPixels returns row 0 first,
//   so PNG rows map 1:1 to texture rows. Only the on-screen display pass
//   flips Y, because the canvas' default framebuffer has y = 0 at the bottom.
// ---------------------------------------------------------------------------
const GPU = (() => {
  const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  const st = {
    gl: null, canvas: null, lost: false, float: false, precisionNote: '',
    programs: new Map(), fbo: null, vao: null, samplers: {}, dummy: null,
    pool: new Map(), live: 0, bytes: 0, gen: 0, renderer: '',
  };

  function init(canvas, opts = {}) {
    st.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
    });
    if (!gl) return false;
    st.gl = gl;
    setup(opts);
    return true;
  }

  function setup(opts = {}) {
    const gl = st.gl;
    st.gen++;
    st.programs.clear();
    st.pool.clear();
    st.live = 0;
    st.bytes = 0;
    st.fbo = gl.createFramebuffer();
    st.vao = gl.createVertexArray();
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.DITHER);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    const mk = (min, mag, wrap) => {
      const s = gl.createSampler();
      gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, min);
      gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, mag);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, wrap);
      gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, wrap);
      return s;
    };
    st.samplers = {
      repeat: mk(gl.LINEAR, gl.LINEAR, gl.REPEAT),
      clamp: mk(gl.LINEAR, gl.LINEAR, gl.CLAMP_TO_EDGE),
      mipRepeat: mk(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR, gl.REPEAT),
      mipClamp: mk(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR, gl.CLAMP_TO_EDGE),
      nearest: mk(gl.NEAREST, gl.NEAREST, gl.REPEAT),
    };
    st.dummy = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, st.dummy);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    st.float = !opts.forceRGBA8 && detectFloat();
    st.precisionNote = st.float
      ? 'Промежуточные результаты: RGBA16F (half float).'
      : 'Промежуточные результаты: RGBA8 — точность ограничена 8 битами на канал (нет поддержки рендеринга в float-текстуры). Цветные изображения во внутреннем линейном виде теряют точность в тенях.';
  }

  // Real check: RGBA16F must be colour-renderable, filterable (core in WebGL2)
  // and actually hold a value that 8 bits cannot represent.
  function detectFloat() {
    const gl = st.gl;
    if (!gl.getExtension('EXT_color_buffer_float')) return false;
    gl.getExtension('EXT_float_blend');
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, 2, 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    let ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    if (ok) {
      gl.viewport(0, 0, 2, 2);
      gl.clearColor(0.1234, 1.5, 0.5, 0.25);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const px = new Float32Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
      ok = Math.abs(px[0] - 0.1234) < 0.001 && Math.abs(px[1] - 1.5) < 0.01 && gl.getError() === gl.NO_ERROR;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteTexture(t);
    return ok;
  }

  function compile(name, fsrc) {
    const gl = st.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(s);
        console.warn(name, log, src.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n'));
        throw new Error('Ошибка компиляции шейдера ' + name + ': ' + log);
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost())
      throw new Error('Ошибка линковки ' + name + ': ' + gl.getProgramInfoLog(p));
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const base = info.name.replace(/\[0\]$/, '');
      uniforms[base] = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size };
    }
    return { p, uniforms };
  }

  function program(name) {
    let pr = st.programs.get(name);
    if (!pr) {
      pr = compile(name, SHADERS.build(name));
      st.programs.set(name, pr);
    }
    return pr;
  }

  // --- textures ------------------------------------------------------------
  // A "Tex" is { tex, size, fmt, gen }. Pool keyed by size/format.
  function fmtOf() { return st.float ? 'f16' : 'u8'; }
  function acquire(size) {
    const key = size + ':' + fmtOf();
    const list = st.pool.get(key);
    if (list && list.length) return list.pop();
    const gl = st.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, st.float ? gl.RGBA16F : gl.RGBA8, size, size);
    st.live++;
    st.bytes += size * size * (st.float ? 8 : 4);
    return { tex, size, fmt: fmtOf(), gen: st.gen };
  }
  function release(t) {
    if (!t || t.gen !== st.gen) return;
    const key = t.size + ':' + t.fmt;
    let list = st.pool.get(key);
    if (!list) st.pool.set(key, (list = []));
    list.push(t);
    trimPool();
  }
  // Keep a bounded number of idle textures; free the rest.
  function trimPool() {
    let idle = 0;
    for (const [, list] of st.pool) idle += list.length;
    if (idle <= 12) return;
    for (const [key, list] of st.pool) {
      const size = +key.split(':')[0];
      while (list.length && (idle > 12 || size >= 2048)) {
        const t = list.pop();
        st.gl.deleteTexture(t.tex);
        st.live--;
        st.bytes -= t.size * t.size * (t.fmt === 'f16' ? 8 : 4);
        idle--;
      }
    }
  }
  function freeAll() {
    for (const [, list] of st.pool) for (const t of list) { st.gl.deleteTexture(t.tex); st.live--; st.bytes -= t.size * t.size * (t.fmt === 'f16' ? 8 : 4); }
    st.pool.clear();
  }

  // Upload an 8-bit RGBA image. srgb=true -> SRGB8_ALPHA8 (hardware decodes to
  // linear before filtering), else RGBA8 raw data. Mipmapped for downscaling.
  function uploadImage(rgba, w, h, srgb) {
    const gl = st.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, w, h);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.generateMipmap(gl.TEXTURE_2D);
    return { tex, w, h, gen: st.gen };
  }
  function deleteImage(t) { if (t && t.gen === st.gen) st.gl.deleteTexture(t.tex); }

  // --- passes --------------------------------------------------------------
  // run(name, target|null, uniforms, opts). Uniform values that are
  // { tex } objects are bound to texture units; opts.samplers maps uniform
  // name -> sampler kind for filtered (texture()) reads.
  function run(name, target, uniforms, opts = {}) {
    const gl = st.gl;
    const pr = program(name);
    gl.useProgram(pr.p);
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.tex, 0);
      gl.viewport(0, 0, target.size, target.size);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const vp = opts.viewport || [0, 0, opts.width, opts.height];
      gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    }
    let unit = 0;
    for (const uname in pr.uniforms) {
      const u = pr.uniforms[uname];
      if (u.type === gl.SAMPLER_2D) {
        let v = uniforms[uname];
        gl.activeTexture(gl.TEXTURE0 + unit);
        const valid = v && v.tex && v.gen === st.gen;
        gl.bindTexture(gl.TEXTURE_2D, valid ? v.tex : st.dummy);
        gl.bindSampler(unit, st.samplers[(opts.samplers && opts.samplers[uname]) || 'repeat']);
        gl.uniform1i(u.loc, unit);
        unit++;
        continue;
      }
      if (!(uname in uniforms)) continue;
      setUniform(u, uniforms[uname]);
    }
    gl.bindVertexArray(st.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (target) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    for (let i = 0; i < unit; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindSampler(i, null);
    }
  }

  function setUniform(u, v) {
    const gl = st.gl, L = u.loc;
    const arr = (x) => (Array.isArray(x) || ArrayBuffer.isView(x) ? x : [x]);
    switch (u.type) {
      case gl.FLOAT: u.size > 1 ? gl.uniform1fv(L, arr(v)) : gl.uniform1f(L, +v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(L, arr(v).flat()); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(L, arr(v).flat()); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(L, arr(v).flat()); break;
      case gl.INT: u.size > 1 ? gl.uniform1iv(L, arr(v).map((x) => x | 0)) : gl.uniform1i(L, v | 0); break;
      case gl.INT_VEC2: gl.uniform2iv(L, arr(v)); break;
      case gl.BOOL: u.size > 1 ? gl.uniform1iv(L, arr(v).map((x) => (x ? 1 : 0))) : gl.uniform1i(L, v ? 1 : 0); break;
      case gl.BOOL_VEC4: gl.uniform4iv(L, arr(v).map((x) => (x ? 1 : 0))); break;
      default: throw new Error('uniform type ' + u.type);
    }
  }

  // Read a texture back as Float32 (float path) or Uint8 (RGBA8 fallback).
  function read(t, x = 0, y = 0, w = t.size, h = t.size) {
    const gl = st.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    let out;
    if (t.fmt === 'f16') {
      out = new Float32Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, out);
    } else {
      out = new Uint8Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    }
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  // Small RGBA8 render target for thumbnails (read back once per change).
  let thumbT = null;
  function renderThumb(name, uniforms, size, opts) {
    const gl = st.gl;
    if (!thumbT || thumbT.gen !== st.gen || thumbT.size !== size) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size, size);
      thumbT = { tex, size, fmt: 'u8', gen: st.gen };
    }
    run(name, thumbT, uniforms, opts);
    return read(thumbT);
  }

  return {
    init, setup, run, read, acquire, release, freeAll, uploadImage, deleteImage, renderThumb,
    get gl() { return st.gl; },
    get float() { return st.float; },
    get precisionNote() { return st.precisionNote; },
    get gen() { return st.gen; },
    get liveTextures() { return st.live; },
    get textureBytes() { return st.bytes; },
    get renderer() {
      if (!st.renderer && st.gl) {
        const ext = st.gl.getExtension('WEBGL_debug_renderer_info');
        st.renderer = (ext && st.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || st.gl.getParameter(st.gl.RENDERER) || 'WebGL2';
      }
      return st.renderer;
    },
    isLost() { return !st.gl || st.gl.isContextLost(); },
  };
})();
