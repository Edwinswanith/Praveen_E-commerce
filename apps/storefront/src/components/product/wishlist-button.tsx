'use client';

import { Heart } from 'lucide-react';
import { cn } from '@vyra/ui';
import { useWishlist } from '@/hooks/use-wishlist';

export function WishlistButton({
  productId,
  productName,
  variant = 'icon',
  className,
}: {
  productId: string;
  productName: string;
  variant?: 'icon' | 'button';
  className?: string;
}) {
  const { has, toggle } = useWishlist();
  const active = has(productId);
  const label = active ? `Remove ${productName} from wishlist` : `Save ${productName} to wishlist`;
  if (variant === 'button') {
    return (
      <button
        type="button"
        onClick={() => void toggle(productId)}
        aria-pressed={active}
        className={cn(
          'inline-flex h-12 items-center justify-center gap-2 rounded-md border border-border-strong px-5 text-sm font-semibold uppercase tracking-wide text-fg transition-colors hover:border-fg',
          className,
        )}
      >
        <Heart className={cn('size-4', active && 'fill-brand-500 text-brand-500')} aria-hidden />
        {active ? 'Wishlisted' : 'Wishlist'}
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggle(productId);
      }}
      className={cn('group/wish flex size-11 items-center justify-center rounded-full', className)}
    >
      {/* 44px hit area, 32px visual */}
      <span className="flex size-8 items-center justify-center rounded-full bg-bg/90 shadow-sm backdrop-blur transition-transform group-hover/wish:scale-105">
        <Heart
          className={cn('size-4', active ? 'fill-brand-500 text-brand-500' : 'text-fg')}
          aria-hidden
        />
      </span>
    </button>
  );
}
