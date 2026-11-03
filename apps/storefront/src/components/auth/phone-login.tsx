'use client';

import * as React from 'react';
import { Smartphone } from 'lucide-react';
import type { OtpRequestResponse, OtpVerifyResponse } from '@vyra/shared';
import { Alert, Button, Field, Input } from '@vyra/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { needsName as isNeedsName, normalizeIndianMobile, retryAfterSeconds } from '@/lib/otp';
import { useAuth } from '@/hooks/use-auth';
import { useCountdown } from '@/hooks/use-countdown';
import { DevCodeHint, OtpCodeInput, ResendCode } from '../otp/otp-input';

interface Sent {
  phone: string;
  phoneMasked: string;
  devCode?: string;
}

function maskLocal(phone: string): string {
  return `+91 ${phone.slice(0, 2)}******${phone.slice(-2)}`;
}

/**
 * Phone-first sign in / sign up: number → OTP → (new accounts only) name.
 * The same code is resubmitted with the name: the API does not consume it on
 * the needs-name 422.
 */
export function PhoneLogin({
  onSuccess,
  idPrefix = 'otp',
}: {
  onSuccess: (res: OtpVerifyResponse) => void;
  idPrefix?: string;
}) {
  const { verifyOtp } = useAuth();
  const [phoneInput, setPhoneInput] = React.useState('');
  const [phoneError, setPhoneError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<Sent | null>(null);
  const [code, setCode] = React.useState('');
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [askName, setAskName] = React.useState(false);
  const [name, setName] = React.useState('');
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [optIn, setOptIn] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [requesting, setRequesting] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const { remaining, start } = useCountdown();
  const codeRef = React.useRef<HTMLInputElement>(null);
  const nameRef = React.useRef<HTMLInputElement>(null);

  const ids = {
    phone: `${idPrefix}-phone`,
    code: `${idPrefix}-code`,
    name: `${idPrefix}-name`,
    optIn: `${idPrefix}-optin`,
  };

  const requestCode = async (phone: string) => {
    setRequesting(true);
    setFormError(null);
    try {
      const res = await api<OtpRequestResponse>('/auth/otp/request', {
        method: 'POST',
        body: { phone },
      });
      setSent({ phone, phoneMasked: res.phoneMasked, devCode: res.devCode });
      start(res.resendAfterSeconds);
      setCode('');
      setCodeError(null);
      requestAnimationFrame(() => codeRef.current?.focus());
    } catch (e) {
      const wait = retryAfterSeconds(e);
      if (wait !== null) {
        // A code was sent moments ago: let them enter it, resend once the window closes.
        start(wait);
        setSent((s) => (s && s.phone === phone ? s : { phone, phoneMasked: maskLocal(phone) }));
        setFormError(`A code was sent recently. You can request a new one in ${wait}s.`);
        requestAnimationFrame(() => codeRef.current?.focus());
      } else if (e instanceof ApiError && e.status === 429) {
        setFormError(e.message || 'Too many codes requested. Please try again later.');
      } else if (!sent) {
        setPhoneError(
          e instanceof ApiError && e.fieldErrors.phone?.[0]
            ? e.fieldErrors.phone[0]
            : errorMessage(e),
        );
      } else {
        setFormError(errorMessage(e));
      }
    } finally {
      setRequesting(false);
    }
  };

  const onPhoneSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const phone = normalizeIndianMobile(phoneInput);
    if (!phone) {
      setPhoneError('Enter a valid 10-digit Indian mobile number');
      return;
    }
    setPhoneError(null);
    void requestCode(phone);
  };

  const onCodeSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!sent) return;
    if (!/^\d{6}$/.test(code)) {
      setCodeError('Enter the 6-digit code');
      codeRef.current?.focus();
      return;
    }
    const trimmedName = name.trim();
    if (askName && trimmedName.length < 2) {
      setNameError('Tell us your name (at least 2 characters)');
      nameRef.current?.focus();
      return;
    }
    setVerifying(true);
    setCodeError(null);
    setNameError(null);
    setFormError(null);
    try {
      const res = await verifyOtp({
        phone: sent.phone,
        code,
        ...(askName ? { name: trimmedName, marketingOptIn: optIn } : {}),
      });
      onSuccess(res);
    } catch (e) {
      if (isNeedsName(e)) {
        setAskName(true);
        requestAnimationFrame(() => nameRef.current?.focus());
      } else if (e instanceof ApiError && e.fieldErrors.name?.[0] && askName) {
        setNameError(e.fieldErrors.name[0]);
      } else if (e instanceof ApiError && e.fieldErrors.code?.[0]) {
        setCodeError(e.fieldErrors.code[0]);
      } else if (e instanceof ApiError && (e.status === 400 || e.status === 401)) {
        setCodeError(e.message || 'That code is incorrect. Please try again.');
        codeRef.current?.focus();
      } else {
        setFormError(errorMessage(e));
      }
    } finally {
      setVerifying(false);
    }
  };

  if (!sent) {
    return (
      <form onSubmit={onPhoneSubmit} noValidate className="space-y-4">
        <Field
          label="Mobile number"
          htmlFor={ids.phone}
          error={phoneError ?? undefined}
          hint="We’ll text you a 6-digit code. No password needed."
        >
          <div className="flex">
            <span className="inline-flex h-10 items-center rounded-l-md border border-r-0 border-border-strong bg-surface px-3 text-sm text-muted">
              +91
            </span>
            <Input
              id={ids.phone}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="98765 43210"
              maxLength={14}
              value={phoneInput}
              onChange={(e) => {
                setPhoneInput(e.target.value);
                setPhoneError(null);
              }}
              invalid={!!phoneError}
              aria-describedby={phoneError ? `${ids.phone}-error` : undefined}
              className="rounded-l-none"
            />
          </div>
        </Field>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Button type="submit" size="lg" block loading={requesting}>
          <Smartphone aria-hidden /> Get OTP
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={onCodeSubmit} noValidate className="space-y-4">
      <div className="flex items-start justify-between gap-2 text-sm">
        <p>
          Enter the code sent to <strong className="whitespace-nowrap">{sent.phoneMasked}</strong>
        </p>
        <button
          type="button"
          className="shrink-0 text-xs font-semibold text-brand-600 hover:underline"
          onClick={() => {
            setSent(null);
            setAskName(false);
            setCode('');
            setFormError(null);
            setCodeError(null);
          }}
        >
          Change number
        </button>
      </div>
      <Field label="6-digit code" htmlFor={ids.code} error={codeError ?? undefined}>
        <OtpCodeInput
          ref={codeRef}
          id={ids.code}
          value={code}
          onChange={(v) => {
            setCode(v);
            setCodeError(null);
          }}
          invalid={!!codeError}
          aria-describedby={codeError ? `${ids.code}-error` : undefined}
          disabled={verifying}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DevCodeHint code={sent.devCode} />
        <span className="ml-auto">
          <ResendCode
            remaining={remaining}
            busy={requesting}
            onResend={() => void requestCode(sent.phone)}
          />
        </span>
      </div>
      {askName && (
        <div className="space-y-3 rounded-md border border-border bg-surface p-3">
          <p className="text-sm font-semibold">Welcome to VYRA! Just one more thing.</p>
          <Field label="Your name" htmlFor={ids.name} error={nameError ?? undefined}>
            <Input
              ref={nameRef}
              id={ids.name}
              autoComplete="name"
              value={name}
              maxLength={80}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
              invalid={!!nameError}
              aria-describedby={nameError ? `${ids.name}-error` : undefined}
            />
          </Field>
          <label htmlFor={ids.optIn} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              id={ids.optIn}
              type="checkbox"
              checked={optIn}
              onChange={(e) => setOptIn(e.target.checked)}
              className="mt-0.5 size-4 accent-brand-500"
            />
            <span>Send me offers and bag reminders on WhatsApp</span>
          </label>
        </div>
      )}
      {formError && <Alert tone="warning">{formError}</Alert>}
      <Button type="submit" size="lg" block loading={verifying}>
        {askName ? 'Create account' : 'Verify & continue'}
      </Button>
    </form>
  );
}
