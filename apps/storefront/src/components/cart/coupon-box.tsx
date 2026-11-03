'use client';

import * as React from 'react';
import useSWR from 'swr';
import { Tag, X } from 'lucide-react';
import type { CouponDto } from '@vyra/shared';
import { formatINR } from '@vyra/shared';
import { Button, Input, Spinner, cn } from '@vyra/ui';
import { errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Modal } from '../ui/dialog';

function describe(c: CouponDto): string {
  const off = c.type === 'PERCENTAGE' ? `${c.value}% off` : `${formatINR(c.value)} off`;
  const cap = c.type === 'PERCENTAGE' && c.maxDiscount ? ` up to ${formatINR(c.maxDiscount)}` : '';
  const min = c.minOrderValue ? ` on orders above ${formatINR(c.minOrderValue)}` : '';
  return `${off}${cap}${min}`;
}

export function CouponBox({
  code,
  autoApplied = false,
  error,
  onApply,
  onRemove,
}: {
  code: string | null;
  /** The best eligible coupon was picked for the shopper; nothing to remove. */
  autoApplied?: boolean;
  error: string | null;
  onApply: (code: string) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
}) {
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const { data: coupons, isLoading } = useSWR<CouponDto[]>(open ? '/coupons/available' : null);

  const apply = async (c: string) => {
    if (c.trim().length < 3) {
      setLocalError('Enter a valid coupon code');
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      await onApply(c);
      setOpen(false);
      setInput('');
    } catch (e) {
      setLocalError(errorMessage(e, 'This coupon can’t be applied'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Coupons</h2>
      {code && autoApplied ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-teal-500 bg-teal-500/5 px-3 py-2">
          <p className="flex items-center gap-2 text-sm">
            <Tag className="size-4 shrink-0 text-teal-600" aria-hidden />
            <span>
              <strong>{code}</strong> applied automatically
            </span>
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-11 shrink-0 rounded-md px-2 text-xs font-bold uppercase text-brand-600 hover:underline"
          >
            Change
          </button>
        </div>
      ) : code ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-teal-500 bg-teal-500/5 px-3 py-2">
          <p className="flex items-center gap-2 text-sm">
            <Tag className="size-4 text-teal-600" aria-hidden />
            <strong>{code}</strong> applied
          </p>
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              try {
                await onRemove();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            aria-label={`Remove coupon ${code}`}
            className="rounded-full p-1 text-muted hover:text-danger"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between rounded-md border border-border-strong px-3 py-2.5 text-sm font-semibold hover:border-fg"
        >
          <span className="flex items-center gap-2">
            <Tag className="size-4" aria-hidden />
            Apply coupon
          </span>
          <span className="text-xs font-bold uppercase text-brand-600">Apply</span>
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      <Modal
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          setLocalError(null);
        }}
        title="Apply coupon"
      >
        <div className="p-5">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void apply(input);
            }}
          >
            <label htmlFor="coupon-code" className="sr-only">
              Coupon code
            </label>
            <Input
              id="coupon-code"
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              placeholder="Enter coupon code"
              autoCapitalize="characters"
              invalid={!!localError}
            />
            <Button type="submit" loading={busy}>
              Apply
            </Button>
          </form>
          {localError && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {localError}
            </p>
          )}
          <h3 className="mb-2 mt-6 text-xs font-bold uppercase tracking-wider text-muted">
            Available coupons
          </h3>
          {isLoading && (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          )}
          {coupons && coupons.length === 0 && (
            <p className="text-sm text-muted">No coupons available right now.</p>
          )}
          <ul className="space-y-3">
            {coupons?.map((c) => (
              <li key={c.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-sm border border-dashed border-brand-500 px-2 py-0.5 font-mono text-sm font-bold text-brand-600">
                    {c.code}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void apply(c.code)}
                  >
                    Apply
                  </Button>
                </div>
                <p className="mt-2 text-sm font-semibold">{describe(c)}</p>
                {c.description && <p className="mt-0.5 text-xs text-muted">{c.description}</p>}
                {c.expiresAt && (
                  <p className={cn('mt-1 text-[11px] text-subtle')}>
                    Valid till {formatDate(c.expiresAt)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </div>
  );
}
