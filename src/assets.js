// ---------------------------------------------------------------------------
// Imported images. The original file bytes are kept (for embedding into the
// project) together with decoded 8-bit RGBA pixels (for GPU upload).
// Assets are immutable; undo snapshots only reference them by id.
// ---------------------------------------------------------------------------
const Assets = (() => {
  const store = new Map();
  let counter = 1;

  function newId() {
    let id;
    do id = 'img' + (counter++).toString(36) + Math.random().toString(36).slice(2, 6);
    while (store.has(id));
    return id;
  }

  function sniff(bytes) {
    if (PNG.isPng(bytes)) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    return null;
  }

  async function decodeJpeg(bytes) {
    let bmp;
    try {
      bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), {
        premultiplyAlpha: 'none', colorSpaceConversion: 'none',
      });
    } catch (e) {
      throw new Error('JPEG повреждён или не поддерживается браузером.');
    }
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const data = g.getImageData(0, 0, bmp.width, bmp.height).data; // JPEG is opaque: no alpha loss
    bmp.close && bmp.close();
    return { width: c.width, height: c.height, rgba: new Uint8Array(data.buffer.slice(0)), notes: [] };
  }

  // Decode file bytes into an asset. Throws Error with a readable message.
  async function add(bytes, name, forcedId) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const mime = sniff(bytes);
    if (!mime) throw new Error(`«${name}»: поддерживаются только PNG и JPEG.`);
    let dec;
    try {
      dec = mime === 'image/png' ? PNG.decode(bytes) : await decodeJpeg(bytes);
    } catch (e) {
      throw new Error(`«${name}»: ${e.message || e}`);
    }
    const id = forcedId || newId();
    const a = { id, name, mime, bytes, width: dec.width, height: dec.height, rgba: dec.rgba,
      notes: dec.notes || [], bitDepth: dec.bitDepth || 8, tex: {} };
    store.set(id, a);
    return a;
  }

  function get(id) { return id ? store.get(id) || null : null; }

  function texture(a, srgb) {
    const k = srgb ? 'srgb' : 'data';
    let t = a.tex[k];
    if (!t || t.gen !== GPU.gen) {
      t = GPU.uploadImage(a.rgba, a.width, a.height, srgb);
      a.tex[k] = t;
    }
    return t;
  }

  // After context loss all GPU handles are invalid; just forget them.
  function dropGpu() { for (const a of store.values()) a.tex = {}; }

  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromBase64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function serialize(ids) {
    const out = {};
    for (const id of ids) {
      const a = store.get(id);
      if (a) out[id] = { name: a.name, mime: a.mime, width: a.width, height: a.height, data: toBase64(a.bytes) };
    }
    return out;
  }

  async function loadSerialized(obj) {
    for (const id of Object.keys(obj || {})) {
      if (store.has(id)) continue;
      const e = obj[id];
      if (!e || typeof e.data !== 'string') throw new Error('Проект повреждён: неверная запись изображения ' + id);
      let bytes;
      try { bytes = fromBase64(e.data); } catch (err) { throw new Error('Проект повреждён: изображение ' + id + ' не в base64.'); }
      await add(bytes, e.name || id, id);
    }
  }

  return { add, get, texture, dropGpu, serialize, loadSerialized, toBase64, fromBase64, all: store };
})();
