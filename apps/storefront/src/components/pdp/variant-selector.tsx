'use client';

import * as React from 'react';
import { Check, Ruler } from 'lucide-react';
import type { VariantDto } from '@vyra/shared';
import { cn } from '@vyra/ui';
import { colorOptions, selectColor, selectSize, sizeOptions, type Selection } from '@/lib/variants';

export interface VariantSelectorProps {
  variants: VariantDto[];
  selection: Selection;
  onChange: (next: Selection) => void;
  onSizeGuide?: () => void;
  sizeError?: string | null;
  sizeGroupRef?: React.Ref<HTMLDivElement>;
}

/**
 * Colour swatches + size buttons. Only real, in-stock colour/size combinations
 * are selectable, so a complete selection always maps to exactly one variant.
 */
export function VariantSelector({
  variants,
  selection,
  onChange,
  onSizeGuide,
  sizeError,
  sizeGroupRef,
}: VariantSelectorProps) {
  const colors = colorOptions(variants);
  const sizes = sizeOptions(variants, selection.color);
  const showColors = colors.length > 1 || (colors.length === 1 && colors[0]!.hex);
  const sizeErrId = React.useId();

  return (
    <div className="space-y-5">
      {showColors && (
        <div>
          <p className="mb-2 text-sm font-bold">
            Colour: <span className="font-normal text-muted">{selection.color ?? 'Select'}</span>
          </p>
          <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
            {colors.map((c) => {
              const selected = selection.color === c.name;
              return (
                <button
                  key={c.name}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`${c.name}${c.inStock ? '' : ' (out of stock)'}`}
                  title={c.name}
                  onClick={() => onChange(selectColor(variants, selection, c.name))}
                  className={cn(
                    'relative flex size-10 items-center justify-center rounded-full border-2 transition-colors',
                    selected ? 'border-brand-500' : 'border-transparent hover:border-border-strong',
                  )}
                >
                  <span
                    className="size-7 rounded-full ring-1 ring-black/10"
                    style={{ background: c.hex ?? '#d4d4d4' }}
                  />
                  {selected && (
                    <Check
                      className="absolute size-3.5 text-white mix-blend-difference"
                      strokeWidth={3}
                      aria-hidden
                    />
                  )}
                  {!c.inStock && (
                    <span aria-hidden className="absolute h-0.5 w-9 rotate-45 bg-muted" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div ref={sizeGroupRef} tabIndex={-1} className="outline-none">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-bold">Select size</p>
          {onSizeGuide && (
            <button
              type="button"
              onClick={onSizeGuide}
              className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-brand-600 hover:underline"
            >
              <Ruler className="size-3.5" aria-hidden /> Size guide
            </button>
          )}
        </div>
        <div
          role="radiogroup"
          aria-label="Size"
          aria-describedby={sizeError ? sizeErrId : undefined}
          className="flex flex-wrap items-start gap-2"
        >
          {sizes.map((s) => {
            const selected = selection.size === s.size;
            const disabled = s.state !== 'available';
            const note =
              s.state === 'out-of-stock'
                ? 'out of stock'
                : s.state === 'unavailable'
                  ? 'not available in this colour'
                  : '';
            const low =
              s.state === 'available' && s.variant && s.variant.available <= 3
                ? s.variant.available
                : null;
            return (
              <div key={s.size} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-disabled={disabled || undefined}
                  disabled={disabled}
                  aria-label={
                    note
                      ? `${s.size}, ${note}`
                      : low !== null
                        ? `${s.size}, only ${low} left`
                        : s.size
                  }
                  data-state={s.state}
                  onClick={() => onChange(selectSize(variants, selection, s.size))}
                  className={cn(
                    'relative flex h-11 min-w-11 items-center justify-center overflow-hidden rounded-full border px-3 text-sm font-semibold transition-colors',
                    selected
                      ? 'border-brand-500 text-brand-600 ring-1 ring-brand-500'
                      : 'border-border-strong hover:border-fg',
                    disabled && 'cursor-not-allowed border-border text-subtle hover:border-border',
                  )}
                >
                  {s.size}
                  {disabled && (
                    <span
                      aria-hidden
                      className="absolute h-px w-[140%] -rotate-[30deg] bg-border-strong"
                    />
                  )}
                </button>
                {low !== null && (
                  <span aria-hidden className="text-[10px] font-semibold leading-none text-warning">
                    {low} left
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {sizeError && (
          <p id={sizeErrId} role="alert" className="mt-2 text-sm font-medium text-danger">
            {sizeError}
          </p>
        )}
      </div>
    </div>
  );
}
