/**
 * API contract: response shapes returned by /api/v1. Money fields are rupees
 * as numbers with at most 2 decimals (computed server-side from paise).
 * Dates are ISO-8601 strings.
 */
import type {
  BarcodeSymbology, Gender, InventoryMovementType, OrderStatus, PaymentMethod, PaymentStatus,
  ProductStatus, RefundStatus, ReturnStatus, RoleName, ShipmentStatus,
} from './enums';

export interface ApiSuccess<T> { data: T; meta?: PageMeta }
export interface ApiErrorBody { error: { code: string; message: string; details?: unknown; requestId?: string } }
export interface PageMeta { page: number; pageSize: number; total: number; totalPages: number }
export interface Paginated<T> { items: T[]; meta: PageMeta }

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
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
}

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
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: string;
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
  shippingFee: number;
  codFee: number;
  taxTotal: number;
  grandTotal: number;
  codAvailable: boolean;
  freeShippingThreshold: number;
}

export interface CartDto {
  id: string;
  items: CartItemDto[];
  savedItems: CartItemDto[];
  couponCode: string | null;
  couponError: string | null;
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
  shippingFee: number;
  codFee: number;
  taxTotal: number;
  shippingMethod: 'STANDARD' | 'EXPRESS';
  events: OrderEventDto[];
  payments: PaymentDto[];
  refunds: RefundDto[];
  shipment: ShipmentDto | null;
  returns: ReturnRequestDto[];
  canCancel: boolean;
  canReturn: boolean;
}

export interface CheckoutResponse {
  order: OrderDetailDto;
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
  reason: string;
  comments: string | null;
  refundAmount: number;
  items: { orderItemId: string; name: string; sku: string; quantity: number }[];
  createdAt: string;
}

export interface WishlistItemDto { id: string; product: ProductCardDto; addedAt: string }

export interface ReviewDto { id: string; rating: number; title: string | null; body: string | null; authorName: string; verifiedPurchase: boolean; createdAt: string }

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

export interface CustomerSummaryDto { id: string; name: string; email: string; phone: string | null; orders: number; totalSpent: number; lastOrderAt: string | null; createdAt: string }

export interface CouponDto {
  id: string; code: string; description: string | null; type: 'PERCENTAGE' | 'FIXED'; value: number;
  maxDiscount: number | null; minOrderValue: number | null; startsAt: string | null; expiresAt: string | null;
  usageLimit: number | null; perUserLimit: number; usedCount: number; categoryIds: string[]; isActive: boolean;
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
