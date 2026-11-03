import { Skeleton } from '@vyra/ui';
import { Container } from '../ui/page-header';
import { ProductGridSkeleton } from '../product/product-grid';

export function ListingSkeleton() {
  return (
    <Container>
      <div className="pb-4 pt-6">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-3 h-7 w-56" />
      </div>
      <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-8">
        <div className="hidden space-y-4 lg:block">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <div>
          <Skeleton className="h-9 w-full" />
          <ProductGridSkeleton className="mt-5" count={12} />
        </div>
      </div>
    </Container>
  );
}
