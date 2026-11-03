'use client';

import * as React from 'react';
import useSWR from 'swr';
import type { ProductCardDto } from '@vyra/shared';
import { getRecentlyViewed } from '@/lib/recently-viewed';
import { ProductRail } from '../product/product-rail';

export function RecentlyViewed({
  excludeId,
  title = 'Recently viewed',
}: {
  excludeId?: string;
  title?: string;
}) {
  const [ids, setIds] = React.useState<string[]>([]);
  React.useEffect(() => {
    setIds(getRecentlyViewed().filter((id) => id !== excludeId));
  }, [excludeId]);
  const key =
    ids.length > 0 ? `/products/by-ids?ids=${ids.map(encodeURIComponent).join(',')}` : null;
  const { data } = useSWR<ProductCardDto[]>(key, { revalidateOnFocus: false });
  if (!data || data.length === 0) return null;
  return <ProductRail title={title} products={data} />;
}
