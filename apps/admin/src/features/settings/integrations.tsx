'use client';
import * as React from 'react';
import useSWR from 'swr';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@vyra/ui';
import { CheckCircle2, CircleDashed, RefreshCw } from 'lucide-react';
import { ApiError, errorMessage } from '@/lib/api';
import type { HealthDto } from '@/lib/types';
import type { Tone } from '@/lib/status';

export type IntegrationKey = keyof HealthDto['integrations'];
export interface IntegrationState { key: IntegrationKey; label: string; state: 'configured' | 'pending' | 'test' | 'off'; detail: string; hint: string }

const LABEL: Record<IntegrationKey, string> = {
  payments: 'Online payments', cod: 'Cash on Delivery', shipping: 'Shipping', email: 'Email', sms: 'SMS (OTP)', whatsapp: 'WhatsApp', embeddings: 'AI search embeddings', storage: 'Media storage',
};

const HINT: Record<IntegrationKey, string> = {
  payments: 'PAYMENT_PROVIDER=razorpay, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET',
  cod: 'COD_ENABLED, COD_RTO_BLOCK_THRESHOLD, COD_CONFIRM_WINDOW_HOURS, PREPAID_DISCOUNT_PERCENT, PREPAID_DISCOUNT_MAX',
  shipping: 'SHIPPING_PROVIDER=shiprocket, SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD, SHIPROCKET_PICKUP_LOCATION, SHIPROCKET_PICKUP_PINCODE',
  email: 'SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM',
  sms: 'SMS_PROVIDER=msg91, MSG91_AUTH_KEY, MSG91_OTP_TEMPLATE_ID (and OTP_PEPPER)',
  whatsapp: 'WHATSAPP_PROVIDER=meta, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_LANG',
  embeddings: 'EMBEDDING_PROVIDER=gemini, GEMINI_API_KEY (GEMINI_EMBEDDING_MODEL, EMBEDDING_DIMENSIONS)',
  storage: 'STORAGE_DRIVER=s3, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (S3_ENDPOINT for R2/MinIO)',
};

/** Maps the health endpoint's loosely-typed integration values to a display state. */
export function describeIntegrations(i: HealthDto['integrations']): IntegrationState[] {
  const pending = (v: string) => v === 'pending' || v.endsWith('(pending)');
  const row = (key: IntegrationKey, state: IntegrationState['state'], detail: string): IntegrationState => ({ key, label: LABEL[key], state, detail, hint: HINT[key] });
  return [
    row('payments', pending(i.payments) ? 'pending' : i.payments.startsWith('mock') ? 'test' : 'configured', pending(i.payments) ? 'No payment provider: only COD checkout works' : i.payments.startsWith('mock') ? 'Mock provider (test mode; refused in production)' : `Provider: ${i.payments}`),
    row('cod', i.cod ? 'configured' : 'off', i.cod ? 'Offered at checkout' : 'Disabled for all customers'),
    row('shipping', i.shipping === 'manual' ? 'configured' : pending(i.shipping) ? 'pending' : 'configured', i.shipping === 'manual' ? 'Manual: staff enter courier & AWB' : pending(i.shipping) ? 'Shiprocket selected but credentials missing' : 'Shiprocket'),
    row('email', pending(i.email) ? 'pending' : 'configured', pending(i.email) ? 'Emails are logged, not sent' : 'SMTP'),
    row('sms', pending(i.sms) ? 'pending' : 'configured', pending(i.sms) ? 'OTPs are logged to the API console' : 'MSG91'),
    row('whatsapp', pending(i.whatsapp) ? 'pending' : 'configured', pending(i.whatsapp) ? 'Order updates are not sent on WhatsApp' : 'Meta Cloud API'),
    row('embeddings', pending(i.embeddings) ? 'pending' : 'configured', `Model: ${i.embeddings.replace(/\s*\(pending\)$/, '')}`),
    row('storage', 'configured', i.storage === 's3' ? 'S3-compatible bucket' : 'Local disk (single server only)'),
  ];
}

const BADGE: Record<IntegrationState['state'], { label: string; tone: Tone }> = {
  configured: { label: 'Configured', tone: 'success' },
  pending: { label: 'Pending configuration', tone: 'warning' },
  test: { label: 'Test mode', tone: 'info' },
  off: { label: 'Disabled', tone: 'neutral' },
};

async function fetchHealth(url: string): Promise<HealthDto> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'include' });
  if (!res.ok) throw new ApiError('INTERNAL', `Health check failed (${res.status})`, res.status);
  return ((await res.json()) as { data: HealthDto }).data;
}

export function IntegrationsCard() {
  const { data, error, isLoading, isValidating, mutate } = useSWR<HealthDto>('/api/v1/health', fetchHealth);
  const rows = data ? describeIntegrations(data.integrations) : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <div className="flex items-center gap-2">
          {data && <Badge tone={data.status === 'ok' ? 'success' : 'danger'}>API {data.status} · v{data.version}</Badge>}
          <Button variant="ghost" size="sm" loading={isValidating && !isLoading} onClick={() => void mutate()} aria-label="Refresh integration status"><RefreshCw /></Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && !data ? <Alert tone="danger">{errorMessage(error)}</Alert> : isLoading || !data ? <Skeleton className="h-64" /> : (
          <>
            {(!data.db || !data.redis) && <Alert tone="danger" className="mb-3">{!data.db ? 'Database unreachable. ' : ''}{!data.redis ? 'Redis unreachable: background jobs (emails, embeddings, auto-cancel) are not running.' : ''}</Alert>}
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.key} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4" data-integration={r.key}>
                  <div className="flex min-w-0 items-start gap-2.5">
                    {r.state === 'pending' ? <CircleDashed className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{r.label}</p>
                      <p className="text-xs text-muted">{r.detail}</p>
                      {r.state !== 'configured' && <p className="mt-0.5 break-words font-mono text-[11px] text-subtle">{r.hint}</p>}
                    </div>
                  </div>
                  <Badge tone={BADGE[r.state].tone} className="shrink-0 self-start">{BADGE[r.state].label}</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">Set these on the API server (see docs/deployment/environment-variables.md) and restart it. Credentials are never shown here.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
