/** Hands a picked image from the header dialog to /search/visual across a client-side navigation. */
let pending: File | null = null;

export function setPendingVisualFile(file: File): void {
  pending = file;
}

export function takePendingVisualFile(): File | null {
  const f = pending;
  pending = null;
  return f;
}
