/** Single source of truth for the REST prefix used by the API and both apps. */
export const API_PREFIX = '/api/v1';

/**
 * Server-to-server endpoints that authenticate by provider signature/token,
 * not cookies, and are therefore exempt from the CSRF header check. Exact
 * paths only (no prefixes or patterns), so nothing else can ride on them.
 */
export const WEBHOOK_PATHS = [`${API_PREFIX}/payments/razorpay/webhook`, `${API_PREFIX}/shipping/shiprocket/webhook`] as const;

/**
 * Base URL of the API for server-side code (Next rewrites, server components,
 * route handlers). In production a missing or invalid API_URL is a startup /
 * build error: silently pointing a live shop at localhost is never correct.
 * Development falls back to the local API.
 */
export function resolveApiUrl(env: { API_URL?: string; NODE_ENV?: string }): string {
  const raw = env.API_URL?.trim();
  if (!raw) {
    if (env.NODE_ENV === 'production') throw new Error('API_URL is not set. Set it to the API origin (e.g. https://api.vyra.in) for production builds and servers.');
    return 'http://localhost:4000';
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`API_URL "${raw}" is not a valid URL`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`API_URL must be http(s), got ${u.protocol}`);
  return raw.replace(/\/+$/, '');
}
