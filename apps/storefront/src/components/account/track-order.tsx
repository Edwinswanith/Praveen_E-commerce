'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Truck } from 'lucide-react';
import type { OrderDetailDto } from '@vyra/shared';
import { Alert, Button, Field, Input } from '@vyra/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { normalizeIndianMobile } from '@/lib/otp';
import { OrderView } from './order-detail';

const schema = z.object({
  number: z
    .string()
    .trim()
    .min(3, 'Enter your order number')
    .max(40)
    .transform((v) => v.toUpperCase()),
  contact: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v.includes('@')) {
        const email = v.toLowerCase();
        if (z.string().email().safeParse(email).success) return { email } as const;
        ctx.addIssue({ code: 'custom', message: 'Enter a valid email address' });
        return z.NEVER;
      }
      const phone = normalizeIndianMobile(v);
      if (phone) return { phone } as const;
      ctx.addIssue({
        code: 'custom',
        message: 'Enter the email or 10-digit mobile number used for the order',
      });
      return z.NEVER;
    }),
});

export function TrackOrder() {
  const params = useSearchParams();
  const [order, setOrder] = React.useState<OrderDetailDto | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { number: params.get('number') ?? '', contact: '' },
  });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      setOrder(
        await api<OrderDetailDto>('/orders/track', { query: { number: v.number, ...v.contact } }),
      );
    } catch (e) {
      setOrder(null);
      setError(
        e instanceof ApiError && e.status === 404
          ? 'We couldn’t find an order with that number and email or phone.'
          : errorMessage(e),
      );
    }
  });
  return (
    <div className="space-y-8 py-8">
      <div className="mx-auto max-w-lg">
        <div className="flex items-center gap-2">
          <Truck className="size-6 text-brand-500" aria-hidden />
          <h1 className="font-display text-xl font-extrabold">Track your order</h1>
        </div>
        <p className="mt-1 text-sm text-muted">
          Enter your order number (e.g. VY-…) and the email or mobile number you used at checkout.
        </p>
        <form onSubmit={onSubmit} noValidate className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label="Order number" htmlFor="tr-number" error={errors.number?.message}>
            <Input
              id="tr-number"
              autoCapitalize="characters"
              {...register('number')}
              invalid={!!errors.number}
            />
          </Field>
          <Field label="Email or mobile number" htmlFor="tr-contact" error={errors.contact?.message}>
            <Input
              id="tr-contact"
              type="text"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com or 98765 43210"
              {...register('contact')}
              invalid={!!errors.contact}
            />
          </Field>
          {error && (
            <Alert tone="danger" className="sm:col-span-2">
              {error}
            </Alert>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" loading={isSubmitting} block size="lg">
              Track order
            </Button>
          </div>
        </form>
      </div>
      {order && <OrderView order={order} onChange={(o) => o && setOrder(o)} />}
    </div>
  );
}
