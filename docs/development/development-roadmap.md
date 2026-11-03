# Development roadmap & status

Last verified: 2026-11-03 (v1.1). Totals: **157 automated tests** (shared 21, API 46 against real Postgres, storefront 35, admin 55) plus **6 Playwright browser tests** (`pnpm e2e`). Typecheck and production builds pass for every package from a clean `--force` build.

## Verification performed (beyond unit tests)
- **Real browser, storefront**: home → category → PDP (variant selector) → add to bag → guest checkout → TEST MODE payment → server signature verification → confirmation. Result in the DB: order `CONFIRMED`, payment `CAPTURED`. No page errors, and no horizontal overflow at 390px.
- **Real browser, admin**: owner login, then all 13 sections loaded against seeded data with zero HTTP/page errors. Scanner RECEIVE flow: the scan left stock unchanged (37→37), and the explicit confirmation wrote `STOCK_IN +1` linked to the scan id (→38).
- **Live AI search (Gemini `gemini-embedding-2@768`, 33 text + 182 image vectors)**: "oversized black cotton t-shirt under 1000 rupees" → filters {black, ≤₹1000} → Oversized Heavyweight Cotton Tee first. "something to wear for diwali" → Festive Silk Blend Kurta first. Querying with a product photo returns that product at 0.936 similarity, followed by other tees.
- **Concurrency**: 25 parallel reservations against 5 units → exactly 5 succeed, with no negative or oversold state (integration test).

## v1.1: protecting margins (phone-first India)
| Feature | Status | Verified by |
| --- | --- | --- |
| Phone + OTP signup/login (MSG91), takeover-safe phone binding | ✅ Done (SMS **pending credentials**) | API integration tests; Playwright signup |
| COD confirmation by OTP / staff call, packing blocked until confirmed, 24h auto-cancel | ✅ Done | API tests; Playwright COD flow + staff block |
| COD-blocked PIN codes, per-phone RTO tracking with auto-block at 2 refusals | ✅ Done | API tests (RTO → auto-block → COD refused, prepaid allowed) |
| RTO status: restock + refusal count; COD/RTO analytics with top refusing PINs | ✅ Done | API tests; admin walkthrough |
| Prepaid discount (5%, max ₹100), never costs free shipping | ✅ Done | shared pricing tests; Playwright prepaid flow |
| Size/colour exchanges via zero-value replacement orders | ✅ Done | API test (restock, reserve, no refund) |
| Reviews with fit feedback + up to 3 photos; fit advice on PDP | ✅ Done | API tests incl. rejected photo leaves no partial review |
| WhatsApp order updates + opt-in abandoned-bag reminders | ✅ Done (WhatsApp **pending credentials**) | API test (once per bag change, opt-in only) |
| Per-product return-rate analytics | ✅ Done | API test |
| Ledger reconciliation endpoint | ✅ Done | API test detects a rogue edit; seeded DB: 389/389 consistent |
| Backups + restore drill scripts | ✅ Done | run against the dev DB (dump → scratch restore → checks) |
| Sentry error reporting (API, PII-stripped) | ✅ Done (**pending DSN**) | wiring only |
| Playwright E2E suite + CI e2e job | ✅ Done | 6/6 locally; CI job not yet run on GitHub |

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
| Playwright E2E suite in repo | ✅ Done | `e2e/` (6 specs), CI job added |
| Monitoring | 🟡 Sentry wired for the API; frontends not yet | Needs `SENTRY_DSN` |
| Rate-limit store in Redis for multi-node | ⏳ Pending | Throttler is in-memory per instance; fine for one API node |

## Known limitations / honest gaps
1. ~~Unknown products returned HTTP 200~~ fixed: now 404 (covered by E2E).
2. ~~Admin contract types missing~~ fixed: all admin DTOs live in `packages/shared`.
3. RETURN scan mode records a `RETURN_RESTOCK`-style stock-in that is not linked to a specific `ReturnRequest`. Use the returns workflow ("Receive") for refund-linked restocks.
4. Product import reports counts + row errors, but has no per-row preview.
5. No global admin search endpoint: the top bar queries products/orders/customers separately.
6. Changing a category's 3-letter code does not change existing SKUs (by design: SKUs are printed on labels). New products use the new code.
7. GST slab logic (5% ≤ ₹2,500 per piece, else 18%, prices inclusive) must be confirmed by a CA. HSN codes are per product.
8. Seed product imagery is generated illustration. Real photography is needed before launch.
9. The in-memory mock payment provider loses pending mock orders on API restart (dev only).

## Required external configuration
Razorpay keys + webhook secret · Shiprocket API user + pickup PIN · SMTP · **MSG91 (DLT-registered OTP template)** · **WhatsApp Business (Meta) + 5 approved templates** · Gemini API key (or keep `local`) · S3/R2 bucket + CDN for production media · GS1 India prefix (only for marketplace selling) · Seller GSTIN/address · Sentry DSN.

## Next phases (all blocked on accounts only the business can create)
1. Razorpay test keys → run 10 sandbox payments/refunds; then live ₹1 test.
2. MSG91 account + DLT template → real OTPs; WhatsApp Business + template approval.
3. Shiprocket API user → one real shipment, then wire NDR/RTO webhooks to `markRto`.
4. Real product photography (the single biggest conversion lever).
5. Production deploy per `docs/deployment/deployment-guide.md`, then watch the COD/RTO dashboard weekly.
