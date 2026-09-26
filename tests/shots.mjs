import { chromium } from 'playwright';
import path from 'node:path';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('file://' + path.resolve('texture-lab.html'));
await page.waitForTimeout(800);
const shot = async (n) => { await page.waitForTimeout(400); await page.screenshot({ path: `test-output/shot-${n}.png` }); };
// ramp selected
await page.evaluate(() => PTL.select('n3')); await shot('ramp');
await page.evaluate(() => { PTL.loadExample(1); PTL.select('n3'); PTL.setView({ mode: 6 }); }); await shot('normal-lit');
await page.evaluate(() => { PTL.loadExample(2); PTL.select('n4'); PTL.setView({ mode: 0, tile3: true, half: true }); }); await shot('combine');
await page.evaluate(() => { const c = PTL.addNode('code'); PTL.select(c); PTL.setView({ tile3: false, half: false }); }); await shot('code');
await page.click('#btn-help'); await shot('help');
await page.click('#modal-close'); await page.click('#btn-api'); await shot('api');
await browser.close();
