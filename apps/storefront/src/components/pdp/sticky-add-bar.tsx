'use client';

import * as React from 'react';
import { ChevronUp, ShoppingBag } from 'lucide-react';
import { Button, Price, cn } from '@vyra/ui';
import { ProductImage } from '../product/product-image';

/**
 * Show the bar only once the main Add-to-bag button has scrolled *above* the
 * viewport (not while it is still below the fold), and never over the footer.
 */
export function shouldShowStickyBar(
  target: { isIntersecting: boolean; top: number } | null,
  footerVisible: boolean,
): boolean {
  if (!target || footerVisible) return false;
  return !target.isIntersecting && target.top < 0;
}

/** Observes the main CTA and the page footer. */
export function useStickyBarVisible(targetRef: React.RefObject<HTMLElement | null>): boolean {
  const [target, setTarget] = React.useState<{ isIntersecting: boolean; top: number } | null>(null);
  const [footerVisible, setFooterVisible] = React.useState(false);
  React.useEffect(() => {
    const el = targetRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === el) setTarget({ isIntersecting: e.isIntersecting, top: e.boundingClientRect.top });
        else setFooterVisible(e.isIntersecting);
      }
    });
    io.observe(el);
    const footer = document.querySelector('footer');
    if (footer) io.observe(footer);
    return () => io.disconnect();
  }, [targetRef]);
  return shouldShowStickyBar(target, footerVisible);
}

export interface StickyAddBarProps {
  visible: boolean;
  imageUrl: string | null;
  name: string;
  price: number;
  mrp: number;
  color: string | null;
  size: string | null;
  onPickSize: () => void;
  onAdd: () => void;
  busy: boolean;
  disabled: boolean;
}

/** Mobile/tablet bottom bar that mirrors the main Add to bag CTA. */
export function StickyAddBar({ visible, imageUrl, name, price, mrp, color, size, onPickSize, onAdd, busy, disabled }: StickyAddBarProps) {
  return (
    <div
      data-testid="sticky-add-bar"
      data-visible={visible}
      aria-hidden={!visible}
      inert={!visible}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 px-3 pt-2 shadow-[0_-4px_16px_rgba(0,0,0,.06)] backdrop-blur pb-[max(0.5rem,env(safe-area-inset-bottom))] transition-transform duration-200 ease-out motion-reduce:transition-none lg:hidden',
        visible ? 'translate-y-0' : 'pointer-events-none translate-y-full',
      )}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <div className="relative h-12 w-9 shrink-0 overflow-hidden rounded-sm bg-surface-2">
          <ProductImage src={imageUrl} alt="" fill sizes="40px" className="object-cover" />
        </div>
        <button
          type="button"
          onClick={onPickSize}
          className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center text-left"
          aria-label={`${name}: ${color ?? 'choose colour'}, ${size ? `size ${size}` : 'choose size'}. Change selection`}
        >
          <Price price={price} mrp={mrp} size="sm" />
          <span className="flex max-w-full items-center gap-1 truncate text-xs text-muted">
            <span className="truncate">
              {color ?? 'Colour'} · {size ? `Size ${size}` : <span className="font-semibold text-brand-600">Select size</span>}
            </span>
            <ChevronUp className="size-3 shrink-0" aria-hidden />
          </span>
        </button>
        <Button size="md" className="h-11 shrink-0 px-4" onClick={onAdd} loading={busy} disabled={disabled}>
          <ShoppingBag aria-hidden /> Add to bag
        </Button>
      </div>
    </div>
  );
}
