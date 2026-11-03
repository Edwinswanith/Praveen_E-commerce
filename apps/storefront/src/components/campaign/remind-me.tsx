'use client';

import * as React from 'react';
import Link from 'next/link';
import { BellRing, Check } from 'lucide-react';
import { formatIST, indianMobileSchema, type CampaignPublicDto } from '@vyra/shared';
import { Alert, Button, Field, Input } from '@vyra/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/hooks/use-auth';

interface RemindMeResult {
  subscribed: boolean;
  earlyAccess: boolean;
}

/**
 * Opt-in for one sale. Signed-in customers tap once (it also unlocks early
 * access for their account); guests give a mobile number.
 */
export function RemindMe({
  campaign: c,
  onSubscribed,
}: {
  campaign: CampaignPublicDto;
  onSubscribed?: (r: RemindMeResult) => void;
}) {
  const { user, loading } = useAuth();
  const [phone, setPhone] = React.useState('');
  const [phoneError, setPhoneError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<RemindMeResult | null>(null);
  const early = c.phase === 'EARLY_ACCESS';
  const hasEarlyWindow = !!c.earlyAccessStartsAt && (c.phase === 'TEASER' || early);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    let body: { phone?: string } = {};
    if (!user) {
      const parsed = indianMobileSchema.safeParse(phone);
      if (!parsed.success) {
        setPhoneError(parsed.error.issues[0]?.message ?? 'Enter a valid 10-digit Indian mobile number');
        return;
      }
      body = { phone: parsed.data };
    }
    setBusy(true);
    try {
      const r = await api<RemindMeResult>(`/campaigns/${encodeURIComponent(c.slug)}/remind-me`, {
        method: 'POST',
        body,
      });
      setDone(r);
      onSubscribed?.(r);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.phone?.[0]) setPhoneError(err.fieldErrors.phone[0]);
      else if (err instanceof ApiError && err.code === 'RATE_LIMITED') setError('Too many tries. Please wait a minute and try again.');
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const consent = `We’ll use this only to remind you about ${c.name}. It isn’t a newsletter sign-up.`;

  if (done || (user && c.subscribed)) {
    const gotEarly = done ? done.earlyAccess : c.hasEarlyAccess;
    return (
      <div className="rounded-lg border border-teal-500/40 bg-teal-500/5 p-4 text-sm" role="status" data-testid="remind-me-done">
        <p className="flex items-center gap-2 font-semibold text-teal-700">
          <Check className="size-4" aria-hidden />
          You’re on the list for {c.name}
        </p>
        <p className="mt-1 text-muted">
          {gotEarly && c.earlyAccessStartsAt
            ? early
              ? 'Early access is open for you now: your sale price shows in your bag.'
              : `Early access opens ${formatIST(c.earlyAccessStartsAt)}. Sale prices will show in your bag.`
            : `We’ll remind you when the sale starts on ${formatIST(c.startsAt)}.`}
        </p>
      </div>
    );
  }

  if (loading) return null;

  return (
    <div className="rounded-lg border border-border p-4" data-testid="remind-me">
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <BellRing className="size-4 text-brand-600" aria-hidden />
        {early ? 'Get early access' : 'Remind me when it starts'}
      </h2>
      {user ? (
        <>
          <p className="mt-1 text-sm text-muted">
            {hasEarlyWindow
              ? 'One tap: we’ll remind you, and early access sale prices will apply to your account.'
              : 'One tap and we’ll remind you when the sale starts.'}
          </p>
          <Button size="lg" className="mt-3 w-full sm:w-auto" loading={busy} onClick={() => void submit()}>
            {early ? 'Get early access' : 'Remind me'}
          </Button>
        </>
      ) : (
        <form className="mt-2 space-y-3" onSubmit={(e) => void submit(e)} noValidate>
          {hasEarlyWindow && (
            <p className="text-sm text-muted">
              <Link href={`/login?next=${encodeURIComponent(`/sale/${c.slug}`)}`} className="font-semibold text-brand-600 hover:underline">
                Sign in
              </Link>{' '}
              to get early access on your account, or leave your number for a reminder when the sale starts.
            </p>
          )}
          <Field label="Mobile number" htmlFor="remind-phone" error={phoneError ?? undefined}>
            <Input
              id="remind-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="10-digit mobile"
              value={phone}
              invalid={!!phoneError}
              onChange={(e) => {
                setPhone(e.target.value);
                setPhoneError(null);
              }}
            />
          </Field>
          <Button type="submit" size="lg" className="w-full sm:w-auto" loading={busy}>
            Remind me
          </Button>
        </form>
      )}
      <p className="mt-2 text-xs text-muted">{consent}</p>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
    </div>
  );
}
