import type { OrderDetailDto } from '@vyra/shared';

const KEY = 'vyra_checkout_idempotency';
const LAST_ORDER = 'vyra_last_order';

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC4122 v4 fallback for older browsers.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** One idempotency key per checkout attempt, stable across retries and reloads until the order completes. */
export function getIdempotencyKey(): string {
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    const k = uuid();
    sessionStorage.setItem(KEY, k);
    return k;
  } catch {
    return uuid();
  }
}

export function clearIdempotencyKey(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function rememberOrder(order: OrderDetailDto): void {
  try {
    sessionStorage.setItem(LAST_ORDER, JSON.stringify(order));
  } catch {
    /* ignore */
  }
}

export function recallOrder(number: string): OrderDetailDto | null {
  try {
    const raw = sessionStorage.getItem(LAST_ORDER);
    if (!raw) return null;
    const o = JSON.parse(raw) as OrderDetailDto;
    return o.number === number ? o : null;
  } catch {
    return null;
  }
}
