/**
 * Admin-only response shapes that are NOT defined in @vyra/shared types.ts.
 * Fields are read defensively; see the final report for contract gaps.
 */
import type { AddressDto, CustomerSummaryDto, OrderSummaryDto, RoleName, ScanMode } from '@vyra/shared';

export interface SupplierDto {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  address: string | null;
  isActive?: boolean;
  createdAt?: string;
}

export type PurchaseOrderStatus = 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED' | string;

export interface PurchaseOrderItemDto {
  id: string;
  variantId: string;
  sku: string;
  productName: string;
  color?: string;
  size?: string;
  quantity: number;
  receivedQuantity: number;
  unitCost: number;
}

export interface PurchaseOrderDto {
  id: string;
  number?: string;
  reference: string | null;
  status: PurchaseOrderStatus;
  supplier?: { id: string; name: string } | null;
  supplierName?: string;
  notes?: string | null;
  totalCost?: number;
  orderedAt?: string;
  items?: PurchaseOrderItemDto[];
  itemCount?: number;
  createdAt?: string;
  receivedAt?: string | null;
}

export interface ScanHistoryRow {
  id: string;
  code: string;
  mode: ScanMode;
  device: string;
  found: boolean;
  sku?: string | null;
  productName?: string | null;
  variant?: { sku: string; productName: string } | null;
  actorName?: string | null;
  orderNumber?: string | null;
  createdAt: string;
}

export interface CustomerDetailDto extends Omit<CustomerSummaryDto, 'orders' | 'totalSpent' | 'lastOrderAt'> {
  totalSpent?: number;
  lastOrderAt?: string | null;
  /** Count (summary shape) or a list of orders (detail shape) — both handled. */
  orders: number | OrderSummaryDto[];
  emailVerified?: boolean;
  addresses?: AddressDto[];
  recentOrders?: OrderSummaryDto[];
  stats?: { orders: number; totalSpent: number; returns: number };
  lastLoginAt?: string | null;
}

export interface StaffUserDto {
  id: string;
  name: string;
  email: string;
  role: RoleName;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
}

export interface AuditLogDto {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorName?: string | null;
  actor?: { name: string; email: string } | null;
  ip?: string | null;
  before?: unknown;
  after?: unknown;
  createdAt: string;
}

export interface SalesAnalyticsDto {
  series: { period: string; revenue: number; orders: number; units: number; aov: number }[];
  totals: { revenue: number; orders: number; units: number; aov: number } & Record<string, number>;
}
export interface ProductAnalyticsRow { productId: string; name: string; units: number; revenue: number; returns: number }
export interface InventoryAnalyticsDto { valuationCost: number; valuationRetail: number; byCategory: { category: string; units: number; value: number }[] }

export interface ImportResultDto { created: number; updated: number; errors: { row: number; message: string }[] }

export interface InventorySummary { units: number; reserved: number; available: number; valuation: number; retailValue?: number; lowStock: number; outOfStock: number }

export interface DispatchLine { variantId: string; sku: string; expected: number; scanned: number }
export type AdminOrderDetail = import('@vyra/shared').OrderDetailDto & {
  customer: { id: string; name: string; email: string; phone: string | null } | null;
  dispatch: DispatchLine[];
};

export interface CancellationReport { total: number; cancelled: number; /** percent, e.g. 12.5 */ rate: number; byReason: { reason: string; count: number; value: number }[] }
export interface ReturnsReport { requests: number; refunded: number; byReason: { reason: string; status: string; count: number }[] }
