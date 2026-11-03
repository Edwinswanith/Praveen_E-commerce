'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RotateCcw, ShieldCheck, ShoppingBag, Zap } from 'lucide-react';
import { toast } from 'sonner';
import type { ProductDetailDto } from '@vyra/shared';
import { Badge, Button, Price } from '@vyra/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { initialSelection, resolveVariant, stockMessage, type Selection } from '@/lib/variants';
import { recordRecentlyViewed } from '@/lib/recently-viewed';
import { useCart } from '@/hooks/use-cart';
import { RatingPill } from '../ui/stars';
import { WishlistButton } from '../product/wishlist-button';
import { Gallery } from './gallery';
import { VariantSelector } from './variant-selector';
import { SizeGuide } from './size-guide';
import { PincodeCheck } from './pincode-check';
import { FitAdvice } from './fit-advice';

export function ProductDetail({ product }: { product: ProductDetailDto }) {
  const router = useRouter();
  const { addItem } = useCart();
  const [selection, setSelection] = React.useState<Selection>(() =>
    initialSelection(product.variants),
  );
  const [sizeError, setSizeError] = React.useState<string | null>(null);
  const [guide, setGuide] = React.useState(false);
  const [busy, setBusy] = React.useState<'add' | 'buy' | null>(null);
  const sizeRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => recordRecentlyViewed(product.id), [product.id]);

  const variant = resolveVariant(product.variants, selection.color, selection.size);
  const soldOut = !product.variants.some((v) => v.isActive && v.inStock && v.available > 0);
  const price = variant?.price ?? product.minPrice;
  const mrp = variant?.mrp ?? product.minMrp;
  const stock = stockMessage(variant);
  const sizes = [...new Set(product.variants.filter((v) => v.isActive).map((v) => v.size))];

  const add = async (mode: 'add' | 'buy') => {
    if (!variant) {
      setSizeError(selection.color ? 'Please select a size' : 'Please select a colour and size');
      sizeRef.current?.focus();
      sizeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setBusy(mode);
    try {
      await addItem(variant.id, 1);
      if (mode === 'buy') {
        router.push('/checkout');
        return;
      }
      toast.success('Added to bag', {
        description: `${product.name} · ${variant.color} · ${variant.size}`,
        action: { label: 'View bag', onClick: () => router.push('/cart') },
      });
    } catch (e) {
      toast.error(
        e instanceof ApiError && e.code === 'OUT_OF_STOCK'
          ? 'Sorry, that size just sold out or you already have the maximum available in your bag.'
          : errorMessage(e),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10">
      <Gallery
        images={product.images}
        videos={product.videos}
        name={product.name}
        color={selection.color}
      />

      <div className="lg:sticky lg:top-24 lg:self-start">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-extrabold uppercase tracking-wide">{product.brand}</p>
            <h1 className="mt-0.5 text-base font-normal text-muted sm:text-lg">{product.name}</h1>
          </div>
        </div>
        {product.rating !== null && product.reviewCount > 0 && (
          <a href="#reviews" className="mt-2 inline-block">
            <RatingPill rating={product.rating} count={product.reviewCount} className="text-xs" />
          </a>
        )}
        {product.badges.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {product.badges.map((b) => (
              <Badge key={b} tone="neutral">
                {b}
              </Badge>
            ))}
          </div>
        )}

        <div className="mt-4 border-t border-border pt-4">
          <Price price={price} mrp={mrp} size="lg" />
          <p className="mt-1 text-xs font-semibold text-teal-600">Inclusive of all taxes</p>
        </div>

        <div className="mt-6">
          <VariantSelector
            variants={product.variants}
            selection={selection}
            onChange={(s) => {
              setSelection(s);
              setSizeError(null);
            }}
            onSizeGuide={
              product.sizeChart && Object.keys(product.sizeChart).length > 0
                ? () => setGuide(true)
                : undefined
            }
            sizeError={sizeError}
            sizeGroupRef={sizeRef}
          />
          <FitAdvice fit={product.fit} className="mt-3" />
          <p className="mt-3 min-h-5 text-sm font-semibold text-warning" aria-live="polite">
            {soldOut ? 'This product is currently out of stock' : stock}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_auto] gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Button
            size="lg"
            onClick={() => void add('add')}
            loading={busy === 'add'}
            disabled={soldOut || busy !== null}
            className="col-span-1"
          >
            <ShoppingBag aria-hidden /> Add to bag
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => void add('buy')}
            loading={busy === 'buy'}
            disabled={soldOut || busy !== null}
            className="order-3 col-span-2 sm:order-none sm:col-span-1"
          >
            <Zap aria-hidden /> Buy now
          </Button>
          <WishlistButton
            productId={product.id}
            productName={product.name}
            variant="button"
            className="px-4"
          />
        </div>

        <div className="mt-8 border-t border-border pt-6">
          <PincodeCheck />
        </div>

        <ul className="mt-6 grid grid-cols-1 gap-2 text-sm text-muted sm:grid-cols-2">
          <li className="flex items-center gap-2">
            <RotateCcw className="size-4" aria-hidden />
            14-day easy returns
          </li>
          <li className="flex items-center gap-2">
            <ShieldCheck className="size-4" aria-hidden />
            100% original products
          </li>
        </ul>
        {variant && <p className="mt-4 text-xs text-subtle">SKU: {variant.sku}</p>}
        <p className="mt-1 text-xs text-subtle">
          Category:{' '}
          <Link
            href={`/c/${product.category.path.map((p) => p.slug).join('/') || product.category.slug}`}
            className="hover:underline"
          >
            {product.category.name}
          </Link>
        </p>
      </div>
      {product.sizeChart && (
        <SizeGuide open={guide} onOpenChange={setGuide} chart={product.sizeChart} sizes={sizes} />
      )}
    </div>
  );
}
