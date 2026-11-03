# Development roadmap & status

Last verified: 2026-11-03. Totals: 102 automated tests passing (shared 17, API 33 against real Postgres, storefront 18, admin 34). Typecheck is clean in all packages, and production builds pass for the API, storefront and admin.

## Verification performed (beyond unit tests)
- **Real browser, storefront**: home → category → PDP (variant selector) → add to bag → guest checkout → TEST MODE payment → server signature verification → confirmation. Result in the DB: order `CONFIRMED`, payment `CAPTURED`. No page errors, and no horizontal overflow at 390px.
- **Real browser, admin**: owner login, then all 13 sections loaded against seeded data with zero HTTP/page errors. Scanner RECEIVE flow: the scan left stock unchanged (37→37), and the explicit confirmation wrote `STOCK_IN +1` linked to the scan id (→38).
- **Live AI search (Gemini `gemini-embedding-2@768`, 33 text + 182 image vectors)**: "oversized black cotton t-shirt under 1000 rupees" → filters {black, ≤₹1000} → Oversized Heavyweight Cotton Tee first. "something to wear for diwali" → Festive Silk Blend Kurta first. Querying with a product photo returns that product at 0.936 similarity, followed by other tees.
- **Concurrency**: 25 parallel reservations against 5 units → exactly 5 succeed, with no negative or oversold state (integration test).

## Module checklist
| Module | Status | Notes |
| --- | --- | --- |
| Monorepo, Docker, CI | ✅ Done | Docker images written but **not built in this environment** (no Docker daemon); CI workflow untested until pushed |
| Design system + brand | ✅ Done | Original wordmark; tokens + primitives in `packages/ui` |
| Auth (customer + staff), RBAC, sessions | ✅ Done | Rotating refresh tokens with reuse detection, lockout, separate realms. Phone OTP: ⏳ not implemented (needs SMS provider) |
| Catalog: categories, products, variants, attributes, media | ✅ Done | Images re-encoded to WebP, EXIF stripped; video upload (MP4/WebM sniffed) |
| SKU + barcode (EAN-13 internal prefix 20, Code128, QR), label PDF | ✅ Done | |
| Scanner (camera ZXing, USB/Bluetooth HID, manual; 5 modes) | ✅ Done | Camera/torch **not tested on a physical phone** |
| Inventory ledger, reservations, suppliers, purchase orders | ✅ Done | |
| Cart, wishlist, coupons, addresses | ✅ Done | |
| Checkout, orders, cancellations, returns, refunds, GST invoice PDF | ✅ Done | |
| Razorpay | 🟡 Implemented, pending credentials | Signature/webhook logic unit-tested against the documented scheme; never called the live API |
| Shiprocket | 🟡 Implemented, pending credentials | Written to the public API docs and unverified. Manual courier + AWB entry works today |
| Email (SMTP) | 🟡 Pending credentials | Emails recorded in `notifications` with status `skipped` |
| AI embeddings, semantic + visual + hybrid search, similar products | ✅ Done | Gemini live-verified; `local` offline fallback for dev/CI |
| Analytics dashboard + reports + CSV/XLSX export | ✅ Done | Revenue counts confirmed+ orders, net of processed refunds, days in IST |
| SEO (metadata, JSON-LD, sitemap, robots, canonical) | ✅ Done | |
| Playwright E2E suite in repo | ⏳ Pending | Browser flows above were run as ad-hoc scripts; convert them into `e2e/` specs in CI |
| Monitoring (Sentry), rate-limit store in Redis for multi-node | ⏳ Pending | Throttler is in-memory per instance |

## Known limitations / honest gaps
1. Unknown product slugs render the not-found page but return HTTP 200 (the streaming loading skeleton starts first). Fix: move `notFound()` ahead of the `loading.tsx` boundary.
2. Contract types for suppliers, purchase orders, scan history, staff users, customer detail and audit logs are not yet in `packages/shared/src/types.ts` (the admin matches the real shapes, but they are not compile-time checked).
3. RETURN scan mode records a `RETURN_RESTOCK`-style stock-in that is not linked to a specific `ReturnRequest`. Use the returns workflow ("Receive") for refund-linked restocks.
4. Product import reports counts + row errors, but has no per-row preview.
5. No global admin search endpoint: the top bar queries products/orders/customers separately.
6. Changing a category's 3-letter code does not change existing SKUs (by design: SKUs are printed on labels). New products use the new code.
7. GST slab logic (5% ≤ ₹2,500 per piece, else 18%, prices inclusive) must be confirmed by a CA. HSN codes are per product.
8. Seed product imagery is generated illustration. Real photography is needed before launch.
9. The in-memory mock payment provider loses pending mock orders on API restart (dev only).

## Required external configuration
Razorpay keys + webhook secret · Shiprocket API user + pickup PIN · SMTP · Gemini API key (or keep `local`) · S3/R2 bucket + CDN for production media · GS1 India prefix (only for marketplace selling) · Seller GSTIN/address · Sentry DSN.

## Next phases
1. Convert the browser flows into a committed Playwright suite (buy flow, admin fulfil, scanner) and run it in CI.
2. Live sandbox verification: Razorpay test keys, then Shiprocket test shipment.
3. Close gaps 1–5 above.
4. Phone OTP login (MSG91/Twilio) and order SMS/WhatsApp notifications.
5. Production deploy per `docs/deployment/deployment-guide.md`.
