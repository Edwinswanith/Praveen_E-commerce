'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { Heart } from 'lucide-react';
import type { WishlistItemDto } from '@vyra/shared';
import { Alert, Button, EmptyState, Spinner } from '@vyra/ui';
import { errorMessage } from '@/lib/api';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { useWishlist } from '@/hooks/use-wishlist';
import { ProductGrid, ProductGridSkeleton } from '../product/product-grid';
import { PageHeader } from '../ui/page-header';

export function WishlistPage() {
  const { user, loading } = useRequireAuth();
  const { ids, loaded } = useWishlist();
  const { data, error, isLoading } = useSWR<WishlistItemDto[]>(user ? '/wishlist' : null);
  if (loading || !user)
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    );
  // Hide items un-hearted on this page immediately (heart state is the source of truth).
  const items = (data ?? []).filter((w) => !loaded || ids.has(w.product.id));
  return (
    <div className="space-y-6 py-6">
      <PageHeader
        title="Wishlist"
        subtitle={data ? `${items.length} saved item${items.length === 1 ? '' : 's'}` : undefined}
      />
      {isLoading && <ProductGridSkeleton count={4} />}
      {error && <Alert tone="danger">{errorMessage(error)}</Alert>}
      {data && items.length === 0 && (
        <EmptyState
          icon={<Heart />}
          title="Your wishlist is empty"
          description="Tap the heart on any product to save it for later."
          action={
            <Button asChild>
              <Link href="/products">Discover styles</Link>
            </Button>
          }
        />
      )}
      {items.length > 0 && <ProductGrid products={items.map((w) => w.product)} />}
    </div>
  );
}
