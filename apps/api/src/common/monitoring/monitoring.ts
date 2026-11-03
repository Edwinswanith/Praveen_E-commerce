import { Logger } from '@nestjs/common';

/**
 * Error monitoring. When SENTRY_DSN is set, server errors (5xx) and crashes are
 * reported to Sentry with the request id; otherwise this is a no-op. Customer
 * PII (cookies, auth headers, bodies) is never sent.
 */
type SentryLike = {
  init(o: Record<string, unknown>): void;
  captureException(e: unknown, ctx?: Record<string, unknown>): void;
};
let sentry: SentryLike | null = null;

export function initMonitoring(dsn: string | undefined, release: string, environment: string) {
  if (!dsn) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sentry = require('@sentry/node') as SentryLike;
    sentry.init({
      dsn, release, environment, tracesSampleRate: 0, sendDefaultPii: false,
      beforeSend(event: { request?: { cookies?: unknown; headers?: Record<string, unknown>; data?: unknown } }) {
        if (event.request) {
          delete event.request.cookies;
          delete event.request.data;
          if (event.request.headers) for (const h of ['cookie', 'authorization', 'x-razorpay-signature']) delete event.request.headers[h];
        }
        return event;
      },
    });
    process.on('unhandledRejection', (e) => sentry?.captureException(e));
    Logger.log('Error monitoring enabled (Sentry)', 'Monitoring');
  } catch (e) {
    Logger.warn(`SENTRY_DSN set but @sentry/node is unavailable: ${(e as Error).message}`, 'Monitoring');
  }
}

export function reportError(error: unknown, context: { requestId?: string; path?: string; status?: number }) {
  sentry?.captureException(error, { tags: { requestId: context.requestId, status: String(context.status ?? '') }, extra: { path: context.path } });
}
