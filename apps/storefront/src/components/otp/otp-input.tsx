'use client';

import * as React from 'react';
import { Button, Input, cn } from '@vyra/ui';
import { formatCountdown } from '@/lib/otp';

type OtpCodeInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
> & {
  value: string;
  onChange: (code: string) => void;
  invalid?: boolean;
  length?: number;
};

/**
 * A single 6-digit code field. One input (not six boxes) so SMS autofill
 * (`autocomplete="one-time-code"`), paste and screen readers all just work.
 */
export const OtpCodeInput = React.forwardRef<HTMLInputElement, OtpCodeInputProps>(
  ({ value, onChange, invalid, length = 6, className, ...props }, ref) => (
    <Input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern={`\\d{${length}}`}
      maxLength={length}
      spellCheck={false}
      value={value}
      invalid={invalid}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
      className={cn('h-12 text-center font-mono text-xl tracking-[0.5em]', className)}
      {...props}
    />
  ),
);
OtpCodeInput.displayName = 'OtpCodeInput';

/** "Resend code" that stays disabled while the server's resend window is open. */
export function ResendCode({
  remaining,
  onResend,
  busy,
  label = 'Resend code',
}: {
  remaining: number;
  onResend: () => void;
  busy?: boolean;
  label?: string;
}) {
  const waiting = remaining > 0;
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      onClick={onResend}
      disabled={waiting || busy}
      loading={busy}
      aria-live="polite"
    >
      {waiting ? `Resend in ${formatCountdown(remaining)}` : label}
    </Button>
  );
}

/**
 * Shown only when the API echoed the code back (development without an SMS
 * provider). Never auto-fills the field.
 */
export function DevCodeHint({ code }: { code?: string | null }) {
  if (!code) return null;
  return (
    <p
      className="rounded-sm border border-dashed border-warning bg-amber-50 px-2 py-1 font-mono text-[11px] text-amber-800"
      data-testid="dev-code-hint"
    >
      DEV MODE: code is {code}
    </p>
  );
}
