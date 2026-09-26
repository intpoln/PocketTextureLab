// Dev helper: screenshots of typical UI states into test-output/.
import { chromium } from 'playwright';
import path from 'node:path';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('file://' + path.resolve('texture-lab.html'));
await page.waitForFunction(() => window.PTL);
const shot = async (n, wait = 800) => { await page.evaluate(() => PTL.whenIdle()); await page.waitForTimeout(wait); await page.screenshot({ path: `test-output/shot-${n}.png` }); };
for (const [k, n] of [[3, 'brick'], [5, 'cobble'], [6, 'wood'], [2, 'panels']]) {
  await page.evaluate((k) => { PTL.loadExample(k); PTL.fitGraph(); }, k); await shot('tpl-' + n, 1500);
}
await page.evaluate(() => PTL.setView({ layout: '3d', material: { mesh: 'sphere', tiling: 2 } })); await shot('3d-sphere', 1500);
await page.evaluate(() => { PTL.loadExample(8); PTL.fitGraph(); }); await shot('fx-fire', 1500);
await page.evaluate(() => { const nz = PTL.getGraph().nodes.find((n) => n.type === 'noise').id; PTL.select(nz); }); await shot('fx-anim-param', 600);
await browser.close();
