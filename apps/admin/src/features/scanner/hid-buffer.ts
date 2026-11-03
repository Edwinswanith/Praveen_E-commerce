import { normalizeScan } from '@vyra/shared';

export interface HidBufferOptions {
  /** Max gap between keystrokes for them to count as one scanner burst. Humans type ~100–250ms apart. */
  maxInterKeyMs?: number;
  /** Max gap between the last character and the terminating Enter. */
  enterGraceMs?: number;
  /** Minimum code length to accept. */
  minLength?: number;
}

/**
 * Detects USB/Bluetooth HID barcode scanners, which "type" a code very quickly and
 * terminate it with Enter. Feed it every keydown (key + timestamp). It returns the
 * normalised code when a fast burst ends in Enter; slow (human) typing never
 * produces a code because any slow gap resets the buffer.
 */
export class HidScanBuffer {
  private chars: string[] = [];
  private lastAt = 0;
  private readonly maxInterKeyMs: number;
  private readonly enterGraceMs: number;
  private readonly minLength: number;

  constructor(opts: HidBufferOptions = {}) {
    this.maxInterKeyMs = opts.maxInterKeyMs ?? 50;
    this.enterGraceMs = opts.enterGraceMs ?? 120;
    this.minLength = opts.minLength ?? 4;
  }

  /** Returns a code when a scan completes, otherwise null. */
  push(key: string, at: number): string | null {
    if (key === 'Enter') {
      const fast = this.chars.length > 0 && at - this.lastAt <= this.enterGraceMs;
      const raw = this.chars.join('');
      this.reset();
      if (!fast || raw.length < this.minLength) return null;
      const code = normalizeScan(raw);
      return code.length >= this.minLength ? code : null;
    }
    // Modifier/navigation keys (Shift, Alt, ArrowLeft…) are ignored without breaking a burst.
    if (key.length !== 1) return null;
    if (this.chars.length > 0 && at - this.lastAt > this.maxInterKeyMs) this.chars = [];
    this.chars.push(key);
    this.lastAt = at;
    return null;
  }

  /** True while a fast burst is in progress (useful to suppress default key handling). */
  get pending(): boolean {
    return this.chars.length > 1;
  }

  reset(): void {
    this.chars = [];
    this.lastAt = 0;
  }
}

/** Returns a predicate that rejects the same code seen again within `windowMs` (camera re-reads). */
export function createDuplicateFilter(windowMs = 2000) {
  const seen = new Map<string, number>();
  return (code: string, at: number): boolean => {
    const prev = seen.get(code);
    seen.set(code, at);
    for (const [k, t] of seen) if (at - t > windowMs * 5) seen.delete(k);
    return prev === undefined || at - prev >= windowMs;
  };
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  return el.isContentEditable === true || el.getAttribute("contenteditable") === "true";
}
