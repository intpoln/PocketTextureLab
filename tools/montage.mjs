// node tools/montage.mjs out.png a.png b.png ...  — grid of equal-size PNGs (dev helper)
import { PNG } from 'pngjs';
import fs from 'node:fs';
const [out, ...files] = process.argv.slice(2);
const imgs = files.map((f) => PNG.sync.read(fs.readFileSync(f)));
const w = imgs[0].width, h = imgs[0].height, cols = Math.min(5, imgs.length), rows = Math.ceil(imgs.length / cols), gap = 4;
const o = new PNG({ width: cols * (w + gap), height: rows * (h + gap) });
o.data.fill(40);
imgs.forEach((im, k) => {
  const ox = (k % cols) * (w + gap), oy = Math.floor(k / cols) * (h + gap);
  for (let y = 0; y < Math.min(h, im.height); y++) for (let x = 0; x < Math.min(w, im.width); x++)
    for (let c = 0; c < 4; c++) o.data[((oy + y) * o.width + ox + x) * 4 + c] = c === 3 ? 255 : im.data[(y * im.width + x) * 4 + c];
});
fs.writeFileSync(out, PNG.sync.write(o));
