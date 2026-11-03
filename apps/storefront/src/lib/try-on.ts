import type { TryOnResponse } from '@vyra/shared';
import { api, ApiError } from './api';

export const TRY_ON_QUOTA_KEY = '/try-on/quota';
export const TRY_ON_MAX_EDGE = 1600;

export interface TryOnQuota {
  remainingToday: number;
  available: boolean;
}

/**
 * Re-encodes a photo as JPEG with its longest edge ≤ 1600px, in the browser.
 * Saves mobile data and strips EXIF (incl. GPS) before anything leaves the device.
 */
export async function downscaleImage(file: Blob, maxEdge = TRY_ON_MAX_EDGE, quality = 0.86): Promise<Blob> {
  const source = await decode(file);
  try {
    const { width, height } = source;
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(source.image, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('encode');
    return blob;
  } finally {
    source.release();
  }
}

interface Decoded {
  image: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { image: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      /* fall back to <img> (older Safari) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode'));
      el.src = url;
    });
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

export function requestTryOn(input: {
  photo: Blob;
  productSlug: string;
  color?: string | null;
  signal?: AbortSignal;
}): Promise<TryOnResponse> {
  const form = new FormData();
  form.append('photo', input.photo, 'photo.jpg');
  form.append('productSlug', input.productSlug);
  if (input.color) form.append('color', input.color);
  form.append('consent', 'true');
  return api<TryOnResponse>('/try-on', { method: 'POST', body: form, signal: input.signal });
}

/** Customer-facing copy for a failed try-on. 429/400 carry a useful server message. */
export function tryOnErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 503) return "Virtual try-on isn't available right now. Please try again later.";
    if (e.status === 422) return e.message || 'Please confirm you are 18+ and this is your photo.';
    if (e.status === 413) return 'That photo is too large. Try a smaller one.';
    if (e.status === 0) return e.message;
    if (e.status >= 500) return "We couldn't create your try-on this time. Please try again.";
    return e.message || 'Something went wrong. Please try again.';
  }
  return "We couldn't create your try-on this time. Please try again.";
}

export function remainingLabel(n: number): string {
  if (n <= 0) return 'No free try-ons left today';
  return `${n} free try-on${n === 1 ? '' : 's'} left today`;
}
