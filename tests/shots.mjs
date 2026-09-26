// Dev helper: screenshots of typical UI states into test-output/.
import { chromium } from 'playwright';
import path from 'node:path';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('file://' + path.resolve('texture-lab.html'));
await page.waitForFunction(() => window.PTL);
const shot = async (n) => { await page.evaluate(() => PTL.whenIdle()); await page.waitForTimeout(500); await page.screenshot({ path: `test-output/shot-${n}.png` }); };
await page.evaluate(() => PTL.select('n3')); await shot('ramp');
await page.evaluate(() => { PTL.loadExample(1); PTL.select('n3'); PTL.setView({ mode: 6 }); }); await shot('normal-lit');
await page.evaluate(() => { PTL.loadExample(2); PTL.select('n4'); PTL.setView({ mode: 0, tile3: true, half: true }); }); await shot('combine');
await page.evaluate(() => { PTL.setView({ tile3: false, half: false }); PTL.loadExample(3); PTL.fitGraph(); }); await shot('template-brick');
await page.evaluate(() => { const t = PTL.getGraph().nodes.find((n) => n.type === 'tiler').id; PTL.select(t); }); await shot('tiler');
await page.evaluate(() => { PTL.loadExample(6); }); await shot('template-wood');
await page.click('#btn-lib'); await shot('library');
await page.click('#modal-close'); await page.click('#btn-help'); await shot('help');
await browser.close();
