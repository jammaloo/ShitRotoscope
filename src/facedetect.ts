import { FaceDetector, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { on, state } from './state';

export interface FaceOverlay {
  /** Dense face-mesh landmarks (~478 points) in pixels of the frame canvas. */
  landmarks: { x: number; y: number }[];
}

let detector: FaceDetector | null = null;
let landmarker: FaceLandmarker | null = null;
let initPromise: Promise<void> | null = null;

/** Meshes per frame index for the current project; null = no faces. */
const cache = new Map<number, FaceOverlay[] | null>();

// Resolution of the per-face crop fed to the landmarker. The landmarker's own
// face finder misses small faces, so we locate faces with the full-range
// detector first and mesh each crop individually.
const CROP_SIZE = 448;
const CROP_MARGIN = 0.35;

export function initFaceDetect(): void {
  on('loaded', () => cache.clear());
}

async function withGpuFallback<T>(make: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  try {
    return await make('GPU');
  } catch {
    return await make('CPU');
  }
}

async function createModels(): Promise<void> {
  const fileset = await FilesetResolver.forVisionTasks('./models/wasm');
  detector = await withGpuFallback((delegate) =>
    FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './models/blaze_face_full_range.tflite', delegate },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.3,
    }),
  );
  landmarker = await withGpuFallback((delegate) =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: './models/face_landmarker.task', delegate },
      runningMode: 'IMAGE',
      numFaces: 1,
    }),
  );
}

/** Lazily initialize both models (first toggle-on). */
export function ensureDetector(): Promise<void> {
  if (!initPromise) {
    initPromise = createModels().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

/** Detect face meshes on a frame; cached. Resolves null when no faces found. */
export async function detectFrame(index: number): Promise<FaceOverlay[] | null> {
  if (cache.has(index)) return cache.get(index)!;
  await ensureDetector();
  const frame = state.frames[index];
  if (!frame || !detector || !landmarker) return null;

  const src = frame.source;
  const overlays: FaceOverlay[] = [];
  for (const det of detector.detect(src).detections ?? []) {
    const b = det.boundingBox;
    if (!b || b.width <= 0 || b.height <= 0) continue;
    const landmarks = meshForBox(src, b);
    if (landmarks) overlays.push({ landmarks });
  }

  const value = overlays.length > 0 ? overlays : null;
  cache.set(index, value);
  return value;
}

/** Crop around a detected face box, mesh it, and map landmarks back to frame pixels. */
function meshForBox(src: HTMLCanvasElement, b: { originX: number; originY: number; width: number; height: number }): { x: number; y: number }[] | null {
  const cx = b.originX + b.width / 2;
  const cy = b.originY + b.height / 2;
  const size = Math.max(b.width, b.height) * (1 + 2 * CROP_MARGIN);
  const x = cx - size / 2;
  const y = cy - size / 2;

  const crop = document.createElement('canvas');
  crop.width = CROP_SIZE;
  crop.height = CROP_SIZE;
  const ctx = crop.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Source rect may extend past the frame edges; the extra area just stays
  // transparent, which the model tolerates fine.
  ctx.drawImage(src, x, y, size, size, 0, 0, CROP_SIZE, CROP_SIZE);

  const lms = landmarker!.detect(crop).faceLandmarks?.[0];
  if (!lms) return null;
  return lms.map((k) => ({ x: x + k.x * size, y: y + k.y * size }));
}

export function cachedFaces(index: number): FaceOverlay[] | null | undefined {
  return cache.get(index);
}
