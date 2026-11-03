'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { loginSchema } from '@vyra/shared';
import { Alert, Button, Field, Input } from '@vyra/ui';
import { ApiError } from '@/lib/api';
import { applyApiErrors } from '@/lib/form-errors';
import { useAuth } from '@/hooks/use-auth';
import { safeNext } from '@/hooks/use-require-auth';
import { AuthCard } from './auth-card';
import { PasswordInput } from './password-input';

export function LoginForm() {
  const { login, user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'), '/account');
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  React.useEffect(() => {
    if (user) router.replace(next);
  }, [user, next, router]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const u = await login(values);
      toast.success(`Welcome back, ${u.name.split(' ')[0]}!`);
      router.replace(next);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setFormError('Incorrect email or password.');
      else if (e instanceof ApiError && e.code === 'RATE_LIMITED')
        setFormError('Too many attempts. Please wait a minute and try again.');
      else setFormError(applyApiErrors(e, setError, ['email', 'password']));
    }
  });

  return (
    <AuthCard
      title="Sign in"
      subtitle="Track orders, save your wishlist and check out faster."
      footer={
        <>
          New to VYRA?{' '}
          <Link
            href={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="font-semibold text-brand-600 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Email" htmlFor="login-email" error={errors.email?.message}>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            {...register('email')}
            invalid={!!errors.email}
            aria-describedby={errors.email ? 'login-email-error' : undefined}
          />
        </Field>
        <Field label="Password" htmlFor="login-password" error={errors.password?.message}>
          <PasswordInput
            id="login-password"
            autoComplete="current-password"
            {...register('password')}
            invalid={!!errors.password}
          />
        </Field>
        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-xs font-semibold text-brand-600 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Button type="submit" size="lg" block loading={isSubmitting}>
          Sign in
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-muted">
        Just want to check an order?{' '}
        <Link href="/track" className="font-semibold text-fg hover:underline">
          Track as a guest
        </Link>
      </p>
    </AuthCard>
  );
}
