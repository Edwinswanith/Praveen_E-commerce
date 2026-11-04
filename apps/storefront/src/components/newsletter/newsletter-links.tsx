'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, MailX, XCircle } from 'lucide-react';
import { Button, Spinner } from '@vyra/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { AuthCard } from '../auth/auth-card';

const INVALID = 'This link is invalid or has expired';

/** A malformed token comes back as VALIDATION_FAILED ("token: …"); show the field message alone. */
const linkError = (e: unknown) =>
  (e instanceof ApiError && e.fieldErrors.token?.[0]) || errorMessage(e, INVALID);

function Outcome({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm" role={ok ? 'status' : 'alert'}>
      {ok ? (
        <CheckCircle2 className="size-6 shrink-0 text-teal-500" aria-hidden />
      ) : (
        <XCircle className="size-6 shrink-0 text-danger" aria-hidden />
      )}
      <p>{children}</p>
    </div>
  );
}

function ShopLink() {
  return (
    <Button asChild block size="lg" variant="outline" className="mt-6">
      <Link href="/">Continue shopping</Link>
    </Button>
  );
}

/**
 * /newsletter/confirm?token=…: the double opt-in click. Confirming on load is
 * fine (it only completes a sign-up the person started).
 */
export function NewsletterConfirm() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = React.useState<{ status: 'loading' | 'ok' | 'error'; message?: string }>(
    { status: 'loading' },
  );
  const ran = React.useRef(false);
  React.useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setState({ status: 'error', message: INVALID });
      return;
    }
    api<{ status: string }>('/newsletter/confirm', { method: 'POST', body: { token } })
      .then(() => setState({ status: 'ok' }))
      .catch((e: unknown) => setState({ status: 'error', message: linkError(e) }));
  }, [token]);
  return (
    <AuthCard title="Newsletter subscription">
      {state.status === 'loading' && (
        <div className="flex items-center gap-3 text-sm" role="status">
          <Spinner /> Confirming your subscription…
        </div>
      )}
      {state.status === 'ok' && (
        <Outcome ok>
          You’re subscribed. We’ll email you about new drops and offers. Every email has an
          unsubscribe link.
        </Outcome>
      )}
      {state.status === 'error' && <Outcome ok={false}>{state.message}</Outcome>}
      {state.status !== 'loading' && <ShopLink />}
    </AuthCard>
  );
}

/**
 * /newsletter/unsubscribe?token=…: needs a click. Email scanners and link
 * previews follow GET links, so loading this page must never unsubscribe anyone.
 */
export function NewsletterUnsubscribe() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = React.useState<{
    status: 'idle' | 'loading' | 'ok' | 'error';
    message?: string;
  }>({ status: 'idle' });
  const unsubscribe = async () => {
    if (!token) {
      setState({ status: 'error', message: INVALID });
      return;
    }
    setState({ status: 'loading' });
    try {
      await api<{ status: string }>('/newsletter/unsubscribe', { method: 'POST', body: { token } });
      setState({ status: 'ok' });
    } catch (e) {
      setState({ status: 'error', message: linkError(e) });
    }
  };
  return (
    <AuthCard title="Unsubscribe from emails">
      {state.status === 'ok' ? (
        <>
          <Outcome ok>You’re unsubscribed. We won’t send you newsletter emails any more.</Outcome>
          <ShopLink />
        </>
      ) : (
        <>
          <div className="flex gap-3 text-sm">
            <MailX className="size-6 shrink-0 text-muted" aria-hidden />
            <p>Stop receiving the VYRA newsletter at this address? Order and account emails still reach you.</p>
          </div>
          <Button
            block
            size="lg"
            className="mt-6"
            loading={state.status === 'loading'}
            onClick={() => void unsubscribe()}
          >
            Unsubscribe
          </Button>
          {state.status === 'error' && (
            <div className="mt-4">
              <Outcome ok={false}>{state.message}</Outcome>
            </div>
          )}
        </>
      )}
    </AuthCard>
  );
}
