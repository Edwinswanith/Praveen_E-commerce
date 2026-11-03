'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { useRouter, useSearchParams } from 'next/navigation';
import { loginSchema, STAFF_ROLES, type SessionUser } from '@vyra/shared';
import { Alert, Button, Field, Input, VyraLogo } from '@vyra/ui';
import { ApiError, request } from '@/lib/api';
import { applyApiErrors, parseOrSetErrors } from '@/lib/forms';

interface Values { email: string; password: string }

function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/login')) return '/';
  return next;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Values>({ defaultValues: { email: '', password: '' } });
  const [formError, setFormError] = React.useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const parsed = parseOrSetErrors(loginSchema, values, setError);
    if (!parsed) return;
    try {
      const { data } = await request<SessionUser>('/auth/login', { method: 'POST', body: parsed, noRedirect: true });
      if (!STAFF_ROLES.includes(data.role)) {
        setFormError('This account does not have staff access.');
        return;
      }
      router.replace(safeNext(params.get('next')));
    } catch (err) {
      if (applyApiErrors(err, setError, ['email', 'password'])) return;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) setFormError('Incorrect email or password, or this account is not a staff account.');
      else if (err instanceof ApiError && err.status === 429) setFormError('Too many attempts. Please wait a minute and try again.');
      else setFormError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  });

  return (
    <div className="grid min-h-dvh bg-surface lg:grid-cols-[1fr_minmax(0,560px)]">
      <div className="relative hidden overflow-hidden bg-fg lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_20%_20%,rgb(255_63_108/0.35),transparent),radial-gradient(50%_40%_at_80%_80%,rgb(124_58_237/0.35),transparent)]" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <VyraLogo className="text-3xl" mono />
          <div className="max-w-md">
            <p className="font-display text-3xl font-bold leading-tight">Run the studio, the stockroom and the shop floor from one place.</p>
            <p className="mt-4 text-sm text-white/70">Catalog, inventory, barcode scanning, orders and analytics for the VYRA team.</p>
          </div>
          <p className="text-xs text-white/50">Authorised staff only. Activity is audited.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-5 py-12">
        <form onSubmit={onSubmit} noValidate className="w-full max-w-sm space-y-5">
          <div className="space-y-1">
            <VyraLogo className="mb-6 text-2xl lg:hidden" />
            <h1 className="text-xl font-bold">Sign in to VYRA Admin</h1>
            <p className="text-sm text-muted">Use your staff account credentials.</p>
          </div>
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Field label="Email" htmlFor="email" error={errors.email?.message}>
            <Input id="email" type="email" autoComplete="username" autoFocus invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined} {...register('email')} />
          </Field>
          <Field label="Password" htmlFor="password" error={errors.password?.message}>
            <Input id="password" type="password" autoComplete="current-password" invalid={!!errors.password} aria-describedby={errors.password ? 'password-error' : undefined} {...register('password')} />
          </Field>
          <Button type="submit" block loading={isSubmitting}>Sign in</Button>
        </form>
      </div>
    </div>
  );
}
