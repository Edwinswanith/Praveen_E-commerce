'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { Eye } from 'lucide-react';
import { cn } from '@vyra/ui';
import { track } from '@/lib/analytics';

const QuickViewSheet = dynamic(() => import('./quick-view-sheet').then((m) => m.QuickViewSheet), { ssr: false });

/**
 * Card overlay: a small always-visible icon button on touch/small screens,
 * a full-width "Quick view" bar on desktop that appears on hover/focus.
 */
export function QuickViewButton({
  productId,
  slug,
  name,
  className,
}: {
  productId: string;
  slug: string;
  name: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const show = () => {
    setLoaded(true);
    setOpen(true);
    track('QUICK_VIEW', productId);
  };
  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label={`Quick view: ${name}`}
        aria-haspopup="dialog"
        className={cn('absolute bottom-0 right-0 flex size-11 items-center justify-center lg:hidden', className)}
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-bg/90 text-fg shadow-sm">
          <Eye className="size-4" aria-hidden />
        </span>
      </button>
      <button
        type="button"
        onClick={show}
        aria-label={`Quick view: ${name}`}
        aria-haspopup="dialog"
        className={cn(
          'absolute inset-x-2 bottom-2 hidden h-10 items-center justify-center gap-2 rounded-md bg-bg/95 text-xs font-bold uppercase tracking-wide text-fg opacity-0 shadow-sm transition-opacity duration-150 hover:bg-bg focus-visible:opacity-100 group-hover:opacity-100 motion-reduce:transition-none lg:flex',
          className,
        )}
      >
        <Eye className="size-4" aria-hidden /> Quick view
      </button>
      {loaded && <QuickViewSheet open={open} onOpenChange={setOpen} slug={slug} name={name} />}
    </>
  );
}
