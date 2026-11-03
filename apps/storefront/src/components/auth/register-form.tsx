'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { registerSchema } from '@vyra/shared';
import { Alert, Button, Field, Input } from '@vyra/ui';
import { ApiError } from '@/lib/api';
import { applyApiErrors } from '@/lib/form-errors';
import { useAuth } from '@/hooks/use-auth';
import { safeNext } from '@/hooks/use-require-auth';
import { AuthCard } from './auth-card';
import { PasswordInput } from './password-input';
import { PhoneLogin } from './phone-login';
import { MethodDivider } from './auth-card';

// Phone is optional: treat an empty input as "not provided".
const formSchema = registerSchema.extend({
  phone: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    registerSchema.shape.phone,
  ),
});

export function RegisterForm() {
  const { register: signUp, user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'), '/account');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [method, setMethod] = React.useState<'phone' | 'email'>('phone');
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', email: '', phone: '', password: '' },
  });

  React.useEffect(() => {
    if (user) router.replace(next);
  }, [user, next, router]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signUp(values);
      toast.success('Welcome to VYRA! Check your inbox to verify your email.');
      router.replace(next);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT')
        setError('email', { message: 'An account with this email already exists.' });
      else setFormError(applyApiErrors(e, setError, ['name', 'email', 'phone', 'password']));
    }
  });

  return (
    <AuthCard
      title="Create your account"
      subtitle="Join VYRA for early access to drops and faster checkout."
      footer={
        <>
          Already have an account?{' '}
          <Link
            href={`/login${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}
            className="font-semibold text-brand-600 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      {method === 'phone' ? (
        <>
          <h2 className="mb-3 text-sm font-bold">Continue with mobile number</h2>
          <PhoneLogin
            idPrefix="reg-otp"
            onSuccess={({ user: u, isNewUser }) => {
              toast.success(
                isNewUser
                  ? `Welcome to VYRA, ${u.name.split(' ')[0]}!`
                  : `Welcome back, ${u.name.split(' ')[0]}! You already had an account.`,
              );
              router.replace(next);
            }}
          />
          <MethodDivider />
          <Button variant="outline" block onClick={() => setMethod('email')}>
            Sign up with email instead
          </Button>
        </>
      ) : (
        <>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <Field label="Full name" htmlFor="reg-name" error={errors.name?.message}>
              <Input id="reg-name" autoComplete="name" {...register('name')} invalid={!!errors.name} />
            </Field>
            <Field label="Email" htmlFor="reg-email" error={errors.email?.message}>
              <Input
                id="reg-email"
                type="email"
                autoComplete="email"
                {...register('email')}
                invalid={!!errors.email}
              />
            </Field>
            <Field label="Mobile number (optional)" htmlFor="reg-phone" error={errors.phone?.message}>
              <Input
                id="reg-phone"
                type="tel"
                inputMode="numeric"
                maxLength={10}
                autoComplete="tel-national"
                {...register('phone')}
                invalid={!!errors.phone}
              />
            </Field>
            <Field
              label="Password"
              htmlFor="reg-password"
              error={errors.password?.message}
              hint="At least 8 characters with a letter and a number"
            >
              <PasswordInput
                id="reg-password"
                autoComplete="new-password"
                {...register('password')}
                invalid={!!errors.password}
              />
            </Field>
            {formError && <Alert tone="danger">{formError}</Alert>}
            <Button type="submit" size="lg" block loading={isSubmitting}>
              Create account
            </Button>
          </form>
          <MethodDivider />
          <Button variant="outline" block onClick={() => setMethod('phone')}>
            Continue with mobile number
          </Button>
        </>
      )}
    </AuthCard>
  );
}
