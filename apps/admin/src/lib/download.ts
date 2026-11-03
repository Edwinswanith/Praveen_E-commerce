import { requestBlob, type Query } from './api';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** GETs (or POSTs) a binary admin endpoint and saves it via a blob URL. */
export async function downloadFile(path: string, fallbackName: string, opts: { query?: Query; method?: 'GET' | 'POST'; body?: unknown } = {}) {
  const { blob, filename } = await requestBlob(path, { query: opts.query, method: opts.method, body: opts.body });
  triggerDownload(blob, filename ?? fallbackName);
}

/** Opens a binary (PDF) in a new tab via a blob URL; falls back to download if popups are blocked. */
export async function openFile(path: string, fallbackName: string, opts: { query?: Query; method?: 'GET' | 'POST'; body?: unknown } = {}) {
  const win = window.open('', '_blank');
  try {
    const { blob, filename } = await requestBlob(path, { query: opts.query, method: opts.method, body: opts.body });
    const url = URL.createObjectURL(blob);
    if (win) {
      win.location.href = url;
    } else {
      triggerDownload(blob, filename ?? fallbackName);
    }
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (err) {
    win?.close();
    throw err;
  }
}
