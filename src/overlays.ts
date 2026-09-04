import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { cachedFaces, detectFrame, FaceOverlay } from './facedetect';
import { hasProject, on, state } from './state';

const overlayCanvas = document.getElementById('overlay-canvas')! as HTMLCanvasElement;
const FACE_COLOR = '#38bdf8';

export function initOverlays(): void {
  on('frame', renderOverlay);
  on('overlay', renderOverlay);
  on('loaded', renderOverlay);
}

export function renderOverlay(): void {
  const ctx = overlayCanvas.getContext('2d')!;
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!hasProject() || state.current < 0) return;

  const i = state.current;

  if (state.showPrev && i > 0) {
    const prev = state.frames[i - 1].drawing;
    if (prev) {
      ctx.globalAlpha = 0.4;
      ctx.drawImage(prev, 0, 0);
      ctx.globalAlpha = 1;
    }
  }

  if (state.showFace) {
    const cached = cachedFaces(i);
    if (cached) {
      drawFaces(ctx, cached);
    } else {
      // Kick off async detection; draw when it lands (if still on this frame).
      detectFrame(i)
        .then((faces) => {
          if (faces && state.current === i) drawFaces(ctx, faces);
        })
        .catch((err) => console.warn('Face detection failed:', err));
    }
  }
}

// Face-mesh landmark indices for a dlib-style nose: bridge down the center,
// then a line across the nostril base.
const NOSE_BRIDGE = [168, 6, 197, 195, 5, 4, 1, 2];
const NOSE_BASE = [98, 97, 2, 326, 327];

function drawFaces(ctx: CanvasRenderingContext2D, faces: FaceOverlay[]): void {
  ctx.save();
  ctx.strokeStyle = FACE_COLOR;
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = Math.max(1.5, 2.2 * (overlayCanvas.width / 640));
  strokeFaceContours(ctx, faces);
  ctx.restore();
}

/**
 * Stroke the face-contour paths (face oval, eyes, brows, lips, nose) for
 * every face using the context's current styling.
 */
export function strokeFaceContours(ctx: CanvasRenderingContext2D, faces: FaceOverlay[]): void {
  for (const face of faces) {
    const pts = face.landmarks;
    ctx.beginPath();
    for (const conn of FaceLandmarker.FACE_LANDMARKS_CONTOURS) {
      const a = pts[conn.start];
      const b = pts[conn.end];
      if (!a || !b) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    strokePolyline(ctx, pts, NOSE_BRIDGE);
    strokePolyline(ctx, pts, NOSE_BASE);
  }
}

function strokePolyline(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], indices: number[]): void {
  ctx.beginPath();
  let started = false;
  for (const i of indices) {
    const p = pts[i];
    if (!p) continue;
    if (!started) {
      ctx.moveTo(p.x, p.y);
      started = true;
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();
}
