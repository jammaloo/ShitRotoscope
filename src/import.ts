import { decompressFrames, parseGIF } from 'gifuct-js';
import { Frame, MAX_DIM, MAX_FRAMES, loadProject } from './state';
import { showProgress, updateProgress, hideProgress } from './ui';

const fpsDialog = document.getElementById('fps-dialog')! as HTMLDialogElement;
const fpsMeta = document.getElementById('fps-meta')!;
const fpsPresets = document.getElementById('fps-presets')!;
const fpsCustom = document.getElementById('fps-custom')! as HTMLInputElement;
const fpsFrames = document.getElementById('fps-frames')!;
const fpsWarning = document.getElementById('fps-warning')!;
const fpsOk = document.getElementById('fps-ok')!;
const fpsCancel = document.getElementById('fps-cancel')!;

const FPS_PRESETS = [6, 8, 12, 15, 24];
const DEFAULT_FPS = 12;

/** Import a video, image, or (animated) GIF file as a new project. */
export async function importFile(file: File): Promise<void> {
  if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) {
    await importGif(file);
  } else if (file.type.startsWith('image/')) {
    await importImage(file);
  } else if (file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(file.name)) {
    await importVideo(file);
  } else {
    throw new Error(`Unsupported file type: ${file.type || file.name}`);
  }
}

async function importGif(file: File): Promise<void> {
  showProgress('Decoding GIF…', 0.2);
  try {
    const buffer = await file.arrayBuffer();
    const gif = parseGIF(buffer);
    const parsed = decompressFrames(gif, true);
    if (parsed.length === 0) throw new Error('This GIF has no frames.');

    const vw = gif.lsd.width;
    const vh = gif.lsd.height;
    if (!vw || !vh) throw new Error('GIF has no readable dimensions.');

    // Composite partial frames onto a logical-screen canvas, honoring each
    // frame's disposal method (the standard gifuct-js compositing algorithm).
    const full = scaledCanvas(vw, vh);
    const fullCtx = full.getContext('2d')!;
    const patch = document.createElement('canvas');
    patch.width = vw;
    patch.height = vh;
    const patchCtx = patch.getContext('2d')!;
    const scaleX = full.width / vw;
    const scaleY = full.height / vh;

    const frames: Frame[] = [];
    const delays: number[] = [];
    let previous: (typeof parsed)[number] | null = null;
    let saved: ImageData | null = null;
    let truncated = false;

    for (let i = 0; i < parsed.length; i++) {
      if (frames.length >= MAX_FRAMES) {
        truncated = true;
        break;
      }
      const frame = parsed[i];

      // Dispose the previous frame's pixels before drawing this one.
      if (previous?.disposalType === 2) {
        fullCtx.clearRect(
          previous.dims.left * scaleX,
          previous.dims.top * scaleY,
          previous.dims.width * scaleX,
          previous.dims.height * scaleY,
        );
      } else if (previous?.disposalType === 3 && saved) {
        fullCtx.putImageData(saved, 0, 0);
      }
      if (frame.disposalType === 3) {
        saved = fullCtx.getImageData(0, 0, full.width, full.height);
      }

      patchCtx.putImageData(
        new ImageData(frame.patch as Uint8ClampedArray<ArrayBuffer>, frame.dims.width, frame.dims.height),
        0,
        0,
      );
      fullCtx.drawImage(patch, frame.dims.left * scaleX, frame.dims.top * scaleY, frame.dims.width * scaleX, frame.dims.height * scaleY);

      const source = document.createElement('canvas');
      source.width = full.width;
      source.height = full.height;
      source.getContext('2d')!.drawImage(full, 0, 0);
      frames.push({ source, drawing: null });
      // GIF frame delays are centiseconds; gifuct reports milliseconds.
      delays.push(frame.delay > 0 ? frame.delay : 100);

      if (i % 5 === 0 || i === parsed.length - 1) {
        updateProgress(`Decoding GIF… ${i + 1} / ${parsed.length}`, (i + 1) / parsed.length);
        await new Promise((r) => setTimeout(r, 0));
      }
      previous = frame;
    }

    // Re-export uses a constant delay: derive fps from the average frame delay.
    const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
    const fps = Math.max(1, Math.min(30, Math.round(1000 / avgDelay)));
    loadProject(frames, fps, frames.length === 1);
    if (truncated) {
      alert(`This GIF has more than ${MAX_FRAMES} frames; only the first ${MAX_FRAMES} were imported.`);
    }
  } finally {
    hideProgress();
  }
}

async function importImage(file: File): Promise<void> {
  showProgress('Loading image…', 0.5);
  try {
    const bitmap = await createImageBitmap(file);
    const source = scaledCanvas(bitmap.width, bitmap.height);
    source.getContext('2d')!.drawImage(bitmap, 0, 0, source.width, source.height);
    bitmap.close();
    loadProject([{ source, drawing: null }], 1, true);
  } finally {
    hideProgress();
  }
}

async function importVideo(file: File): Promise<void> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const url = URL.createObjectURL(file);
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not decode this video (try an MP4/H.264 or WebM file).'));
    });
    if (!isFinite(video.duration) || video.duration <= 0) {
      throw new Error('Could not read the video duration.');
    }

    const fps = await askFps(video.duration);
    if (fps === null) return; // cancelled

    const frames = await extractFrames(video, fps);
    loadProject(frames, fps, false);
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
    hideProgress();
  }
}

function scaledCanvas(w: number, h: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  return c;
}

/** Show the fps picker dialog; resolves chosen fps, or null if cancelled. */
function askFps(duration: number): Promise<number | null> {
  return new Promise((resolve) => {
    fpsMeta.textContent = `Duration: ${duration.toFixed(2)} s`;

    // preset buttons
    fpsPresets.textContent = '';
    let selected = DEFAULT_FPS;
    const presetBtns = FPS_PRESETS.map((fps) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn' + (fps === DEFAULT_FPS ? ' active' : '');
      btn.textContent = String(fps);
      btn.addEventListener('click', () => {
        selected = fps;
        fpsCustom.value = String(fps);
        presetBtns.forEach((b) => b.classList.toggle('active', b === btn));
        refreshEstimate();
      });
      fpsPresets.appendChild(btn);
      return btn;
    });
    fpsCustom.value = String(DEFAULT_FPS);

    const refreshEstimate = () => {
      const count = Math.floor(duration * selected);
      fpsFrames.textContent = `≈ ${Math.min(count, MAX_FRAMES)} frames at ${selected} fps`;
      fpsWarning.hidden = count <= MAX_FRAMES;
    };
    refreshEstimate();

    const onCustomInput = () => {
      const v = Math.max(1, Math.min(30, Math.floor(Number(fpsCustom.value) || DEFAULT_FPS)));
      selected = v;
      presetBtns.forEach((b) => b.classList.toggle('active', Number(b.textContent) === v));
      refreshEstimate();
    };
    fpsCustom.addEventListener('input', onCustomInput);

    const close = (result: number | null) => {
      fpsCustom.removeEventListener('input', onCustomInput);
      fpsOk.removeEventListener('click', onOk);
      fpsCancel.removeEventListener('click', onCancel);
      fpsDialog.close();
      resolve(result);
    };
    const onOk = () => close(selected);
    const onCancel = () => close(null);

    fpsOk.addEventListener('click', onOk);
    fpsCancel.addEventListener('click', onCancel);
    fpsDialog.showModal();
  });
}

async function extractFrames(video: HTMLVideoElement, fps: number): Promise<Frame[]> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new Error('Video has no readable frames.');

  const total = Math.min(MAX_FRAMES, Math.max(1, Math.floor(video.duration * fps)));
  const frames: Frame[] = [];
  showProgress('Extracting frames…', 0);

  for (let i = 0; i < total; i++) {
    const t = Math.min(i / fps + 0.001, Math.max(0, video.duration - 0.01));
    await seekTo(video, t);
    // Chrome can paint the pre-seek frame if we draw synchronously on seeked.
    await nextPaint();

    const source = scaledCanvas(vw, vh);
    source.getContext('2d')!.drawImage(video, 0, 0, source.width, source.height);
    frames.push({ source, drawing: null });

    if (i % 3 === 0 || i === total - 1) {
      updateProgress(`Extracting frames… ${i + 1} / ${total}`, (i + 1) / total);
    }
  }
  return frames;
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      clearTimeout(fallback);
      resolve();
    };
    // Safety net in case 'seeked' never fires (e.g. target ≈ current time).
    const fallback = setTimeout(done, 2000);
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
