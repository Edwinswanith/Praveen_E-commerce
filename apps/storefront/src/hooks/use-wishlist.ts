'use client';

import * as React from 'react';
import useSWR from 'swr';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api, errorMessage, swrFetcher } from '@/lib/api';
import { useAuth } from './use-auth';

export const WISHLIST_IDS_KEY = '/wishlist/ids';

/** Wishlist heart state (product ids) for signed-in customers; anonymous users are sent to login. */
export function useWishlist() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { data, mutate } = useSWR<string[]>(user ? WISHLIST_IDS_KEY : null, swrFetcher, {
    revalidateOnFocus: false,
  });
  const ids = React.useMemo(() => new Set(data ?? []), [data]);

  const toggle = React.useCallback(
    async (productId: string) => {
      if (!user) {
        router.push(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      const has = ids.has(productId);
      const optimistic = has
        ? (data ?? []).filter((id) => id !== productId)
        : [...(data ?? []), productId];
      try {
        await mutate(
          async () => {
            if (has) await api(`/wishlist/${productId}`, { method: 'DELETE' });
            else await api('/wishlist', { method: 'POST', body: { productId } });
            return optimistic;
          },
          {
            optimisticData: optimistic,
            rollbackOnError: true,
            revalidate: false,
            populateCache: true,
          },
        );
        toast.success(has ? 'Removed from wishlist' : 'Saved to wishlist');
      } catch (e) {
        toast.error(errorMessage(e));
      }
    },
    [user, ids, data, mutate, router, pathname],
  );

  return {
    ids,
    loaded: data !== undefined,
    count: user ? ids.size : 0,
    has: (id: string) => ids.has(id),
    toggle,
  };
}
