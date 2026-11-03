/**
 * API contract: response shapes returned by /api/v1. Money fields are rupees
 * as numbers with at most 2 decimals (computed server-side from paise).
 * Dates are ISO-8601 strings.
 */
import type {
  BarcodeSymbology, CodConfirmation, FitFeedback, Gender, ReturnType, InventoryMovementType, OrderStatus, PaymentMethod, PaymentStatus,
  ProductStatus, RefundStatus, ReturnStatus, RoleName, ShipmentStatus,
} from './enums';

export interface ApiSuccess<T> { data: T; meta?: PageMeta }
export interface ApiErrorBody { error: { code: string; message: string; details?: unknown; requestId?: string } }
export interface PageMeta { page: number; pageSize: number; total: number; totalPages: number }
export interface Paginated<T> { items: T[]; meta: PageMeta }

export interface SessionUser {
  id: string;
  name: string;
  /** null for phone-only accounts */
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  marketingOptIn: boolean;
  role: RoleName;
  permissions: string[];
}

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  code: string;
  parentId: string | null;
  description: string | null;
  imageUrl: string | null;
  bannerUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  isActive: boolean;
  sortOrder: number;
  productCount?: number;
  children: CategoryNode[];
}

export interface ProductImageDto {
  id: string;
  url: string;
  thumbUrl: string;
  alt: string;
  color: string | null;
  sortOrder: number;
  width: number | null;
  height: number | null;
  /** AI-generated/styled image: storefront shows a disclosure. */
  aiGenerated: boolean;
}

export interface ProductVideoDto { id: string; url: string; posterUrl: string | null }

export interface VariantDto {
  id: string;
  sku: string;
  color: string;
  colorHex: string | null;
  size: string;
  mrp: number;
  price: number;
  discountPercent: number;
  available: number;
  inStock: boolean;
  isActive: boolean;
  barcode: string | null;
  /** Regular price without campaigns (price < basePrice while a sale applies). */
  basePrice: number;
  campaign: CampaignBadgeDto | null;
}

/** Which live campaign priced this item, for badges and countdowns. */
export interface CampaignBadgeDto { id: string; name: string; slug: string; endsAt: string }

export interface ProductCardDto {
  id: string;
  slug: string;
  name: string;
  brand: string;
  gender: Gender;
  categorySlug: string;
  imageUrl: string | null;
  hoverImageUrl: string | null;
  minPrice: number;
  minMrp: number;
  discountPercent: number;
  colors: { name: string; hex: string | null }[];
  sizes: string[];
  inStock: boolean;
  rating: number | null;
  reviewCount: number;
  badges: string[];
  /** Live campaign pricing this card's lowest price, if any. */
  campaign: CampaignBadgeDto | null;
  /** Present on semantic/visual search results: 0..1 similarity. */
  score?: number;
}

export interface ProductDetailDto extends Omit<ProductCardDto, 'imageUrl' | 'hoverImageUrl'> {
  description: string;
  status: ProductStatus;
  category: { id: string; name: string; slug: string; path: { name: string; slug: string }[] };
  tags: string[];
  attributes: Record<string, string>;
  sizeChart: Record<string, Record<string, string>> | null;
  hsnCode: string;
  images: ProductImageDto[];
  videos: ProductVideoDto[];
  variants: VariantDto[];
  /** Aggregated from reviews: how the product fits. */
  fit: FitSummaryDto;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: string;
}

export interface FitSummaryDto {
  runsSmall: number;
  trueToSize: number;
  runsLarge: number;
  total: number;
  /** Plain-language advice, e.g. "Most buyers say it runs small — consider one size up." null when too few reviews. */
  advice: string | null;
}

/**
 * Live deal summary for promotional banners. Computed from IN-STOCK products
 * only, using the same discount shown on product cards, so a banner can never
 * advertise a discount a shopper can't actually buy.
 */
export interface DealsSummaryDto {
  /** Highest card discount among in-stock products (0 when none). */
  maxDiscountPercent: number;
  /** In-stock products discounted by at least DEAL_MIN_DISCOUNT (see pricing.ts). */
  productCount: number;
}

export interface HomeDto {
  trending: ProductCardDto[];
  newArrivals: ProductCardDto[];
  bestSellers: ProductCardDto[];
  featured: ProductCardDto[];
  categories: CategoryNode[];
  deals: DealsSummaryDto;
}

export interface ProductFacets {
  categories: { slug: string; name: string; count: number }[];
  sizes: { value: string; count: number }[];
  colors: { value: string; hex: string | null; count: number }[];
  brands: { value: string; count: number }[];
  fabrics: { value: string; count: number }[];
  fits: { value: string; count: number }[];
  occasions: { value: string; count: number }[];
  price: { min: number; max: number };
}

export interface ProductListResponse { items: ProductCardDto[]; meta: PageMeta; facets: ProductFacets }

export interface SearchResponse {
  items: ProductCardDto[];
  meta: PageMeta;
  /** How the query was understood: extracted filters + whether vectors were used. */
  interpretation: { semanticText: string; filters: Record<string, unknown>; mode: 'semantic' | 'keyword' | 'visual' | 'hybrid'; model: string | null };
}

export interface CartItemDto {
  id: string;
  variantId: string;
  productId: string;
  productSlug: string;
  name: string;
  brand: string;
  imageUrl: string | null;
  color: string;
  size: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  unitMrp: number;
  lineTotal: number;
  available: number;
  /** false when the variant is out of stock / inactive or quantity exceeds availability. */
  purchasable: boolean;
  savedForLater: boolean;
}

export interface CartTotalsDto {
  mrpTotal: number;
  subtotal: number;
  productDiscount: number;
  couponDiscount: number;
  /** Bundle promotion ("Buy 2, extra 10% off") applied, if any. */
  promotionDiscount: number;
  promotionName: string | null;
  /** Part of the product discount that comes from live campaign prices. */
  campaignSavings: number;
  /** Explains which offer won when offers can't combine. */
  offerNote: string | null;
  /** Discount for paying online (0 for COD / quotes without a payment method). */
  prepaidDiscount: number;
  /** What the prepaid discount would be if paying online (for the "save ₹x by paying online" nudge). */
  prepaidSavings: number;
  shippingFee: number;
  codFee: number;
  taxTotal: number;
  grandTotal: number;
  codAvailable: boolean;
  /** Why COD is unavailable, when it is. */
  codUnavailableReason: string | null;
  freeShippingThreshold: number;
}

export interface CartDto {
  id: string;
  items: CartItemDto[];
  savedItems: CartItemDto[];
  couponCode: string | null;
  couponError: string | null;
  /** The coupon was picked automatically (no code entered). */
  couponAutoApplied: boolean;
  totals: CartTotalsDto;
  itemCount: number;
}

export interface AddressDto {
  id: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  type: 'HOME' | 'WORK' | 'OTHER';
  isDefault: boolean;
}

export interface OrderItemDto {
  id: string;
  variantId: string;
  productSlug: string;
  name: string;
  sku: string;
  color: string;
  size: string;
  imageUrl: string | null;
  quantity: number;
  unitPrice: number;
  unitMrp: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
  returnedQuantity: number;
}

export interface OrderEventDto { status: OrderStatus; note: string | null; createdAt: string; actor: string | null }

export interface ShipmentDto {
  id: string;
  provider: 'MANUAL' | 'SHIPROCKET';
  status: ShipmentStatus;
  courierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  events: { status: string; location: string | null; description: string | null; occurredAt: string }[];
}

export interface PaymentDto {
  id: string;
  provider: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  createdAt: string;
}

export interface RefundDto { id: string; amount: number; status: RefundStatus; reason: string | null; providerRefundId: string | null; createdAt: string }

export interface OrderSummaryDto {
  id: string;
  number: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus | null;
  codConfirmation: CodConfirmation;
  grandTotal: number;
  itemCount: number;
  customerName: string;
  customerEmail: string;
  createdAt: string;
  previewImages: string[];
}

export interface OrderDetailDto extends OrderSummaryDto {
  items: OrderItemDto[];
  shippingAddress: Omit<AddressDto, 'id' | 'isDefault'>;
  mrpTotal: number;
  subtotal: number;
  couponCode: string | null;
  couponDiscount: number;
  prepaidDiscount: number;
  promotionDiscount: number;
  /** Discount breakdown from the order's discount ledger. */
  savings: { campaign: number; promotion: number; coupon: number; prepaid: number };
  shippingFee: number;
  codFee: number;
  taxTotal: number;
  shippingMethod: 'STANDARD' | 'EXPRESS';
  /** COD orders must be confirmed by OTP (or by staff) before they are packed. */
  codConfirmation: CodConfirmation;
  /** Set when this order is the replacement shipment of an exchange. */
  exchangeForOrderNumber: string | null;
  events: OrderEventDto[];
  payments: PaymentDto[];
  refunds: RefundDto[];
  shipment: ShipmentDto | null;
  returns: ReturnRequestDto[];
  canCancel: boolean;
  canReturn: boolean;
  /** Variants of the same products, same price, in stock: valid exchange targets per order item. */
  exchangeOptions?: Record<string, { variantId: string; color: string; size: string; available: number }[]>;
}

export interface CheckoutResponse {
  order: OrderDetailDto;
  /** COD: an OTP was sent to this masked phone; confirm with POST /orders/:number/confirm-cod. */
  codOtp: null | { phoneMasked: string; expiresInSeconds: number; resendAfterSeconds?: number; devCode?: string };
  /** Present for ONLINE payments: pass to the provider's checkout widget. */
  payment: null | {
    provider: 'razorpay' | 'mock';
    keyId: string;
    providerOrderId: string;
    amount: number; // paise, as required by Razorpay checkout
    currency: 'INR';
    name: string;
    prefill: { name: string; email: string; contact: string };
  };
}

export interface ReturnRequestDto {
  id: string;
  orderId: string;
  orderNumber: string;
  status: ReturnStatus;
  type: ReturnType;
  reason: string;
  comments: string | null;
  refundAmount: number;
  replacementOrderNumber: string | null;
  items: { orderItemId: string; name: string; sku: string; quantity: number; color: string; size: string; exchangeFor: { variantId: string; sku: string; color: string; size: string } | null }[];
  createdAt: string;
}

export interface WishlistItemDto { id: string; product: ProductCardDto; addedAt: string }

export interface ReviewDto {
  id: string; rating: number; title: string | null; body: string | null; authorName: string; verifiedPurchase: boolean; createdAt: string;
  fit: FitFeedback | null; sizePurchased: string | null; images: { id: string; url: string; thumbUrl: string }[];
}

export interface InventoryRowDto {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  barcode: string | null;
  color: string;
  size: string;
  onHand: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  costPrice: number | null;
  price: number;
  stockValue: number;
  updatedAt: string;
}

export interface InventoryMovementDto {
  id: string;
  variantId: string;
  sku: string;
  productName: string;
  type: InventoryMovementType;
  quantity: number;
  onHandAfter: number;
  reservedAfter: number;
  reason: string | null;
  reference: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface ScanResultDto {
  scanId: string;
  found: boolean;
  code: string;
  symbology: BarcodeSymbology | null;
  variant: null | {
    id: string; sku: string; color: string; size: string; price: number; mrp: number;
    productId: string; productName: string; imageUrl: string | null;
    onHand: number; reserved: number; available: number;
  };
  /** DISPATCH mode: whether the scanned variant belongs to the order and how many remain to scan. */
  dispatch?: { orderId: string; matches: boolean; expected: number; scanned: number };
}

export interface DashboardDto {
  revenue: { total: number; today: number; last30Days: number };
  orders: { total: number; pending: number; today: number };
  customers: { total: number; newLast30Days: number };
  catalog: { products: number; activeProducts: number; variants: number };
  inventory: { totalUnits: number; reservedUnits: number; lowStock: number; outOfStock: number; valuation: number };
  revenueSeries: { date: string; revenue: number; orders: number }[];
  bestSellers: { productId: string; name: string; units: number; revenue: number; imageUrl: string | null }[];
  categoryPerformance: { category: string; revenue: number; units: number }[];
  recentOrders: OrderSummaryDto[];
}

export interface CustomerSummaryDto { id: string; name: string; email: string | null; phone: string | null; orders: number; totalSpent: number; lastOrderAt: string | null; createdAt: string }

export interface CouponDto {
  id: string; code: string; description: string | null; type: 'PERCENTAGE' | 'FIXED'; value: number;
  maxDiscount: number | null; minOrderValue: number | null; startsAt: string | null; expiresAt: string | null;
  usageLimit: number | null; perUserLimit: number; usedCount: number; categoryIds: string[]; isActive: boolean;
  autoApply: boolean; combinableWithPromotions: boolean; campaignId: string | null;
}

export interface EmbeddingStatusDto {
  provider: string; model: string; dimensions: number; configured: boolean;
  counts: { pending: number; processing: number; completed: number; failed: number };
  productsIndexed: number; productsTotal: number;
}

export interface AdminProductRow {
  id: string; name: string; slug: string; brand: string; status: ProductStatus; categoryName: string;
  imageUrl: string | null; variantCount: number; totalStock: number; minPrice: number; maxPrice: number;
  isFeatured: boolean; updatedAt: string;
}

export interface AdminVariantDto extends VariantDto {
  costPrice: number | null; weightGrams: number; lowStockThreshold: number; onHand: number; reserved: number;
  barcodes: { symbology: BarcodeSymbology; value: string }[];
}

export interface AdminProductDetailDto extends Omit<ProductDetailDto, 'variants'> {
  variants: AdminVariantDto[];
  isFeatured: boolean;
  categoryId: string;
  embedding: { text: boolean; images: number; status: string | null; model: string | null };
}

export interface HealthDto {
  status: 'ok' | 'degraded';
  db: boolean;
  redis: boolean;
  version: string;
  /** "configured" | "pending" | provider description, per integration. */
  integrations: { payments: string; cod: boolean; shipping: string; email: string; sms: string; whatsapp: string; embeddings: string; storage: string };
}

export interface PurchaseOrderDetailDto {
  id: string; number: string; status: PurchaseOrderSummaryDto['status']; reference: string | null; notes: string | null; totalCost: number;
  orderedAt: string; receivedAt: string | null; supplier: SupplierDto;
  items: { id: string; variantId: string; sku: string; productName: string; color: string; size: string; quantity: number; receivedQuantity: number; unitCost: number }[];
}

export interface CampaignPublicDto {
  id: string;
  slug: string;
  name: string;
  edition: string | null;
  festival: string | null;
  description: string | null;
  phase: import('./campaigns').CampaignPhase;
  teaserStartsAt: string | null;
  earlyAccessStartsAt: string | null;
  startsAt: string;
  endsAt: string;
  /** The end was moved later after publishing (always disclosed). */
  extended: boolean;
  originalEndsAt: string | null;
  /** Next phase change, the only valid countdown target. */
  countdownTo: string | null;
  banner: { title: string | null; subtitle: string | null; imageUrl: string | null; themeColor: string | null };
  /** Computed from in-stock campaign prices (rounded down). null = no % claim. */
  claim: { upToPercent: number | null; productCount: number };
  promotions: { id: string; name: string; minQuantity: number; percentOff: number }[];
  /** This viewer can shop early access now. */
  hasEarlyAccess: boolean;
  subscribed: boolean;
}

export interface CampaignAdminDto extends CampaignPublicDto {
  status: import('./campaigns').CampaignStatus;
  priority: number;
  budget: number | null;
  budgetUsed: number;
  priceCount: number;
  subscriberCount: number;
  publishedAt: string | null;
  createdAt: string;
}

export interface CampaignPriceRowDto {
  variantId: string; productId: string; productName: string; sku: string; color: string; size: string; imageUrl: string | null;
  mrp: number; regularPrice: number; costPrice: number | null; salePrice: number; percentOffRegular: number; percentOffMrp: number;
  stockCap: number | null; soldCount: number; perCustomerLimit: number | null; available: number;
  warnings: string[];
}

export interface CampaignChecklistDto { ready: boolean; problems: { level: 'error' | 'warning'; message: string }[] }

export interface CampaignReportDto {
  campaignId: string; phase: import('./campaigns').CampaignPhase;
  orders: number; units: number; revenue: number; aov: number; cancelledOrders: number; returnedUnits: number;
  discount: { campaign: number; promotion: number; coupon: number; prepaid: number; total: number };
  budget: number | null; budgetUsedPercent: number | null;
  subscribers: number;
  topProducts: { productId: string; name: string; units: number; revenue: number }[];
  sellThrough: { variantId: string; sku: string; productName: string; soldCount: number; stockCap: number | null }[];
  daily: { date: string; orders: number; revenue: number; discount: number }[];
}

export interface ReturnPreviewDto {
  /** What the customer gets back. */
  refundAmount: number;
  /** Net paid for the returned items. */
  itemsValue: number;
  /** Offers the kept items no longer qualify for. */
  deductions: { label: string; amount: number }[];
  note: string | null;
}

export interface TryOnResponse {
  /** data: URL (image/webp). Generated in memory, never stored on our servers. */
  image: string;
  color: string;
  disclaimer: string;
  remainingToday: number;
}

export interface FunnelStepDto { step: 'PRODUCT_VIEW' | 'ADD_TO_CART' | 'CHECKOUT_STARTED' | 'ORDER_PLACED'; sessions: number; rateFromPrevious: number | null; rateFromStart: number | null }

export interface FunnelDto {
  from: string;
  to: string;
  steps: FunnelStepDto[];
  /** Overall: sessions that ordered / sessions that viewed a product. */
  conversionRate: number;
  bagAbandonmentRate: number;
  checkoutAbandonmentRate: number;
  byDevice: { device: string; sessions: number; orders: number; conversionRate: number }[];
  bySource: { source: string; sessions: number; orders: number; conversionRate: number; revenue: number }[];
  products: { productId: string; name: string; views: number; addToCart: number; viewToCartRate: number; tryOns: number }[];
  tryOn: { total: number; sessions: number; sessionsThatOrdered: number; conversionRate: number; dailyLimit: number; usedToday: number };
  daily: { date: string; sessions: number; orders: number }[];
}

export interface OtpRequestResponse {
  phoneMasked: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  /** Only in development when no SMS provider is configured. Never in production. */
  devCode?: string;
}

export interface OtpVerifyResponse {
  user: SessionUser;
  isNewUser: boolean;
}

// ---------------- admin contract types (previously untyped) ----------------
export interface SupplierDto {
  id: string; name: string; contactName: string | null; email: string | null; phone: string | null; gstin: string | null; address: string | null;
  isActive: boolean; createdAt: string; updatedAt: string;
}

export interface PurchaseOrderSummaryDto {
  id: string; number: string; supplierName: string; status: 'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';
  reference: string | null; totalCost: number; itemCount: number; orderedAt: string; receivedAt: string | null;
}

export interface ScanHistoryDto {
  id: string; code: string; mode: string; device: string; found: boolean; orderId: string | null; sku: string | null;
  productName: string | null; color: string | null; size: string | null; actorName: string; createdAt: string;
}

export interface StaffUserDto extends SessionUser { isActive: boolean; lastLoginAt: string | null; createdAt: string }

export interface AuditLogDto { id: string; action: string; entity: string; entityId: string | null; actorName: string | null; before: unknown; after: unknown; createdAt: string }

export interface CustomerDetailDto {
  id: string; name: string; email: string | null; phone: string | null; emailVerified: boolean; isActive: boolean; createdAt: string; lastLoginAt: string | null;
  notes: string | null; addresses: AddressDto[]; orders: OrderSummaryDto[];
  stats: { orders: number; totalSpent: number; returns: number; rto: number };
  codRisk: CodRiskDto | null;
  recentSearches: { query: string | null; mode: string; createdAt: string }[];
}

export interface CodRiskDto { phone: string; rtoCount: number; codBlocked: boolean; note: string | null; lastRtoAt: string | null }

export interface CodSettingsDto {
  enabled: boolean;
  rtoBlockThreshold: number;
  confirmWindowHours: number;
  prepaidDiscountPercent: number;
  prepaidDiscountMax: number;
  blockedPincodes: { pincode: string; reason: string | null; createdAt: string }[];
}

export interface CodAnalyticsDto {
  codOrders: number;
  prepaidOrders: number;
  codShare: number;
  confirmedRate: number;
  autoCancelled: number;
  rtoOrders: number;
  rtoRate: number;
  rtoValue: number;
  topRtoPincodes: { pincode: string; rto: number; orders: number }[];
}

export interface ProductReturnRateDto { productId: string; name: string; unitsSold: number; unitsReturned: number; returnRate: number; topReason: string | null; exchanges: number }
