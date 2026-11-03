# Environment variables

Validated at boot by `apps/api/src/config/env.ts`, which refuses to start on invalid config. The annotated template is `apps/api/.env.example`.

## API (`apps/api/.env`)
| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | | development | `production` enforces secure cookies and forbids the mock payment provider |
| `PORT` | | 4000 | |
| `DATABASE_URL` | ✔ | | PostgreSQL with `vector` + `pg_trgm` |
| `REDIS_URL` | | redis://localhost:6379 | BullMQ |
| `QUEUES_ENABLED` | | true | `false` runs jobs inline (tests/seed) |
| `RUN_WORKERS_IN_API` | | true | set `false` in prod and run the worker separately |
| `JWT_ACCESS_SECRET` | ✔ | | ≥ 32 chars |
| `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_DAYS` | | 900 / 30 | |
| `COOKIE_SECURE` / `COOKIE_DOMAIN` | prod | false / – | |
| `CORS_ORIGINS` | | localhost:3000,3001 | comma-separated |
| `STOREFRONT_URL` / `ADMIN_URL` | | localhost | used in emails |
| `STORAGE_DRIVER` | | local | `s3` needs `S3_BUCKET`, `S3_REGION` (+ keys / `S3_ENDPOINT` for R2/MinIO) |
| `STORAGE_LOCAL_DIR` / `MEDIA_BASE_URL` | | ./storage, /media | |
| `BARCODE_EAN_PREFIX` | | 20 | GS1 restricted-circulation; replace with your GS1 prefix |
| `PAYMENT_PROVIDER` | | none | `razorpay` needs `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; `mock` for dev only |
| `COD_ENABLED` / `PAYMENT_RESERVATION_MINUTES` | | true / 30 | |
| `SHIPPING_PROVIDER` | | manual | `shiprocket` needs `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_PICKUP_PINCODE` (+ `SHIPROCKET_PICKUP_LOCATION`) |
| `EMBEDDING_PROVIDER` | | local | `gemini` needs `GEMINI_API_KEY`; `GEMINI_EMBEDDING_MODEL` (gemini-embedding-2), `EMBEDDING_DIMENSIONS` must stay 768 unless migrated |
| `IMAGE_GEN_MODEL` | | gemini-3.1-flash-image | AI product photography (uses `GEMINI_API_KEY`); about $0.04 per image |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `MAIL_FROM` | | – | without SMTP, emails are recorded as `skipped` |
| `SELLER_NAME` / `SELLER_GSTIN` / `SELLER_ADDRESS` / `SELLER_STATE` | prod | placeholders | printed on GST invoices; state decides CGST+SGST vs IGST |
| `SMS_PROVIDER` | prod | console | `msg91` needs `MSG91_AUTH_KEY` + `MSG91_OTP_TEMPLATE_ID` (DLT-registered). `console` logs OTPs and echoes them to the client **in development only** |
| `WHATSAPP_PROVIDER` | | none | `meta` needs `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`; templates listed in `.env.example` must be approved in Meta Business Manager |
| `OTP_PEPPER` | prod | (JWT secret) | 32+ random chars, hashes OTPs |
| `COD_RTO_BLOCK_THRESHOLD` / `COD_CONFIRM_WINDOW_HOURS` | | 2 / 24 | COD refusals before auto-block / hours before unconfirmed COD auto-cancels |
| `PREPAID_DISCOUNT_PERCENT` / `PREPAID_DISCOUNT_MAX` | | 5 / 100 | online-payment incentive (₹ cap); 0 disables |
| `ABANDONED_CART_AFTER_HOURS` | | 3 | reminders only go to opted-in customers, once per bag change |
| `SENTRY_DSN`, `LOG_LEVEL` | | – / info | 5xx errors reported without cookies/auth/bodies |
| `SEED_STAFF_PASSWORD`, `SEED_FORCE` | seed only | | |
| `NODE_USE_ENV_PROXY=1` | behind a proxy | | makes Node fetch honour `HTTPS_PROXY` |

## Storefront / Admin
| Variable | Notes |
| --- | --- |
| `API_URL` | API origin used by rewrites (build time) and server components (runtime) |
| `NEXT_PUBLIC_SITE_URL` | storefront canonical URLs, sitemap |
| `NEXT_PUBLIC_STOREFRONT_URL` | admin "preview on storefront" links |
