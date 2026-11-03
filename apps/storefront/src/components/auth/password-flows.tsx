'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, MailCheck, XCircle } from 'lucide-react';
import { forgotPasswordSchema, passwordSchema } from '@vyra/shared';
import { Alert, Button, Field, Input, Spinner } from '@vyra/ui';
import { api, errorMessage } from '@/lib/api';
import { applyApiErrors } from '@/lib/form-errors';
import { useAuth } from '@/hooks/use-auth';
import { AuthCard } from './auth-card';
import { PasswordInput } from './password-input';

export function ForgotPasswordForm() {
  const [sent, setSent] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: values });
      setSent(values.email);
    } catch (e) {
      setFormError(applyApiErrors(e, setError, ['email']));
    }
  });
  if (sent) {
    return (
      <AuthCard
        title="Check your inbox"
        footer={
          <Link href="/login" className="font-semibold text-brand-600 hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="flex gap-3 text-sm">
          <MailCheck className="size-6 shrink-0 text-teal-500" aria-hidden />
          <p>
            If an account exists for <strong>{sent}</strong>, we’ve sent a link to reset your
            password. It expires shortly, so use it soon.
          </p>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Forgot password?"
      subtitle="Enter your email and we’ll send you a reset link."
      footer={
        <Link href="/login" className="font-semibold text-brand-600 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Email" htmlFor="fp-email" error={errors.email?.message}>
          <Input
            id="fp-email"
            type="email"
            autoComplete="email"
            {...register('email')}
            invalid={!!errors.email}
          />
        </Field>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Button type="submit" size="lg" block loading={isSubmitting}>
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
}

const resetForm = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'Passwords don’t match', path: ['confirm'] });

export function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(resetForm), defaultValues: { password: '', confirm: '' } });
  if (!token || token.length < 20) {
    return (
      <AuthCard
        title="Invalid reset link"
        footer={
          <Link href="/forgot-password" className="font-semibold text-brand-600 hover:underline">
            Request a new link
          </Link>
        }
      >
        <Alert tone="danger">This password reset link is missing or malformed.</Alert>
      </AuthCard>
    );
  }
  if (done) {
    return (
      <AuthCard title="Password updated">
        <div className="flex gap-3 text-sm">
          <CheckCircle2 className="size-6 shrink-0 text-teal-500" aria-hidden />
          <p>Your password has been reset. You can now sign in with your new password.</p>
        </div>
        <Button asChild block size="lg" className="mt-6">
          <Link href="/login">Sign in</Link>
        </Button>
      </AuthCard>
    );
  }
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: { token, password: values.password },
      });
      setDone(true);
    } catch (e) {
      setFormError(
        applyApiErrors(e, setError, ['password']) ?? 'This link has expired. Request a new one.',
      );
    }
  });
  return (
    <AuthCard title="Set a new password">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field
          label="New password"
          htmlFor="rp-pass"
          error={errors.password?.message}
          hint="At least 8 characters with a letter and a number"
        >
          <PasswordInput
            id="rp-pass"
            autoComplete="new-password"
            {...register('password')}
            invalid={!!errors.password}
          />
        </Field>
        <Field label="Confirm password" htmlFor="rp-confirm" error={errors.confirm?.message}>
          <PasswordInput
            id="rp-confirm"
            autoComplete="new-password"
            {...register('confirm')}
            invalid={!!errors.confirm}
          />
        </Field>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Button type="submit" size="lg" block loading={isSubmitting}>
          Update password
        </Button>
      </form>
    </AuthCard>
  );
}

export function VerifyEmail() {
  const token = useSearchParams().get('token') ?? '';
  const { user, refresh } = useAuth();
  const [state, setState] = React.useState<{
    status: 'loading' | 'ok' | 'error';
    message?: string;
  }>({ status: 'loading' });
  const [resent, setResent] = React.useState(false);
  const ran = React.useRef(false);
  React.useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (token.length < 20) {
      setState({ status: 'error', message: 'This verification link is missing or malformed.' });
      return;
    }
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(() => {
        setState({ status: 'ok' });
        void refresh();
      })
      .catch((e: unknown) =>
        setState({
          status: 'error',
          message: errorMessage(e, 'This link is invalid or has expired.'),
        }),
      );
  }, [token, refresh]);
  return (
    <AuthCard title="Email verification">
      {state.status === 'loading' && (
        <div className="flex items-center gap-3 text-sm">
          <Spinner /> Verifying your email…
        </div>
      )}
      {state.status === 'ok' && (
        <>
          <div className="flex gap-3 text-sm">
            <CheckCircle2 className="size-6 shrink-0 text-teal-500" aria-hidden />
            <p>Your email is verified. You’re all set!</p>
          </div>
          <Button asChild block size="lg" className="mt-6">
            <Link href={user ? '/account' : '/login'}>{user ? 'Go to my account' : 'Sign in'}</Link>
          </Button>
        </>
      )}
      {state.status === 'error' && (
        <>
          <div className="flex gap-3 text-sm">
            <XCircle className="size-6 shrink-0 text-danger" aria-hidden />
            <p>{state.message}</p>
          </div>
          {user && !user.emailVerified && (
            <Button
              className="mt-6"
              variant="outline"
              block
              disabled={resent}
              onClick={async () => {
                try {
                  await api('/auth/resend-verification', { method: 'POST' });
                  setResent(true);
                } catch (e) {
                  setState({ status: 'error', message: errorMessage(e) });
                }
              }}
            >
              {resent ? 'Verification email sent' : 'Resend verification email'}
            </Button>
          )}
        </>
      )}
    </AuthCard>
  );
}
