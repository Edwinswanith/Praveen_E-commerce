'use client';

import useSWR from 'swr';
import type { CartDto, CartItemDto } from '@vyra/shared';
import { api, swrFetcher } from '@/lib/api';

export const CART_KEY = '/cart';

function withItems(cart: CartDto, items: CartItemDto[], savedItems = cart.savedItems): CartDto {
  return { ...cart, items, savedItems, itemCount: items.reduce((s, i) => s + i.quantity, 0) };
}

/**
 * Cart state (guest or customer) via SWR. Mutations apply optimistic updates
 * where the outcome is predictable and always settle on the server's CartDto
 * (which carries authoritative totals).
 */
export function useCart() {
  const {
    data: cart,
    error,
    isLoading,
    mutate,
  } = useSWR<CartDto>(CART_KEY, swrFetcher, { revalidateOnFocus: true });

  const run = (request: () => Promise<CartDto>, optimistic?: (c: CartDto) => CartDto) =>
    mutate(request(), {
      optimisticData: optimistic && cart ? optimistic(cart) : undefined,
      rollbackOnError: true,
      populateCache: true,
      revalidate: false,
    });

  return {
    cart,
    error,
    isLoading,
    count: cart?.itemCount ?? 0,
    refresh: () => mutate(),
    addItem: (variantId: string, quantity = 1) =>
      run(() => api<CartDto>('/cart/items', { method: 'POST', body: { variantId, quantity } })),
    updateQuantity: (itemId: string, quantity: number) =>
      run(
        () => api<CartDto>(`/cart/items/${itemId}`, { method: 'PATCH', body: { quantity } }),
        (c) =>
          withItems(
            c,
            c.items.map((i) =>
              i.id === itemId ? { ...i, quantity, lineTotal: i.unitPrice * quantity } : i,
            ),
          ),
      ),
    removeItem: (itemId: string) =>
      run(
        () => api<CartDto>(`/cart/items/${itemId}`, { method: 'DELETE' }),
        (c) =>
          withItems(
            c,
            c.items.filter((i) => i.id !== itemId),
            c.savedItems.filter((i) => i.id !== itemId),
          ),
      ),
    saveForLater: (itemId: string) =>
      run(
        () => api<CartDto>(`/cart/items/${itemId}/save-for-later`, { method: 'POST' }),
        (c) => {
          const item = c.items.find((i) => i.id === itemId);
          return item
            ? withItems(
                c,
                c.items.filter((i) => i.id !== itemId),
                [{ ...item, savedForLater: true }, ...c.savedItems],
              )
            : c;
        },
      ),
    moveToCart: (itemId: string) =>
      run(
        () => api<CartDto>(`/cart/items/${itemId}/move-to-cart`, { method: 'POST' }),
        (c) => {
          const item = c.savedItems.find((i) => i.id === itemId);
          return item
            ? withItems(
                c,
                [...c.items, { ...item, savedForLater: false }],
                c.savedItems.filter((i) => i.id !== itemId),
              )
            : c;
        },
      ),
    applyCoupon: (code: string) =>
      run(() =>
        api<CartDto>('/cart/coupon', { method: 'POST', body: { code: code.trim().toUpperCase() } }),
      ),
    removeCoupon: () => run(() => api<CartDto>('/cart/coupon', { method: 'DELETE' })),
  };
}
