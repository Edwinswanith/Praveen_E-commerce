# Deployment guide

## Recommended topology (India region)
| Piece | Option | Notes |
| --- | --- | --- |
| Storefront, Admin | Vercel (or any Node host using the `standalone` output) | Set `API_URL` at **build and runtime** (rewrites are resolved at build). Put admin on its own domain (e.g. `admin.vyra.in`), optionally behind Vercel password/IP allowlist |
| API + worker | Render / Railway / Fly.io / AWS ECS, region `ap-south-1` (Mumbai) | Image: `infrastructure/docker/api.Dockerfile`. Run ≥2 API instances with `RUN_WORKERS_IN_API=false` and 1 worker (`node dist/src/worker.js`) |
| PostgreSQL 16 + pgvector | Neon, Supabase, AWS RDS (pgvector supported) | Enable PITR. Run `prisma migrate deploy` on release |
| Redis | Upstash / ElastiCache | BullMQ requires `maxmemory-policy noeviction` |
| Media | S3 / Cloudflare R2 + CDN | `STORAGE_DRIVER=s3`, `MEDIA_BASE_URL=https://media.vyra.in` |

## Release steps
1. CI green (typecheck, tests against pgvector Postgres, build, migration guard).
2. `pnpm --filter @vyra/api exec prisma migrate deploy` (forward-only; review SQL for locks on big tables).
3. Deploy the API and worker, then the frontends.
4. Smoke test: `GET /api/v1/health`. Every integration should read `configured`, not `pending`.

## Go-live checklist
- [ ] `NODE_ENV=production`, `COOKIE_SECURE=true`, `COOKIE_DOMAIN=.vyra.in`, real `CORS_ORIGINS`.
- [ ] `JWT_ACCESS_SECRET` from a secret manager (never in git). Rotating it logs everyone out.
- [ ] Razorpay **live** keys + webhook at `https://api.vyra.in/api/v1/payments/razorpay/webhook` (events: `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`) + `RAZORPAY_WEBHOOK_SECRET`. Run one ₹1 live payment and refund.
- [ ] Shiprocket API user, pickup location and `SHIPROCKET_PICKUP_PINCODE`. Book one test shipment (this integration is **unverified until then**).
- [ ] SMTP (e.g. Amazon SES Mumbai / Postmark) with SPF/DKIM/DMARC for the sending domain.
- [ ] `GEMINI_API_KEY` set, `EMBEDDING_PROVIDER=gemini`, then Admin → AI → Reindex.
- [ ] Seller name/GSTIN/address/state for invoices. GST slab rates reviewed by your CA.
- [ ] GS1 India barcode prefix (if selling on marketplaces), then `BARCODE_EAN_PREFIX`.
- [ ] Change seeded staff passwords or don't seed production (the seed is for development).
- [ ] Error monitoring (Sentry DSN), uptime check on `/api/v1/health`, log drain.
- [ ] Backups: provider PITR + nightly `pg_dump -Fc` to a separate bucket. Test a restore.

## Backups & restore
```bash
# daily (cron / platform scheduler); uploads to S3/R2 when BACKUP_S3_URI is set
DATABASE_URL=... BACKUP_S3_URI=s3://vyra-backups/db infrastructure/deployment/backup.sh
# monthly restore drill: restores into a scratch DB and checks stock consistency
ADMIN_DATABASE_URL=postgresql://.../postgres infrastructure/deployment/restore-check.sh backups/vyra-<stamp>.dump
```
Also check `GET /api/v1/admin/inventory/reconcile` weekly (or alert on it): it proves stock equals the ledger for every variant.
Media lives in object storage. Enable bucket versioning.

## Scaling notes
- Listing/search queries are bounded (pagination, a vector candidate pool of 600). Add read replicas before anything exotic.
- Embedding throughput is limited by the provider's rate limits, and BullMQ retries 429s with exponential backoff.
- A single very hot SKU serialises on its inventory row by design. This only matters for flash sales of thousands per second.
