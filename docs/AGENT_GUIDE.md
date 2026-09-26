# Pocket Texture Lab — guide for AI agents and scripts

Pocket Texture Lab is an offline, single-file, node-based procedural texture
editor (WebGL2). Everything the UI can do is also available from JavaScript
through the global object `window.PTL`. If you are an agent driving this page
(Playwright, Puppeteer, DevTools console, browser extension), use `PTL`
instead of clicking: it is faster, exact and every call is validated with
readable error messages.

## Quick start

```js
// 1. Discover node types, ports and parameters (with ranges/options/help)
PTL.nodeTypes();

// 2. Build a graph (each mutating call = one undo step; batch() groups them)
const ids = PTL.batch(() => {
  const noise = PTL.addNode('noise', { params: { scale: 8, octaves: 6, seed: 42 } });
  const blur  = PTL.addNode('gaussian', { params: { sigma: 2 } });
  const nrm   = PTL.addNode('normal', { params: { strength: 5, convention: 'dx' } });
  const out   = PTL.addNode('output', { params: { filename: 'rock_normal' } });
  PTL.connect(noise, 0, blur, 0);   // (fromNode, outputPort, toNode, inputPort)
  PTL.connect(blur, 0, nrm, 0);
  PTL.connect(nrm, 0, out, 0);
  return { noise, blur, nrm, out };
});
PTL.autoLayout();

// 3. Inspect results (fresh GPU evaluation, 8-bit RGBA exactly as exported)
PTL.stats(ids.nrm);                       // {min,max,mean} per channel
PTL.pixel(ids.nrm, 10, 20);               // [r,g,b,a] 0..255, x right, y down
const png = await PTL.renderPNG(ids.out, { size: 1024 });  // Uint8Array (PNG file)
await PTL.renderDataURL(ids.out);         // "data:image/png;base64,..."
await PTL.exportPNG(ids.out);             // triggers a browser download
```

## API reference

Discovery / state
- `PTL.help()` — this text.
- `PTL.nodeTypes()` — `[{type, title, category, inputs[], outputs[], params[{key,type,min,max,options,default,help}], presets[], help}]`.
- `PTL.getGraph()` — `{resolution, activeOutput, nodes:[{id,type,x,y,params}], links:[{from,fromPort,to,toPort}]}`.
- `PTL.getNode(id)`, `PTL.getParams(id)`, `PTL.errors()` (per-node errors, e.g. GLSL compile logs), `PTL.info()`.

Editing (all validated; unknown params/enum values throw with the list of valid ones)
- `PTL.addNode(type, {params, x, y})` → node id (e.g. `"n7"`). Without x/y the node is placed to the right.
- `PTL.setParams(id, {key: value, ...})`, `PTL.applyPreset(id, label)`, `PTL.moveNode(id, x, y)`.
- `PTL.connect(fromId, fromPort, toId, toPort)` — an input takes one link (replaces the old one); outputs fan out; cycles throw.
- `PTL.disconnect(toId, toPort)`, `PTL.removeNode(id)`, `PTL.duplicate(id)`.
- `PTL.setActiveOutput(outputId)`, `PTL.setResolution(256|512|1024|2048)`, `PTL.select(id)`.
- `PTL.batch(fn)` — several edits as one undo step. `PTL.undo()`, `PTL.redo()`, `PTL.autoLayout()`.
- `PTL.newProject()`, `PTL.examples()`, `PTL.loadExample(i)`.

Images and projects
- `await PTL.importImage(bytes | base64 | dataURL, {name, nodeId?, interp:'srgb'|'data', fit:'stretch'|'cover'|'tile'})` → image node id.
- `PTL.saveProject()` → project JSON object (images embedded as base64). `await PTL.loadProject(obj|string)`.

Rendering
- `PTL.render(id, {size, port})` → `{width, height, space, rgba: Uint8Array}` (file values, rows top→bottom).
- `await PTL.renderPNG(id, {size, port})` → PNG bytes (Uint8Array); `await PTL.renderPNGBase64(...)`, `await PTL.renderDataURL(...)`.
- `PTL.pixel(id, x, y, {size})`, `PTL.stats(id, {size})`, `await PTL.exportPNG(id?)` (download).
- `PTL.setView({mode:0..6, tile3, half})` — preview: 0 RGB, 1 RGBA, 2 R, 3 G, 4 B, 5 A, 6 lit normal; 3×3 tiling; half-offset.

## Conventions you must know

- Image coordinates: x → right, y → down, row 0 is the top row. UV = pixel centre / size.
- Spaces: `color` results are linear light inside and sRGB in files/preview; `data` results
  (masks, height, normals, packed channels) are written as-is, never gamma corrected.
  Levels, Invert, HSV, Grayscale, Color Ramp and the Code node work on file (sRGB) values.
- Missing inputs use documented defaults (see `inputs[].whenUnconnected`), usually black (0,0,0,1).
- Normals: tangent space, +X right, +Y up (OpenGL). `convention:'dx'` flips only green.
  Flat height → (128,128,255,255). `strength` = relief height in % of texture width.
- Tileable noise/voronoi use integer scale (periodic in u and v). Blur/normal with `wrap:'repeat'` sample across edges.
- Filter radii are in project pixels; lower-resolution previews scale them.

## Node types (ids)

Sources: `image`, `constant`, `noise`, `voronoi`, `shape`, `gradient`.
Adjust: `levels`, `invert`, `grayscale`, `ramp`, `hsv`, `blend` (inputs A=0, B=1, mask=2), `transform`.
Blur: `gaussian`, `dirblur`, `radialblur`. Normal: `normal`. Channels: `split` (outputs R,G,B,A = ports 0..3),
`combine` (inputs R,G,B,A = ports 0..3; presets `orm`, `hdrp`, `custom`; per channel `rSrc` R|G|B|A|L|C, `rVal`, `rInv`).
Custom code: `code`. Output: `output` (param `filename`).

## Writing new functionality: the `code` node (GLSL ES 3.00)

The `code` node runs your fragment function on the GPU for every pixel:

```glsl
vec4 process(vec2 uv, ivec2 px) {
  vec4 a = in0(px);                    // exact texel of input A (0..3 = A..D)
  vec4 b = in1UV(uv + vec2(0.01, 0.0)); // bilinear, wraps around (repeat)
  float n = float(pcg3(uvec3(uvec2(px), 7u)).x) / 4294967295.0; // hash noise
  return vec4(mix(a.rgb, b.rgb, p1), 1.0);   // p1..p4 = sliders
}
```

- Inputs arrive as file values (colour inputs sRGB-encoded). Unconnected input = (0,0,0,1).
- Helpers: `u_res` (vec2 size), `PI`, `LUMA`, `toLin()`, `toSrgb()`, `pcg3(uvec3)`, `wrapPx(ivec2, bool repeat)`, `pix()`, `pixUV()`.
- Param `space`: `data` (write numbers as-is) or `color` (returned values are sRGB).
- Compile errors appear in `PTL.errors()[id]` and in the node panel (line numbers match your code).
- For tileable results use only integer frequencies of `uv` and repeat sampling.

```js
const c = PTL.addNode('code', { params: {
  code: 'vec4 process(vec2 uv, ivec2 px){ float v = 0.5+0.5*sin(uv.x*6.2831853*p1*16.0); return vec4(vec3(v),1.0); }',
  p1: 0.25 } });
PTL.errors()[c];   // undefined when it compiled
```

## Typical recipes

- Packed ORM: masks → `combine` (preset `orm`) → `output`.
- HDRP mask: connect Roughness to port 3 of `combine` (preset `hdrp`) and set `aInv: true` (smoothness = 1 − roughness).
- Normal map for Unreal: `normal` with `convention:'dx'` or `PTL.applyPreset(id, 'Unreal / DirectX −Y')`.
- Check seams: `PTL.setView({tile3:true, half:true})`.
