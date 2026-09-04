import { undo, applyToDrawing } from './draw';
import { detectFrame, ensureDetector } from './facedetect';
import { importFile } from './import';
import { renderOverlay, strokeFaceContours } from './overlays';
import {
  hasProject,
  on,
  setColor,
  setCurrent,
  setHideFrame,
  setInvertFrame,
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
const hideBgToggle = document.getElementById('hide-bg-toggle')! as HTMLInputElement;
const invertBgToggle = document.getElementById('invert-bg-toggle')! as HTMLInputElement;
const copyFacesBtn = document.getElementById('copy-faces-btn')! as HTMLButtonElement;
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

  // ---- copy detected faces to the drawing canvas ----
  copyFacesBtn.addEventListener('click', async () => {
    if (!hasProject()) return;
    const originalLabel = copyFacesBtn.textContent;
    copyFacesBtn.disabled = true;
    try {
      const index = state.current;
      const faces = await detectFrame(index);
      if (state.current !== index) return; // user moved on while detecting
      if (faces) {
        applyToDrawing((ctx) => strokeFaceContours(ctx, faces));
      } else {
        copyFacesBtn.textContent = 'No faces found';
        await new Promise((r) => setTimeout(r, 1200));
      }
    } catch (err) {
      console.error(err);
      alert('Could not run face detection.');
    } finally {
      copyFacesBtn.textContent = originalLabel;
      copyFacesBtn.disabled = !hasProject();
    }
  });
  hideBgToggle.addEventListener('change', () => setHideFrame(hideBgToggle.checked));
  invertBgToggle.addEventListener('change', () => setInvertFrame(invertBgToggle.checked));

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

  // ---- collapsible controls (mobile layout) ----
  const controlPane = document.getElementById('control-pane')!;
  const collapseBtn = document.getElementById('collapse-btn')! as HTMLButtonElement;
  const controlsHeader = document.getElementById('controls-header')!;
  const setCollapsed = (collapsed: boolean) => {
    controlPane.classList.toggle('collapsed', collapsed);
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
  };
  if (window.matchMedia('(max-width: 768px)').matches) setCollapsed(true);
  const toggleControls = (e: Event) => {
    const t = e.target as HTMLElement;
    if (t.closest('#open-btn') || t.closest('#collapse-btn')) return;
    setCollapsed(!controlPane.classList.contains('collapsed'));
  };
  collapseBtn.addEventListener('click', () => setCollapsed(!controlPane.classList.contains('collapsed')));
  controlsHeader.addEventListener('click', toggleControls);

  updateToolButtons();
  updateSwatches();
  updatePrevToggle();

  // Sync toggle visuals from state: browsers restore checkbox states on
  // reload, which would desync the UI from the actual (all-off) settings.
  faceToggle.checked = state.showFace;
  prevToggle.checked = state.showPrev;
  hideBgToggle.checked = state.hideFrame;
  invertBgToggle.checked = state.invertFrame;
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
  copyFacesBtn.disabled = !hasProject();
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
