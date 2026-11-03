'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import type { SessionUser } from '@vyra/shared';
import { changePasswordSchema, passwordSchema } from '@vyra/shared';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, cn } from '@vyra/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { applyApiErrors } from '@/lib/form-errors';
import { useAuth } from '@/hooks/use-auth';
import { PasswordInput } from '../auth/password-input';
import { PageHeader } from '../ui/page-header';

const phoneRule = z
  .string()
  .trim()
  .refine((v) => v === '' || /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit Indian mobile number');

const profileForm = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(80),
  phone: phoneRule,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => v === '' || z.string().email().safeParse(v).success, 'Enter a valid email address'),
});

function ProfileForm({ user }: { user: SessionUser }) {
  const { setUser } = useAuth();
  const [formError, setFormError] = React.useState<string | null>(null);
  // A verified phone with no email is the account's only login: the API refuses to change it.
  const phoneLocked = user.phoneVerified && !user.email;
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(profileForm),
    defaultValues: { name: user.name, phone: user.phone ?? '', email: user.email ?? '' },
  });
  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    if (user.email && v.email === '') {
      setError('email', { message: 'Email can’t be removed — enter a new one instead' });
      return;
    }
    const body: Record<string, string | null> = { name: v.name };
    if (!phoneLocked && v.phone !== (user.phone ?? '')) body.phone = v.phone === '' ? null : v.phone;
    if (v.email !== '' && v.email !== (user.email ?? '')) body.email = v.email;
    try {
      const u = await api<SessionUser>('/users/me', { method: 'PATCH', body });
      setUser(u);
      reset({ name: u.name, phone: u.phone ?? '', email: u.email ?? '' });
      toast.success(body.email ? 'Profile updated. Please verify your new email.' : 'Profile updated');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT') {
        const field = /email/i.test(e.message) ? 'email' : 'phone';
        setError(field, { message: e.message });
      } else {
        setFormError(applyApiErrors(e, setError, ['name', 'phone', 'email']));
      }
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" htmlFor="pf-name" error={errors.name?.message}>
        <Input id="pf-name" autoComplete="name" {...register('name')} invalid={!!errors.name} />
      </Field>
      <Field
        label="Mobile number"
        htmlFor="pf-phone"
        error={errors.phone?.message}
        hint={
          phoneLocked
            ? 'This number is your login. Add an email to be able to change it.'
            : user.phoneVerified
              ? 'Verified'
              : undefined
        }
      >
        <Input
          id="pf-phone"
          type="tel"
          inputMode="numeric"
          maxLength={10}
          autoComplete="tel-national"
          {...register('phone')}
          disabled={phoneLocked}
          readOnly={phoneLocked}
          invalid={!!errors.phone}
        />
      </Field>
      <Field
        label="Email"
        htmlFor="pf-email"
        error={errors.email?.message}
        hint={
          user.email
            ? 'Changing your email means verifying the new address.'
            : 'Add an email to get order receipts and invoices.'
        }
        className="sm:col-span-2"
      >
        <Input
          id="pf-email"
          type="email"
          autoComplete="email"
          placeholder={user.email ? undefined : 'you@example.com'}
          {...register('email')}
          invalid={!!errors.email}
        />
      </Field>
      {formError && (
        <Alert tone="danger" className="sm:col-span-2">
          {formError}
        </Alert>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

/** Saved immediately (it's a consent toggle, not part of the details form). */
function MarketingPreference({ user }: { user: SessionUser }) {
  const { setUser } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      const u = await api<SessionUser>('/users/me', {
        method: 'PATCH',
        body: { marketingOptIn: !user.marketingOptIn },
      });
      setUser(u);
      toast.success(
        u.marketingOptIn ? 'You’ll get offers & bag reminders on WhatsApp' : 'WhatsApp offers turned off',
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p id="mkt-label" className="text-sm font-semibold">
          WhatsApp offers &amp; bag reminders
        </p>
        <p id="mkt-desc" className="text-xs text-muted">
          Early access to drops, offers and a nudge if you leave something in your bag. Order
          updates are always sent.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={user.marketingOptIn}
        aria-labelledby="mkt-label"
        aria-describedby="mkt-desc"
        disabled={busy}
        onClick={() => void toggle()}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-50',
          user.marketingOptIn ? 'bg-teal-500' : 'bg-border-strong',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'inline-block size-5 rounded-full bg-white shadow transition-transform',
            user.marketingOptIn ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

const pwForm = changePasswordSchema
  .extend({ newPassword: passwordSchema, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, {
    message: 'Passwords don’t match',
    path: ['confirm'],
  });

function ChangePasswordForm() {
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(pwForm),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: v.currentPassword, newPassword: v.newPassword },
      });
      reset();
      toast.success('Password changed');
    } catch (e) {
      setFormError(applyApiErrors(e, setError, ['currentPassword', 'newPassword']));
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field
        label="Current password"
        htmlFor="cp-cur"
        error={errors.currentPassword?.message}
        className="sm:col-span-2"
      >
        <PasswordInput
          id="cp-cur"
          autoComplete="current-password"
          {...register('currentPassword')}
          invalid={!!errors.currentPassword}
        />
      </Field>
      <Field label="New password" htmlFor="cp-new" error={errors.newPassword?.message}>
        <PasswordInput
          id="cp-new"
          autoComplete="new-password"
          {...register('newPassword')}
          invalid={!!errors.newPassword}
        />
      </Field>
      <Field label="Confirm new password" htmlFor="cp-confirm" error={errors.confirm?.message}>
        <PasswordInput
          id="cp-confirm"
          autoComplete="new-password"
          {...register('confirm')}
          invalid={!!errors.confirm}
        />
      </Field>
      {formError && (
        <Alert tone="danger" className="sm:col-span-2">
          {formError}
        </Alert>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" loading={isSubmitting}>
          Change password
        </Button>
      </div>
    </form>
  );
}

export function ProfilePage() {
  const { user } = useAuth();
  const [resending, setResending] = React.useState(false);
  if (!user) return null;
  return (
    <div className="space-y-6">
      <PageHeader title="Profile" subtitle="Manage your personal details and preferences." />
      {user.email && !user.emailVerified && (
        <Alert tone="warning" title="Verify your email">
          We sent a verification link to {user.email}.{' '}
          <button
            type="button"
            className="font-semibold underline disabled:opacity-50"
            disabled={resending}
            onClick={async () => {
              setResending(true);
              try {
                await api('/auth/resend-verification', { method: 'POST' });
                toast.success('Verification email sent');
              } catch (e) {
                toast.error(errorMessage(e));
              } finally {
                setResending(false);
              }
            }}
          >
            Resend link
          </button>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Personal details</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm user={user} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Communication</CardTitle>
        </CardHeader>
        <CardContent>
          <MarketingPreference user={user} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{user.email ? 'Change password' : 'Password'}</CardTitle>
        </CardHeader>
        <CardContent>
          {user.email ? (
            <ChangePasswordForm />
          ) : (
            <p className="text-sm text-muted">
              You sign in with a one-time code sent to your mobile. To also sign in with a
              password, add an email above, then use “Forgot password” on the sign-in page.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
