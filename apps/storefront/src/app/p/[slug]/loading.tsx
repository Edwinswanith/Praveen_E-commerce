import { Skeleton } from '@vyra/ui';
import { Container } from '@/components/ui/page-header';

export default function Loading() {
  return (
    <Container className="pt-4">
      <Skeleton className="h-3 w-60" />
      <div
        className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10"
        aria-busy="true"
        aria-label="Loading product"
      >
        <div className="flex flex-col-reverse gap-3 lg:grid lg:grid-cols-[72px_1fr]">
          <div className="flex gap-2 lg:flex-col">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="aspect-[3/4] w-16 lg:w-full" />
            ))}
          </div>
          <Skeleton className="aspect-[3/4] w-full rounded-lg" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-8 w-1/2" />
          <div className="flex gap-2 pt-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="size-10 rounded-full" />
            ))}
          </div>
          <div className="flex gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-11 rounded-full" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 pt-4">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
          <Skeleton className="mt-6 h-24 w-full" />
        </div>
      </div>
    </Container>
  );
}
