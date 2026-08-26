/* Headless end-to-end exercise of the app using the local Chrome.
 * Run: node scripts/e2e.mjs */
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:5173/';
const OUT = '/tmp/srt/out';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
page.on('console', (msg) => {
  // TFLite routes benign native INFO banners through console.error.
  if (msg.type() === 'error' && !/^INFO: Created TensorFlow Lite/.test(msg.text())) {
    errors.push('console: ' + msg.text());
  }
  if (msg.type() === 'warning' && /Face detection failed/i.test(msg.text())) {
    errors.push('console: ' + msg.text());
  }
});

const ok = (name) => console.log(`  ✓ ${name}`);
const fail = (name, detail) => {
  console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  process.exitCode = 1;
};
const expect = (cond, name, detail) => (cond ? ok(name) : fail(name, detail));

async function counter() {
  return (await page.textContent('#frame-counter')).trim();
}

async function canvasHasInk(sel) {
  return page.$eval(sel, (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
    return false;
  });
}

async function drawStroke(x0, y0, x1, y1) {
  const box = await page.locator('#draw-canvas').boundingBox();
  const sx = box.x + (x0 / 100) * box.width;
  const sy = box.y + (y0 / 100) * box.height;
  const ex = box.x + (x1 / 100) * box.width;
  const ey = box.y + (y1 / 100) * box.height;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    await page.mouse.move(sx + (ex - sx) * t, sy + (ey - sy) * t);
  }
  await page.mouse.up();
}

// ---------- 1. video import ----------
console.log('\n[1] video import + fps dialog');
await page.goto(BASE);
await page.setInputFiles('#file-input', '/tmp/srt/test.mp4');
await page.waitForSelector('#fps-dialog[open]');
const meta = (await page.textContent('#fps-meta')).trim();
expect(/Duration: 2\.5\d s/.test(meta), 'duration shown', meta);
await page.click('#fps-ok');
await page.waitForFunction(() => !document.querySelector('#progress-overlay').hidden, null, { timeout: 5000 }).catch(() => {});
await page.waitForFunction(() => document.querySelector('#progress-overlay').hidden, null, { timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll('.thumb').length > 0);
expect((await counter()) === '1 / 30', '30 frames at 12fps', await counter());
expect((await page.locator('.thumb').count()) === 30, '30 thumbnails');
expect(!(await page.locator('#prev-toggle').isDisabled()), 'previous-frame toggle enabled for video');

// ---------- 2. drawing ----------
console.log('\n[2] pen drawing + thumbnails');
await drawStroke(20, 30, 70, 60);
expect(await canvasHasInk('#draw-canvas'), 'stage has ink');
const thumbInk = await page.$eval('.thumb:nth-child(1) canvas', (c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let nonWhite = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) nonWhite++;
  }
  return nonWhite;
});
expect(thumbInk > 50, 'thumbnail 1 shows strokes on white', `nonWhite=${thumbInk}`);

// undo
await page.click('#undo-btn');
expect(!(await canvasHasInk('#draw-canvas')), 'undo clears stroke');
expect(await page.locator('#undo-btn').isDisabled(), 'undo disabled after emptying stack');

// keyboard undo (⌘Z / Ctrl+Z)
await drawStroke(20, 30, 70, 60);
const defaultInk = await page.$eval('#draw-canvas', (c) => {
  const d = c.getContext('2d').getImageData(Math.floor(c.width * 0.45), Math.floor(c.height * 0.45), 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
});
expect(defaultInk[3] > 0 && defaultInk[0] < 40 && defaultInk[1] < 40 && defaultInk[2] < 40, 'default pen is black', JSON.stringify(defaultInk));
await page.keyboard.press('Meta+z');
expect(!(await canvasHasInk('#draw-canvas')), '⌘Z clears stroke');
expect(await page.locator('#undo-btn').isDisabled(), 'undo disabled after ⌘Z');

// regression: ⌘Z must work right after drawing even when a control
// (e.g. the brush slider) was focused before the stroke
await page.focus('#brush-slider');
await drawStroke(25, 35, 65, 55);
expect(await canvasHasInk('#draw-canvas'), 'redraw with slider focused');
await page.keyboard.press('Meta+z');
expect(!(await canvasHasInk('#draw-canvas')), '⌘Z works immediately after drawing');

// redraw for later steps
await drawStroke(20, 30, 70, 60);
await drawStroke(60, 70, 30, 80);

// ---------- 3. frame nav + onion skin ----------
console.log('\n[3] frame navigation + previous-frame overlay');
await drawStroke(50, 20, 50, 80); // extra stroke still on frame 1
await page.click('#next-btn');
expect((await counter()) === '2 / 30', 'next frame', await counter());
await page.keyboard.press('ArrowLeft');
expect((await counter()) === '1 / 30', 'arrow key back', await counter());
await page.keyboard.press('ArrowRight');
expect((await counter()) === '2 / 30', 'arrow key forward', await counter());

await page.click('label.toggle-row:has(#prev-toggle)');
expect(await canvasHasInk('#overlay-canvas'), 'onion skin drawn on overlay');
await page.click('label.toggle-row:has(#prev-toggle)');
expect(!(await canvasHasInk('#overlay-canvas')), 'onion skin cleared');

// background hide/invert toggles
const pixelAt = (fx, fy) =>
  page.$eval('#frame-canvas', (c, [fx, fy]) => {
    const d = c.getContext('2d').getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [fx, fy]);
const p0 = await pixelAt(0.15, 0.5);
await page.click('label.toggle-row:has(#invert-bg-toggle)');
const p1 = await pixelAt(0.15, 0.5);
const invertedOk = p0.every((v, i) => Math.abs(p1[i] - (255 - v)) < 40);
expect(invertedOk, 'invert flips frame pixels', `${p0} -> ${p1}`);
await page.click('label.toggle-row:has(#invert-bg-toggle)');
expect((await pixelAt(0.15, 0.5)).every((v, i) => Math.abs(v - p0[i]) < 10), 'invert restores frame');

await drawStroke(30, 30, 60, 60); // something to look at with the background hidden
await page.click('label.toggle-row:has(#hide-bg-toggle)');
const frameEmpty = await page.$eval('#frame-canvas', (c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false;
  return true;
});
expect(frameEmpty, 'hide background clears frame layer');
expect(await canvasHasInk('#draw-canvas'), 'drawing still visible with background hidden');
await page.click('label.toggle-row:has(#hide-bg-toggle)');
expect((await pixelAt(0.15, 0.5)).every((v, i) => Math.abs(v - p0[i]) < 10), 'background restored');

// thumbnail jump
await page.click('.thumb:nth-child(5)');
expect((await counter()) === '5 / 30', 'thumbnail click jumps', await counter());

// ---------- 4. eraser ----------
console.log('\n[4] eraser');
await drawStroke(50, 20, 52, 80); // scribble on frame 5
expect(await canvasHasInk('#draw-canvas'), 'frame 5 has ink');
await page.click('#eraser-btn');
await drawStroke(48, 10, 48, 95); // erase a vertical strip
const inkAfterErase = await page.$eval('#draw-canvas', (c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let count = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) count++;
  return count;
});
expect(inkAfterErase > 0, 'eraser leaves partial ink', `ink=${inkAfterErase}`);
await page.click('#pen-btn');

// ---------- 5. brush size + color ----------
console.log('\n[5] brush size + color');
expect((await page.textContent('#brush-label')).trim() === '6 px', 'default brush 6px', await page.textContent('#brush-label'));
await page.click('#brush-plus');
await page.click('#brush-plus');
expect((await page.textContent('#brush-label')).trim() === '8 px', 'brush +1 twice below 8', await page.textContent('#brush-label'));
await page.click('#brush-minus');
expect((await page.textContent('#brush-label')).trim() === '6 px', 'brush minus');
await page.click('#pen-btn');
await page.click('.swatch[data-color="#2563eb"]');
// draw and sample the drawing canvas center line color
await drawStroke(10, 50, 90, 50);
const sampled = await page.$eval('#draw-canvas', (c) => {
  const d = c.getContext('2d').getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
});
expect(sampled[2] > sampled[0] && sampled[2] > 150, 'blue stroke sampled', JSON.stringify(sampled));

// ---------- 6. GIF export ----------
console.log('\n[6] GIF export');
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  (async () => {
    await page.click('#save-btn');
    await page.waitForSelector('#save-dialog[open]');
    await page.click('#save-ok');
  })(),
]);
const gifPath = OUT + '/test.gif';
await download.saveAs(gifPath);
let probe = '';
try {
  probe = execSync(
    `ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=width,height,nb_read_frames -of csv=p=0 "${gifPath}"`,
  ).toString().trim();
} catch (e) {
  probe = 'ffprobe failed: ' + e.message;
}
console.log(`    gif: ${probe}`);
expect(/^\d+,\d+,\d+$/.test(probe), 'gif decodable via ffprobe', probe);
expect(probe.endsWith(',30'), 'gif has 30 frames', probe);

// transparent-background variant
const [download2] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  (async () => {
    await page.click('#save-btn');
    await page.waitForSelector('#save-dialog[open]');
    await page.click('label.bg-option:has(input[value="transparent"]) span');
    await page.click('#save-ok');
  })(),
]);
await download2.saveAs(OUT + '/test-transparent.gif');
const pixFmt = execSync(
  `ffprobe -v error -select_streams v:0 -show_entries frame=pix_fmt -of csv=p=0 "${OUT}/test-transparent.gif"`,
).toString().trim();
console.log(`    transparent gif pix_fmt: ${pixFmt}`);
expect(/(rgb|bgr)a$/i.test(pixFmt), 'transparent gif has an alpha channel', pixFmt);
let tprobe = '';
try {
  tprobe = execSync(
    `ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=width,height,nb_read_frames -of csv=p=0 "${OUT}/test-transparent.gif"`,
  ).toString().trim();
} catch {
  tprobe = 'ffprobe failed';
}
expect(tprobe.endsWith(',30'), 'transparent gif has 30 frames', tprobe);

// ---------- 7. single image + face detection + PNG ----------
console.log('\n[7] image import + face detection + PNG export');
page.once('dialog', (d) => d.accept()); // replace-project confirm
await page.setInputFiles('#file-input', '/tmp/srt/face.jpg');
await page.waitForFunction(() => document.querySelector('#frame-counter').textContent.includes('1 / 1'));
expect((await counter()) === '1 / 1', 'single image project');
expect(await page.locator('#prev-toggle').isDisabled(), 'previous-frame toggle disabled for single frame');

await page.click('label.toggle-row:has(#face-toggle)');
await page.waitForFunction(async () => {
  const c = document.querySelector('#overlay-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
  return false;
}, null, { timeout: 20000 });
ok('face detection overlay drawn');

await drawStroke(30, 45, 70, 45);

// ---------- 8. multi-face detection ----------
console.log('\n[8] multi-face detection');
page.once('dialog', (d) => d.accept());
await page.setInputFiles('#file-input', '/tmp/srt/two-1036641.jpg');
await page.waitForFunction(() => document.querySelector('#frame-counter').textContent.includes('1 / 1'));
if (!(await page.locator('#face-toggle').isChecked())) {
  await page.click('label.toggle-row:has(#face-toggle)');
}
const countFaceClusters = () =>
  page.evaluate(() => {
    const c = document.querySelector('#overlay-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const cols = new Array(c.width).fill(false);
    let blue = 0;
    for (let y = 0; y < c.height; y += 2) {
      for (let x = 0; x < c.width; x += 1) {
        const i = (y * c.width + x) * 4;
        if (d[i + 3] > 200 && d[i] > 20 && d[i] < 150 && d[i + 1] > 120 && d[i + 2] > 150) {
          cols[x] = true;
          blue++;
        }
      }
    }
    let runs = 0;
    let runLen = 0;
    for (let x = 0; x < c.width; x++) {
      if (cols[x]) runLen++;
      else {
        if (runLen >= c.width * 0.03) runs++;
        runLen = 0;
      }
    }
    if (runLen >= c.width * 0.03) runs++;
    return { blue, runs };
  });
let clusters = 0;
let bluePx = 0;
for (let i = 0; i < 15; i++) {
  await page.waitForTimeout(1000);
  ({ blue: bluePx, runs: clusters } = await countFaceClusters());
  if (clusters >= 2) break;
}
console.log(`    blue pixels: ${bluePx}, column clusters: ${clusters}`);
expect(clusters >= 2, 'multiple face boxes drawn', `clusters=${clusters}, blue=${bluePx}`);
await page.screenshot({ path: OUT + '/multiface.png' });

const [download3] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  (async () => {
    await page.click('#save-btn');
    await page.waitForSelector('#save-dialog[open]');
    expect((await page.textContent('#save-ok')).trim() === 'Export PNG', 'PNG mode for single image');
    await page.click('label.bg-option:has(input[value="transparent"]) span');
    await page.click('#save-ok');
  })(),
]);
const pngPath = OUT + '/test.png';
await download3.saveAs(pngPath);
const pngInfo = execSync(`file "${pngPath}"`).toString().trim();
console.log(`    png: ${pngInfo}`);
expect(pngInfo.includes('PNG image data'), 'png exported');

// ---------- 10. animated GIF import ----------
console.log('\n[10] animated GIF import');
page.once('dialog', (d) => d.accept());
await page.setInputFiles('#file-input', '/tmp/srt/anim.gif');
await page.waitForFunction(() => document.querySelector('#frame-counter').textContent.includes('1 / 8'));
expect((await counter()) === '1 / 8', '8-frame gif imported', await counter());
expect((await page.locator('.thumb').count()) === 8, '8 thumbnails for gif frames');
await drawStroke(30, 30, 60, 60);
expect(await canvasHasInk('#draw-canvas'), 'drawing on gif frame');
await page.click('#next-btn');
expect((await counter()) === '2 / 8', 'gif frame navigation', await counter());
expect(!(await page.locator('#prev-toggle').isDisabled()), 'previous-frame toggle active for gif');

// re-export round-trip
const [gifOut] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  (async () => {
    await page.click('#save-btn');
    await page.waitForSelector('#save-dialog[open]');
    await page.click('#save-ok');
  })(),
]);
await gifOut.saveAs(OUT + '/from-gif.gif');
const gifProbe = execSync(
  `ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "${OUT}/from-gif.gif"`,
).toString().trim();
expect(gifProbe === '8', 're-exported gif has 8 frames', gifProbe);

// back to the face image for any later sections
await page.screenshot({ path: OUT + '/final.png' });

// ---------- 9. mobile layout ----------
console.log('\n[9] mobile layout');
const mPage = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
mPage.on('pageerror', (err) => errors.push('mobile pageerror: ' + err.message));
await mPage.goto(BASE);
await mPage.setInputFiles('#file-input', '/tmp/srt/face.jpg');
await mPage.waitForFunction(() => document.querySelector('#frame-counter').textContent.includes('1 / 1'));

const layout = await mPage.evaluate(() => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  return {
    stage: box(document.getElementById('stage-wrap')),
    thumbs: box(document.getElementById('thumb-pane')),
    controls: box(document.getElementById('control-pane')),
    controlsBodyVisible: getComputedStyle(document.getElementById('controls-body')).display !== 'none',
    saveVisible: !!document.getElementById('save-btn').offsetParent,
  };
});
expect(layout.stage.y < layout.thumbs.y, 'stage above reel', JSON.stringify(layout));
expect(layout.thumbs.y < layout.controls.y, 'reel above controls');
expect(layout.thumbs.h < 150 && layout.thumbs.w > 300, 'reel is a short full-width strip', `h=${layout.thumbs.h} w=${layout.thumbs.w}`);
expect(layout.stage.h > 400, 'stage takes most of the screen', `h=${layout.stage.h}`);
expect(!layout.controlsBodyVisible, 'controls collapsed by default on mobile');
expect(layout.saveVisible, 'save button visible while collapsed');

const headerLabel = mPage.locator('#controls-header > span').first();
await headerLabel.click();
expect(
  await mPage.evaluate(() => getComputedStyle(document.getElementById('controls-body')).display !== 'none'),
  'controls expand on tap',
);
await headerLabel.click();
expect(
  await mPage.evaluate(() => getComputedStyle(document.getElementById('controls-body')).display === 'none'),
  'controls collapse on tap',
);

// drawing works on the mobile viewport
const mbox = await mPage.locator('#draw-canvas').boundingBox();
await mPage.mouse.move(mbox.x + mbox.width * 0.3, mbox.y + mbox.height * 0.3);
await mPage.mouse.down();
await mPage.mouse.move(mbox.x + mbox.width * 0.7, mbox.y + mbox.height * 0.6, { steps: 5 });
await mPage.mouse.up();
const mInk = await mPage.$eval('#draw-canvas', (c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
  return false;
});
expect(mInk, 'drawing works on mobile viewport');
await mPage.screenshot({ path: OUT + '/mobile.png' });
await mPage.close();

await browser.close();

console.log('\npage errors:', errors.length ? errors : 'none');
if (errors.length) process.exitCode = 1;
console.log(process.exitCode ? '\nE2E FAILED' : '\nE2E PASSED');
