import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import { on, state } from './state';

/** Contour segments in frame pixels, one closed-ish loop per person region. */
export interface PersonEdges {
  segments: [number, number, number, number][];
}

let segmenter: ImageSegmenter | null = null;
let initPromise: Promise<ImageSegmenter> | null = null;

const cache = new Map<number, PersonEdges | null>();

// DeepLab V3 (PASCAL) class 15 = person.
const PERSON_CLASS = 15;
// Contour resolution: grid cells across the frame width. Coarser = chunkier.
const GRID_W = 128;
// A cell counts as person above this fraction of person pixels.
const FILL_THRESHOLD = 0.55;

export function initPersonEdges(): void {
  on('loaded', () => cache.clear());
}

async function createSegmenter(): Promise<ImageSegmenter> {
  const fileset = await FilesetResolver.forVisionTasks('./models/wasm');
  const make = (delegate: 'GPU' | 'CPU') =>
    ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './models/deeplab_v3.tflite', delegate },
      runningMode: 'IMAGE',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
  try {
    return await make('GPU');
  } catch {
    return await make('CPU');
  }
}

export function ensureSegmenter(): Promise<ImageSegmenter> {
  if (!initPromise) {
    initPromise = createSegmenter()
      .then((s) => {
        segmenter = s;
        return s;
      })
      .catch((err) => {
        initPromise = null;
        throw err;
      });
  }
  return initPromise;
}

/** Segment a frame and extract person contours; cached. null = no persons. */
export async function detectPersons(index: number): Promise<PersonEdges | null> {
  if (cache.has(index)) return cache.get(index)!;
  const s = segmenter ?? (await ensureSegmenter());
  const frame = state.frames[index];
  if (!frame) return null;

  const result = s.segment(frame.source);
  const mask = result.categoryMask;
  if (!mask) {
    result.close();
    cache.set(index, null);
    return null;
  }

  try {
    const data = mask.getAsUint8Array();
    const mw = mask.width;
    const mh = mask.height;

    // Downsample the per-pixel mask into a person/grid.
    const gw = Math.min(GRID_W, mw);
    const gh = Math.max(1, Math.round((gw * mh) / mw));
    const grid = new Uint8Array(gw * gh);
    for (let cy = 0; cy < gh; cy++) {
      const y0 = Math.floor((cy * mh) / gh);
      const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * mh) / gh));
      for (let cx = 0; cx < gw; cx++) {
        const x0 = Math.floor((cx * mw) / gw);
        const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * mw) / gw));
        let person = 0;
        let total = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            total++;
            if (data[y * mw + x] === PERSON_CLASS) person++;
          }
        }
        grid[cy * gw + cx] = person / total >= FILL_THRESHOLD ? 1 : 0;
      }
    }

    // Trace cell boundaries between person and non-person cells.
    const scaleX = frame.source.width / gw;
    const scaleY = frame.source.height / gh;
    const segments: [number, number, number, number][] = [];
    const isPerson = (cx: number, cy: number) =>
      cx >= 0 && cx < gw && cy >= 0 && cy < gh && grid[cy * gw + cx] === 1;
    for (let cy = 0; cy < gh; cy++) {
      for (let cx = 0; cx < gw; cx++) {
        if (grid[cy * gw + cx] !== 1) continue;
        const x = cx * scaleX;
        const y = cy * scaleY;
        if (!isPerson(cx, cy - 1)) segments.push([x, y, x + scaleX, y]);
        if (!isPerson(cx, cy + 1)) segments.push([x, y + scaleY, x + scaleX, y + scaleY]);
        if (!isPerson(cx - 1, cy)) segments.push([x, y, x, y + scaleY]);
        if (!isPerson(cx + 1, cy)) segments.push([x + scaleX, y, x + scaleX, y + scaleY]);
      }
    }

    const value = segments.length > 0 ? { segments } : null;
    cache.set(index, value);
    return value;
  } finally {
    result.close();
  }
}

export function cachedPersons(index: number): PersonEdges | null | undefined {
  return cache.get(index);
}
