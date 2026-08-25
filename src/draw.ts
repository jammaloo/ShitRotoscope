import { Frame, drawingFor, emit, hasProject, on, state } from './state';

const stage = document.getElementById('stage')!;
const stageWrap = document.getElementById('stage-wrap')!;
const emptyState = document.getElementById('empty-state')!;
const frameCanvas = document.getElementById('frame-canvas')! as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlay-canvas')! as HTMLCanvasElement;
const drawCanvas = document.getElementById('draw-canvas')! as HTMLCanvasElement;
const brushCursor = document.getElementById('brush-cursor')!;

const UNDO_LIMIT = 15;
let undoStack: ImageData[] = [];

interface Pt {
  x: number;
  y: number;
}

export function initDraw(): void {
  drawCanvas.addEventListener('pointerdown', onPointerDown);
  drawCanvas.addEventListener('pointermove', onPointerMove);
  drawCanvas.addEventListener('pointerup', onPointerUp);
  drawCanvas.addEventListener('pointercancel', onPointerUp);
  drawCanvas.addEventListener('pointerenter', () => (brushCursor.style.display = 'block'));
  drawCanvas.addEventListener('pointerleave', () => (brushCursor.style.display = 'none'));

  window.addEventListener('resize', layoutStage);
  on('loaded', layoutStage);
  on('frame', renderStage);
  on('tool', refreshCursorSize);
}

function layoutStage(): void {
  emptyState.style.display = hasProject() ? 'none' : 'flex';
  stage.hidden = !hasProject();
  if (!hasProject()) return;

  const frame = state.frames[state.current];
  const w = frame.source.width;
  const h = frame.source.height;

  for (const c of [frameCanvas, overlayCanvas, drawCanvas]) {
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }
  fitStage(w, h);
  renderStage();
}

function fitStage(w: number, h: number): void {
  const pad = 48;
  const availW = stageWrap.clientWidth - pad;
  const availH = stageWrap.clientHeight - pad;
  const scale = Math.min(availW / w, availH / h, 1.5);
  stage.style.width = `${Math.max(80, Math.floor(w * scale))}px`;
  stage.style.height = `${Math.max(80, Math.floor(h * scale))}px`;
}

/** Draw the current frame's image + drawing onto the stage. */
export function renderStage(): void {
  if (!hasProject() || state.current < 0) return;
  const frame = state.frames[state.current];
  frameCanvas.getContext('2d')!.clearRect(0, 0, frameCanvas.width, frameCanvas.height);
  frameCanvas.getContext('2d')!.drawImage(frame.source, 0, 0);
  const dctx = drawCanvas.getContext('2d')!;
  dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  if (frame.drawing) dctx.drawImage(frame.drawing, 0, 0);
  undoStack = [];
  updateUndoButton();
}

export function undo(): void {
  const frame = state.frames[state.current];
  if (!frame?.drawing || undoStack.length === 0) return;
  const snap = undoStack.pop()!;
  frame.drawing.getContext('2d')!.putImageData(snap, 0, 0);
  const dctx = drawCanvas.getContext('2d')!;
  dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  dctx.drawImage(frame.drawing, 0, 0);
  emit('thumb', state.current);
  updateUndoButton();
}

function updateUndoButton(): void {
  const btn = document.getElementById('undo-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = undoStack.length === 0;
}

// ---------- pointer input ----------

let stroking = false;
let last: Pt = { x: 0, y: 0 };
let prevMid: Pt = { x: 0, y: 0 };

function toFramePoint(e: PointerEvent): Pt {
  const rect = drawCanvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * drawCanvas.width,
    y: ((e.clientY - rect.top) / rect.height) * drawCanvas.height,
  };
}

function strokeContext(frame: Frame): CanvasRenderingContext2D {
  const ctx = drawingFor(frame).getContext('2d')!;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = state.brushSize;
  ctx.globalCompositeOperation = state.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = state.color;
  ctx.fillStyle = state.color;
  return ctx;
}

function onPointerDown(e: PointerEvent): void {
  if (!hasProject()) return;
  e.preventDefault();
  // preventDefault() stops the browser from moving focus off the last-focused
  // control (e.g. the brush slider), which would swallow later keyboard
  // shortcuts like ⌘Z while drawing.
  (document.activeElement as HTMLElement | null)?.blur();
  drawCanvas.setPointerCapture(e.pointerId);

  const frame = state.frames[state.current];
  // Snapshot before the stroke for undo.
  const ctx = strokeContext(frame);
  undoStack.push(ctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  updateUndoButton();

  stroking = true;
  last = toFramePoint(e);
  prevMid = last;

  // Dot for taps / single clicks.
  ctx.beginPath();
  ctx.arc(last.x, last.y, state.brushSize / 2, 0, Math.PI * 2);
  ctx.fill();
  paintToStage(frame);
}

function onPointerMove(e: PointerEvent): void {
  updateBrushCursor(e);
  if (!stroking || !hasProject()) return;

  const frame = state.frames[state.current];
  const ctx = strokeContext(frame);
  const p = toFramePoint(e);
  const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };

  ctx.beginPath();
  ctx.moveTo(prevMid.x, prevMid.y);
  ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
  ctx.stroke();

  prevMid = mid;
  last = p;
  paintToStage(frame);
}

function onPointerUp(e: PointerEvent): void {
  if (!stroking) return;
  stroking = false;
  try {
    drawCanvas.releasePointerCapture(e.pointerId);
  } catch {
    /* pointer already released */
  }
  emit('thumb', state.current);
}

/** Blit the frame's drawing canvas onto the visible stage canvas. */
function paintToStage(frame: Frame): void {
  const dctx = drawCanvas.getContext('2d')!;
  dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  dctx.drawImage(drawingFor(frame), 0, 0);
}

// ---------- brush cursor ----------

let cursorScale = 1;

function updateBrushCursor(e: PointerEvent): void {
  const rect = drawCanvas.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  cursorScale = rect.width / drawCanvas.width;
  const size = Math.max(4, state.brushSize * cursorScale);
  brushCursor.style.width = `${size}px`;
  brushCursor.style.height = `${size}px`;
  brushCursor.style.left = `${e.clientX - stageRect.left}px`;
  brushCursor.style.top = `${e.clientY - stageRect.top}px`;
  brushCursor.style.display = 'block';
}

export function refreshCursorSize(): void {
  // Recompute on brush-size change; position stays where the pointer is.
  const size = Math.max(4, state.brushSize * cursorScale);
  brushCursor.style.width = `${size}px`;
  brushCursor.style.height = `${size}px`;
}
