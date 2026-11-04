# CLAUDE.md — VYRA engineering guide

VYRA ("WEAR YOUR VIBE.") is a single-vendor Indian fashion e-commerce platform:
customer storefront + staff admin + one NestJS API over PostgreSQL/pgvector.

## Layout
```
apps/api          NestJS 11 modular monolith (REST /api/v1), Prisma 6, BullMQ
  prisma/         schema.prisma + migrations (hand-written SQL at the end of init)
  src/modules/    one folder per domain (auth, products, inventory, orders, search, ai…)
  src/common/     prisma, http (envelope, errors, zod pipe, CSRF), queue, storage, mail, audit
  src/seed/       dev seed (runs through real services) + generated garment art
  test/           jest: unit/*.spec.ts and *.e2e-spec.ts (supertest, real Postgres)
apps/storefront   Next.js 15 App Router customer site
apps/admin        Next.js 15 staff dashboard (client-rendered behind auth)
packages/shared   zod schemas, API DTO types, pricing/GST, SKU, EAN-13, order state machine, NL query parser
packages/ui       design tokens (Tailwind v4 @theme) + primitives (Button, Field, Badge, Price, VyraLogo…)
packages/config   tsconfig bases
```

## Commands
```bash
pnpm install
pnpm db:up                               # docker: postgres(pgvector) + redis
pnpm --filter @vyra/shared build         # other packages consume dist/
pnpm db:migrate && pnpm db:seed          # seed prints staff credentials
pnpm --filter @vyra/api dev              # tsc --watch + node (NOT tsx: Nest DI needs decorator metadata)
pnpm --filter @vyra/storefront dev       # :3000
pnpm --filter @vyra/admin dev            # :3001
pnpm test | pnpm typecheck | pnpm build
apps/api/scripts/restart-api.sh          # rebuild + restart compiled API (dev helper)
pnpm e2e                                 # Playwright full-stack tests (apps on :4000/:3000/:3001, seeded DB)
```
API tests need `vyra_test` DB migrated: `DATABASE_URL=…/vyra_test pnpm --filter @vyra/api exec prisma migrate deploy`.
Behind an HTTP proxy, Node's fetch needs `NODE_USE_ENV_PROXY=1` (Gemini/Razorpay calls).

## Non-negotiable rules
1. **Stock changes only via `InventoryService.apply`** (guarded atomic UPDATE + ledger row in the same tx). Never `prisma.inventory.update`. Multi-variant ops sort by variantId.
2. **Prices are computed server-side** with `priceCart` (integer paise). Never accept prices/totals from clients. Money in DB is `Decimal(12,2)` rupees; convert with `common/money.ts`.
3. **Payments**: trust only provider signature + server re-fetch (`OrdersService.verifyPayment`). `markPaid` is idempotent and row-locked. Mock provider is refused in production.
4. **A scan never changes stock.** `/admin/scans` only identifies; movements need explicit `POST /admin/inventory/movements` with a reason.
5. **Vectors from different models are never compared**: every embedding row stores `model`; queries filter by it. Changing dimensions = new migration.
6. **Staff vs customer realms**: staff routes live under `/admin/**` with `@StaffOnly()` + `@RequirePermissions(...)`; they use separate cookies. Permission matrix: `apps/api/src/modules/roles/permissions.ts`.
7. **Contract first**: change `packages/shared` types/schemas, then API, then apps. Response envelope `{data, meta?}`; errors `{error:{code,message,details}}`.
8. Variants are never deleted (orders reference them) — they are deactivated. Colour/size of an existing variant are immutable (baked into SKU and printed labels).
9. Prisma cannot model the HNSW index: delete any `DROP INDEX "product_embeddings_vector_hnsw"` from generated migrations (`scripts/check-migrations.sh` enforces this in CI).
10. Don't invent credentials. Integrations without config report "pending" via `GET /api/v1/health`.
11. **COD orders cannot be packed until `codConfirmation = CONFIRMED`** (customer OTP or staff call). RTO goes through `OrdersService.markRto` (restocks + counts refusals per phone).
12. **OTP login never trusts an unverified phone**: only accounts with `phoneVerifiedAt` can be signed into by OTP; OTPs are stored hashed and never logged in production.
13. Exchanges are same-product, same-price swaps fulfilled by a zero-value replacement order. Never refund an exchange that has a replacement.
14. `GET /admin/inventory/reconcile` must always report `consistent: true`; if it doesn't, something bypassed rule 1.
15. AI product images are always stored with `aiGenerated = true` (disclosed on the storefront). Never generate children as models; for live products, generate only from a real photo of the garment (`sourceImageId`).
16. **Virtual try-on photos are never persisted** (no disk, DB, logs or cache): processed in memory, result returned as a data URL. Try-on is disabled for kids' products and capped per session + globally per day (`TRYON_*` env).
17. Revenue-bearing analytics events (ADD_TO_CART, ORDER_PLACED, TRY_ON, SEARCH) are recorded server-side only; the browser may only send PRODUCT_VIEW / CHECKOUT_STARTED / QUICK_VIEW.
18. **No hardcoded marketing claims.** Discount claims come from live data (`/home` → `deals`, in-stock only, rounded down via `upToDiscountClaim`); shipping/returns promises come from `PRICING_RULES` / `RETURN_WINDOW_DAYS` (storefront `lib/store-promises.ts`). A claim the shop can't fulfil is misleading advertising under Indian consumer law.
19. **Campaign prices go through `CampaignPricingService`** (cards, PDP, bag, checkout): never read `variant.price` as "the price". Campaign phase is derived from the clock (`computeCampaignPhase`), never a flag a job flips. Offer order: sale price → best bundle → one coupon → prepaid; discounts never take a line below cost (`unitFloor`). Every discount is written to `order_discounts` by source.
20. **Sale honesty**: sale price < regular ≤ MRP and ≥ cost; MRP-only strike-through; countdowns only to `countdownTo`; a running sale's prices/bundles can only get better; extensions are disclosed (`originalEndsAt`); checkout stops with `PRICE_CHANGED` instead of charging more than the shopper saw.

21. **Money and return transitions are race-safe**: refunds only via `OrdersService.refund` (order row lock, PENDING row before the provider call, one live refund per return enforced by a unique index); return decisions claim their status atomically (`updateMany … where status = expected`). New concurrency-sensitive flows get a test in `apps/api/test/concurrency.e2e-spec.ts`.
22. **No third party is contacted without proof of consent**: phones are messaged only when verified (`phoneVerifiedAt`); newsletter is double opt-in with signed unsubscribe links. Public lookups that could be guessed (e.g. order tracking) use `AttemptLimiter` cross-IP lockouts and mask PII.
23. **Every route is covered by the contract sweep** (`apps/api/test/contract-sweep.e2e-spec.ts`): new routes must pass auth/realm/RBAC/CSRF/validation/envelope checks automatically; intentional exceptions are listed in the sweep with a reason. Production config fails fast (`resolveApiUrl`); never default to localhost.

## Status
See `docs/development/development-roadmap.md` for the module checklist, known limitations and required external configuration, and `docs/verification/` for the latest verification evidence (matrix, bug fixes, security, performance, readiness).
