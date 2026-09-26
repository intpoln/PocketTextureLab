// ---------------------------------------------------------------------------
// PNG: decoding via UPNG.js (+pako inflate), encoding via a minimal RGBA8
// writer on top of pako.deflate. Nothing here touches Canvas 2D, so RGB is
// preserved exactly even where A = 0.
// ---------------------------------------------------------------------------
const PNG = (() => {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes, start, end) {
    let c = 0xffffffff;
    for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  const u32 = (b, p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;

  function isPng(bytes) {
    if (bytes.length < 8) return false;
    for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return false;
    return true;
  }

  // Structural validation before handing the file to UPNG: chunk bounds, CRCs,
  // IHDR first, IDAT present, IEND reached. Gives clear errors for damaged files.
  function validate(bytes) {
    if (!isPng(bytes)) throw new Error('Файл не является PNG (неверная сигнатура).');
    let p = 8, sawIHDR = false, sawIDAT = false, sawIEND = false, first = true;
    while (p + 12 <= bytes.length) {
      const len = u32(bytes, p);
      const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
      if (p + 12 + len > bytes.length) throw new Error(`PNG повреждён: чанк ${type} обрезан.`);
      const crc = u32(bytes, p + 8 + len);
      if (crc32(bytes, p + 4, p + 8 + len) !== crc) throw new Error(`PNG повреждён: неверная контрольная сумма чанка ${type}.`);
      if (first && type !== 'IHDR') throw new Error('PNG повреждён: первый чанк не IHDR.');
      first = false;
      if (type === 'IHDR') sawIHDR = true;
      if (type === 'IDAT') sawIDAT = true;
      if (type === 'IEND') { sawIEND = true; break; }
      p += 12 + len;
    }
    if (!sawIHDR || !sawIDAT) throw new Error('PNG повреждён: нет данных изображения (IHDR/IDAT).');
    if (!sawIEND) throw new Error('PNG повреждён: файл обрезан (нет IEND).');
  }

  // Returns { width, height, rgba: Uint8Array, bitDepth, colorType, notes: [] }.
  // 16-bit channels are converted to 8 bit with rounding (v16 / 257), reported in notes.
  function decode(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    validate(bytes);
    let img;
    try {
      img = UPNG.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    } catch (e) {
      throw new Error('PNG повреждён или не поддерживается: ' + (e && e.message ? e.message : e));
    }
    const { width: w, height: h, depth, ctype } = img;
    if (!(w > 0 && h > 0)) throw new Error('PNG повреждён: нулевой размер.');
    if (w * h > 8192 * 8192) throw new Error('Изображение слишком большое (максимум 8192×8192).');
    const notes = [];
    if (img.tabs && img.tabs.acTL) notes.push('APNG: используется только первый кадр.');
    const bpp = UPNG.decode._getBPP(img);
    const need = Math.ceil((w * bpp) / 8) * h;
    if (!img.data || img.data.length < need) throw new Error('PNG повреждён: недостаточно данных изображения.');
    let rgba;
    if (depth === 16) {
      rgba = convert16(img, w, h);
      notes.push('16-битный PNG преобразован в 8 бит на канал (округление v/257).');
    } else {
      rgba = new Uint8Array(UPNG.toRGBA8.decodeImage(img.data, w, h, img).buffer);
    }
    if (img.tabs && (img.tabs.iCCP || img.tabs.gAMA)) notes.push('ICC-профиль / gAMA в файле игнорируются.');
    return { width: w, height: h, rgba, bitDepth: depth, colorType: ctype, notes };
  }

  function convert16(img, w, h) {
    const d = img.data, n = w * h, out = new Uint8Array(n * 4);
    const r16 = (i) => (d[i] << 8) | d[i + 1];
    const q = (v) => Math.round(v / 257);
    const tr = img.tabs.tRNS;
    const ct = img.ctype;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (ct === 6) { for (let c = 0; c < 4; c++) out[o + c] = q(r16(i * 8 + c * 2)); }
      else if (ct === 2) {
        const r = r16(i * 6), g = r16(i * 6 + 2), b = r16(i * 6 + 4);
        out[o] = q(r); out[o + 1] = q(g); out[o + 2] = q(b);
        out[o + 3] = tr && r === tr[0] && g === tr[1] && b === tr[2] ? 0 : 255;
      } else if (ct === 4) {
        const g = q(r16(i * 4)); out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = q(r16(i * 4 + 2));
      } else if (ct === 0) {
        const raw = r16(i * 2), g = q(raw); out[o] = out[o + 1] = out[o + 2] = g;
        out[o + 3] = tr != null && typeof tr === 'number' && raw === tr ? 0 : 255;
      } else throw new Error('Неподдерживаемый тип PNG.');
    }
    return out;
  }

  // Lossless RGBA8 encoder: colour type 6, bit depth 8, adaptive filters.
  function encode(rgba, w, h) { return assemble(w, h, pako.deflate(filterRows(rgba, w, h), { level: 6 })); }

  // Same bytes-in, but zlib via the browser's native CompressionStream when
  // available (much faster than pako for 1-2K textures); falls back to pako.
  async function encodeAsync(rgba, w, h) {
    const raw = filterRows(rgba, w, h);
    if (typeof CompressionStream === 'function') {
      try {
        const cs = new CompressionStream('deflate');
        const buf = await new Response(new Blob([raw]).stream().pipeThrough(cs)).arrayBuffer();
        return assemble(w, h, new Uint8Array(buf));
      } catch (e) { /* fall back */ }
    }
    return assemble(w, h, pako.deflate(raw, { level: 6 }));
  }

  function filterRows(rgba, w, h) {
    if (rgba.length !== w * h * 4) throw new Error('encode: размер буфера не совпадает');
    const stride = w * 4;
    const raw = new Uint8Array((stride + 1) * h);
    const c0 = new Uint8Array(stride), c1 = new Uint8Array(stride), c2 = new Uint8Array(stride),
      c3 = new Uint8Array(stride), c4 = new Uint8Array(stride);
    const cand = [c0, c1, c2, c3, c4];
    const zero = new Uint8Array(stride);
    const cost = (r) => (r < 128 ? r : 256 - r);
    for (let y = 0; y < h; y++) {
      const cur = rgba.subarray(y * stride, (y + 1) * stride);
      const up = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : zero;
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
      for (let x = 0; x < stride; x++) {
        const v = cur[x], b = up[x];
        const a = x >= 4 ? cur[x - 4] : 0, c = x >= 4 ? up[x - 4] : 0;
        const p = a + b - c;
        const pa = p > a ? p - a : a - p, pb = p > b ? p - b : b - p, pc = p > c ? p - c : c - p;
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        let r;
        r = v; c0[x] = r; s0 += cost(r);
        r = (v - a) & 255; c1[x] = r; s1 += cost(r);
        r = (v - b) & 255; c2[x] = r; s2 += cost(r);
        r = (v - ((a + b) >> 1)) & 255; c3[x] = r; s3 += cost(r);
        r = (v - pr) & 255; c4[x] = r; s4 += cost(r);
      }
      const sums = [s0, s1, s2, s3, s4];
      let best = 0;
      for (let f = 1; f < 5; f++) if (sums[f] < sums[best]) best = f;
      raw[y * (stride + 1)] = best;
      raw.set(cand[best], y * (stride + 1) + 1);
    }
    return raw;
  }

  function assemble(w, h, idat) {
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w); dv.setUint32(4, h);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const chunks = [chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
    const total = 8 + chunks.reduce((s, c) => s + c.length, 0);
    const outBytes = new Uint8Array(total);
    outBytes.set(SIG, 0);
    let p = 8;
    for (const c of chunks) { outBytes.set(c, p); p += c.length; }
    return outBytes;
  }
  function chunk(type, data) {
    const c = new Uint8Array(12 + data.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
    c.set(data, 8);
    dv.setUint32(8 + data.length, crc32(c, 4, 8 + data.length));
    return c;
  }

  return { decode, encode, encodeAsync, isPng, crc32 };
})();
