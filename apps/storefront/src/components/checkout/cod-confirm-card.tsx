'use client';

import * as React from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { OrderDetailDto, OtpRequestResponse } from '@vyra/shared';
import { Alert, Button, Field } from '@vyra/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { clearCodOtp, rememberCodOtp, type CodOtpHint } from '@/lib/checkout-session';
import { retryAfterSeconds } from '@/lib/otp';
import { useCountdown } from '@/hooks/use-countdown';
import { DevCodeHint, OtpCodeInput, ResendCode } from '../otp/otp-input';

const DEFAULT_RESEND_SECONDS = 30;

function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+91 ${d.slice(0, 2)}******${d.slice(-2)}` : 'your mobile';
}

function initialWait(hint: CodOtpHint | null): number {
  if (!hint) return 0;
  const elapsed = (Date.now() - hint.sentAt) / 1000;
  return Math.max(0, Math.ceil(hint.resendAfterSeconds - elapsed));
}

/**
 * "Confirm your Cash on Delivery order": the OTP sent to the delivery phone
 * at checkout. Works for guests (the code itself authorises the call).
 */
export function CodConfirmCard({
  order,
  hint: initialHint,
  onConfirmed,
  onStale,
}: {
  order: OrderDetailDto;
  hint: CodOtpHint | null;
  onConfirmed: (order: OrderDetailDto) => void;
  /** The server says the order is no longer pending: reload it. */
  onStale?: () => void;
}) {
  const [hint, setHint] = React.useState<CodOtpHint | null>(initialHint);
  const [code, setCode] = React.useState('');
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(
    initialHint && initialHint.expiresInSeconds === 0
      ? 'We couldn’t send your code just now. Tap “Resend code” to get a new one.'
      : null,
  );
  const [confirming, setConfirming] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const { remaining, start } = useCountdown(initialWait(initialHint));
  const inputRef = React.useRef<HTMLInputElement>(null);
  const path = `/orders/${encodeURIComponent(order.number)}`;
  const phoneMasked = hint?.phoneMasked ?? maskPhone(order.shippingAddress.phone);
  const titleId = `cod-confirm-${order.number}`;

  const confirm = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setCodeError('Enter the 6-digit code');
      inputRef.current?.focus();
      return;
    }
    setConfirming(true);
    setCodeError(null);
    setNotice(null);
    try {
      const updated = await api<OrderDetailDto>(`${path}/confirm-cod`, {
        method: 'POST',
        body: { code },
      });
      clearCodOtp(order.number);
      toast.success('Your Cash on Delivery order is confirmed');
      onConfirmed(updated);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setCodeError(e.message || 'Too many attempts. Request a new code.');
      } else if (e instanceof ApiError && (e.status === 400 || e.status === 422)) {
        setCodeError(e.fieldErrors.code?.[0] ?? e.message ?? 'That code is incorrect.');
      } else {
        setNotice(errorMessage(e));
      }
      inputRef.current?.focus();
    } finally {
      setConfirming(false);
    }
  };

  const resend = async () => {
    setResending(true);
    setNotice(null);
    try {
      const res = await api<OtpRequestResponse>(`${path}/resend-cod-otp`, { method: 'POST' });
      const next: CodOtpHint = {
        phoneMasked: res.phoneMasked,
        expiresInSeconds: res.expiresInSeconds,
        devCode: res.devCode,
        sentAt: Date.now(),
        resendAfterSeconds: res.resendAfterSeconds,
      };
      setHint(next);
      rememberCodOtp(order.number, next);
      start(res.resendAfterSeconds);
      setCode('');
      setCodeError(null);
      toast.success(`New code sent to ${res.phoneMasked}`);
      inputRef.current?.focus();
    } catch (e) {
      const wait = retryAfterSeconds(e);
      if (wait !== null) {
        start(wait);
        setNotice(`Please wait ${wait}s before requesting another code.`);
      } else if (e instanceof ApiError && e.status === 400 && /already confirmed/i.test(e.message)) {
        // Confirmed elsewhere (e.g. by our team on a call).
        clearCodOtp(order.number);
        setNotice('This order is already confirmed.');
        onStale?.();
      } else {
        setNotice(errorMessage(e));
      }
    } finally {
      setResending(false);
    }
  };

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-lg border-2 border-brand-500 bg-brand-50/40 p-4 sm:p-5"
      data-testid="cod-confirm-card"
    >
      <h2 id={titleId} className="flex items-center gap-2 font-display text-lg font-extrabold">
        <ShieldCheck className="size-5 text-brand-600" aria-hidden />
        Confirm your Cash on Delivery order
      </h2>
      <p className="mt-1 text-sm">
        We sent a 6-digit code to <strong className="whitespace-nowrap">{phoneMasked}</strong>.
        Enter it so we can pack your order.
      </p>
      <p className="mt-1 text-xs text-muted">
        Unconfirmed Cash on Delivery orders are cancelled automatically after 24 hours.
      </p>
      <form onSubmit={(e) => void confirm(e)} noValidate className="mt-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Confirmation code" htmlFor={`${titleId}-code`} error={codeError ?? undefined}>
            <OtpCodeInput
              ref={inputRef}
              id={`${titleId}-code`}
              value={code}
              onChange={(v) => {
                setCode(v);
                setCodeError(null);
              }}
              invalid={!!codeError}
              aria-describedby={codeError ? `${titleId}-code-error` : undefined}
              disabled={confirming}
            />
          </Field>
          <Button type="submit" size="lg" loading={confirming} className={codeError ? 'sm:mb-5' : ''}>
            Confirm order
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DevCodeHint code={hint?.devCode} />
          <span className="ml-auto">
            <ResendCode remaining={remaining} busy={resending} onResend={() => void resend()} />
          </span>
        </div>
        {notice && <Alert tone="warning">{notice}</Alert>}
      </form>
    </section>
  );
}
