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
import { OrderView } from './order-detail';

const schema = z.object({
  number: z
    .string()
    .trim()
    .min(3, 'Enter your order number')
    .max(40)
    .transform((v) => v.toUpperCase()),
  email: z.string().trim().toLowerCase().email('Enter the email used for the order'),
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
    defaultValues: { number: params.get('number') ?? '', email: '' },
  });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      setOrder(
        await api<OrderDetailDto>('/orders/track', { query: { number: v.number, email: v.email } }),
      );
    } catch (e) {
      setOrder(null);
      setError(
        e instanceof ApiError && e.status === 404
          ? 'We couldn’t find an order with that number and email.'
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
          Enter your order number (e.g. VY-…) and the email you used at checkout.
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
          <Field label="Email" htmlFor="tr-email" error={errors.email?.message}>
            <Input
              id="tr-email"
              type="email"
              autoComplete="email"
              {...register('email')}
              invalid={!!errors.email}
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
      {order && <OrderView order={order} />}
    </div>
  );
}
