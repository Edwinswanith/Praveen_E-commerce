/**
 * Admin-only response shapes that are NOT defined in @vyra/shared types.ts.
 * Shared admin DTOs (SupplierDto, StaffUserDto, AuditLogDto, CustomerDetailDto, ScanHistoryDto,
 * PurchaseOrderSummaryDto, Cod*) are imported from @vyra/shared directly.
 */
import type { PurchaseOrderSummaryDto, SupplierDto } from '@vyra/shared';

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

/** GET /admin/purchase-orders/:id */
export type { PurchaseOrderDetailDto } from '@vyra/shared';

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
  customer: { id: string; name: string; email: string | null; phone: string | null } | null;
  dispatch: DispatchLine[];
};

export interface CancellationReport { total: number; cancelled: number; /** percent, e.g. 12.5 */ rate: number; byReason: { reason: string; count: number; value: number }[] }
export interface ReturnsReport { requests: number; refunded: number; byReason: { reason: string; status: string; count: number }[] }

/** GET /api/v1/admin/system/health (staff only; the public /health has no configuration details) */
export type { HealthDto } from '@vyra/shared';

// ---------- Campaigns ----------
// Not in @vyra/shared yet: shapes mirror CampaignsService.toPromotionDto / preview / bulkPrices.

/** GET /admin/promotions (bundle offers such as "Buy 2, extra 10% off"). */
export interface PromotionAdminDto {
  id: string; campaignId: string | null; name: string; minQuantity: number; percentOff: number; maxDiscount: number | null;
  categoryIds: string[]; productIds: string[]; startsAt: string | null; endsAt: string | null;
  isActive: boolean; usageLimit: number | null; usedCount: number; createdAt: string;
}

/** GET /admin/campaigns/:id/preview?at= */
export interface CampaignPreviewDto {
  at: string;
  campaign: import('@vyra/shared').CampaignPublicDto;
  salePriceApplies: boolean;
  earlyAccessApplies: boolean;
}

/** POST /admin/campaigns/:id/prices/bulk */
export interface CampaignBulkResultDto {
  rows: import('@vyra/shared').CampaignPriceRowDto[];
  applied: number;
  skippedBelowCost: number;
}

/** GET /admin/inventory/reconcile (not in @vyra/shared). CLAUDE.md rule 14: must always be consistent. */
export interface StockDrift { variantId: string; sku: string; onHand: number; ledgerOnHand: number; reserved: number; ledgerReserved: number }
export interface ReconcileResult { checkedVariants: number; consistent: boolean; drift: StockDrift[]; checkedAt: string }

/** POST /admin/barcodes/generate-missing (not in @vyra/shared). */
export interface GenerateMissingBarcodesResult { generated: number }
