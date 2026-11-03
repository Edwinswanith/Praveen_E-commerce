import type { OrderStatus } from './enums';

/** Allowed order status transitions. Anything else is rejected by the API. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: ['RETURNED'],
  CANCELLED: [],
  RETURNED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Statuses in which stock is still held as a reservation (not yet left the warehouse). */
export const RESERVED_STATUSES: OrderStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'];

/** Customer can cancel themselves only before packing. */
export const CUSTOMER_CANCELLABLE: OrderStatus[] = ['PENDING_PAYMENT', 'CONFIRMED'];

/** Return window in days after delivery. */
export const RETURN_WINDOW_DAYS = 14;
