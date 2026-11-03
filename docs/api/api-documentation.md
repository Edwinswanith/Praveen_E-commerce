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

## v1.1 additions: phone-first identity, COD protection, exchanges, reviews

### Phone OTP (customer)
- `POST /auth/otp/request` body `{ phone }` (accepts `+91 98…`, `098…`, `98…`) → `OtpRequestResponse` (`phoneMasked`, `expiresInSeconds` 300, `resendAfterSeconds` 30, `devCode` **only** in development when no SMS provider is configured). 429 `RATE_LIMITED` with `details.retryAfterSeconds` if requested within 30s; max 5/hour.
- `POST /auth/otp/verify` body `{ phone, code, name?, marketingOptIn? }` → `OtpVerifyResponse { user, isNewUser }` (sets session cookies, merges guest cart). New phone → 422 with `details.needsName: true` if `name` is missing (the code is NOT consumed; resubmit with name). Phone-only accounts have `email: null`.
- `PATCH /users/me` also accepts `email`, `marketingOptIn` (WhatsApp offers + bag reminders opt-in).
- `SessionUser` gained `phoneVerified`, `marketingOptIn`; `email` may be `null`.

### Checkout & COD
- `CartTotalsDto` gained `prepaidDiscount` (applied when paying ONLINE), `prepaidSavings` (what paying online would save: show "Save ₹x by paying online"), `codUnavailableReason`.
- `POST /checkout/quote` also accepts `pincode`, `phone` so COD availability reflects blocked PINs / refusal history.
- Phone-only customers must send `guestEmail` at checkout (receipt); it is saved to their profile. Error 422 `fieldErrors.guestEmail` otherwise.
- COD orders return `codOtp: { phoneMasked, expiresInSeconds, devCode? }` and `order.codConfirmation: "PENDING"`. Show an OTP step on the confirmation page:
  - `POST /orders/:number/confirm-cod` body `{ code }` → `OrderDetailDto` (public; OTP authorises, works for guests)
  - `POST /orders/:number/resend-cod-otp` → `OtpRequestResponse`
  - Unconfirmed COD orders auto-cancel after 24h. Staff can confirm after a phone call.
- `GET /orders/track?number=&phone=` now works with phone instead of email.
- `OrderDetailDto` gained `prepaidDiscount`, `codConfirmation`, `exchangeForOrderNumber`, `exchangeOptions` (per order item id: same-product same-price in-stock variants), and status `RTO`.

### Returns & exchanges
- `POST /returns` body adds `type: "RETURN" | "EXCHANGE"`; for EXCHANGE every item needs `exchangeVariantId` (from `exchangeOptions`). Exchanges have `refundAmount: 0`.
- `ReturnRequestDto` gained `type`, `replacementOrderNumber`, `items[].exchangeFor`. Status `EXCHANGED` = replacement order created.

### Reviews
- `POST /products/:slug/reviews` is `multipart/form-data` (or JSON): `rating`, `title?`, `body?`, `fit?` (`RUNS_SMALL|TRUE_TO_SIZE|RUNS_LARGE`), `sizePurchased?`, `images` (≤3 photos, ≤10MB each). `ReviewDto` gained `fit`, `sizePurchased`, `images[]`.
- `ProductDetailDto.fit: { runsSmall, trueToSize, runsLarge, total, advice }`: show `advice` near the size selector when present.

### Staff
| Endpoint | Permission |
| --- | --- |
| `POST /admin/orders/:id/confirm-cod` body `{ note? }` (confirmed by phone call) | `orders:write` |
| `POST /admin/orders/:id/status` with `status: "RTO"` (shipped parcel returned undelivered: restocks, counts a COD refusal against the phone) | `orders:write` |
| `GET /admin/orders?codPending=true` (COD orders awaiting confirmation) | `orders:read` |
| `GET /admin/cod/settings` → `CodSettingsDto` | `orders:read` |
| `POST /admin/cod/blocked-pincodes` body `{ pincode, reason? }`, `DELETE /admin/cod/blocked-pincodes/:pincode` → `CodSettingsDto` | `orders:write` |
| `GET /admin/cod/risks?q&blocked&page` → `CodRiskDto[]` + meta; `PATCH /admin/cod/risks/:phone` body `{ codBlocked, note? }` | read / `orders:write` |
| `GET /admin/analytics/cod?from&to` → `CodAnalyticsDto` | `analytics:read` |
| `GET /admin/analytics/return-rates?from&to` → `ProductReturnRateDto[]` | `analytics:read` |
| `GET /admin/customers/:id` now `CustomerDetailDto` (adds `stats.rto`, `codRisk`) | `customers:read` |
| `POST /admin/products/:id/images/generate` body `aiPhotoSchema` `{ sourceImageId?, style: MODEL\|STUDIO\|FLATLAY\|LIFESTYLE, color?, notes?, count: 1\|2 }` → `ProductImageDto[]` (`aiGenerated: true`). With `sourceImageId` the real garment is kept exactly; kids items never use a generated child model | `catalog:write` |

### Garment tag QR links
- QR labels encode `${STOREFRONT_URL}/s/<SKU>` (stable forever: printed on tags). The storefront route redirects to `/p/<slug>?variant=<id>&utm_source=tag&utm_medium=qr` with colour + size preselected; unknown/retired SKUs land on search.
- `GET /products/by-sku/:sku` (public) → `{ slug, variantId, color, size, isActive }` for ACTIVE products only (no stock/cost).
- The admin scanner accepts the tag URL, the EAN-13, the SKU, or legacy `VYRA:<SKU>` text.

Typed admin DTOs now exist for suppliers, purchase orders, scan history, staff users, audit logs and customer detail (`packages/shared/src/types.ts`).

## v1.2 additions: funnel analytics, virtual try-on

### Session analytics (first-party, cookie-less, no PII)
- The storefront keeps a random session id (`localStorage` key `vyra_sid`, regex `^[A-Za-z0-9_-]{16,64}$`, new id after 30 min idle) and sends it on **every** API call as headers `X-Vyra-Session`, plus `X-Vyra-Device: mobile|tablet|desktop` and `X-Vyra-Source` (first-touch `utm_source`, e.g. `tag` for garment-tag QR scans, persisted for the session). CORS allows these headers.
- `POST /events` body `analyticsEventsSchema` `{ sessionId, device?, source?, events: [{ type: "PRODUCT_VIEW" | "CHECKOUT_STARTED" | "QUICK_VIEW", productId? }] (≤20) }` → 202 `{ accepted }`. Send PRODUCT_VIEW once per PDP view, CHECKOUT_STARTED when /checkout mounts with items, QUICK_VIEW when a quick view opens. Use `navigator.sendBeacon`-style fire-and-forget (never block UI; failures ignored).
- ADD_TO_CART, ORDER_PLACED, SEARCH, TRY_ON are recorded **server-side** from the headers (they cannot be sent by the browser).

### Virtual try-on
- `GET /try-on/quota` → `{ remainingToday, available }` (per session via `X-Vyra-Session`).
- `POST /try-on` multipart: `photo` (jpeg/png/webp ≤ 8 MB), `productSlug`, `color?`, `consent: "true"` (customer confirms they are 18+ and it is their photo) → `TryOnResponse { image: "data:image/webp;base64,…", color, disclaimer, remainingToday }`. Takes ~10s. Errors: 422 consent missing; 400 kids product / no session; 429 per-session daily cap (default 5) or global daily cap; 503 not configured. **The photo is processed in memory and never stored.** Not available for kids' products. Show `disclaimer` with every result.

### Staff
| `GET /admin/analytics/funnel?from&to` → `FunnelDto` (steps with unique sessions, conversion/abandonment, byDevice, bySource first-touch incl. revenue, products view→bag, tryOn usage incl. today vs daily limit, daily series) | `analytics:read` |

## v1.3 additions: festival campaigns and offers

Design rules (enforced by the API, not the UI): a campaign's **phase is derived from the clock** (`DRAFT | UPCOMING | TEASER | EARLY_ACCESS | LIVE | PAUSED | ENDED | CANCELLED`, half-open windows, UTC stored, IST shown), so no job has to "switch a sale on". Prices are resolved by one server-side resolver for cards, PDP, bag and checkout. Offer layers apply in this order: **campaign sale price → best bundle promotion → one coupon → prepaid**. A sale price is never at or above the regular price, never above MRP and **never below cost**. Strike-through is MRP only.

### Public
- `GET /campaigns/current` → `CampaignPublicDto[]` (TEASER / EARLY_ACCESS / LIVE only). `claim.upToPercent` is computed from in-stock deal prices vs MRP and rounded **down** to a multiple of 5 (`null` below 10%): the only "Up to X% off" a page may show. `countdownTo` is the next real phase boundary and the only valid countdown target. `extended` + `originalEndsAt` disclose extensions.
- `GET /campaigns/:slug` → `CampaignPublicDto` (404 for drafts and not-yet-announced campaigns). With a customer session: `hasEarlyAccess`, `subscribed`.
- `GET /campaigns/:slug/products?limit=48` → `ProductCardDto[]` (in stock first, best deal first).
- `POST /campaigns/:slug/remind-me` body `{ phone?, email? }` (guests need a phone; signed-in customers can send `{}`) → `{ subscribed, earlyAccess }`. One WhatsApp/email per phase (early access, live, ending soon within 3h). Signed-in subscribers and marketing opt-ins get early-access prices.
- `ProductCardDto.campaign`, `VariantDto.campaign` + `VariantDto.basePrice` (regular price; `price < basePrice` while a sale applies). Product pages show **public** prices (they are cached); early-access prices apply in the bag.
- `CartTotalsDto` adds `campaignSavings`, `promotionDiscount`, `promotionName`, `offerNote` (which offer won when a coupon can't combine with a bundle). `CartDto.couponAutoApplied`: the best auto-apply coupon is picked when no code is typed. Applying a non-combinable code that would lose to the bundle is refused with the reason.
- `POST /checkout` accepts `expectedTotal` (the total the shopper saw). If the server total is higher (sale ended, deal sold out, early access withdrawn) → 409 `PRICE_CHANGED` with `details.grandTotal`; nothing is charged. A deal that sells out between bag and order → 409 `CONFLICT`. Per-customer deal limits are checked by account, email and phone (400).
- `OrderDetailDto` adds `promotionDiscount` and `savings { campaign, promotion, coupon, prepaid }` (from the order discount ledger).
- `POST /orders/:number/return-preview` body `{ items: [{ orderItemId, quantity }] }` → `ReturnPreviewDto { refundAmount, itemsValue, deductions[{label, amount}], note }`. If the items kept no longer qualify for a bundle's minimum quantity or a coupon's minimum order, the discount those kept items received is deducted. Computed cumulatively: a later return of the rest gives the deduction back (negative `amount`), so returning everything refunds everything paid for the items. `POST /returns` stores exactly this amount.

### Staff
| Endpoint | Permission |
| --- | --- |
| `GET /admin/campaigns` → `CampaignAdminDto[]`; `POST` body `campaignSchema` (banner text may not contain typed `%` figures); `GET/PATCH/DELETE /admin/campaigns/:id` (delete: drafts only; slug locked after publish; start/early access locked once selling; end moves only via extend) | `promotions:read` / `promotions:write` |
| `POST /admin/campaigns/:id/publish` (blocked by checklist errors) · `/pause` · `/resume` (refused while the budget is used up) · `/cancel` body `{ note? }` | `promotions:write` |
| `POST /admin/campaigns/:id/extend` body `{ endsAt, note }` (later only; sets `originalEndsAt`, shown to customers; re-arms "ending soon" reminders) | `promotions:write` |
| `GET /admin/campaigns/:id/prices` → `CampaignPriceRowDto[]` (MRP, regular, cost, sale, % off regular and MRP, cap, sold, warnings); `PUT` body `{ items: [{ variantId, salePrice \| percentOff, stockCap?, perCustomerLimit? }] }`; while selling, prices may only go down and caps can't drop below sold | `promotions:write` |
| `POST /admin/campaigns/:id/prices/bulk` body `{ categoryIds[], productIds[], percentOff (off REGULAR), roundToNine, stockCap?, perCustomerLimit? }` → `{ rows, applied, skippedBelowCost }` | `promotions:write` |
| `DELETE /admin/campaigns/:id/prices/:variantId` (not while selling) | `promotions:write` |
| `GET /admin/campaigns/:id/checklist` → `CampaignChecklistDto` (errors: window, below cost, nothing to sell; warnings: out of stock, no cost price, overlaps, pre-sale price hikes in the last 30 days, budget vs potential discount) | `promotions:read` |
| `GET /admin/campaigns/:id/preview?at=ISO` → what the storefront shows at that instant | `promotions:read` |
| `GET /admin/campaigns/:id/report` → `CampaignReportDto` (orders, units, revenue, AOV, discount by source, budget used, top products, sell-through, daily IST) | `analytics:read` |
| `GET /admin/promotions?campaignId=`, `POST` body `promotionSchema` ("buy N, X% off", scope by categories/products, cap, usage limit, evergreen window or campaign), `PATCH/DELETE /admin/promotions/:id` (a running sale's bundle can only get better; used promotions are deactivated, not deleted) | `promotions:read` / `promotions:write` |
| Coupons gain `autoApply`, `combinableWithPromotions`, `campaignId` (campaign coupons work only while that campaign sells) | `promotions:write` |

Campaign budgets count sale-price, bundle and coupon discounts of non-cancelled orders; when used up the campaign auto-pauses (audited). The budget can be overshot by at most the orders in flight when it runs out.
