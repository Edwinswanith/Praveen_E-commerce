# VYRA API (v1)

Base path: `/api/v1`. Interactive OpenAPI docs: `http://localhost:4000/api/docs` (JSON at `/api/docs-json`).

Response shapes are defined as TypeScript interfaces in `packages/shared/src/types.ts`;
request bodies are validated by zod schemas in `packages/shared/src/schemas/index.ts`.
Both frontends import these from `@vyra/shared`, so the contract is compile-time checked.

## Conventions

| Topic | Rule |
| --- | --- |
| Success envelope | `{ "data": T, "meta"?: PageMeta }` |
| Error envelope | `{ "error": { "code": "VALIDATION_FAILED" \| "UNAUTHORIZED" \| "FORBIDDEN" \| "NOT_FOUND" \| "CONFLICT" \| "OUT_OF_STOCK" \| "RATE_LIMITED" \| "PAYMENT_FAILED" \| "BAD_REQUEST" \| "INTERNAL", "message": string, "details"?: unknown, "requestId": string } }` |
| Validation errors | `details` is `{ fieldErrors: Record<string, string[]>, formErrors: string[] }` |
| Pagination | `?page=1&pageSize=20` → `meta: { page, pageSize, total, totalPages }`. Paginated endpoints return `data: T[]` + `meta`. |
| Money | Rupees as JSON numbers (max 2 decimals). Computed server-side from integer paise. Never trust client prices. |
| Dates | ISO-8601 UTC strings. |
| Auth (customer) | httpOnly cookies `vyra_at` (JWT, 15 min) and `vyra_rt` (rotating refresh token, 30 days, path `/api/v1/auth`). On `401`, call `POST /auth/refresh` once and retry. |
| Auth (staff) | Separate cookies `vyra_staff_at` / `vyra_staff_rt` issued by `/admin/auth/*`. Every staff endpoint lives under `/api/v1/admin/**`. A customer session can never reach admin endpoints. |
| Bearer tokens | `Authorization: Bearer <access JWT>` is also accepted (for scripts/mobile). |
| CSRF | Cookies are `SameSite=Lax`; every state-changing request must send header `X-Requested-With: vyra` (enforced). Frontends call the API through their own Next.js rewrite (`/api/v1/* → API`), so cookies are first-party. |
| Guest cart | Cookie `vyra_cart` (opaque id). Merged into the customer cart on login/register. |
| Idempotency | `POST /checkout` requires `idempotencyKey` (UUID). Webhooks are deduplicated by provider event id. |
| Rate limits | Global 120 req/min/IP; auth endpoints 10/min; visual search 20/min. `429` → `RATE_LIMITED`. |

## Public & customer endpoints

### Health
- `GET /health` → `{ status: "ok", db: boolean, redis: boolean, version }`

### Auth
- `POST /auth/register` body `registerSchema` → `SessionUser` (sets cookies; sends verification email)
- `POST /auth/login` body `loginSchema` → `SessionUser`
- `POST /auth/logout` → `{ ok: true }`
- `POST /auth/refresh` → `SessionUser`
- `GET /auth/me` → `SessionUser` (401 if anonymous)
- `POST /auth/verify-email` body `{ token }` → `{ ok: true }`
- `POST /auth/resend-verification` (auth) → `{ ok: true }`
- `POST /auth/forgot-password` body `{ email }` → `{ ok: true }` (always ok; no account enumeration)
- `POST /auth/reset-password` body `{ token, password }` → `{ ok: true }`
- `POST /auth/change-password` (auth) body `changePasswordSchema` → `{ ok: true }`

### Profile & addresses (auth)
- `PATCH /users/me` body `updateProfileSchema` → `SessionUser`
- `GET /users/me/addresses` → `AddressDto[]`
- `POST /users/me/addresses` body `addressSchema` → `AddressDto`
- `PATCH /users/me/addresses/:id` body partial `addressSchema` → `AddressDto`
- `DELETE /users/me/addresses/:id` → `{ ok: true }`

### Catalog
- `GET /home` → `{ trending: ProductCardDto[], newArrivals: ProductCardDto[], bestSellers: ProductCardDto[], featured: ProductCardDto[], categories: CategoryNode[] }`
- `GET /categories` → `CategoryNode[]` (tree of active categories, with `productCount`)
- `GET /categories/:slug` → `CategoryNode & { path: {name, slug}[] }`
- `GET /products` query `productListQuerySchema` → `ProductListResponse` (note: this one returns `data: { items, meta, facets }`)
  - `category` = category slug (includes descendants); `sizes`, `colors`, `brands`, `fabric`, `fit`, `occasion` = comma-separated lists
- `GET /products/by-ids?ids=a,b,c` → `ProductCardDto[]` (recently viewed; order preserved)
- `GET /products/:slug` → `ProductDetailDto` (404 unless ACTIVE)
- `GET /products/:slug/similar?limit=12` → `ProductCardDto[]` (vector similarity on images+text; falls back to same category)
- `GET /products/:slug/related?limit=12` → `ProductCardDto[]` (same category / complementary)
- `GET /products/:slug/reviews?page` → `{ items: ReviewDto[], meta, summary: { average: number|null, count: number, distribution: Record<'1'|'2'|'3'|'4'|'5', number> } }`
- `POST /products/:slug/reviews` (auth) body `reviewSchema` → `ReviewDto` (one per user per product; `verifiedPurchase` computed)

### Search & AI discovery
- `GET /search?q=...&page&pageSize&category&gender&sizes&colors&minPrice&maxPrice&sort` → `SearchResponse`
  - Natural-language queries are parsed (`parseSearchQuery`) into hard filters + semantic text; results ranked by vector similarity (hybrid with keyword relevance). If the embedding provider is unavailable it degrades to keyword search and `interpretation.mode = "keyword"`.
- `GET /search/suggest?q=` → `{ products: { slug, name, imageUrl, price }[], categories: { slug, name }[] }`
- `POST /visual-search` multipart: `image` (jpeg/png/webp, ≤ 8 MB), optional `q` (text refinement), `category`, `gender`, `maxPrice` → `SearchResponse` (`mode: "visual"` or `"hybrid"` when `q` given)

### Cart (guest or customer)
- `GET /cart` → `CartDto`
- `POST /cart/items` body `{ variantId, quantity }` → `CartDto` (409 `OUT_OF_STOCK` if exceeding availability)
- `PATCH /cart/items/:itemId` body `{ quantity }` → `CartDto`
- `DELETE /cart/items/:itemId` → `CartDto`
- `POST /cart/items/:itemId/save-for-later` → `CartDto`
- `POST /cart/items/:itemId/move-to-cart` → `CartDto`
- `POST /cart/coupon` body `{ code }` → `CartDto` (400 with message if invalid)
- `DELETE /cart/coupon` → `CartDto`
- `GET /coupons/available` → `CouponDto[]` (public, active, not per-user-exhausted)

### Wishlist (auth)
- `GET /wishlist` → `WishlistItemDto[]`
- `GET /wishlist/ids` → `string[]` (product ids, for heart state)
- `POST /wishlist` body `{ productId }` → `{ ok: true }`
- `DELETE /wishlist/:productId` → `{ ok: true }`

### Shipping
- `GET /shipping/serviceability?pincode=560001` → `{ pincode, serviceable: boolean, codAvailable: boolean, estimatedDays: { min, max }, expressAvailable: boolean, city: string|null, state: string|null }`

### Checkout & payments
- `POST /checkout/quote` body `{ shippingMethod, paymentMethod, couponCode? }` → `CartTotalsDto & { couponError: string|null }`
- `POST /checkout` body `checkoutSchema` → `CheckoutResponse`
  - Guest checkout: provide `guestEmail` + `address`.
  - Stock is **reserved** atomically for every line; any shortfall → 409 `OUT_OF_STOCK` with `details.items: { variantId, requested, available }[]`.
  - `COD` → order `CONFIRMED` immediately. `ONLINE` → order `PENDING_PAYMENT`, reservation expires after 30 min.
  - `payment.provider = "razorpay"`: open Razorpay Checkout (`https://checkout.razorpay.com/v1/checkout.js`) with `key = keyId`, `order_id = providerOrderId`, `amount`. On success call verify.
  - `payment.provider = "mock"` (development only, `PAYMENT_PROVIDER=mock`): show a clearly labelled TEST MODE dialog, then call `POST /payments/mock/authorize`.
- `POST /payments/verify` body `verifyPaymentSchema` → `OrderDetailDto` (server verifies HMAC signature; never trusts the client)
- `POST /payments/mock/authorize` body `{ providerOrderId, outcome: "success" | "failure" }` → `{ providerOrderId, providerPaymentId, signature }` (404 unless mock provider enabled)
- `POST /payments/razorpay/webhook` — provider → server only (raw body HMAC verified, idempotent)

### Orders (customer)
- `GET /orders?page` (auth) → `OrderSummaryDto[]` + meta
- `GET /orders/:number` (auth, own orders) → `OrderDetailDto`
- `POST /orders/:number/cancel` (auth) body `{ reason }` → `OrderDetailDto` (only `PENDING_PAYMENT` / `CONFIRMED`)
- `GET /orders/track?number=VY-…&email=…` (public) → `OrderDetailDto` (guest tracking)
- `POST /returns` (auth) body `returnRequestSchema` → `ReturnRequestDto` (within 14 days of delivery)
- `GET /returns` (auth) → `ReturnRequestDto[]`

### Newsletter
- `POST /newsletter` body `{ email }` → `{ ok: true }`

## Staff endpoints (`/api/v1/admin/**`)

Permission strings are `resource:action`. Role grants live in `apps/api/src/modules/roles/permissions.ts`.

| Endpoint | Permission |
| --- | --- |
| `POST /admin/auth/login` body `loginSchema` → `SessionUser` (staff roles only) | public |
| `POST /admin/auth/logout`, `POST /admin/auth/refresh`, `GET /admin/auth/me` | staff |
| `GET /admin/dashboard` → `DashboardDto` | `analytics:read` |
| `GET /admin/categories` → `CategoryNode[]` (all, incl. inactive) | `catalog:read` |
| `POST /admin/categories`, `PATCH /admin/categories/:id`, `DELETE /admin/categories/:id` | `catalog:write` |
| `GET /admin/products?q&status&categoryId&page&pageSize` → `AdminProductRow[]` + meta | `catalog:read` |
| `GET /admin/products/:id` → `ProductDetailDto & { variants: (VariantDto & { costPrice, weightGrams, lowStockThreshold, onHand, reserved })[] , embedding: { text: boolean, images: number, status } }` | `catalog:read` |
| `POST /admin/products` body `productSchema` → product detail (SKUs + barcodes generated server-side) | `catalog:write` |
| `PATCH /admin/products/:id` body `productUpdateSchema` (variants upserted by `id`; omitted variants are deactivated, never deleted) | `catalog:write` |
| `POST /admin/products/:id/status` body `{ status: "DRAFT" \| "ACTIVE" \| "ARCHIVED" }` | `catalog:publish` |
| `POST /admin/products/bulk` body `{ ids: string[], action: "publish" \| "unpublish" \| "archive" \| "feature" \| "unfeature" }` → `{ updated }` | `catalog:publish` |
| `POST /admin/products/import` multipart `file` (.csv/.xlsx) `?dryRun=true` → `{ created, updated, errors: { row, message }[] }` | `catalog:write` |
| `GET /admin/products/import/template` → CSV template | `catalog:read` |
| `POST /admin/products/:id/images` multipart `files[]` (+ `color`) → `ProductImageDto[]` | `catalog:write` |
| `PATCH /admin/products/:id/images/:imageId` body `{ alt?, color?, sortOrder? }`; `DELETE` same path | `catalog:write` |
| `POST /admin/products/:id/videos` multipart `file` (mp4/webm ≤ 50 MB); `DELETE /admin/products/:id/videos/:videoId` | `catalog:write` |
| `GET /admin/barcodes/:variantId.png?symbology=EAN13\|CODE128\|QR` → PNG | `inventory:read` |
| `POST /admin/barcodes/labels` body `barcodeLabelsSchema` → `application/pdf` | `inventory:read` |
| `POST /admin/scans` body `scanLookupSchema` → `ScanResultDto` (never changes stock) | `inventory:read` |
| `GET /admin/scans?page` → scan history | `inventory:read` |
| `GET /admin/inventory?q&status=IN_STOCK\|LOW_STOCK\|OUT_OF_STOCK&page` → `InventoryRowDto[]` + meta + `summary: { units, reserved, available, valuation, lowStock, outOfStock }` | `inventory:read` |
| `POST /admin/inventory/movements` body `inventoryMovementSchema` → `InventoryRowDto` | `inventory:write` |
| `GET /admin/inventory/movements?variantId&type&page` → `InventoryMovementDto[]` + meta | `inventory:read` |
| `GET /admin/inventory/export?format=csv\|xlsx` | `inventory:read` |
| `GET/POST /admin/suppliers`, `PATCH/DELETE /admin/suppliers/:id` | `inventory:write` (GET: read) |
| `GET/POST /admin/purchase-orders`, `GET /admin/purchase-orders/:id`, `POST /admin/purchase-orders/:id/receive` body `{ items: { itemId, quantity }[] }` | `inventory:write` |
| `GET /admin/orders?status&q&from&to&page` → `OrderSummaryDto[]` + meta | `orders:read` |
| `GET /admin/orders/:id` → `OrderDetailDto & { customer: { id, name, email, phone } \| null, dispatch: { variantId, sku, expected, scanned }[] }` | `orders:read` |
| `POST /admin/orders/:id/status` body `orderStatusUpdateSchema` | `orders:write` |
| `POST /admin/orders/:id/cancel` body `{ reason }` (releases stock, refunds captured payments) | `orders:write` |
| `POST /admin/orders/:id/shipment` body `shipmentCreateSchema` → `ShipmentDto` | `orders:write` |
| `POST /admin/orders/:id/refunds` body `{ amount, reason }` → `RefundDto` | `orders:refund` |
| `GET /admin/orders/:id/invoice` → `application/pdf` (GST tax invoice) | `orders:read` |
| `GET /admin/returns?status&page`, `POST /admin/returns/:id/decision` body `returnDecisionSchema` | `orders:write` |
| `GET /admin/customers?q&page` → `CustomerSummaryDto[]` + meta; `GET /admin/customers/:id` | `customers:read` |
| `GET/POST /admin/coupons`, `PATCH/DELETE /admin/coupons/:id` | `promotions:write` (GET: read) |
| `GET /admin/analytics/sales?from&to&granularity=day\|week\|month` → `{ series: { period, revenue, orders, units, aov }[], totals }` | `analytics:read` |
| `GET /admin/analytics/products?from&to` → `{ productId, name, units, revenue, returns }[]` | `analytics:read` |
| `GET /admin/analytics/inventory` → `{ valuationCost, valuationRetail, byCategory: { category, units, value }[] }` | `analytics:read` |
| `GET /admin/analytics/cancellations?from&to`, `GET /admin/analytics/returns?from&to` | `analytics:read` |
| `GET /admin/analytics/export?report=sales\|products\|inventory&format=csv\|xlsx&from&to` | `analytics:read` |
| `GET /admin/ai/status` → `EmbeddingStatusDto`; `POST /admin/ai/reindex` body `{ productIds?: string[] }` | `catalog:write` |
| `GET /admin/users`, `POST /admin/users` body `staffUserSchema`, `PATCH /admin/users/:id` body `{ role?, isActive? }` | `staff:manage` (SUPER_ADMIN/ADMIN) |
| `GET /admin/audit-logs?entity&page` | `audit:read` |

`AdminProductRow` = `{ id, name, slug, brand, status, categoryName, imageUrl, variantCount, totalStock, minPrice, maxPrice, isFeatured, updatedAt }`.
