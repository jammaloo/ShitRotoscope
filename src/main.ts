import './styles.css';
import { initControls, runImport } from './controls';
import { initDraw, renderStage } from './draw';
import { initExport } from './export';
import { initFaceDetect } from './facedetect';
import { initOverlays } from './overlays';
import { on } from './state';
import { initThumbs } from './thumbs';

initDraw();
initThumbs();
// Face cache must be cleared before overlays re-render, or a newly loaded
// project briefly draws the previous project's cached face boxes.
initFaceDetect();
initOverlays();
initControls();
initExport();

// Redraw the whole stage when overlays change (onion skin sits under the drawing).
on('overlay', renderStage);

// Drag & drop anywhere in the window.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) void runImport(file);
});
