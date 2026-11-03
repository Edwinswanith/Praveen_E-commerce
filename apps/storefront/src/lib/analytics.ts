/**
 * First-party, cookie-less session analytics (no PII, no third-party trackers).
 *
 * - A random session id lives in localStorage `vyra_sid` and rotates after 30
 *   minutes of inactivity. If storage is unavailable (private mode, blocked
 *   site data) an in-memory store is used for the lifetime of the tab.
 * - Every browser API call carries X-Vyra-Session / X-Vyra-Device / X-Vyra-Source
 *   (see `analyticsHeaders`, used by lib/api.ts).
 * - `track()` batches the three browser-reportable funnel events to
 *   POST /api/v1/events. It never throws and never blocks the UI.
 */
import type { CLIENT_EVENT_TYPES } from '@vyra/shared';
import { API_PREFIX } from '@vyra/shared';

export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];
export type Device = 'mobile' | 'tablet' | 'desktop';

export const SESSION_KEY = 'vyra_sid';
const ACTIVE_KEY = 'vyra_sid_at';
const SOURCE_KEY = 'vyra_src';
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const FLUSH_DELAY_MS = 2000;
const MAX_BATCH = 20;
const SESSION_RE = /^[A-Za-z0-9_-]{16,64}$/;
const EVENTS_URL = `${API_PREFIX}/events`;

// ---------------------------------------------------------------- storage
interface KV {
  get(k: string): string | null;
  set(k: string, v: string): void;
}

const memory = new Map<string, string>();
const memoryKV: KV = {
  get: (k) => memory.get(k) ?? null,
  set: (k, v) => void memory.set(k, v),
};

/** localStorage when it works, otherwise the in-memory fallback (per call: storage can start failing at any time, e.g. quota). */
const kv: KV = {
  get(k) {
    try {
      const v = window.localStorage.getItem(k);
      return v ?? memoryKV.get(k);
    } catch {
      return memoryKV.get(k);
    }
  },
  set(k, v) {
    memoryKV.set(k, v);
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* in-memory only */
    }
  },
};

// ---------------------------------------------------------------- session id
function randomHex(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '');
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export function newSessionId(): string {
  return `s_${randomHex()}`;
}

/** Current session id; starts a new session after 30 min idle. Each call counts as activity. */
export function getSessionId(now: number = Date.now()): string {
  const existing = kv.get(SESSION_KEY);
  const lastActive = Number(kv.get(ACTIVE_KEY) ?? 0);
  let sid = existing;
  if (!sid || !SESSION_RE.test(sid) || !(now - lastActive < SESSION_IDLE_MS)) {
    sid = newSessionId();
    kv.set(SESSION_KEY, sid);
  }
  kv.set(ACTIVE_KEY, String(now));
  return sid;
}

// ---------------------------------------------------------------- device
export function detectDevice(
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  width: number = typeof window !== 'undefined' ? window.innerWidth : 1280,
  touchPoints: number = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0,
): Device {
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua)) return 'tablet';
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
  // iPadOS reports a desktop Safari UA but has multi-touch.
  if (/Macintosh/i.test(ua) && touchPoints > 1) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return 'mobile';
  if (width < 640) return 'mobile';
  if (width < 1024 && touchPoints > 0) return 'tablet';
  return 'desktop';
}

// ---------------------------------------------------------------- source
/** Lowercase, keep [a-z0-9_.-], max 40 chars; null when nothing usable remains. */
export function sanitizeSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, 40);
  return s || null;
}

/**
 * First-touch `utm_source` for the current session: the first page of a
 * session decides it (later utm links in the same session don't overwrite).
 */
export function getSource(sid: string = getSessionId()): string | null {
  const raw = kv.get(SOURCE_KEY);
  if (raw) {
    try {
      const stored = JSON.parse(raw) as { sid?: unknown; source?: unknown };
      if (stored.sid === sid) return typeof stored.source === 'string' ? stored.source || null : null;
    } catch {
      /* corrupt: re-derive */
    }
  }
  let source: string | null = null;
  try {
    source = sanitizeSource(new URLSearchParams(window.location.search).get('utm_source'));
  } catch {
    source = null;
  }
  kv.set(SOURCE_KEY, JSON.stringify({ sid, source: source ?? '' }));
  return source;
}

/** Headers for every browser API request. Empty on the server. */
export function analyticsHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const sid = getSessionId();
    const headers: Record<string, string> = {
      'X-Vyra-Session': sid,
      'X-Vyra-Device': detectDevice(),
    };
    const source = getSource(sid);
    if (source) headers['X-Vyra-Source'] = source;
    return headers;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------- batching
interface QueuedEvent {
  type: ClientEventType;
  productId?: string;
}

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function onHide() {
  flush();
}
function onVisibility() {
  if (document.visibilityState === 'hidden') flush();
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisibility);
}

/** Sends everything queued (fire-and-forget, keepalive so it survives page unload). */
export function flush(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0 || typeof window === 'undefined') return;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    const sessionId = getSessionId();
    const source = getSource(sessionId);
    const body = JSON.stringify({
      sessionId,
      device: detectDevice(),
      ...(source ? { source } : {}),
      events: batch,
    });
    void fetch(EVENTS_URL, {
      method: 'POST',
      keepalive: true,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Requested-With': 'vyra',
        ...analyticsHeaders(),
      },
      body,
    }).catch(() => undefined);
  } catch {
    /* analytics must never break the page */
  }
  if (queue.length > 0) flush();
}

/** Queue a funnel event; flushed after 2s of quiet, on page hide, or when 20 are queued. */
export function track(type: ClientEventType, productId?: string): void {
  try {
    if (typeof window === 'undefined') return;
    listen();
    queue.push(productId ? { type, productId } : { type });
    if (queue.length >= MAX_BATCH) {
      flush();
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, FLUSH_DELAY_MS);
  } catch {
    /* never throws */
  }
}

/** Called once on app boot so the landing page's utm_source is captured as first touch. */
export function initAnalytics(): void {
  try {
    getSource(getSessionId());
    listen();
  } catch {
    /* ignore */
  }
}

/** Test helper: forget queued events, timers and in-memory state. */
export function __resetAnalytics(): void {
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
  memory.clear();
  if (listening && typeof window !== 'undefined') {
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVisibility);
  }
  listening = false;
}
