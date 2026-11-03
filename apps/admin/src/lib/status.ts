import type { OrderStatus, PaymentStatus, ProductStatus, ReturnStatus, ReturnType, ShipmentStatus, RefundStatus } from '@vyra/shared';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'brand' | 'teal' | 'sun';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Pending payment',
  CONFIRMED: 'Confirmed',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RETURNED: 'Returned',
  RTO: 'Returned to origin (RTO)',
};

export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  PENDING_PAYMENT: 'warning',
  CONFIRMED: 'info',
  PACKED: 'info',
  SHIPPED: 'info',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'success',
  CANCELLED: 'neutral',
  RETURNED: 'danger',
  RTO: 'danger',
};

export const PRODUCT_STATUS_TONE: Record<ProductStatus, Tone> = { DRAFT: 'neutral', ACTIVE: 'success', ARCHIVED: 'warning' };

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, Tone> = {
  CREATED: 'neutral', AUTHORIZED: 'info', CAPTURED: 'success', FAILED: 'danger', REFUNDED: 'warning', PARTIALLY_REFUNDED: 'warning',
};

export const RETURN_STATUS_TONE: Record<ReturnStatus, Tone> = {
  REQUESTED: 'warning', APPROVED: 'info', REJECTED: 'neutral', RECEIVED: 'info', REFUNDED: 'success', EXCHANGED: 'success',
};

export const SHIPMENT_STATUS_TONE: Record<ShipmentStatus, Tone> = {
  PENDING: 'neutral', READY_TO_SHIP: 'info', IN_TRANSIT: 'info', OUT_FOR_DELIVERY: 'info', DELIVERED: 'success', RTO: 'danger', CANCELLED: 'neutral',
};

export const REFUND_STATUS_TONE: Record<RefundStatus, Tone> = { PENDING: 'warning', PROCESSED: 'success', FAILED: 'danger' };

export const STOCK_STATUS: Record<'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK', { label: string; tone: Tone }> = {
  IN_STOCK: { label: 'In stock', tone: 'success' },
  LOW_STOCK: { label: 'Low stock', tone: 'warning' },
  OUT_OF_STOCK: { label: 'Out of stock', tone: 'danger' },
};

export const RETURN_TYPE_LABEL: Record<ReturnType, string> = { RETURN: 'Return', EXCHANGE: 'Exchange' };
export const RETURN_TYPE_TONE: Record<ReturnType, Tone> = { RETURN: 'neutral', EXCHANGE: 'violet' };
