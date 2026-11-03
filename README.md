# VYRA: WEAR YOUR VIBE.

VYRA is a single-vendor fashion e-commerce platform for India. It has a customer storefront, a staff admin dashboard and one API.

Every size/colour variant gets its own SKU and barcode and is stocked separately. Inventory changes are written to an audited ledger, so concurrent orders can't oversell. Payments are verified on the server, and search uses AI embeddings so customers can search by text or by photo.

| App | Stack | Port |
| --- | --- | --- |
| `apps/storefront` | Next.js 15 (App Router), Tailwind v4, Radix, Framer Motion | 3000 |
| `apps/admin` | Next.js 15, TanStack Table, Recharts, ZXing camera scanning | 3001 |
| `apps/api` | NestJS 11, Prisma 6, PostgreSQL 16 + pgvector, Redis/BullMQ | 4000 (`/api/docs` Swagger) |

## Prerequisites
Node 22+, pnpm 10, Docker (or local PostgreSQL 16 with the `vector` + `pg_trgm` extensions, and Redis 7).

## Quick start
```bash
pnpm install
pnpm db:up                                  # postgres (pgvector) + redis in Docker
cp apps/api/.env.example apps/api/.env      # set JWT_ACCESS_SECRET (openssl rand -hex 32)
pnpm --filter @vyra/shared build
pnpm db:migrate
SEED_STAFF_PASSWORD='choose-one-1' pnpm db:seed   # demo catalog, stock, orders; prints logins
pnpm --filter @vyra/api dev                 # http://localhost:4000/api/docs
pnpm --filter @vyra/storefront dev          # http://localhost:3000
pnpm --filter @vyra/admin dev               # http://localhost:3001
```
To use real AI search, set `EMBEDDING_PROVIDER=gemini` and `GEMINI_API_KEY` in `apps/api/.env`, then click "Reindex" under Admin → Settings → AI search. With `local`, search runs offline as a lexical fallback.

## Scripts
| Command | What it does |
| --- | --- |
| `pnpm dev` | all apps in watch mode (Turborepo) |
| `pnpm build` / `pnpm typecheck` / `pnpm test` | across the monorepo |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:reset` | Prisma migrations / demo seed / drop + re-migrate |
| `pnpm --filter @vyra/api worker` | standalone background worker (production) |

## Documentation
- [CLAUDE.md](CLAUDE.md): conventions and the rules that must never be broken
- [System architecture](docs/architecture/system-architecture.md) · [Technical decisions](docs/architecture/technical-decisions.md)
- [Database design](docs/database/database-design.md) · [ER diagram](docs/database/er-diagram.md)
- [API reference](docs/api/api-documentation.md) (live: `/api/docs`)
- [Design system](docs/design/design-system.md)
- [Deployment guide](docs/deployment/deployment-guide.md) · [Environment variables](docs/deployment/environment-variables.md)
- [Development roadmap and status](docs/development/development-roadmap.md)
