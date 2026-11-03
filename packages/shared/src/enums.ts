/**
 * Business status enums. These MUST stay in sync with the Prisma enums in
 * apps/api/prisma/schema.prisma (a unit test in the API asserts parity).
 */
export const RoleName = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  INVENTORY_MANAGER: 'INVENTORY_MANAGER',
  ORDER_MANAGER: 'ORDER_MANAGER',
  CUSTOMER: 'CUSTOMER',
} as const;
export type RoleName = (typeof RoleName)[keyof typeof RoleName];

export const STAFF_ROLES: RoleName[] = ['SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER', 'ORDER_MANAGER'];

export const ProductStatus = { DRAFT: 'DRAFT', ACTIVE: 'ACTIVE', ARCHIVED: 'ARCHIVED' } as const;
export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];

export const Gender = { MEN: 'MEN', WOMEN: 'WOMEN', KIDS: 'KIDS', UNISEX: 'UNISEX' } as const;
export type Gender = (typeof Gender)[keyof typeof Gender];

export const BarcodeSymbology = { EAN13: 'EAN13', CODE128: 'CODE128', QR: 'QR' } as const;
export type BarcodeSymbology = (typeof BarcodeSymbology)[keyof typeof BarcodeSymbology];

export const InventoryMovementType = {
  STOCK_IN: 'STOCK_IN',
  STOCK_OUT: 'STOCK_OUT',
  ADJUSTMENT: 'ADJUSTMENT',
  RESERVATION: 'RESERVATION',
  RELEASE: 'RELEASE',
  FULFILLMENT: 'FULFILLMENT',
  RETURN_RESTOCK: 'RETURN_RESTOCK',
} as const;
export type InventoryMovementType = (typeof InventoryMovementType)[keyof typeof InventoryMovementType];

/** Movements a staff member may record manually (others are system-generated). */
export const MANUAL_MOVEMENT_TYPES = ['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT'] as const;

export const OrderStatus = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  PACKED: 'PACKED',
  SHIPPED: 'SHIPPED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  RETURNED: 'RETURNED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const PaymentStatus = {
  CREATED: 'CREATED',
  AUTHORIZED: 'AUTHORIZED',
  CAPTURED: 'CAPTURED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentMethod = { ONLINE: 'ONLINE', COD: 'COD' } as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const ShipmentStatus = {
  PENDING: 'PENDING',
  READY_TO_SHIP: 'READY_TO_SHIP',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  RTO: 'RTO',
  CANCELLED: 'CANCELLED',
} as const;
export type ShipmentStatus = (typeof ShipmentStatus)[keyof typeof ShipmentStatus];

export const ReturnStatus = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  RECEIVED: 'RECEIVED',
  REFUNDED: 'REFUNDED',
} as const;
export type ReturnStatus = (typeof ReturnStatus)[keyof typeof ReturnStatus];

export const RefundStatus = { PENDING: 'PENDING', PROCESSED: 'PROCESSED', FAILED: 'FAILED' } as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

export const CouponType = { PERCENTAGE: 'PERCENTAGE', FIXED: 'FIXED' } as const;
export type CouponType = (typeof CouponType)[keyof typeof CouponType];

export const ScanMode = {
  IDENTIFY: 'IDENTIFY',
  RECEIVE: 'RECEIVE',
  ADJUST: 'ADJUST',
  DISPATCH: 'DISPATCH',
  RETURN: 'RETURN',
} as const;
export type ScanMode = (typeof ScanMode)[keyof typeof ScanMode];

export const EmbeddingKind = { TEXT: 'TEXT', IMAGE: 'IMAGE' } as const;
export type EmbeddingKind = (typeof EmbeddingKind)[keyof typeof EmbeddingKind];

export const EmbeddingJobStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type EmbeddingJobStatus = (typeof EmbeddingJobStatus)[keyof typeof EmbeddingJobStatus];
