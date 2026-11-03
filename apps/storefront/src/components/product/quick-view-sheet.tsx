'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ArrowRight, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import type { ProductDetailDto, ProductImageDto } from '@vyra/shared';
import { Alert, Button, Price, Skeleton, cn } from '@vyra/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { initialSelection, resolveVariant, stockMessage, type Selection } from '@/lib/variants';
import { useCart } from '@/hooks/use-cart';
import { useMediaQuery } from '@/hooks/use-media-query';
import { Sheet } from '../ui/dialog';
import { imagesForColor } from '../pdp/gallery';
import { VariantSelector } from '../pdp/variant-selector';
import { ProductImage } from './product-image';

function MiniCarousel({ images, name }: { images: ProductImageDto[]; name: string }) {
  const [index, setIndex] = React.useState(0);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    ref.current?.scrollTo({ left: 0 });
    setIndex(0);
  }, [images]);
  if (images.length === 0) {
    return (
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md">
        <ProductImage src={null} alt={name} fill />
      </div>
    );
  }
  return (
    <div className="relative">
      <div
        ref={ref}
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label={`${name} images`}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.clientWidth) setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
        onKeyDown={(e) => {
          const el = ref.current;
          if (!el || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
          e.preventDefault();
          const next = Math.min(images.length - 1, Math.max(0, index + (e.key === 'ArrowRight' ? 1 : -1)));
          el.scrollTo({ left: next * el.clientWidth });
        }}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-md scrollbar-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {images.map((img, i) => (
          <div key={img.id} className="relative aspect-[3/4] w-full shrink-0 snap-center bg-surface-2">
            <ProductImage src={img.url} alt={img.alt || name} fill sizes="(min-width: 1024px) 380px, 70vw" className="object-cover" priority={i === 0} />
            {img.aiGenerated && (
              <span className="absolute left-2 top-2 rounded-sm bg-bg/90 px-1.5 py-0.5 text-[10px] font-medium text-muted">AI-styled photo</span>
            )}
          </div>
        ))}
      </div>
      {images.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5" aria-hidden>
          {images.map((img, i) => (
            <span key={img.id} className={cn('h-1.5 rounded-full bg-white shadow-sm', i === index ? 'w-4 bg-brand-500' : 'w-1.5')} />
          ))}
        </div>
      )}
    </div>
  );
}

function QuickViewBody({ product }: { product: ProductDetailDto }) {
  const { addItem } = useCart();
  const [selection, setSelection] = React.useState<Selection>(() => initialSelection(product.variants));
  const [sizeError, setSizeError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [added, setAdded] = React.useState(false);
  const sizeRef = React.useRef<HTMLDivElement>(null);
  const variant = resolveVariant(product.variants, selection.color, selection.size);
  const soldOut = !product.variants.some((v) => v.isActive && v.inStock && v.available > 0);
  const images = React.useMemo(() => imagesForColor(product.images, selection.color), [product.images, selection.color]);

  const add = async () => {
    if (!variant) {
      setSizeError(selection.color ? 'Please select a size' : 'Please select a colour and size');
      sizeRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await addItem(variant.id, 1);
      setAdded(true);
      toast.success('Added to bag', { description: `${product.name} · ${variant.color} · ${variant.size}` });
    } catch (e) {
      toast.error(
        e instanceof ApiError && e.code === 'OUT_OF_STOCK'
          ? 'Sorry, that size just sold out or you already have the maximum available in your bag.'
          : errorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:grid-cols-1">
      <div className="mx-auto w-full max-w-[280px] sm:max-w-none lg:max-w-[300px]">
        <MiniCarousel images={images} name={product.name} />
      </div>
      <div className="min-w-0">
        <p className="font-extrabold uppercase tracking-wide">{product.brand}</p>
        <p className="text-sm text-muted">{product.name}</p>
        <Price price={variant?.price ?? product.minPrice} mrp={variant?.mrp ?? product.minMrp} size="md" className="mt-2" />
        <div className="mt-4">
          <VariantSelector
            variants={product.variants}
            selection={selection}
            onChange={(s) => {
              setSelection(s);
              setSizeError(null);
              setAdded(false);
            }}
            sizeError={sizeError}
            sizeGroupRef={sizeRef}
          />
          <p className="mt-2 min-h-5 text-sm font-semibold text-warning" aria-live="polite">
            {soldOut ? 'This product is currently out of stock' : stockMessage(variant)}
          </p>
        </div>
        <div className="mt-2 space-y-2">
          <Button size="lg" block onClick={() => void add()} loading={busy} disabled={soldOut}>
            <ShoppingBag aria-hidden /> {added ? 'Added · add another' : 'Add to bag'}
          </Button>
          <Link
            href={`/p/${product.slug}${variant ? `?variant=${variant.id}` : ''}`}
            className="flex h-11 items-center justify-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline"
          >
            View full details <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}

export function QuickViewSheet({
  open,
  onOpenChange,
  slug,
  name,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  name: string;
}) {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const { data, error } = useSWR<ProductDetailDto>(open ? `/products/${encodeURIComponent(slug)}` : null, {
    revalidateOnFocus: false,
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange} side={desktop ? 'right' : 'bottom'} title="Quick view" description={name}>
      {data ? (
        <QuickViewBody product={data} />
      ) : error ? (
        <div className="p-5">
          <Alert tone="danger">{errorMessage(error, 'We couldn’t load this product.')}</Alert>
        </div>
      ) : (
        <div className="grid gap-3 p-4" aria-busy="true" aria-label="Loading product">
          <Skeleton className="mx-auto aspect-[3/4] w-full max-w-[280px] rounded-md" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-11 w-full" />
        </div>
      )}
    </Sheet>
  );
}
