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

/** Import a video or image file as a new project. */
export async function importFile(file: File): Promise<void> {
  if (file.type.startsWith('image/')) {
    await importImage(file);
  } else if (file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(file.name)) {
    await importVideo(file);
  } else {
    throw new Error(`Unsupported file type: ${file.type || file.name}`);
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
