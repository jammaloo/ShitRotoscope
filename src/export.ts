import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { Frame, hasProject, state } from './state';
import { downloadBlob, hideProgress, showProgress, updateProgress } from './ui';

type Background = 'frame' | 'white' | 'black';

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
  saveDialog.showModal();
}

async function onConfirm(): Promise<void> {
  if (!hasProject()) return;
  const checked = saveDialog.querySelector<HTMLInputElement>('input[name="bg"]:checked');
  const bg = (checked?.value ?? 'frame') as Background;
  saveDialog.close();

  try {
    if (state.singleImage) {
      await exportPng(bg);
    } else {
      await exportGif(bg);
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
  if (bg === 'frame') {
    ctx.drawImage(frame.source, 0, 0);
  } else {
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

async function exportGif(bg: Background): Promise<void> {
  const { frames, fps } = state;
  const delay = Math.max(20, Math.round(1000 / fps / 10) * 10); // GIF delays are 1/100s units
  const gif = GIFEncoder();
  const w = frames[0].source.width;
  const h = frames[0].source.height;

  showProgress('Encoding GIF… 0 / ' + frames.length, 0);
  for (let i = 0; i < frames.length; i++) {
    const canvas = composite(frames[i], bg);
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, w, h);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, w, h, { palette, delay, repeat: 0 });

    if (i % 4 === 0 || i === frames.length - 1) {
      updateProgress(`Encoding GIF… ${i + 1} / ${frames.length}`, (i + 1) / frames.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  gif.finish();
  downloadBlob(new Blob([gif.bytesView() as Uint8Array<ArrayBuffer>], { type: 'image/gif' }), 'shitrotoscope.gif');
}
