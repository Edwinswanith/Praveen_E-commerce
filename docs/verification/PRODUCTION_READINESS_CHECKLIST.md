# Production readiness checklist

Status as of 4 Nov 2026. VERIFIED = exercised by a passing automated test or command in this pass (isolated environment). BLOCKED = needs credentials, infrastructure or a decision this environment doesn't have. NOT RUN = possible but not done. FAILED = currently failing.

## Build and code health
| Item | Status | Evidence |
| --- | --- | --- |
| Dependencies install from the lockfile | VERIFIED | `pnpm install --frozen-lockfile` exit 0 |
| Type checking (all packages) | VERIFIED | `pnpm typecheck` exit 0 |
| Linting | NOT RUN (partially) | `pnpm lint` exit 0, but every `lint` script is `tsc --noEmit`; there is no ESLint or other linter configured |
| Production builds (API, storefront, admin, shared, ui) | VERIFIED | `pnpm build --force` exit 0 with `API_URL` set |
| Build fails fast without `API_URL` in production | VERIFIED | storefront build exits 1 with a clear message |
| Unit + integration tests | VERIFIED | 398 passed (shared 40, admin 132, storefront 107, API 119) |
| Browser E2E | VERIFIED | 28 passed, 1 skipped by design |
| Prisma schema valid, client generated | VERIFIED | `prisma validate`, `prisma generate` |
| Migrations apply cleanly; HNSW-index guard | VERIFIED | `migrate status` up to date on `vyra` and `vyra_test`; `check-migrations.sh` OK |
| Environment validation rejects bad config | VERIFIED | mock payments in production, bad `DATABASE_URL` and short JWT secret all rejected |
| CI workflow updated (audit gate, nightly run) | NOT RUN | changes pushed; the workflow has not run on GitHub from this environment |

## API
| Item | Status | Evidence |
| --- | --- | --- |
| All current routes discovered (178 = 168 baseline + 10 added, 0 removed) | VERIFIED | contract sweep discovery |
| Authentication, realm isolation, RBAC, CSRF, validation, unknown ids, envelope on every route | VERIFIED | contract sweep: 9/9 checks green |
| Every route has a success path in a passing test | VERIFIED | route recorder: 178/178 |
| Response schemas | VERIFIED (partially) | envelope shape on every response; exact DTO fields asserted only for tested fields, not a full JSON-schema per route |

## Data and money integrity
| Item | Status | Evidence |
| --- | --- | --- |
| No overselling under concurrent checkout | VERIFIED | concurrency spec (last unit, 4 buyers) |
| Idempotent checkout | VERIFIED | same key ×3 concurrent → 1 order |
| Duplicate payment callbacks capture once | VERIFIED | verify ×2 + webhook ×2 concurrent |
| Refunds never exceed the amount paid | VERIFIED | BUG-001 fixed |
| A return is refunded and restocked once | VERIFIED | BUG-002, BUG-003 fixed |
| Coupon usage limits under concurrency | VERIFIED | |
| Expired orders release stock exactly once | VERIFIED | duplicate expiry job |
| Inventory ledger reconciles | VERIFIED | `consistent: true` after every concurrency, journey and webhook test |
| Campaign budget exhaustion under concurrency | VERIFIED (sequential) / NOT RUN (concurrent) | can overshoot by the orders in flight (documented design) |
| Backups and restore drill | NOT RUN this pass | `infrastructure/deployment/backup.sh` exists; a restore drill ran in an earlier round |

## Security
| Item | Status | Evidence |
| --- | --- | --- |
| Critical/high dependency advisories | FAILED (1 high open) | multer DoS; patch only 12 days old. Upgrade after 2026-11-05. 0 critical |
| Cookie flags | VERIFIED | HttpOnly, SameSite=Lax, path-scoped refresh |
| `COOKIE_SECURE=true` and HTTPS in production | BLOCKED | deployment config |
| Session rotation and theft detection | VERIFIED | |
| Sale reminder abuse, tracking enumeration, health disclosure | VERIFIED fixed | BUG-008/009/010 |
| Rate limiting across multiple API instances | BLOCKED | throttler store is in memory; needs Redis-backed storage before running more than one instance |
| Deployment behind exactly one trusted proxy (`X-Forwarded-For`) | BLOCKED | deployment config; otherwise per-IP limits can be spoofed |
| Penetration test / SAST | NOT RUN | |

## External integrations
| Integration | Status | Notes |
| --- | --- | --- |
| Razorpay orders, verify, webhook, refunds | BLOCKED | no sandbox keys; mock provider uses the same signature/verify/refund code paths |
| Shiprocket shipments | BLOCKED | no API user |
| Shiprocket tracking webhook | BLOCKED (live) / VERIFIED (contract) | payload format from a third-party description, unconfirmed |
| MSG91 OTP SMS | BLOCKED | no DLT template; console provider verified |
| WhatsApp Business templates (incl. `vyra_sale_live`, `vyra_sale_ending`) | BLOCKED | no Meta credentials or approved templates |
| SMTP (verification, reset, order, newsletter confirm) | BLOCKED | no SMTP host; emails recorded as skipped |
| Gemini embeddings / search | VERIFIED in an earlier round; NOT RUN live this pass | local provider in tests |
| Gemini AI photos / virtual try-on | NOT RUN live (paid) | stubbed in tests; request URL verified in browser |
| S3/R2 storage | BLOCKED | local storage driver verified; no bucket |
| Sentry | BLOCKED | no DSN; scrubbing logic reviewed, job-failure reporting added |
| Redis / BullMQ schedulers | VERIFIED | schedulers registered; no failed jobs; failed jobs retained (5,000) and now reported |

## Performance and reliability
| Item | Status | Evidence |
| --- | --- | --- |
| Latency/throughput baseline | VERIFIED | `PERFORMANCE_REPORT.md`: 0 errors in 12,000 requests up to c=50 |
| N+1 queries | VERIFIED none on measured endpoints | constant queries per request |
| Memory stability under repeated load | VERIFIED | plateau around 560 MB |
| Multi-instance / production-size load test | NOT RUN | |

## Business and legal (not code)
| Item | Status |
| --- | --- |
| GST slab logic confirmed by a CA | BLOCKED |
| Real product photography replacing AI demo images | BLOCKED |
| Seller GSTIN and address on invoices | BLOCKED |
| Decision on review pre- vs post-moderation (implemented: post-moderation) | NOT APPLICABLE (decision recorded; reversible) |

## Verdict: **NOT READY**
The code paths are verified in isolation, and the P0 money/stock races found in this pass are fixed. But a live shop still needs:
- real payment, SMS, WhatsApp, email and storage credentials, each tested against its sandbox
- HTTPS with `COOKIE_SECURE`
- one trusted proxy hop, or a Redis-backed rate limiter
- the multer upgrade
- a CI run on GitHub

Once those items are VERIFIED, this becomes READY WITH DOCUMENTED LIMITATIONS.
