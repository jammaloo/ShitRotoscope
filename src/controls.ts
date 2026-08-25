import { undo } from './draw';
import { ensureDetector } from './facedetect';
import { importFile } from './import';
import { renderOverlay } from './overlays';
import {
  hasProject,
  on,
  setColor,
  setCurrent,
  setShowFace,
  setShowPrev,
  setTool,
  setBrushSize,
  state,
} from './state';

const fileInput = document.getElementById('file-input')! as HTMLInputElement;
const prevBtn = document.getElementById('prev-btn')! as HTMLButtonElement;
const nextBtn = document.getElementById('next-btn')! as HTMLButtonElement;
const frameCounter = document.getElementById('frame-counter')!;
const penBtn = document.getElementById('pen-btn')! as HTMLButtonElement;
const eraserBtn = document.getElementById('eraser-btn')! as HTMLButtonElement;
const undoBtn = document.getElementById('undo-btn')! as HTMLButtonElement;
const brushSlider = document.getElementById('brush-slider')! as HTMLInputElement;
const brushMinus = document.getElementById('brush-minus')! as HTMLButtonElement;
const brushPlus = document.getElementById('brush-plus')! as HTMLButtonElement;
const brushLabel = document.getElementById('brush-label')!;
const swatches = document.getElementById('swatches')!;
const customColor = document.getElementById('custom-color')! as HTMLInputElement;
const faceToggle = document.getElementById('face-toggle')! as HTMLInputElement;
const prevToggle = document.getElementById('prev-toggle')! as HTMLInputElement;
const saveBtn = document.getElementById('save-btn')! as HTMLButtonElement;

export function initControls(): void {
  // ---- import ----
  const pickFile = () => fileInput.click();
  document.getElementById('open-btn')!.addEventListener('click', pickFile);
  document.getElementById('empty-open-btn')!.addEventListener('click', pickFile);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void runImport(file);
  });

  // ---- frame nav ----
  prevBtn.addEventListener('click', () => setCurrent(state.current - 1));
  nextBtn.addEventListener('click', () => setCurrent(state.current + 1));
  on('frame', updateNav);
  on('loaded', updateNav);
  on('loaded', updatePrevToggle);

  // ---- tools ----
  penBtn.addEventListener('click', () => setTool('pen'));
  eraserBtn.addEventListener('click', () => setTool('eraser'));
  undoBtn.addEventListener('click', undo);
  on('tool', updateToolButtons);

  // ---- brush ----
  brushSlider.addEventListener('input', () => setBrushSize(Number(brushSlider.value)));
  brushMinus.addEventListener('click', () => nudgeBrush(-1));
  brushPlus.addEventListener('click', () => nudgeBrush(1));

  // ---- color ----
  swatches.querySelectorAll<HTMLElement>('.swatch[data-color]').forEach((el) => {
    el.addEventListener('click', () => setColor(el.dataset.color!));
  });
  customColor.addEventListener('input', () => setColor(customColor.value));
  on('tool', updateSwatches);

  // ---- overlays ----
  faceToggle.addEventListener('change', async () => {
    setShowFace(faceToggle.checked);
    if (faceToggle.checked) {
      try {
        await ensureDetector();
        renderOverlay();
      } catch (err) {
        console.error(err);
        alert('Could not load the face detection model.');
        faceToggle.checked = false;
        setShowFace(false);
      }
    }
  });
  prevToggle.addEventListener('change', () => setShowPrev(prevToggle.checked));

  // ---- keyboard ----
  window.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const target = e.target as HTMLElement;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // Let arrow keys act natively on focused controls (e.g. the brush slider).
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      setCurrent(state.current + (e.key === 'ArrowLeft' ? -1 : 1));
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
  });

  updateToolButtons();
  updateSwatches();
  updatePrevToggle();
}

export async function runImport(file: File): Promise<void> {
  if (hasProject() && anyDrawings() && !confirm('Replace the current project? Your drawings will be lost.')) {
    return;
  }
  try {
    await importFile(file);
  } catch (err) {
    console.error(err);
    alert(err instanceof Error ? err.message : String(err));
  }
}

function anyDrawings(): boolean {
  return state.frames.some((f) => f.drawing);
}

/** The previous-frame overlay is meaningless with fewer than two frames. */
function updatePrevToggle(): void {
  const disable = state.frames.length <= 1;
  prevToggle.disabled = disable;
  if (disable && prevToggle.checked) {
    prevToggle.checked = false;
    setShowPrev(false);
  }
}

function updateNav(): void {
  frameCounter.textContent = hasProject() ? `${state.current + 1} / ${state.frames.length}` : '0 / 0';
  prevBtn.disabled = !hasProject() || state.current <= 0;
  nextBtn.disabled = !hasProject() || state.current >= state.frames.length - 1;
  saveBtn.disabled = !hasProject();
}

function updateToolButtons(): void {
  penBtn.classList.toggle('active', state.tool === 'pen');
  eraserBtn.classList.toggle('active', state.tool === 'eraser');
  brushSlider.value = String(state.brushSize);
  brushLabel.textContent = `${state.brushSize} px`;
}

function nudgeBrush(dir: 1 | -1): void {
  const step = state.brushSize < 8 ? 1 : 2;
  setBrushSize(state.brushSize + dir * step);
}

function updateSwatches(): void {
  const current = state.color.toLowerCase();
  let matchesPreset = false;
  swatches.querySelectorAll<HTMLElement>('.swatch[data-color]').forEach((el) => {
    const match = el.dataset.color!.toLowerCase() === current;
    if (match) matchesPreset = true;
    el.classList.toggle('active', match);
  });
  swatches.querySelector<HTMLElement>('.swatch.custom')!.classList.toggle('active', !matchesPreset);
  if (!matchesPreset) customColor.value = state.color;
}
