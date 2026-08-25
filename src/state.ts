export type Tool = 'pen' | 'eraser';

export interface Frame {
  /** The source video/image frame. */
  source: HTMLCanvasElement;
  /** The user's drawing for this frame; created lazily on first stroke. */
  drawing: HTMLCanvasElement | null;
}

export type AppEvent =
  | 'loaded' // project imported / replaced
  | 'frame' // current frame changed
  | 'thumb' // drawing on frame i changed (detail: index)
  | 'tool' // tool / brush / color changed
  | 'overlay' // overlay toggles changed
  | 'undo'; // undo availability changed

type Handler = (detail?: number) => void;

const listeners = new Map<AppEvent, Set<Handler>>();

export function on(event: AppEvent, fn: Handler): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(fn);
  return () => set!.delete(fn);
}

export function emit(event: AppEvent, detail?: number): void {
  const set = listeners.get(event);
  if (set) for (const fn of set) fn(detail);
}

export const MAX_DIM = 720;
export const MAX_FRAMES = 600;

export const state = {
  frames: [] as Frame[],
  current: -1,
  fps: 12,
  singleImage: false,
  tool: 'pen' as Tool,
  brushSize: 6,
  color: '#000000',
  showFace: false,
  showPrev: false,
  showPersons: false,
  hideFrame: false,
  invertFrame: false,
};

export function hasProject(): boolean {
  return state.frames.length > 0;
}

/** Create the drawing canvas for a frame if it doesn't exist yet. */
export function drawingFor(frame: Frame): HTMLCanvasElement {
  if (!frame.drawing) {
    const c = document.createElement('canvas');
    c.width = frame.source.width;
    c.height = frame.source.height;
    frame.drawing = c;
  }
  return frame.drawing;
}

export function loadProject(frames: Frame[], fps: number, singleImage: boolean): void {
  state.frames = frames;
  state.fps = fps;
  state.singleImage = singleImage;
  state.current = frames.length > 0 ? 0 : -1;
  emit('loaded');
  if (state.current >= 0) emit('frame');
}

export function setCurrent(index: number): void {
  const clamped = Math.max(0, Math.min(state.frames.length - 1, index));
  if (clamped === state.current) return;
  state.current = clamped;
  emit('frame');
}

export function setTool(tool: Tool): void {
  if (state.tool === tool) return;
  state.tool = tool;
  emit('tool');
}

export function setBrushSize(size: number): void {
  const clamped = Math.max(1, Math.min(60, Math.round(size)));
  if (state.brushSize === clamped) return;
  state.brushSize = clamped;
  emit('tool');
}

export function setColor(color: string): void {
  if (state.color === color) return;
  state.color = color;
  emit('tool');
}

export function setShowFace(on: boolean): void {
  state.showFace = on;
  emit('overlay');
}

export function setShowPrev(on: boolean): void {
  state.showPrev = on;
  emit('overlay');
}

export function setShowPersons(on: boolean): void {
  state.showPersons = on;
  emit('overlay');
}

export function setHideFrame(on: boolean): void {
  state.hideFrame = on;
  emit('overlay');
}

export function setInvertFrame(on: boolean): void {
  state.invertFrame = on;
  emit('overlay');
}
