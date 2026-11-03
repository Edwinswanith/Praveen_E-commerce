import type { OrderStatus } from './enums';

/** Allowed order status transitions. Anything else is rejected by the API. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'DELIVERED', 'RTO'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'RTO'],
  DELIVERED: ['RETURNED'],
  CANCELLED: [],
  RETURNED: [],
  RTO: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Statuses in which stock is still held as a reservation (not yet left the warehouse). */
export const RESERVED_STATUSES: OrderStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'];

/** Customer can cancel themselves only before packing. */
export const CUSTOMER_CANCELLABLE: OrderStatus[] = ['PENDING_PAYMENT', 'CONFIRMED'];

/** Unconfirmed COD orders are auto-cancelled after this many hours. */
export const COD_CONFIRM_WINDOW_HOURS = 24;

/** Return window in days after delivery. */
export const RETURN_WINDOW_DAYS = 14;
