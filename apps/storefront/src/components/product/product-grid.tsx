import type { ProductCardDto } from '@vyra/shared';
import { Skeleton, cn } from '@vyra/ui';
import { ProductCard } from './product-card';

export function ProductGrid({
  products,
  className,
}: {
  products: ProductCardDto[];
  className?: string;
}) {
  return (
    <ul
      className={cn(
        'grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 md:grid-cols-3 xl:grid-cols-4',
        className,
      )}
    >
      {products.map((p, i) => (
        <li key={p.id}>
          <ProductCard product={p} priority={i < 4} />
        </li>
      ))}
    </ul>
  );
}

export function ProductCardSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-[3/4] w-full" />
      <Skeleton className="mt-2 h-4 w-1/2" />
      <Skeleton className="mt-1.5 h-3.5 w-3/4" />
      <Skeleton className="mt-1.5 h-4 w-1/3" />
    </div>
  );
}

export function ProductGridSkeleton({
  count = 8,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 md:grid-cols-3 xl:grid-cols-4',
        className,
      )}
      aria-busy="true"
      aria-label="Loading products"
    >
      {Array.from({ length: count }, (_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}
