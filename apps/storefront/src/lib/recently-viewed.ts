const KEY = 'vyra_recently_viewed';
const MAX = 12;

export function getRecentlyViewed(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

export function recordRecentlyViewed(productId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const next = [productId, ...getRecentlyViewed().filter((id) => id !== productId)].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode) */
  }
}

const PIN_KEY = 'vyra_pincode';
export function getSavedPincode(): string {
  try {
    return window.localStorage.getItem(PIN_KEY) ?? '';
  } catch {
    return '';
  }
}
export function savePincode(pin: string): void {
  try {
    window.localStorage.setItem(PIN_KEY, pin);
  } catch {
    /* ignore */
  }
}
