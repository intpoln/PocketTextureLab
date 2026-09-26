# Pocket Texture Lab — guide for AI agents and scripts

Author: intpoln — https://github.com/intpoln/PocketTextureLab

Pocket Texture Lab is an offline, single-file, node-based procedural texture
editor (WebGL2). Everything the UI can do is also available from JavaScript
through the global object `window.PTL`. If you are an agent driving this page
(Playwright, Puppeteer, DevTools console, browser extension), use `PTL`
instead of clicking: it is faster, exact and every call is validated with
readable error messages.

## If you are an AI agent that has just opened this page

You need nothing else — no repository, no install. Everything is in this file:

1. Run JavaScript in the page (DevTools console, Playwright/Puppeteer `page.evaluate`, a browser
   extension or «run JS» tool). The API is `window.PTL`; read `PTL.help()` (this text) and `PTL.nodeTypes()`.
2. For «make me a <material> texture»: start from the closest template (`PTL.examples()`), or build a graph
   from the recipes below. Keep 3 outputs with `usage` basecolor / normal / orm: `<name>_basecolor`, `<name>_normal`, `<name>_orm`.
   For particle effects build an animated graph and export a sprite sheet (see Animation below).
3. Verify with numbers (`PTL.stats`, `PTL.pixel`, `PTL.errors()`) and pictures (`await PTL.renderDataURL(id)`).
4. Deliver: `await PTL.exportAll()` downloads every Output as PNG; `PTL.saveProject()` returns the editable
   project JSON; or return `await PTL.renderPNGBase64(id)` to your caller.
5. The user sees the graph you build live in the UI and can keep editing it; `PTL.autoLayout()` tidies it.

If you drive the page from Node with Playwright in a headless sandbox, launch Chromium with
`--use-angle=swiftshader --enable-unsafe-swiftshader` (software WebGL2). Headless example:

```js
const page = await browser.newPage();
await page.goto('https://<host>/texture-lab.html'); // or file:///path/texture-lab.html
await page.waitForFunction(() => window.PTL);
const b64 = await page.evaluate(async () => { PTL.loadExample(4); return PTL.renderPNGBase64(PTL.getGraph().activeOutput); });
```

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
- `PTL.newProject()`, `PTL.examples()`, `PTL.getExample(i)` (graph JSON to study), `PTL.loadExample(i)`.
- Template parameters (a few knobs shown at project level when nothing is selected):
  `PTL.expose(id, key, label)`, `PTL.unexpose(id, key)`, `PTL.exposed()` → `[{node,key,label,value}]`,
  `PTL.setExposed(label, value)`.
- Colour gradients: `PTL.rampPresets()` (Magma, Inferno, Viridis, Fire, Water, Terrain, Rust, Wood, …);
  `PTL.setParams(rampId, {stops: PTL.rampPreset('Magma')})` or `PTL.applyPreset(rampId, 'Magma')`.
- Browser library (localStorage of this site): `PTL.library.saveNodePreset(id, name)`, `.nodePresets(type)`,
  `.saveTemplate(name)`, `.templates()`, `await .loadTemplate(name)`.
- `await PTL.exportAll()` — download every Output node as PNG.
- Material outputs: `PTL.addNode('output', {params:{usage:'basecolor'|'normal'|'orm', filename}})` — these three
  feed the 3D preview (`PTL.setView({layout:'3d'|'split', material:{mesh:'cube'|'sphere'|'cylinder'|'plane', tiling:2}})`).
- Animation (sprite sheets / flipbooks for particle FX):
  `PTL.animate(id, key, {from, to, curve})` (curve `linear` | `pingpong` | `smooth` | `easeIn` | `easeOut`),
  `PTL.unanimate(id, key)`, `PTL.animation({frames: 4|8|16|32|64, frameSize: 64|128|256|512, fps})` →
  `{layout:[cols,rows], sheet:[w,h]}`, `PTL.setFrame(k)`, `await PTL.renderSpriteSheet(id)` →
  `{width, height, cols, rows, png}`, `await PTL.exportSpriteSheet(id)`. Sheets are ALWAYS power-of-two
  (2×2, 4×2, 4×4, 8×4, 8×8 frames of 64–512 px), frames left→right, top→bottom.
  Seamless loops: frame k has t = k/N, so animate periodic params by exactly one period with `linear`:
  noise/voronoi `evolution` 0→1, waves `phase` 0→1, transform `offsetX/Y` 0→±1; or use `pingpong`.
  Transparency comes from Color Ramp stops with alpha (e.g. black α=0 → orange α=1).

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

## Node reference

Pin kinds (also coloured in the UI): **gray** = one value per pixel (mask/height), **color** = RGB(A),
**any** = either (output keeps what came in). A colour sent into a gray input is reduced to luminance.
`PTL.nodeTypes()` returns the same info (`description`, `inputs[].accepts`, `outputs[].produces`, params).

| id | inputs → outputs | what it is for |
|---|---|---|
| `noise` | — → gray | Perlin / Value / Worley / White noise; `fractal` fbm·ridged·billow; `scale` (int when tile), `stretch` (anisotropy), `octaves`, `persistence`, `lacunarity`, `warp`+`warpScale` (domain warp), `contrast`, `invert`, `grain` (white). Base of almost everything. |
| `voronoi` | — → gray | Cells: `mode` f1·f2·crackle(F2−F1)·border·cell (random value per cell); `metric` euclid·manhattan·chebyshev. Stones, cracks, scales, crystals. |
| `shape` | — → gray | One ellipse/rect/ring with softness; stamp for tiler/splatter or a mask. |
| `gradient` | — → gray | Linear/radial/angular ramps (not tileable). |
| `waves` | distort(gray) → gray | Sine/triangle/saw/square stripes with integer periods `countX`,`countY`; distort input = wood grain, marble. |
| `tiler` | pattern(gray) → pattern(gray), random(gray) | Tile Sampler: grid `countX×countY`, `rowOffset` (0.5 = bricks), size, `bevel`, random position/size/rotation/value, `density`, `blend` max·add·top. Presets: Кирпичи, Плитка, Паркет, Соты / горошек, Булыжник. Output 1 = random value per tile (use with `ramp` for per-brick colours). |
| `splatter` | pattern(gray) → pattern(gray), random(gray) | Scatter `count` copies (≤4000) of a disc/gauss/rect or the input, random size/rotation/value, `aspect` (tiny = scratches). Always tileable. |
| `image` | — → any | Imported PNG/JPEG (`interp` srgb/data, `fit`). |
| `constant` | — → gray/color | Flat value or colour. |
| `levels` | any → any | Remap/contrast/gamma; inBlack = inWhite gives a threshold. |
| `invert` | any → any | 1 − x per channel. |
| `grayscale` | any → gray | Luminance or one channel. |
| `ramp` | gray → color | Gradient map, 2–8 stops `{p, c:[r,g,b,a]}` in sRGB. The way to colour masks. |
| `hsv` | color → color | Hue shift, saturation, value. |
| `blend` | A any, B any, mask gray → any | mix/add/multiply/screen/min/max with `opacity` and mask. |
| `transform` | any → any | Offset/scale/rotate (repeat or clamp). |
| `warp` | image any, map gray → any | Displace image by a map: `directional` (angle) or `gradient`. Makes things organic. |
| `gaussian`, `dirblur`, `radialblur` | any → any | Blurs (radii in project pixels). |
| `normal` | height gray → color | Height → normal map; `strength` (% of width), `convention` gl/dx, `blur`. |
| `split` / `combine` | any → 4 gray / 4 gray → color | Channel (un)packing; combine presets `orm`, `hdrp`, `custom`. |
| `fx` | — → color (RGBA, alpha from palette), intensity (gray) | Animated particle/VFX sprites, always looping over the frame cycle: `effect` = flame · fire · explosion · smoke · smokeloop · sparks · sparkloop · lightning · electric · flare · star · shockwave · magic · orb · vortex · laser · slash · cloud · caustics; `stops` palette (gradient with alpha; presets incl. Magma, Fire, Energy, Magic, Electric, Smoke, Sun), `intensity`, `scale`, `loops`, `detail`, `count`, `thick`, `distort`, `twist`, `seed`, `background` transparent/black. One-shot effects (explosion, smoke, sparks, shockwave, slash) play once per cycle. |
| `glow` | any → any (image+glow), any (glow only) | Bloom: `threshold`, `knee`, `radius` (σ, 3 scales σ/2σ/4σ), `intensity`, `tint`, `alpha` (glow extends sprite alpha). Use after fx/emissive masks. |
| `polar` | any → any | Strip → circle (`toPolar`, `turns` integer) or circle → strip; e.g. waves → rings for magic circles/portals. |
| `code` | 4 any → any | Your GLSL per-pixel function (see below). |
| `output` | any → file | Export target (`filename`). Several outputs allowed; `setActiveOutput`. |

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

## How to make a game texture (method)

1. **Build a height map first** (gray): combine noises / tiler / splatter with `blend` (max, multiply, add)
   and shape it with `levels`. Everything else is derived from it.
2. **Normal**: `height → normal` (strength 2–8, blur 0.5–1 removes pixel noise). Use `convention:'dx'` for Unreal.
3. **Albedo**: masks → `ramp` (gradient map) for colour, variation via `tiler` output 1 or a large-scale
   noise multiplied in (`blend` multiply, opacity 0.3–0.6). Keep albedo mid-range (sRGB ~30–240).
4. **Roughness / AO / Metallic**: `levels`/`invert` of the height or masks → `combine` preset `orm` → `output`.
5. Add one `output` per map with `usage` basecolor / normal / orm and clear filenames; `setActiveOutput` on basecolor.
   Check the result in 3D: `PTL.setView({layout:'split'})`.
6. Check tiling with `PTL.setView({tile3:true, half:true})`, verify numbers with `PTL.stats(id)`, look at
   `await PTL.renderDataURL(id)`. Keep everything tileable: integer scales, repeat wrap, no gradients.
7. Scale: noise `scale` 2–4 = large forms, 8–16 = medium, 32–64 = fine detail. Use different seeds per layer.

Built-in examples you can read as templates: `PTL.examples()`, `PTL.getExample(i)` (graph JSON) or
`PTL.loadExample(i)`: 0 noise→levels→ramp, 1 noise→blur→normal, 2 masks→ORM, and full texture templates
(basecolor + normal + ORM outputs, exposed parameters): **3 brick wall, 4 asphalt with cracks, 5 cobblestone,
6 wood planks, 7 painted metal with chips and scratches**; example 2 = metal panels showing how masks are packed
into ORM; animated VFX flipbooks: **8 candle flame, 9 explosion with sparks, 10 magic circle, 11 lightning, 12 portal, 13 energy orb**. Fastest path for a request like «сделай асфальт»:
`PTL.loadExample(4)`, then tune it with `PTL.exposed()` / `PTL.setExposed(label, value)` or `PTL.setParams`.

## Recipes (node chains; params are good starting points)

- **Asphalt**: `noise{type:'white',grain:1,octaves:2}` → `levels{outWhite:0.35}` = fine grain;
  `splatter{pattern:'disc',count:4000,size:0.028,sizeRand:0.6,valRand:0.7,bevel:0.35,blend:'top'}` = aggregate;
  `blend{mode:'max'}`(grain, stones) = height → `ramp` dark greys → `blend multiply` with
  `noise{scale:3,warp:0.3}`→`levels{outBlack:0.75}` (stains); height → `normal{strength:2,blur:0.5}`.
  Cracks: `voronoi{mode:'crackle'}`→`levels` threshold, multiply into albedo, subtract from height.
- **Brick wall**: `tiler` preset «Кирпичи» → `warp{mode:'gradient',intensity:0.006}` with `noise{scale:16}` as map
  → `blend multiply` with `levels(noise){outBlack:0.72}` = height → `normal{strength:4}`.
  Colour: `ramp`(tiler output 1, reds/browns) mixed with mortar `constant` using `levels(height){inWhite:0.08}` as mask.
- **Cobblestone / flagstone** (template 5): `voronoi{mode:'border',scale:7,randomness:0.85}` warped by noise →
  `gaussian{sigma:5}` → `levels{inBlack:0.1,inWhite:0.7,gamma:2.2}` = domed stones with gaps; per-stone variation from
  `voronoi{mode:'cell'}` with the SAME seed/scale/randomness and the same warp; gaps = dirt ramp + splatter pebbles.
- **Tiles**: `tiler` preset «Плитка», `bevel` 0.03–0.06; grout mask = `levels(tiler){inWhite:0.05}` inverted.
- **Wood planks** (template 6): grain = `waves{countY:84,distort:14}` distorted by `noise{scale:1,stretch:4}` + knots
  (`splatter{pattern:'gauss',count:5,size:0.13,aspect:0.5}` added into the distortion) → `levels` to thin dark lines,
  × fine fibers `noise{type:'value',scale:4,stretch:32}`; planks `tiler{countX:2,countY:6,rowOffset:0.5}`; give each plank
  its own grain with `warp{mode:'directional',angle:90,intensity:0.5}` using tiler output 1 (random per plank) as map.
- **VFX flipbooks** (examples 8–13: candle flame, explosion + sparks, magic circle, lightning, portal, energy orb):
  use the `fx` node — `const f = PTL.addNode('fx', {params:{effect:'explosion'}})` (setting `effect` also loads its
  palette and defaults), combine several with `blend{mode:'screen'}` (e.g. explosion + sparks, orb + electric),
  tint with `PTL.applyPreset(f, 'Magma')`, then `PTL.animation({frames:64, frameSize:128})` and
  `await PTL.exportSpriteSheet(outId)`. Custom VFX: animate any params (noise `evolution`, transform offsets) or
  write a `code` node — the loop phase is not passed to code nodes, so drive them through animated `p1..p4`.
- **Marble**: `noise{warp:0.7,warpScale:2,fractal:'ridged'}` → `levels` → `ramp` white/grey veins.
- **Rock / cliff**: `noise{fractal:'ridged',scale:3,octaves:7}` + `voronoi{mode:'crackle',scale:6}` (blend multiply) →
  `warp` by another noise → `normal{strength:8}`; albedo = ramp of height + `hsv` tweak.
- **Ground / dirt**: `noise{fractal:'billow',scale:6}` + `splatter` pebbles (small discs, `blend:'max'`) → ramp browns.
- **Scratched metal**: base `noise{type:'value',stretch:8,scale:2}` (brushed) + `splatter{pattern:'square',aspect:0.01,size:0.3,count:80,rotRand:15,bevel:0}`
  (scratches) → roughness via `levels`; metallic = constant 1 → `combine{preset:'orm'}`.
- **Rust**: `noise{warp:0.5}` → `levels` threshold → mask; `blend mix` metal colour vs rust `ramp` (oranges) with that mask.
- **Concrete**: `noise{scale:4}` + `noise{type:'white'}` small pores via `splatter{pattern:'gauss',count:2000,size:0.01}` inverted.
- **Fabric**: `waves{countX:64}` × `waves{countY:64}` (blend multiply), `warp` tiny noise.

If a pattern is hard to express with nodes, write it in one `code` node (below) — e.g. a whole asphalt:

```glsl
// A = height from other nodes (optional). p1 = stone density, p2 = darkness.
vec4 process(vec2 uv, ivec2 px) {
  vec2 g = uv * 64.0;                       // 64 cells: integer => tileable
  vec2 i = floor(g), f = fract(g);
  float d = 9.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = mod(i + vec2(x, y), 64.0);
    uvec3 h = pcg3(uvec3(uvec2(c), 7u));
    vec2 o = vec2(h.xy >> 8u) / 16777215.0;
    float r = length(vec2(x, y) + o - f);
    if (r < d) { d = r; id = float(h.z >> 8u) / 16777215.0; }
  }
  float stone = smoothstep(0.55, 0.2, d) * step(id, p1);
  float v = mix(0.12, 0.45, stone * (0.5 + 0.5 * id)) * (1.0 - 0.3 * p2);
  return vec4(vec3(v), 1.0);
}
```

## More small recipes

- Packed ORM: masks → `combine` (preset `orm`) → `output`.
- HDRP mask: connect Roughness to port 3 of `combine` (preset `hdrp`) and set `aInv: true` (smoothness = 1 − roughness).
- Normal map for Unreal: `normal` with `convention:'dx'` or `PTL.applyPreset(id, 'Unreal / DirectX −Y')`.
- Check seams: `PTL.setView({tile3:true, half:true})`.
