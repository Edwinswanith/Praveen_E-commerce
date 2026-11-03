'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import type { SessionUser } from '@vyra/shared';
import { changePasswordSchema, passwordSchema } from '@vyra/shared';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@vyra/ui';
import { api, errorMessage } from '@/lib/api';
import { applyApiErrors } from '@/lib/form-errors';
import { useAuth } from '@/hooks/use-auth';
import { PasswordInput } from '../auth/password-input';
import { PageHeader } from '../ui/page-header';

const profileForm = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(80),
  phone: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^[6-9]\d{9}$/.test(v),
      'Enter a valid 10-digit Indian mobile number',
    ),
});

function ProfileForm({ user }: { user: SessionUser }) {
  const { setUser } = useAuth();
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(profileForm),
    defaultValues: { name: user.name, phone: user.phone ?? '' },
  });
  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const u = await api<SessionUser>('/users/me', {
        method: 'PATCH',
        body: { name: v.name, phone: v.phone === '' ? null : v.phone },
      });
      setUser(u);
      reset({ name: u.name, phone: u.phone ?? '' });
      toast.success('Profile updated');
    } catch (e) {
      setFormError(applyApiErrors(e, setError, ['name', 'phone']));
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" htmlFor="pf-name" error={errors.name?.message}>
        <Input id="pf-name" autoComplete="name" {...register('name')} invalid={!!errors.name} />
      </Field>
      <Field label="Mobile number" htmlFor="pf-phone" error={errors.phone?.message}>
        <Input
          id="pf-phone"
          type="tel"
          inputMode="numeric"
          maxLength={10}
          {...register('phone')}
          invalid={!!errors.phone}
        />
      </Field>
      <Field
        label="Email"
        htmlFor="pf-email"
        hint="Email can’t be changed"
        className="sm:col-span-2"
      >
        <Input id="pf-email" value={user.email} disabled readOnly />
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
      <PageHeader title="Profile" subtitle="Manage your personal details and password." />
      {!user.emailVerified && (
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
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
