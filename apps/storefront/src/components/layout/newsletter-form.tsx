'use client';

import * as React from 'react';
import { z } from 'zod';
import { Button, Input, cn } from '@vyra/ui';
import { api, errorMessage } from '@/lib/api';

const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

export function NewsletterForm({
  tone = 'light',
  source = 'footer',
  className,
}: {
  tone?: 'light' | 'dark';
  /** Where the form is (stored with the consent record): lowercase letters, digits, - or _. */
  source?: string;
  className?: string;
}) {
  const [email, setEmail] = React.useState('');
  const [state, setState] = React.useState<{
    status: 'idle' | 'loading' | 'done' | 'error';
    message?: string;
  }>({ status: 'idle' });
  const id = React.useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setState({ status: 'error', message: parsed.error.issues[0]?.message });
      return;
    }
    setState({ status: 'loading' });
    try {
      // Double opt-in: nothing is sent to this address until they click the emailed link.
      await api('/newsletter', { method: 'POST', body: { email: parsed.data, source } });
      setState({
        status: 'done',
        message: 'Check your inbox to confirm your subscription.',
      });
      setEmail('');
    } catch (err) {
      setState({ status: 'error', message: errorMessage(err) });
    }
  };

  return (
    <form onSubmit={submit} noValidate className={cn('w-full', className)}>
      <label htmlFor={id} className="sr-only">
        Email address
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="email"
          autoComplete="email"
          placeholder="Your email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          invalid={state.status === 'error'}
          aria-describedby={`${id}-msg`}
          className={
            tone === 'dark'
              ? 'border-white/20 bg-white/10 text-white placeholder:text-white/50 focus:border-white'
              : undefined
          }
        />
        <Button type="submit" loading={state.status === 'loading'} className="shrink-0">
          Subscribe
        </Button>
      </div>
      <p
        id={`${id}-msg`}
        role={state.status === 'error' ? 'alert' : 'status'}
        className={cn(
          'mt-2 min-h-4 text-xs',
          state.status === 'error'
            ? 'text-red-400'
            : tone === 'dark'
              ? 'text-white/70'
              : 'text-muted',
        )}
      >
        {state.message}
      </p>
    </form>
  );
}
