'use client';

import type { OrderDetailDto } from '@vyra/shared';
import { cn } from '@vyra/ui';

export type ExchangeOption = NonNullable<OrderDetailDto['exchangeOptions']>[string][number];

/** Exchange targets for one order item (same product, same price, in stock). */
export function exchangeOptionsFor(order: OrderDetailDto, orderItemId: string): ExchangeOption[] {
  return order.exchangeOptions?.[orderItemId] ?? [];
}

/**
 * Pick the size/colour to receive instead of `current`. A radio group of chips:
 * native radios keep keyboard + screen-reader behaviour for free.
 */
export function ExchangePicker({
  itemId,
  itemName,
  current,
  options,
  value,
  onChange,
  error,
}: {
  itemId: string;
  itemName: string;
  current: { color: string; size: string };
  options: ExchangeOption[];
  value: string | null;
  onChange: (variantId: string) => void;
  error?: string | null;
}) {
  const name = `exchange-${itemId}`;
  const multiColour = new Set(options.map((o) => o.color)).size > 1 || options.some((o) => o.color !== current.color);
  return (
    <fieldset className="mt-2" aria-describedby={error ? `${name}-error` : undefined}>
      <legend className="mb-1.5 text-xs font-semibold text-muted">
        Exchange {itemName} ({current.color} · {current.size}) for
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const checked = value === o.variantId;
          const label = multiColour ? `${o.color} · ${o.size}` : o.size;
          return (
            <label
              key={o.variantId}
              className={cn(
                'inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-300',
                checked
                  ? 'border-fg bg-fg text-white'
                  : 'border-border-strong bg-bg hover:border-fg',
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.variantId}
                checked={checked}
                onChange={() => onChange(o.variantId)}
                className="sr-only"
              />
              <span className="font-semibold">{label}</span>
              {o.available <= 3 && (
                <span className={cn('text-[11px]', checked ? 'text-white/80' : 'text-warning')}>
                  {o.available} left
                </span>
              )}
            </label>
          );
        })}
      </div>
      {error && (
        <p id={`${name}-error`} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
