import { ApiError } from './api';

/** `details.retryAfterSeconds` from a 429 RATE_LIMITED response, if any. */
export function retryAfterSeconds(e: unknown): number | null {
  if (!(e instanceof ApiError) || e.status !== 429) return null;
  const d = e.details as { retryAfterSeconds?: unknown } | null | undefined;
  return d && typeof d.retryAfterSeconds === 'number' && d.retryAfterSeconds > 0
    ? Math.ceil(d.retryAfterSeconds)
    : null;
}

/** 422 from /auth/otp/verify telling us this phone is new and we need a name. */
export function needsName(e: unknown): boolean {
  if (!(e instanceof ApiError) || e.status !== 422) return false;
  const d = e.details as { needsName?: unknown } | null | undefined;
  return !!d && d.needsName === true;
}

/** Strips +91 / leading 0 / spaces / dashes. Returns the 10-digit number or null. */
export function normalizeIndianMobile(v: string): string | null {
  const n = v.trim().replace(/^(\+91|0)/, '').replace(/[\s-]/g, '');
  return /^[6-9]\d{9}$/.test(n) ? n : null;
}

export function formatCountdown(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`;
}
