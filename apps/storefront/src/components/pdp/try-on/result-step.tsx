'use client';

import * as React from 'react';
import Link from 'next/link';
import { Camera, Check, Download, Info, Palette, ShoppingBag } from 'lucide-react';
import type { TryOnResponse, VariantDto } from '@vyra/shared';
import { Button, cn } from '@vyra/ui';
import { colorOptions, resolveVariant, selectSize, sizeOptions, type Selection } from '@/lib/variants';
import { CompareSlider } from './compare-slider';

export interface ResultStepProps {
  result: TryOnResponse;
  photoUrl: string;
  productName: string;
  productSlug: string;
  variants: VariantDto[];
  selection: Selection;
  onSelectionChange: (s: Selection) => void;
  onAddToBag: (variantId: string) => Promise<boolean>;
  onTryColor: (color: string) => void;
  onRetake: () => void;
  remainingText: string | null;
  canRegenerate: boolean;
  error: string | null;
}

export function ResultStep({
  result,
  photoUrl,
  productName,
  productSlug,
  variants,
  selection,
  onSelectionChange,
  onAddToBag,
  onTryColor,
  onRetake,
  remainingText,
  canRegenerate,
  error,
}: ResultStepProps) {
  const [showColors, setShowColors] = React.useState(false);
  const [needSize, setNeedSize] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [added, setAdded] = React.useState(false);
  const colors = colorOptions(variants);
  const sizes = sizeOptions(variants, selection.color).filter((s) => s.state === 'available');
  const variant = resolveVariant(variants, selection.color, selection.size);

  React.useEffect(() => setAdded(false), [selection.color, selection.size]);

  const add = async (variantId: string) => {
    setAdding(true);
    try {
      const ok = await onAddToBag(variantId);
      if (ok) {
        setAdded(true);
        setNeedSize(false);
      }
    } finally {
      setAdding(false);
    }
  };

  const onAddClick = () => {
    if (!variant) {
      setNeedSize(true);
      return;
    }
    void add(variant.id);
  };

  const pickSize = (size: string) => {
    const next = selectSize(variants, selection, size);
    onSelectionChange(next);
    const v = resolveVariant(variants, next.color, next.size);
    if (v) void add(v.id);
  };

  const fileName = `vyra-try-on-${productSlug}-${result.color.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.webp`;

  return (
    <div className="flex flex-col gap-4 p-5">
      <CompareSlider
        beforeSrc={photoUrl}
        afterSrc={result.image}
        beforeAlt="Your original photo"
        afterAlt={`AI try-on preview: you wearing ${productName} in ${result.color}`}
        initial={70}
        afterBadge={
          <span className="pointer-events-none absolute bottom-2 left-2 rounded-sm bg-bg/90 px-2 py-1 text-[11px] font-medium text-muted shadow-sm">
            AI-generated preview · {result.color}
          </span>
        }
      />

      <p className="flex gap-2 rounded-md bg-surface px-3 py-2 text-xs text-muted" data-testid="try-on-disclaimer">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>{result.disclaimer}</span>
      </p>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      {needSize && (
        <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-3">
          <p role="alert" className="mb-2 text-sm font-bold">
            Pick your size to add to bag
          </p>
          <div role="radiogroup" aria-label="Size" className="flex flex-wrap gap-2">
            {sizes.length === 0 && <p className="text-sm text-muted">This colour is sold out right now.</p>}
            {sizes.map((s) => (
              <button
                key={s.size}
                type="button"
                role="radio"
                aria-checked={selection.size === s.size}
                onClick={() => pickSize(s.size)}
                className={cn(
                  'flex h-11 min-w-11 items-center justify-center rounded-full border px-3 text-sm font-semibold',
                  selection.size === s.size ? 'border-brand-500 text-brand-600 ring-1 ring-brand-500' : 'border-border-strong bg-bg hover:border-fg',
                )}
              >
                {s.size}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        <Button type="button" size="lg" block onClick={onAddClick} loading={adding}>
          {added ? <Check aria-hidden /> : <ShoppingBag aria-hidden />}
          {added ? 'Added to bag' : `Add to bag${variant ? ` · ${variant.size}` : ''}`}
        </Button>
        {added && (
          <Link href="/cart" className="text-center text-sm font-semibold text-brand-600 underline-offset-4 hover:underline">
            View bag
          </Link>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="col-span-2 h-11"
            onClick={() => setShowColors((v) => !v)}
            aria-expanded={showColors}
            disabled={colors.length < 2 || !canRegenerate}
          >
            <Palette aria-hidden /> Try another colour
          </Button>
          <a
            href={result.image}
            download={fileName}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-border-strong px-2 text-sm font-semibold hover:border-fg [&_svg]:size-4"
          >
            <Download aria-hidden /> Download
          </a>
          <Button type="button" variant="outline" className="h-11 px-2" onClick={onRetake}>
            <Camera aria-hidden /> Retake
          </Button>
        </div>
      </div>

      {showColors && (
        <div>
          <p className="mb-2 text-sm font-bold">Try another colour</p>
          <div role="group" aria-label="Try another colour" className="flex flex-wrap gap-2">
            {colors.map((c) => {
              const current = c.name.toLowerCase() === result.color.toLowerCase();
              return (
                <button
                  key={c.name}
                  type="button"
                  disabled={current || !canRegenerate}
                  onClick={() => onTryColor(c.name)}
                  aria-label={current ? `${c.name} (showing)` : `Try on in ${c.name}`}
                  className={cn(
                    'inline-flex h-11 items-center gap-2 rounded-full border px-3 text-sm font-semibold',
                    current ? 'border-brand-500 text-brand-600' : 'border-border-strong hover:border-fg',
                    'disabled:cursor-default',
                  )}
                >
                  <span className="size-5 rounded-full ring-1 ring-black/10" style={{ background: c.hex ?? '#d4d4d4' }} aria-hidden />
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {remainingText && <p className="text-center text-xs font-semibold text-muted">{remainingText}</p>}
    </div>
  );
}
