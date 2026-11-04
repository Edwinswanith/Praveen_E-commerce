# System verification report

Verification pass on branch `claude/youthful-brown-kd52jo`, 3–4 Nov 2026. Everything below was run in an isolated environment: a local cloud container with a local PostgreSQL and Redis, the dev and test databases, a mock payment provider and console SMS. No production data, live payment or real customer message was involved.

Companion documents:
- `API_VERIFICATION_MATRIX.csv`: one row per endpoint with evidence
- `BUG_FIX_REPORT.md`
- `E2E_TEST_REPORT.md`
- `SECURITY_REPORT.md`
- `PERFORMANCE_REPORT.md`
- `PRODUCTION_READINESS_CHECKLIST.md`

## 1. Environment
| Component | Version |
| --- | --- |
| OS / CPU / RAM | Linux 6.18 container, 4 vCPU, 16 GB |
| Node / pnpm | 22.23.4 / 10.28.0 |
| PostgreSQL / pgvector | 16.15 / 0.6.0 (native; no Docker daemon available) |
| Redis | 7.0.15 |
| NestJS / Prisma / BullMQ | 11.2.8 / 6.19.0 / 5.81.5 |
| Next.js | 15.5.28 (upgraded from 15.5.6) |
| Playwright / Chromium | 1.63.0 |

Architecture matched the audit: a NestJS modular monolith, two Next.js apps, a Zod shared contract, Prisma over Postgres + pgvector, and BullMQ on Redis.

**Environment caveats:**
- The container restarted twice during the pass, so services were re-started and dependencies re-installed; the steps are repeatable.
- No Docker daemon, so the Docker images were not built.

## 2. Commands executed (final state)
| Command | Exit | Result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | |
| `prisma validate` / `prisma generate` | 0 / 0 | |
| `prisma migrate status` (vyra, vyra_test) | 0 | up to date (3 new migrations this pass) |
| `apps/api/scripts/check-migrations.sh` | 0 | no HNSW drop |
| `pnpm typecheck` | 0 | 6/6 tasks |
| `pnpm lint` | 0 | `tsc` only; no real linter configured |
| `pnpm test --force` | 0 | shared 40, admin 132, storefront 107, API 119 = **398 passed** |
| `pnpm build --force` (`NODE_ENV=production`, `API_URL` set) | 0 | 4/4 |
| storefront build without `API_URL` | 1 | intended fail-fast (BUG-011) |
| `pnpm e2e` (production builds) | 0 | **28 passed**, 1 skipped by design |
| `pnpm audit --prod` | 1 | 6 advisories (1 high, 5 moderate); `--audit-level=critical` passes |
| `node scripts/perf/bench.mjs` (c=1/10/50) | 0 | 0 errors in 12,000 requests |

Baseline at the start of the pass: typecheck, tests (306) and builds were green, but `pnpm audit` reported 70 advisories (4 critical), and the build fetched `localhost:4000` silently.

## 3. Endpoint verification
- **Baseline:** 168 endpoints (audit). **Now:** 178. Added: newsletter confirm/unsubscribe and admin list/export, admin reviews list/hide/publish, staff system health, Shiprocket webhook, reminder withdrawal. **Removed:** 0.
- **Actually tested at runtime:** 178.
- **Results:**

| Status | Count |
| --- | ---: |
| PASS (isolated environment) | 178 |
| FAIL | 0 |
| BLOCKED | 0 |
| NOT RUN | 0 |

  19 endpoints additionally carry a "live integration: BLOCKED" note (Razorpay, Shiprocket, MSG91 or SMTP).
- **Method:**
  - The contract sweep discovers routes from Nest metadata at runtime. On every route it checks 401 for anonymous callers, realm isolation, the 3-role permission matrix, CSRF, 422 validation, 4xx for unknown ids, the envelope and the absence of stack traces.
  - A test-only route recorder logged every status observed across all 13 API suites. 178/178 routes returned a 2xx inside a passing test, 53 of them via the new `positive-paths` spec.
  - Mutations assert the database state, not just the HTTP code.

## 4. Failures found and fixed
19 defects (4 × P0, 8 × P1, 5 × P2, 2 × P3) plus 3 audit feature gaps (review moderation, newsletter lifecycle, Shiprocket webhook). Full details in `BUG_FIX_REPORT.md`.

The most serious:
- **BUG-001:** concurrent refunds over-refunded (₹1,006 refunded on an ≈₹838 payment).
- **BUG-002:** one return refunded three times.
- **BUG-003:** concurrent receives restocked twice (phantom stock).
- **BUG-005:** the critical Next.js RCE advisory.
- **BUG-016:** a guest refresh probe could sign a shopper out.
- **BUG-011:** silent production fallback to localhost.
- **BUG-015:** the product import template could not be imported.

## 5. Audit gaps (Phase 8) outcome
| Gap | Outcome |
| --- | --- |
| A. Sale reminders with arbitrary phones | Fixed: OTP for guests, account-verified phone only, consent and withdrawal |
| B. Notes write under read permission | Fixed: `customers:write` |
| C. Tracking enumeration | Fixed: per-IP + cross-IP lockouts, masked view |
| D. Health disclosure | Fixed: public minimal, staff `/admin/system/health` |
| E. Localhost API_URL defaults | Fixed: fail-fast `resolveApiUrl`, Turbo env, CI env |
| F. Prefix / CSRF config | Fixed: shared `API_PREFIX`, exact `WEBHOOK_PATHS`, tested through the middleware |
| G. Review moderation | Implemented: post-moderation with reasons, audit, rating recompute; admin page |
| H. Newsletter lifecycle | Implemented: double opt-in, signed unsubscribe, suppression, admin list/export; storefront pages |
| I. Shiprocket webhooks | Implemented (token, replay-safe, conservative mapping); live BLOCKED |
| J. Backend-only APIs | Notes, barcode backfill and ledger check now have admin UI. The Razorpay webhook stays server-to-server |

## 6. Services verified
- API, storefront and admin started from production builds.
- Postgres and Redis connectivity checked.
- BullMQ schedulers registered (reservation expiry, abandoned bags, campaign sweep, analytics); 0 failed jobs.
- The campaign sweep ran inline in tests.

## 7. Remaining blockers
See `PRODUCTION_READINESS_CHECKLIST.md`. In short:
- **Provider credentials and sandboxes:** Razorpay, Shiprocket, MSG91, WhatsApp, SMTP, S3/R2, Sentry.
- **Deployment configuration:** HTTPS with `COOKIE_SECURE`, one trusted proxy, and a Redis-backed throttler for more than one instance.
- **Pending upgrade:** multer (after 2026-11-05).
- **Missing tooling:** a real linter / SAST.
- **CI:** the workflow has not run on GitHub yet.
- **Business sign-offs:** GST, real product photos, seller details.

## 8. Production readiness: **NOT READY**
Local verification is strong: 398 + 28 tests, every endpoint exercised, and the concurrency invariants hold. But no live payment, messaging, shipping or storage provider has been exercised, and the deployment-level controls above are unverified. Local tests passing does not make the system production-ready.
