// sRGB transfer functions (IEC 61966-2-1), CPU side. Must match SHADERS.COMMON.
const ColorUtil = {
  toLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); },
  toSrgb(c) { c = Math.max(c, 0); return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; },
  hex(c) {
    const h = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
    return '#' + h(c[0]) + h(c[1]) + h(c[2]);
  },
  fromHex(s) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
    return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0, 0, 0];
  },
  // GPU readback -> 8-bit file values. Colour textures are linear inside and
  // sRGB-encoded here; data textures are written as-is. RGB is kept even at A=0.
  toBytes(arr, space) {
    const n = arr.length, out = new Uint8Array(n);
    const color = space === 'color';
    if (arr instanceof Uint8Array) {
      for (let i = 0; i < n; i++) {
        out[i] = color && (i & 3) !== 3 ? Math.round(ColorUtil.toSrgb(arr[i] / 255) * 255) : arr[i];
      }
      return out;
    }
    for (let i = 0; i < n; i++) {
      let v = arr[i];
      if (color && (i & 3) !== 3) v = ColorUtil.toSrgb(v);
      v = v !== v ? 0 : v < 0 ? 0 : v > 1 ? 1 : v;
      out[i] = Math.round(v * 255);
    }
    return out;
  },
};
