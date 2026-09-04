import { hasProject, on, setCurrent, state } from './state';

const thumbList = document.getElementById('thumb-list')!;
const THUMB_H = 100;

export function initThumbs(): void {
  on('loaded', rebuild);
  on('frame', highlightCurrent);
  on('thumb', (index) => {
    if (index !== undefined && index >= 0 && index < state.frames.length) {
      renderThumb(index);
    }
  });
}

function rebuild(): void {
  thumbList.textContent = '';
  if (!hasProject()) return;

  state.frames.forEach((frame, i) => {
    const btn = document.createElement('button');
    btn.className = 'thumb';
    btn.title = `Frame ${i + 1}`;

    const canvas = document.createElement('canvas');
    // 100px-tall cards; width follows the frame's aspect ratio.
    canvas.height = THUMB_H;
    canvas.width = Math.max(40, Math.round((frame.source.width / frame.source.height) * THUMB_H));
    btn.appendChild(canvas);

    const num = document.createElement('span');
    num.className = 'thumb-num';
    num.textContent = String(i + 1);
    btn.appendChild(num);

    btn.addEventListener('click', () => setCurrent(i));
    thumbList.appendChild(btn);
    renderThumb(i);
  });
  highlightCurrent();
}

/** Draw only the user's strokes on a white background. */
function renderThumb(i: number): void {
  const btn = thumbList.children[i] as HTMLButtonElement | undefined;
  if (!btn) return;
  const canvas = btn.querySelector('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const drawing = state.frames[i].drawing;
  if (drawing) ctx.drawImage(drawing, 0, 0, canvas.width, canvas.height);
}

function highlightCurrent(): void {
  const { current } = state;
  Array.from(thumbList.children).forEach((el, i) => {
    el.classList.toggle('current', i === current);
  });
  const el = thumbList.children[current] as HTMLElement | undefined;
  if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
