import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { Frame, hasProject, state } from './state';
import { downloadBlob, hideProgress, showProgress, updateProgress } from './ui';

type Background = 'white' | 'black' | 'transparent';

const saveDialog = document.getElementById('save-dialog')! as HTMLDialogElement;
const saveTitle = document.getElementById('save-title')!;
const saveMeta = document.getElementById('save-meta')!;
const saveOk = document.getElementById('save-ok')!;
const saveCancel = document.getElementById('save-cancel')!;

export function initExport(): void {
  const saveBtn = document.getElementById('save-btn')!;
  saveBtn.addEventListener('click', openSaveDialog);
  saveOk.addEventListener('click', onConfirm);
  saveCancel.addEventListener('click', () => saveDialog.close());
}

function openSaveDialog(): void {
  if (!hasProject()) return;
  saveTitle.textContent = state.singleImage ? 'Export image' : 'Export GIF';
  saveMeta.textContent = state.singleImage
    ? '1 frame'
    : `${state.frames.length} frames · ${state.fps} fps`;
  saveOk.textContent = state.singleImage ? 'Export PNG' : 'Export GIF';

  const row = document.getElementById('skip-unedited-row')!;
  if (state.singleImage) {
    row.hidden = true;
  } else {
    row.hidden = false;
    const edited = state.frames.filter((f) => f.drawing).length;
    (document.getElementById('skip-unedited') as HTMLInputElement).disabled = edited === 0;
    (document.getElementById('skip-count') as HTMLElement).textContent =
      `(${edited} of ${state.frames.length} edited)`;
  }
  saveDialog.showModal();
}

async function onConfirm(): Promise<void> {
  if (!hasProject()) return;
  const checked = saveDialog.querySelector<HTMLInputElement>('input[name="bg"]:checked');
  const bg = (checked?.value ?? 'white') as Background;
  const skipInput = document.getElementById('skip-unedited') as HTMLInputElement | null;
  const skipUnedited = skipInput?.checked ?? false;
  saveDialog.close();

  try {
    if (state.singleImage) {
      await exportPng(bg);
    } else {
      const frames = skipUnedited ? state.frames.filter((f) => f.drawing) : state.frames;
      if (frames.length === 0) {
        alert('No edited frames to export.');
        return;
      }
      await exportGif(frames, bg);
    }
  } catch (err) {
    console.error(err);
    alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    hideProgress();
  }
}

function composite(frame: Frame, bg: Background): HTMLCanvasElement {
  const w = frame.source.width;
  const h = frame.source.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  if (bg === 'white' || bg === 'black') {
    ctx.fillStyle = bg === 'white' ? '#ffffff' : '#000000';
    ctx.fillRect(0, 0, w, h);
  }
  if (frame.drawing) ctx.drawImage(frame.drawing, 0, 0);
  return c;
}

async function exportPng(bg: Background): Promise<void> {
  showProgress('Exporting…', 0.5);
  const canvas = composite(state.frames[0], bg);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  downloadBlob(blob, 'shitrotoscope.png');
}

async function exportGif(frames: Frame[], bg: Background): Promise<void> {
  const { fps } = state;
  const delay = Math.max(20, Math.round(1000 / fps / 10) * 10); // GIF delays are 1/100s units
  const gif = GIFEncoder();
  const w = frames[0].source.width;
  const h = frames[0].source.height;
  const transparentGif = bg === 'transparent';

  showProgress('Encoding GIF… 0 / ' + frames.length, 0);
  for (let i = 0; i < frames.length; i++) {
    const canvas = composite(frames[i], bg);
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, w, h);

    // GIF only has 1-bit alpha: snap alpha with oneBitAlpha and mark the
    // palette's transparent entry per frame.
    const palette = transparentGif
      ? quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true })
      : quantize(data, 256);
    const index = transparentGif
      ? applyPalette(data, palette, 'rgba4444')
      : applyPalette(data, palette);

    const opts: {
      palette: number[][];
      delay: number;
      repeat: number;
      transparent?: boolean;
      transparentIndex?: number;
      dispose?: number;
    } = { palette, delay, repeat: 0 };
    if (transparentGif) {
      const transparentIndex = palette.findIndex((color) => color.length > 3 && color[3] === 0);
      if (transparentIndex >= 0) {
        opts.transparent = true;
        opts.transparentIndex = transparentIndex;
      }
      // Dispose to background so earlier frames don't bleed through the
      // transparent areas of later ones.
      opts.dispose = 2;
    }
    gif.writeFrame(index, w, h, opts);

    if (i % 4 === 0 || i === frames.length - 1) {
      updateProgress(`Encoding GIF… ${i + 1} / ${frames.length}`, (i + 1) / frames.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  gif.finish();
  downloadBlob(new Blob([gif.bytesView() as Uint8Array<ArrayBuffer>], { type: 'image/gif' }), 'shitrotoscope.gif');
}
