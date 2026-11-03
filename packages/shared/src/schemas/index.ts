import { z } from 'zod';

const trimmed = (min = 1, max = 200) => z.string().trim().min(min).max(max);
export const slugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens');
const money = z.coerce.number().nonnegative().max(10_000_000).multipleOf(0.01);
export const cuid = z.string().min(1).max(64);

// ---------- Auth ----------
export const passwordSchema = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/\d/, 'Must contain a number');

export const registerSchema = z.object({
  name: trimmed(2, 80),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number').optional(),
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const indianMobileSchema = z.string().trim().transform((v) => v.replace(/^(\+91|0)/, '').replace(/[\s-]/g, '')).pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'));

export const otpRequestSchema = z.object({ phone: indianMobileSchema });
export const otpVerifySchema = z.object({
  phone: indianMobileSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  /** Required only when creating a new account. */
  name: z.string().trim().min(2).max(80).optional(),
  marketingOptIn: z.boolean().optional(),
});
export const codConfirmSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });

export const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) });
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });
export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });
export const updateProfileSchema = z.object({
  name: trimmed(2, 80).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  marketingOptIn: z.boolean().optional(),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/).optional().nullable(),
});

// ---------- Address ----------
export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
] as const;

export const pincodeSchema = z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code');

export const addressSchema = z.object({
  fullName: trimmed(2, 80),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
  line1: trimmed(3, 160),
  line2: z.string().trim().max(160).optional().nullable(),
  landmark: z.string().trim().max(120).optional().nullable(),
  city: trimmed(2, 80),
  state: z.enum(INDIAN_STATES),
  pincode: pincodeSchema,
  type: z.enum(['HOME', 'WORK', 'OTHER']).default('HOME'),
  isDefault: z.boolean().default(false),
});
export type AddressInput = z.infer<typeof addressSchema>;

// ---------- Catalog ----------
export const categorySchema = z.object({
  name: trimmed(2, 80),
  slug: slugSchema,
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, '3-letter code used in SKUs'),
  parentId: cuid.optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  imageUrl: z.string().url().optional().nullable(),
  bannerUrl: z.string().url().optional().nullable(),
  seoTitle: z.string().max(70).optional().nullable(),
  seoDescription: z.string().max(170).optional().nullable(),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});
export type CategoryInput = z.infer<typeof categorySchema>;

export const variantSchema = z
  .object({
    id: cuid.optional(),
    color: trimmed(2, 40),
    colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
    size: trimmed(1, 12),
    mrp: money,
    price: money,
    costPrice: money.optional().nullable(),
    weightGrams: z.coerce.number().int().positive().max(50_000).default(300),
    lowStockThreshold: z.coerce.number().int().min(0).max(10_000).default(5),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.price <= v.mrp, { message: 'Selling price cannot exceed MRP', path: ['price'] });
export type VariantInput = z.infer<typeof variantSchema>;

export const productAttributesSchema = z.object({
  fabric: z.string().max(80).optional(),
  fit: z.string().max(40).optional(),
  occasion: z.string().max(40).optional(),
  pattern: z.string().max(40).optional(),
  sleeve: z.string().max(40).optional(),
  neck: z.string().max(40).optional(),
  season: z.string().max(40).optional(),
  care: z.string().max(300).optional(),
}).catchall(z.string().max(200));

export const productSchema = z.object({
  name: trimmed(3, 150),
  slug: slugSchema.optional(),
  description: z.string().trim().min(10).max(5000),
  brand: trimmed(1, 60).default('VYRA'),
  gender: z.enum(['MEN', 'WOMEN', 'KIDS', 'UNISEX']),
  categoryId: cuid,
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
  tags: z.array(z.string().trim().toLowerCase().max(30)).max(20).default([]),
  attributes: productAttributesSchema.default({}),
  sizeChart: z.record(z.string(), z.record(z.string(), z.string())).optional().nullable(),
  hsnCode: z.string().regex(/^\d{4,8}$/).default('6109'),
  isFeatured: z.boolean().default(false),
  seoTitle: z.string().max(70).optional().nullable(),
  seoDescription: z.string().max(170).optional().nullable(),
  variants: z.array(variantSchema).min(1, 'Add at least one size/colour variant').max(200),
});
export type ProductInput = z.infer<typeof productSchema>;
export const productUpdateSchema = productSchema.partial().extend({ variants: z.array(variantSchema).max(200).optional() });

export const productListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  gender: z.enum(['MEN', 'WOMEN', 'KIDS', 'UNISEX']).optional(),
  sizes: z.string().optional(),
  colors: z.string().optional(),
  brands: z.string().optional(),
  fabric: z.string().optional(),
  fit: z.string().optional(),
  occasion: z.string().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  inStock: z.enum(['true', 'false']).optional(),
  featured: z.enum(['true', 'false']).optional(),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc', 'discount', 'popularity', 'rating']).default('relevance'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

// ---------- Inventory & barcodes ----------
export const inventoryMovementSchema = z.object({
  variantId: cuid,
  type: z.enum(['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT']),
  /** STOCK_IN/STOCK_OUT: positive quantity. ADJUSTMENT: signed delta. */
  quantity: z.coerce.number().int().refine((n) => n !== 0, 'Quantity cannot be zero'),
  reason: trimmed(3, 300),
  reference: z.string().trim().max(100).optional().nullable(),
  supplierId: cuid.optional().nullable(),
  unitCost: money.optional().nullable(),
  scanId: cuid.optional().nullable(),
});
export type InventoryMovementInput = z.infer<typeof inventoryMovementSchema>;

export const scanLookupSchema = z.object({
  code: z.string().trim().min(1).max(64),
  mode: z.enum(['IDENTIFY', 'RECEIVE', 'ADJUST', 'DISPATCH', 'RETURN']),
  device: z.enum(['CAMERA', 'USB', 'BLUETOOTH', 'MANUAL']).default('MANUAL'),
  orderId: cuid.optional(),
});

export const barcodeLabelsSchema = z.object({
  items: z.array(z.object({ variantId: cuid, copies: z.coerce.number().int().min(1).max(500).default(1) })).min(1).max(500),
  format: z.enum(['A4_3x8', 'THERMAL_50x25']).default('A4_3x8'),
  symbology: z.enum(['EAN13', 'CODE128', 'QR']).default('EAN13'),
});

export const supplierSchema = z.object({
  name: trimmed(2, 120),
  contactName: z.string().max(80).optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  gstin: z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN').optional().nullable(),
  address: z.string().max(400).optional().nullable(),
});

export const purchaseOrderSchema = z.object({
  supplierId: cuid,
  reference: z.string().max(60).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  items: z.array(z.object({ variantId: cuid, quantity: z.coerce.number().int().positive(), unitCost: money })).min(1),
});

// ---------- Cart / checkout ----------
export const addToCartSchema = z.object({ variantId: cuid, quantity: z.coerce.number().int().min(1).max(10).default(1) });
export const updateCartItemSchema = z.object({ quantity: z.coerce.number().int().min(1).max(10) });
export const applyCouponSchema = z.object({ code: z.string().trim().toUpperCase().min(3).max(30) });

export const checkoutSchema = z.object({
  addressId: cuid.optional(),
  address: addressSchema.optional(),
  guestEmail: z.string().email().optional(),
  shippingMethod: z.enum(['STANDARD', 'EXPRESS']).default('STANDARD'),
  paymentMethod: z.enum(['ONLINE', 'COD']),
  couponCode: z.string().trim().toUpperCase().max(30).optional().nullable(),
  /** Client-generated UUID; resubmitting with the same key returns the same order. */
  idempotencyKey: z.string().uuid(),
}).refine((v) => v.addressId || v.address, { message: 'Delivery address is required', path: ['address'] });
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const verifyPaymentSchema = z.object({
  orderId: cuid,
  providerOrderId: z.string().min(1).max(100),
  providerPaymentId: z.string().min(1).max(100),
  signature: z.string().min(1).max(200),
});

// ---------- Orders ----------
export const orderStatusUpdateSchema = z.object({
  status: z.enum(['CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED', 'RTO']),
  note: z.string().max(500).optional(),
});
export const cancelOrderSchema = z.object({ reason: trimmed(3, 300) });
export const shipmentCreateSchema = z.object({
  provider: z.enum(['MANUAL', 'SHIPROCKET']).default('MANUAL'),
  courierName: z.string().max(80).optional(),
  trackingNumber: z.string().max(80).optional(),
  trackingUrl: z.string().url().optional(),
});
export const returnRequestSchema = z.object({
  orderId: cuid,
  type: z.enum(['RETURN', 'EXCHANGE']).default('RETURN'),
  reason: z.enum(['SIZE_ISSUE', 'DAMAGED', 'WRONG_ITEM', 'QUALITY', 'NOT_AS_DESCRIBED', 'OTHER']),
  comments: z.string().max(1000).optional(),
  items: z.array(z.object({ orderItemId: cuid, quantity: z.coerce.number().int().positive(), exchangeVariantId: cuid.optional() })).min(1),
}).refine((r) => r.type !== 'EXCHANGE' || r.items.every((i) => i.exchangeVariantId), { message: 'Choose the size/colour you want for each exchanged item', path: ['items'] });
export const returnDecisionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'RECEIVE', 'REFUND']),
  note: z.string().max(500).optional(),
  restock: z.boolean().default(true),
});

// ---------- Coupons / reviews ----------
export const couponSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,30}$/),
  description: z.string().max(200).optional().nullable(),
  type: z.enum(['PERCENTAGE', 'FIXED']),
  value: z.coerce.number().positive(),
  maxDiscount: money.optional().nullable(),
  minOrderValue: money.optional().nullable(),
  startsAt: z.coerce.date().optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
  usageLimit: z.coerce.number().int().positive().optional().nullable(),
  perUserLimit: z.coerce.number().int().positive().default(1),
  categoryIds: z.array(cuid).default([]),
  isActive: z.boolean().default(true),
}).refine((c) => c.type !== 'PERCENTAGE' || c.value <= 90, { message: 'Percentage cannot exceed 90%', path: ['value'] });

export const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  fit: z.enum(['RUNS_SMALL', 'TRUE_TO_SIZE', 'RUNS_LARGE']).optional(),
  sizePurchased: z.string().trim().max(12).optional(),
  title: z.string().trim().max(100).optional(),
  body: z.string().trim().max(2000).optional(),
});

export const staffUserSchema = z.object({
  name: trimmed(2, 80),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  role: z.enum(['ADMIN', 'INVENTORY_MANAGER', 'ORDER_MANAGER']),
});

export const codPincodeSchema = z.object({ pincode: pincodeSchema, reason: z.string().trim().max(200).optional() });
export const codRiskUpdateSchema = z.object({ codBlocked: z.boolean(), note: z.string().trim().max(300).optional() });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().max(200).optional(),
});
