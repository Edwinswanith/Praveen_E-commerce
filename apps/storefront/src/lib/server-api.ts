/** Server-only helper (uses API_URL, which is not exposed to the browser). */
import type { PageMeta } from '@vyra/shared';

const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export type ServerResult<T> =
  | { ok: true; data: T; meta?: PageMeta }
  | { ok: false; status: number; code: string; message: string };

/**
 * Server-side fetch of a public API endpoint. Never throws: an unreachable API
 * or error response becomes `{ ok: false }` so pages render an error state and
 * `next build` succeeds without the API running.
 */
export async function serverFetch<T>(
  path: string,
  init: {
    revalidate?: number | false;
    query?: Record<string, string | number | undefined>;
    timeoutMs?: number;
  } = {},
): Promise<ServerResult<T>> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(init.query ?? {}))
    if (v !== undefined && v !== '') params.set(k, String(v));
  const qs = params.toString();
  const url = `${API_URL}/api/v1${path}${qs ? `${path.includes('?') ? '&' : '?'}${qs}` : ''}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: init.revalidate === false ? undefined : { revalidate: init.revalidate ?? 60 },
      cache: init.revalidate === false ? 'no-store' : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 8000),
    });
    if (!res.ok) {
      let code = 'INTERNAL';
      let message = res.statusText;
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        code = body.error?.code ?? code;
        message = body.error?.message ?? message;
      } catch {
        /* non-JSON error body */
      }
      return { ok: false, status: res.status, code, message };
    }
    const json = (await res.json()) as { data: T; meta?: PageMeta };
    return { ok: true, data: json.data, meta: json.meta };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      code: 'UNAVAILABLE',
      message: e instanceof Error ? e.message : 'API unavailable',
    };
  }
}
