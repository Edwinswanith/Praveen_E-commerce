'use client';

import Link from 'next/link';
import { AlertTriangle, Bookmark, ShoppingBag, Trash2 } from 'lucide-react';
import type { CartItemDto } from '@vyra/shared';
import { formatINR } from '@vyra/shared';
import { cn } from '@vyra/ui';
import { ProductImage } from '../product/product-image';
import { QuantityStepper } from '../ui/quantity-stepper';

export function CartLine({
  item,
  onQuantity,
  onRemove,
  onSave,
  onMove,
  busy,
}: {
  item: CartItemDto;
  onQuantity?: (q: number) => void;
  onRemove: () => void;
  onSave?: () => void;
  onMove?: () => void;
  busy?: boolean;
}) {
  const maxQty = Math.max(1, Math.min(10, item.available || item.quantity));
  const warn = !item.savedForLater && !item.purchasable;
  return (
    <li className={cn('flex gap-3 py-4 sm:gap-4', busy && 'opacity-60')}>
      <Link
        href={`/p/${item.productSlug}`}
        className="relative aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-md bg-surface-2 sm:w-28"
      >
        <ProductImage
          src={item.imageUrl}
          alt={item.name}
          fill
          sizes="112px"
          className="object-cover"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold">{item.brand}</p>
            <Link
              href={`/p/${item.productSlug}`}
              className="line-clamp-2 text-sm text-muted hover:text-fg"
            >
              {item.name}
            </Link>
          </div>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            aria-label={`Remove ${item.name}`}
            className="-mr-1 -mt-1 rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-danger"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          {item.color} · Size {item.size}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          {onQuantity && !item.savedForLater ? (
            <QuantityStepper
              value={item.quantity}
              max={maxQty}
              onChange={onQuantity}
              disabled={busy}
              label={`Quantity for ${item.name}`}
            />
          ) : (
            <span className="text-xs text-muted">Qty {item.quantity}</span>
          )}
          <p className="text-sm">
            <strong className="tabular-nums">
              {formatINR(item.savedForLater ? item.unitPrice : item.lineTotal)}
            </strong>
            {item.unitMrp > item.unitPrice && (
              <span className="ml-1.5 text-xs text-muted line-through">
                <span className="sr-only">MRP </span>
                {formatINR(item.unitMrp * (item.savedForLater ? 1 : item.quantity))}
              </span>
            )}
          </p>
        </div>
        {warn && (
          <p
            role="alert"
            className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-danger"
          >
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            {item.available <= 0
              ? 'Out of stock — remove it or save for later to continue.'
              : `Only ${item.available} available — reduce the quantity to continue.`}
          </p>
        )}
        <div className="mt-2">
          {onSave && !item.savedForLater && (
            <button
              type="button"
              onClick={onSave}
              disabled={busy}
              className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-muted hover:text-fg"
            >
              <Bookmark className="size-3.5" aria-hidden /> Save for later
            </button>
          )}
          {onMove && item.savedForLater && (
            <button
              type="button"
              onClick={onMove}
              disabled={busy || item.available <= 0}
              className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-brand-600 hover:underline disabled:text-subtle"
            >
              <ShoppingBag className="size-3.5" aria-hidden />{' '}
              {item.available <= 0 ? 'Out of stock' : 'Move to bag'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
