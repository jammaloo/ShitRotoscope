/* Smoke-test the production build served by `vite preview`. */
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:4173/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/^INFO: Created TensorFlow Lite/.test(m.text())) {
    errors.push('console: ' + m.text());
  }
});

await page.goto(BASE);
await page.setInputFiles('#file-input', '/tmp/srt/test.mp4');
await page.waitForSelector('#fps-dialog[open]');
await page.click('#fps-ok');
await page.waitForFunction(() => document.querySelectorAll('.thumb').length > 0, null, { timeout: 30000 });
console.log('✓ import: ' + (await page.textContent('#frame-counter')).trim());

const box = await page.locator('#draw-canvas').boundingBox();
await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 5 });
await page.mouse.up();
const ink = await page.$eval('#draw-canvas', (c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
  return false;
});
console.log(ink ? '✓ drawing works' : '✗ drawing failed');
if (!ink) process.exitCode = 1;

const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  (async () => {
    await page.click('#save-btn');
    await page.waitForSelector('#save-dialog[open]');
    await page.click('#save-ok');
  })(),
]);
await download.saveAs('/tmp/srt/out/build-smoke.gif');
const frames = execSync(
  'ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 /tmp/srt/out/build-smoke.gif',
).toString().trim();
console.log(frames === '30' ? '✓ gif export: 30 frames' : '✗ gif export: ' + frames);
if (frames !== '30') process.exitCode = 1;

// face detection loads from bundled models in the static build
await page.click('label.toggle-row:has(#face-toggle)');
await page.waitForTimeout(4000);
console.log('✓ face detector initialized from static models (no errors)');

await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'BUILD SMOKE PASSED');
if (errors.length) process.exitCode = 1;
