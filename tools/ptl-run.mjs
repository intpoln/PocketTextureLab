// Run a PTL script headlessly and save its images.
//   node tools/ptl-run.mjs script.js [outDir]
// The script body runs inside the page as an async function with `PTL` in
// scope and may `return { images: { name: base64png, ... }, info: any,
// project: PTL.saveProject() }`. Images are written to outDir/name.png,
// the project (if returned) to outDir/project.ptl.json, and a screenshot of
// the UI to outDir/ui.png.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [scriptPath, outDir = 'ptl-out'] = process.argv.slice(2);
if (!scriptPath) { console.error('usage: node tools/ptl-run.mjs script.js [outDir]'); process.exit(2); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto('file://' + path.join(root, 'texture-lab.html'));
await page.waitForFunction(() => window.PTL);
const body = fs.readFileSync(scriptPath, 'utf8');
let out;
try {
  out = await page.evaluate((src) => new Function('return (async () => {\n' + src + '\n})()')(), body);
} catch (e) {
  console.error('script failed:', e.message);
  await browser.close();
  process.exit(1);
}
out = out || {};
for (const [k, v] of Object.entries(out.images || {})) fs.writeFileSync(path.join(outDir, k + '.png'), Buffer.from(v, 'base64'));
if (out.project) fs.writeFileSync(path.join(outDir, 'project.ptl.json'), JSON.stringify(out.project));
await page.evaluate(() => PTL.whenIdle());
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(outDir, 'ui.png') });
if (out.info !== undefined) console.log(JSON.stringify(out.info, null, 1));
console.log('saved to', outDir);
await browser.close();
