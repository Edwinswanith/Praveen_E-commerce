import * as React from 'react';
import { formatINR, discountPercent } from '@vyra/shared';
import { cn } from '../lib/cn';

/**
 * Original VYRA wordmark: geometric letterforms with the "V" built from two
 * brand-colour strokes (pink over violet) — reads as a checkmark/"vibe" tick.
 */
export function VyraLogo({ className, withTagline = false, mono = false }: { className?: string; withTagline?: boolean; mono?: boolean }) {
  return (
    <span className={cn('inline-flex flex-col leading-none', className)} aria-label="VYRA">
      <svg viewBox="0 0 132 32" className="h-[1em] w-auto" role="img" aria-hidden>
        <path d="M2 4 L13 28 L18 17" fill="none" stroke={mono ? 'currentColor' : '#7C3AED'} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 28 L24 4" fill="none" stroke={mono ? 'currentColor' : '#FF3F6C'} strokeWidth="5.5" strokeLinecap="round" />
        <text x="32" y="28" fontFamily="var(--font-display), Manrope, sans-serif" fontWeight="800" fontSize="30" letterSpacing="1" fill="currentColor">YRA</text>
      </svg>
      {withTagline && <span className="mt-1 text-[0.28em] font-semibold tracking-[0.35em] text-muted">WEAR YOUR VIBE.</span>}
    </span>
  );
}

export function Price({ price, mrp, size = 'md', className }: { price: number; mrp?: number; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const off = mrp ? discountPercent(mrp, price) : 0;
  const text = { sm: 'text-sm', md: 'text-base', lg: 'text-2xl' }[size];
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-2', className)}>
      <span className={cn('font-bold text-fg', text)}>{formatINR(price)}</span>
      {off > 0 && mrp && (
        <>
          <span className={cn('text-muted line-through', size === 'lg' ? 'text-base' : 'text-xs')}>
            <span className="sr-only">MRP </span>{formatINR(mrp)}
          </span>
          <span className={cn('font-semibold text-brand-500', size === 'lg' ? 'text-base' : 'text-xs')}>({off}% OFF)</span>
        </>
      )}
    </span>
  );
}

export function ColorDot({ hex, name, className }: { hex: string | null; name: string; className?: string }) {
  return (
    <span
      title={name}
      className={cn('inline-block size-3 rounded-full ring-1 ring-black/10', className)}
      style={{ background: hex ?? '#ccc' }}
    />
  );
}
