import type { PageMeta } from '@vyra/shared';

/** Error thrown for any non-2xx API response (or network failure). */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get fieldErrors(): Record<string, string[]> | null {
    const d = this.details;
    if (d && typeof d === 'object' && 'fieldErrors' in d) {
      const fe = (d as { fieldErrors: unknown }).fieldErrors;
      if (fe && typeof fe === 'object') return fe as Record<string, string[]>;
    }
    return null;
  }

  get formErrors(): string[] {
    const d = this.details;
    if (d && typeof d === 'object' && 'formErrors' in d && Array.isArray((d as { formErrors: unknown }).formErrors)) {
      return (d as { formErrors: string[] }).formErrors;
    }
    return [];
  }
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: PageMeta;
  /** Any extra top-level envelope keys (e.g. inventory `summary`). */
  extra: Record<string, unknown>;
}

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

const BASE = '/api/v1/admin';
const AUTH_PATHS = ['/auth/login', '/auth/refresh', '/auth/logout'];

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Builds an admin API path (relative to /api/v1/admin) with a query string. */
export function adminPath(path: string, query?: Query): string {
  return `${path}${buildQuery(query)}`;
}

let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'vyra' },
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => { refreshing = null; }, 0);
      });
  }
  return refreshing;
}

function redirectToLogin() {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?next=${next}`);
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error */
  }
  if (body && typeof body === 'object' && 'error' in body) {
    const e = (body as { error: { code?: string; message?: string; details?: unknown; requestId?: string } }).error;
    return new ApiError(e.code ?? 'INTERNAL', e.message ?? res.statusText, res.status, e.details, e.requestId);
  }
  const fallback: Record<number, string> = {
    401: 'Your session has expired. Please sign in again.',
    403: 'You do not have permission to do this.',
    404: 'Not found.',
    429: 'Too many requests. Please slow down.',
    502: 'The API is unreachable.',
    503: 'The API is unavailable.',
    504: 'The API timed out.',
  };
  return new ApiError(res.status === 401 ? 'UNAUTHORIZED' : 'INTERNAL', fallback[res.status] ?? `Request failed (${res.status})`, res.status);
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** Skip the refresh/redirect dance (used by the auth gate itself). */
  noRedirect?: boolean;
}

async function rawRequest(path: string, opts: RequestOptions, retried = false): Promise<Response> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (method !== 'GET') headers['X-Requested-With'] = 'vyra';
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${buildQuery(opts.query)}`, { method, headers, body, credentials: 'include', signal: opts.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('NETWORK', 'Could not reach the server. Check your connection.', 0);
  }
  const isAuthPath = AUTH_PATHS.some((p) => path.startsWith(p));
  if (res.status === 401 && !isAuthPath && !retried) {
    const ok = await refreshSession();
    if (ok) return rawRequest(path, opts, true);
    if (!opts.noRedirect) redirectToLogin();
  }
  return res;
}

/** Performs a JSON request and unwraps the `{ data, meta }` envelope. */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<ApiEnvelope<T>> {
  const res = await rawRequest(path, opts);
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return { data: undefined as T, extra: {} };
  const json = (await res.json()) as Record<string, unknown>;
  const { data, meta, ...extra } = json;
  return { data: data as T, meta: meta as PageMeta | undefined, extra };
}

/** Fetches a binary resource (PDF/PNG/CSV/XLSX) with credentials. */
export async function requestBlob(path: string, opts: RequestOptions = {}): Promise<{ blob: Blob; filename: string | null }> {
  const res = await rawRequest(path, opts);
  if (!res.ok) throw await toApiError(res);
  const cd = res.headers.get('Content-Disposition');
  const match = cd?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return { blob: await res.blob(), filename: match?.[1] ? decodeURIComponent(match[1]) : null };
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>(path, { query, signal }).then((r) => r.data),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }).then((r) => r.data),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body ?? {} }).then((r) => r.data),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body ?? {} }).then((r) => r.data),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }).then((r) => r.data),
  upload: <T>(path: string, form: FormData, query?: Query) => request<T>(path, { method: 'POST', body: form, query }).then((r) => r.data),
  blob: requestBlob,
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
