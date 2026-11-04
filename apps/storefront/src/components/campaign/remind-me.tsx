'use client';

import * as React from 'react';
import Link from 'next/link';
import { BellRing, Check } from 'lucide-react';
import {
  formatIST,
  indianMobileSchema,
  type CampaignPublicDto,
  type OtpRequestResponse,
  type RemindMeResponse,
} from '@vyra/shared';
import { Alert, Button, Field, Input } from '@vyra/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { retryAfterSeconds } from '@/lib/otp';
import { useAuth } from '@/hooks/use-auth';
import { useCountdown } from '@/hooks/use-countdown';
import { DevCodeHint, OtpCodeInput, ResendCode } from '../otp/otp-input';

type Channel = RemindMeResponse['channels'][number];

/** Says honestly where reminders will go, from the channels the API will actually use. */
export function channelsMessage(channels: Channel[]): string {
  const wa = channels.includes('whatsapp');
  const email = channels.includes('email');
  if (wa && email) return 'We’ll remind you on WhatsApp and email.';
  if (wa) return 'We’ll remind you on WhatsApp.';
  if (email)
    return 'We’ll remind you by email. Verify a mobile number on your account to get WhatsApp reminders too.';
  return 'We don’t have a verified mobile number or email for your account yet, so we can’t send reminders.';
}

const CONSENT = 'Reminders are only for this sale and you can stop them anytime.';

/**
 * Opt-in for one sale. Signed-in customers tap once (reminders go to the
 * account's verified phone and email; it also unlocks early access). Guests
 * prove they own the number with a 6-digit code before we store it.
 */
export function RemindMe({
  campaign: c,
  onChange,
}: {
  campaign: CampaignPublicDto;
  /** Called after subscribing or stopping reminders (refresh the campaign). */
  onChange?: (r: { subscribed: boolean }) => void;
}) {
  const { user, loading } = useAuth();
  const [phone, setPhone] = React.useState('');
  const [phoneError, setPhoneError] = React.useState<string | null>(null);
  const [sentTo, setSentTo] = React.useState<{ phone: string; otp: OtpRequestResponse } | null>(null);
  const [code, setCode] = React.useState('');
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [done, setDone] = React.useState<RemindMeResponse | null>(null);
  const [stopped, setStopped] = React.useState(false);
  const { remaining, start } = useCountdown();
  const codeRef = React.useRef<HTMLInputElement>(null);
  const path = `/campaigns/${encodeURIComponent(c.slug)}/remind-me`;
  const early = c.phase === 'EARLY_ACCESS';
  const hasEarlyWindow = !!c.earlyAccessStartsAt && (c.phase === 'TEASER' || early);

  const rateLimited = (e: unknown, fallback: string) =>
    e instanceof ApiError && e.status === 429 ? e.message || fallback : null;

  const finish = (r: RemindMeResponse) => {
    setDone(r);
    setStopped(false);
    setSentTo(null);
    setCode('');
    onChange?.({ subscribed: true });
  };

  /** Signed in: one tap. Guest: step 1, send a code to the number. */
  const requestCode = async (e?: React.FormEvent) => {
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
      const r = await api<RemindMeResponse>(path, { method: 'POST', body });
      if (r.subscribed) finish(r);
      else if (r.otp && body.phone) {
        setSentTo({ phone: body.phone, otp: r.otp });
        setCode('');
        setCodeError(null);
        start(r.otp.resendAfterSeconds);
        requestAnimationFrame(() => codeRef.current?.focus());
      } else setError('Something went wrong. Please try again.');
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.phone?.[0]) setPhoneError(err.fieldErrors.phone[0]);
      else setError(rateLimited(err, 'Too many tries. Please wait a minute and try again.') ?? errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /** Guest step 2: the code proves the number is theirs. */
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sentTo) return;
    if (!/^\d{6}$/.test(code)) {
      setCodeError('Enter the 6-digit code');
      codeRef.current?.focus();
      return;
    }
    setBusy(true);
    setCodeError(null);
    setError(null);
    try {
      finish(await api<RemindMeResponse>(path, { method: 'POST', body: { phone: sentTo.phone, code } }));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 422 || err.status === 429)) {
        setCodeError(err.fieldErrors.code?.[0] ?? (err.message || 'That code is incorrect.'));
      } else setError(errorMessage(err));
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!sentTo) return;
    setResending(true);
    setError(null);
    try {
      const r = await api<RemindMeResponse>(path, { method: 'POST', body: { phone: sentTo.phone } });
      if (r.otp) {
        setSentTo({ phone: sentTo.phone, otp: r.otp });
        start(r.otp.resendAfterSeconds);
        setCode('');
        setCodeError(null);
        codeRef.current?.focus();
      }
    } catch (err) {
      const wait = retryAfterSeconds(err);
      if (wait !== null) start(wait);
      setError(rateLimited(err, 'Please wait before requesting another code.') ?? errorMessage(err));
    } finally {
      setResending(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      await api<{ subscribed: false; removed: number }>(path, { method: 'DELETE' });
      setDone(null);
      setStopped(true);
      onChange?.({ subscribed: false });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const errorAlert = error && (
    <Alert tone="danger" className="mt-3">
      {error}
    </Alert>
  );

  const subscribed = !!done?.subscribed || (!!user && c.subscribed && !stopped);
  if (subscribed) {
    const gotEarly = done ? done.earlyAccess : c.hasEarlyAccess;
    return (
      <div className="rounded-lg border border-teal-500/40 bg-teal-500/5 p-4 text-sm" data-testid="remind-me-done">
        <div role="status">
          <p className="flex items-center gap-2 font-semibold text-teal-700">
            <Check className="size-4 shrink-0" aria-hidden />
            You’re on the list for {c.name}
          </p>
          <p className="mt-1 text-muted">
            {gotEarly && c.earlyAccessStartsAt
              ? early
                ? 'Early access is open for you now: your sale price shows in your bag.'
                : `Early access opens ${formatIST(c.earlyAccessStartsAt)}. Sale prices will show in your bag.`
              : `We’ll remind you when the sale starts on ${formatIST(c.startsAt)}.`}
          </p>
          {done && (
            <p className="mt-1" data-testid="remind-me-channels">
              {channelsMessage(done.channels)}
            </p>
          )}
        </div>
        {user ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-xs text-muted">{CONSENT}</p>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="min-h-11 px-0"
              loading={busy}
              onClick={() => void stop()}
            >
              Stop reminders
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted">Reminders are only for this sale.</p>
        )}
        {errorAlert}
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
      {stopped && (
        <p className="mt-1 text-sm" role="status" data-testid="remind-me-stopped">
          Reminders stopped. We won’t message you about this sale.
        </p>
      )}
      {user ? (
        <>
          <p className="mt-1 text-sm text-muted">
            {hasEarlyWindow
              ? 'One tap: we’ll remind you, and early access sale prices will apply to your account.'
              : 'One tap and we’ll remind you when the sale starts.'}
          </p>
          <Button size="lg" className="mt-3 w-full sm:w-auto" loading={busy} onClick={() => void requestCode()}>
            {early ? 'Get early access' : 'Remind me'}
          </Button>
        </>
      ) : sentTo ? (
        <form className="mt-2 space-y-3" onSubmit={(e) => void verify(e)} noValidate>
          <p className="text-sm">
            We sent a code to <strong className="whitespace-nowrap">{sentTo.otp.phoneMasked}</strong>. Enter it
            to confirm the number is yours.
          </p>
          <Field label="6-digit code" htmlFor="remind-code" error={codeError ?? undefined}>
            <OtpCodeInput
              ref={codeRef}
              id="remind-code"
              value={code}
              onChange={(v) => {
                setCode(v);
                setCodeError(null);
              }}
              invalid={!!codeError}
              disabled={busy}
            />
          </Field>
          <Button type="submit" size="lg" className="w-full sm:w-auto" loading={busy}>
            Confirm
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <DevCodeHint code={sentTo.otp.devCode} />
            <span className="ml-auto flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="link"
                size="sm"
                className="min-h-11"
                onClick={() => {
                  setSentTo(null);
                  setCode('');
                  setCodeError(null);
                  setError(null);
                }}
              >
                Change number
              </Button>
              <span className="[&_button]:min-h-11">
                <ResendCode remaining={remaining} busy={resending} onResend={() => void resend()} />
              </span>
            </span>
          </div>
        </form>
      ) : (
        <form className="mt-2 space-y-3" onSubmit={(e) => void requestCode(e)} noValidate>
          {hasEarlyWindow && (
            <p className="text-sm text-muted">
              <Link
                href={`/login?next=${encodeURIComponent(`/sale/${c.slug}`)}`}
                className="font-semibold text-brand-600 hover:underline"
              >
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
            Send code
          </Button>
          <p className="text-xs text-muted">We’ll send a 6-digit code to confirm the number is yours.</p>
        </form>
      )}
      <p className="mt-2 text-xs text-muted">{CONSENT}</p>
      {errorAlert}
    </div>
  );
}
