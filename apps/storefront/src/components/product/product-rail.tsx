import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { ProductCardDto } from '@vyra/shared';
import { cn } from '@vyra/ui';
import { ProductCard } from './product-card';

/** Horizontal scroll-snap rail of product cards. */
export function ProductRail({
  title,
  eyebrow,
  products,
  viewAllHref,
  className,
}: {
  title: string;
  eyebrow?: React.ReactNode;
  products: ProductCardDto[];
  viewAllHref?: string;
  className?: string;
}) {
  if (products.length === 0) return null;
  const headingId = `rail-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <section aria-labelledby={headingId} className={cn('py-6 sm:py-8', className)}>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          {eyebrow && (
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-600">
              {eyebrow}
            </p>
          )}
          <h2
            id={headingId}
            className="font-display text-lg font-extrabold uppercase tracking-wide text-fg sm:text-xl"
          >
            {title}
          </h2>
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-600 hover:underline"
          >
            View all <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
      </div>
      <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:scroll-px-6 lg:scroll-px-0 [scrollbar-width:thin] sm:-mx-6 sm:gap-4 sm:px-6 lg:mx-0 lg:px-0">
        {products.map((p) => (
          <li key={p.id} className="w-[44%] shrink-0 snap-start sm:w-[30%] md:w-[23%] lg:w-[18.5%]">
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}
