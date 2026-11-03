import type { ApiErrorBody, PageMeta } from '@vyra/shared';
import { analyticsHeaders } from './analytics';

/** Error thrown for every non-2xx API response (or a network failure: code NETWORK_ERROR, status 0). */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** `details.fieldErrors` from a VALIDATION_FAILED response, if present. */
  get fieldErrors(): Record<string, string[]> {
    const d = this.details as { fieldErrors?: unknown } | null | undefined;
    if (d && typeof d === 'object' && d.fieldErrors && typeof d.fieldErrors === 'object') {
      return d.fieldErrors as Record<string, string[]>;
    }
    return {};
  }
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON body (serialised) or FormData (sent as multipart). */
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  /** Skip the automatic refresh-and-retry on 401 (used by the auth endpoints themselves). */
  skipRefresh?: boolean;
}

export const API_PREFIX = '/api/v1';

const NO_REFRESH_PATHS = ['/auth/refresh', '/auth/login', '/auth/register', '/auth/logout', '/auth/otp'];

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  if (!qs) return url;
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await res.json()) as Partial<ApiErrorBody>;
  } catch {
    body = null;
  }
  const err = body?.error;
  if (err && typeof err.code === 'string') {
    return new ApiError(err.code, err.message || 'Something went wrong', res.status, err.details);
  }
  const fallbackCode =
    res.status === 401
      ? 'UNAUTHORIZED'
      : res.status === 404
        ? 'NOT_FOUND'
        : res.status === 429
          ? 'RATE_LIMITED'
          : 'INTERNAL';
  return new ApiError(fallbackCode, res.statusText || 'Something went wrong', res.status);
}

let refreshInFlight: Promise<boolean> | null = null;

/** POST /auth/refresh, de-duplicated across concurrent 401s. Resolves true when a new session was issued. */
export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(buildUrl('/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'vyra', Accept: 'application/json', ...analyticsHeaders() },
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const method = opts.method ?? 'GET';
  // Session analytics headers ride on every browser request (server components use server-api.ts).
  const headers: Record<string, string> = { Accept: 'application/json', ...analyticsHeaders() };
  let body: BodyInit | undefined;
  if (method !== 'GET') headers['X-Requested-With'] = 'vyra';
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  try {
    return await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body,
      credentials: 'include',
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(
      'NETWORK_ERROR',
      'Could not reach VYRA. Check your connection and try again.',
      0,
    );
  }
}

/** Calls the API and returns the full envelope `{ data, meta }`. */
export async function apiEnvelope<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<{ data: T; meta?: PageMeta }> {
  let res = await send(path, opts);
  const canRefresh = !opts.skipRefresh && !NO_REFRESH_PATHS.some((p) => path.startsWith(p));
  if (res.status === 401 && canRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) res = await send(path, opts);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return { data: undefined as T };
  const json = (await res.json()) as { data: T; meta?: PageMeta };
  return json;
}

/** Calls the API and unwraps `data`. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { data } = await apiEnvelope<T>(path, opts);
  return data;
}

/** SWR fetcher: keys are API paths (e.g. "/cart"). */
export const swrFetcher = <T>(path: string): Promise<T> => api<T>(path);

export function errorMessage(
  e: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (e instanceof ApiError) return e.message || fallback;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
