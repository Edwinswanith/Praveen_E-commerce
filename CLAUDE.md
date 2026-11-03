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

## Status
See `docs/development/development-roadmap.md` for the module checklist, known limitations and required external configuration.
