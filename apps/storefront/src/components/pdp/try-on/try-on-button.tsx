'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import type { Gender, VariantDto } from '@vyra/shared';
import { cn } from '@vyra/ui';
import { TRY_ON_QUOTA_KEY, type TryOnQuota } from '@/lib/try-on';
import type { Selection } from '@/lib/variants';

// The dialog (and its steps) only download when someone actually opens it.
const TryOnDialog = dynamic(() => import('./try-on-dialog').then((m) => m.TryOnDialog), { ssr: false });

export interface TryOnButtonProps {
  productSlug: string;
  productName: string;
  gender: Gender;
  variants: VariantDto[];
  selection: Selection;
  onSelectionChange: (s: Selection) => void;
  onAddToBag: (variantId: string) => Promise<boolean>;
  className?: string;
}

/** "Try it on ✨" entry point. Hidden for kids' products and whenever the service says it's unavailable. */
export function TryOnButton({ gender, className, ...rest }: TryOnButtonProps) {
  const enabled = gender !== 'KIDS';
  const { data: quota, mutate } = useSWR<TryOnQuota>(enabled ? TRY_ON_QUOTA_KEY : null, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  if (!enabled || !quota?.available) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
        className={cn(
          'group relative flex min-h-12 w-full items-center justify-between gap-3 overflow-hidden rounded-md border border-violet-500/30 bg-gradient-to-r from-violet-500/10 via-brand-500/10 to-sun-400/20 px-4 py-2.5 text-left transition-colors hover:border-violet-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
          className,
        )}
        aria-haspopup="dialog"
      >
        <span className="min-w-0">
          <span className="block text-sm font-extrabold uppercase tracking-wide text-fg">
            Try it on <span aria-hidden>✨</span>
          </span>
          <span className="block truncate text-xs text-muted">
            See it on you with AI · {quota.remainingToday > 0 ? `${quota.remainingToday} free today` : 'come back tomorrow'}
          </span>
        </span>
        <span
          aria-hidden
          className="shrink-0 rounded-full bg-fg px-3 py-1.5 text-xs font-bold text-white transition-transform motion-safe:group-hover:translate-x-0.5"
        >
          Try now
        </span>
      </button>
      {loaded && (
        <TryOnDialog
          open={open}
          onOpenChange={setOpen}
          remaining={quota.remainingToday}
          onRemainingChange={(n) => void mutate({ ...quota, remainingToday: n }, { revalidate: false })}
          {...rest}
        />
      )}
    </>
  );
}
