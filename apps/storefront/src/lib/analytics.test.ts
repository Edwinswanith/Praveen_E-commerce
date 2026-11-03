import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetAnalytics,
  analyticsHeaders,
  detectDevice,
  FLUSH_DELAY_MS,
  getSessionId,
  getSource,
  sanitizeSource,
  SESSION_IDLE_MS,
  SESSION_KEY,
  track,
} from './analytics';
import { api } from './api';

const SID_RE = /^s_[0-9a-f]{32}$/;

function setUrl(search: string) {
  window.history.replaceState(null, '', `/${search}`);
}

describe('session id', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetAnalytics();
    setUrl('');
  });

  it('creates an s_-prefixed dash-less id that matches the API regex and persists it', () => {
    const sid = getSessionId(1_000);
    expect(sid).toMatch(SID_RE);
    expect(sid).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(window.localStorage.getItem(SESSION_KEY)).toBe(sid);
    expect(getSessionId(2_000)).toBe(sid);
  });

  it('keeps the id while active and rotates after 30 minutes idle', () => {
    const t0 = 1_000_000;
    const sid = getSessionId(t0);
    expect(getSessionId(t0 + SESSION_IDLE_MS - 1)).toBe(sid); // activity refreshes the clock
    expect(getSessionId(t0 + 2 * SESSION_IDLE_MS - 2)).toBe(sid);
    const rotated = getSessionId(t0 + 3 * SESSION_IDLE_MS);
    expect(rotated).not.toBe(sid);
    expect(rotated).toMatch(SID_RE);
  });

  it('replaces a tampered id', () => {
    window.localStorage.setItem(SESSION_KEY, 'bad id!');
    window.localStorage.setItem('vyra_sid_at', String(Date.now()));
    expect(getSessionId()).toMatch(SID_RE);
  });

  it('falls back to memory when localStorage throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    try {
      const sid = getSessionId(5_000);
      expect(sid).toMatch(SID_RE);
      expect(getSessionId(6_000)).toBe(sid);
      expect(() => analyticsHeaders()).not.toThrow();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe('source + device', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetAnalytics();
  });

  it('sanitises utm_source', () => {
    expect(sanitizeSource('  Instagram Story!! ')).toBe('instagramstory');
    expect(sanitizeSource('news.letter_v2-a')).toBe('news.letter_v2-a');
    expect(sanitizeSource('<script>')).toBe('script');
    expect(sanitizeSource('!!!')).toBeNull();
    expect(sanitizeSource('x'.repeat(80))).toHaveLength(40);
  });

  it('keeps the first-touch source for the session and resets it on rotation', () => {
    setUrl('?utm_source=TAG');
    const sid = getSessionId(10_000);
    expect(getSource(sid)).toBe('tag');
    setUrl('?utm_source=instagram');
    expect(getSource(sid)).toBe('tag');
    const next = getSessionId(10_000 + SESSION_IDLE_MS + 1);
    expect(getSource(next)).toBe('instagram');
  });

  it('detects devices from UA and viewport', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148';
    const pixel = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/120 Mobile Safari/537.36';
    const tab = 'Mozilla/5.0 (Linux; Android 13; SM-X700) Chrome/120 Safari/537.36';
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15';
    expect(detectDevice(iphone, 390, 5)).toBe('mobile');
    expect(detectDevice(pixel, 412, 5)).toBe('mobile');
    expect(detectDevice(tab, 1200, 5)).toBe('tablet');
    expect(detectDevice(mac, 1024, 5)).toBe('tablet'); // iPadOS
    expect(detectDevice(mac, 1440, 0)).toBe('desktop');
    expect(detectDevice('unknown', 500, 0)).toBe('mobile');
  });
});

describe('headers on API requests', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    window.localStorage.clear();
    __resetAnalytics();
    setUrl('?utm_source=tag');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends X-Vyra-Session / Device / Source on every request', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: {} }), { status: 200 }));
    await api('/cart');
    await api('/newsletter', { method: 'POST', body: { email: 'a@b.co' } });
    for (const [, init] of fetchMock.mock.calls) {
      const h = init!.headers as Record<string, string>;
      expect(h['X-Vyra-Session']).toMatch(SID_RE);
      expect(['mobile', 'tablet', 'desktop']).toContain(h['X-Vyra-Device']);
      expect(h['X-Vyra-Source']).toBe('tag');
    }
    const [a, b] = fetchMock.mock.calls.map(([, init]) => (init!.headers as Record<string, string>)['X-Vyra-Session']);
    expect(a).toBe(b);
  });
});

describe('track() batching', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    __resetAnalytics();
    setUrl('');
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('{"data":{"accepted":1}}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('debounces events into one keepalive POST /api/v1/events', () => {
    track('PRODUCT_VIEW', 'cprod1aaaaaaaaaaaaaaaaaa');
    vi.advanceTimersByTime(FLUSH_DELAY_MS - 100);
    track('QUICK_VIEW', 'cprod2aaaaaaaaaaaaaaaaaa');
    vi.advanceTimersByTime(FLUSH_DELAY_MS - 100);
    expect(fetchMock).not.toHaveBeenCalled();
    track('CHECKOUT_STARTED');
    vi.advanceTimersByTime(FLUSH_DELAY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/events');
    expect(init?.method).toBe('POST');
    expect(init?.keepalive).toBe(true);
    const h = init!.headers as Record<string, string>;
    expect(h['X-Requested-With']).toBe('vyra');
    expect(h['X-Vyra-Session']).toMatch(SID_RE);
    const body = JSON.parse(String(init!.body)) as { sessionId: string; device: string; events: unknown[] };
    expect(body.sessionId).toBe(h['X-Vyra-Session']);
    expect(body.device).toMatch(/mobile|tablet|desktop/);
    expect(body.events).toEqual([
      { type: 'PRODUCT_VIEW', productId: 'cprod1aaaaaaaaaaaaaaaaaa' },
      { type: 'QUICK_VIEW', productId: 'cprod2aaaaaaaaaaaaaaaaaa' },
      { type: 'CHECKOUT_STARTED' },
    ]);
  });

  it('flushes immediately on pagehide and when the page is hidden', () => {
    track('PRODUCT_VIEW', 'cprod1aaaaaaaaaaaaaaaaaa');
    window.dispatchEvent(new Event('pagehide'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    track('QUICK_VIEW', 'cprod1aaaaaaaaaaaaaaaaaa');
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vis.mockRestore();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(FLUSH_DELAY_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('caps a batch at 20 events', () => {
    for (let i = 0; i < 25; i++) track('PRODUCT_VIEW');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { events: unknown[] }).events).toHaveLength(20);
    vi.advanceTimersByTime(FLUSH_DELAY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never throws, even if fetch does', () => {
    fetchMock.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => {
      track('PRODUCT_VIEW');
      vi.advanceTimersByTime(FLUSH_DELAY_MS);
    }).not.toThrow();
    fetchMock.mockRejectedValue(new TypeError('offline'));
    expect(() => {
      track('PRODUCT_VIEW');
      vi.advanceTimersByTime(FLUSH_DELAY_MS);
    }).not.toThrow();
  });
});
