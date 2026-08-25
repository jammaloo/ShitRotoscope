const progressOverlay = document.getElementById('progress-overlay')!;
const progressLabel = document.getElementById('progress-label')!;
const progressFill = document.getElementById('progress-fill')!;

export function showProgress(label: string, fraction = 0): void {
  progressLabel.textContent = label;
  progressFill.style.width = `${Math.round(fraction * 100)}%`;
  progressOverlay.hidden = false;
}

export function updateProgress(label: string | null, fraction: number): void {
  if (label !== null) progressLabel.textContent = label;
  progressFill.style.width = `${Math.round(fraction * 100)}%`;
}

export function hideProgress(): void {
  progressOverlay.hidden = true;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
