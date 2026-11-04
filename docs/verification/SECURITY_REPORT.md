# Security report

Scope: the VYRA API (178 routes), storefront and admin, verified in an isolated local environment on 3–4 Nov 2026. "Verified" means exercised by an automated test that passed. No production system, real payment or real customer message was touched.

## 1. Authentication and sessions

| Control | Result | Evidence |
| --- | --- | --- |
| Separate realms: customer `vyra_at`/`vyra_rt`, staff `vyra_staff_at`/`vyra_staff_rt` | VERIFIED | Contract sweep "realm" check: customer tokens get 401 on every staff route and staff tokens get 401 on every customer-only route (all 178 routes checked) |
| Every protected route rejects anonymous calls with 401 + error envelope | VERIFIED | Contract sweep "unauthenticated" check |
| Cookie flags: HttpOnly, SameSite=Lax, refresh cookie path-scoped to `/api/v1/auth` | VERIFIED | `hardening.e2e-spec.ts` "session cookies". `Secure` follows `COOKIE_SECURE` (false in tests, must be true in production; see readiness checklist) |
| Refresh-token rotation, single use, reuse detection revokes the family | VERIFIED | `concurrency.e2e-spec.ts` stolen-token test |
| Concurrent refresh (two tabs) | FIXED (BUG-004) | 30 s grace for a just-rotated token; replay after the window or of a logged-out token still revokes everything |
| A cookieless refresh never clears another session | FIXED (BUG-016) | regression test + browser journeys |
| Disabled accounts and role changes take effect on the next request | VERIFIED by design | The guard re-reads the user and role on every request (`auth.guard.ts`); role change tested in `positive-paths.e2e-spec.ts` |
| Access tokens are not revoked on logout | ACCEPTED LIMITATION | Access JWTs stay valid until expiry (`ACCESS_TOKEN_TTL_SECONDS`); refresh is revoked immediately. Keep the TTL short |
| OTP login only for verified phones; OTPs hashed, never logged in production | VERIFIED (existing tests) | `growth.e2e-spec.ts` |
| Brute force: login 10/min per IP, OTP request 5/min, forgot-password 5/min, lockout on repeated failures | VERIFIED (existing tests) | |

## 2. Authorization

- **Permission matrix:** the contract sweep calls every staff route as ADMIN, INVENTORY_MANAGER and ORDER_MANAGER. Each route is allowed exactly when the role holds all its permissions, and refused with 403 FORBIDDEN otherwise. All 178 routes PASS.
- **BUG-007 fixed:** support notes now require `customers:write`.
- **New permissions:** `customers:write` (ADMIN, SUPER_ADMIN, ORDER_MANAGER) and `reviews:moderate` (ADMIN, SUPER_ADMIN). Neither widens any role's existing access.
- **IDOR:** customers can't read, edit or delete another customer's addresses (`positive-paths`), orders (`/orders/:number` checks ownership) or returns. Unknown ids answer 4xx on every parameterised route (sweep "unknown-id").

## 3. CSRF and webhooks

- Every cookie-authenticated mutation (all non-GET routes) is refused with 403 "Missing CSRF header" without `X-Requested-With: vyra`. This is checked on every route by the sweep.
- Only the exact paths in `WEBHOOK_PATHS` are exempt: `/api/v1/payments/razorpay/webhook` and `/api/v1/shipping/shiprocket/webhook`. Query strings are tolerated; look-alike paths (`…/webhook2`, `…/webhook/extra`) are not exempt. Tested through the real middleware chain in `shipping-webhook.e2e-spec.ts`.
- **Razorpay webhook:** HMAC signature over the raw body; deduplicated by event id. A verify call and a webhook for the same payment arriving at once capture it exactly once (`concurrency.e2e-spec.ts`). Verified against the mock provider's signing only; **live Razorpay: BLOCKED** (no sandbox keys).
- **Shiprocket webhook (new):** constant-time token check on `x-api-key`; refuses everything (503) when no token is configured; replay-safe; restocks only on "RTO DELIVERED". The payload format comes from a third-party description, not official docs (official docs weren't reachable from this environment), so **live Shiprocket: BLOCKED / unverified**.

## 4. Information disclosure

| Finding | Status |
| --- | --- |
| Public `/health` exposed version and integration configuration | FIXED (BUG-010): staff-only `/admin/system/health` |
| Guest tracking returned the full address, phone and email | FIXED (BUG-009): masked |
| Stack traces in responses | VERIFIED none: the sweep's envelope check scans every response for `"stack"` |
| PII in error logs via query strings | FIXED (BUG-018) |
| Sentry events | cookies, request bodies and `cookie`/`authorization`/`x-razorpay-signature` headers stripped before sending |
| Newsletter responses reveal list membership | Never: same `{ok: true}` for every state |
| Forgot-password reveals accounts | Never: always 200 (tested) |

## 5. Abuse prevention

- **Sale reminders:** phone ownership proven by OTP; signed-in customers only use their own verified phone; consent recorded and withdrawable (BUG-008).
- **Order tracking:** per-IP limit plus cross-IP lockouts per contact and per order number (BUG-009).
- **Newsletter:** double opt-in, at most 3 confirmation emails per address per day, signed unsubscribe links, suppression list kept.
- **Try-on and visual search:** existing per-session and global caps; photos never persisted (CLAUDE.md rule 16).
- **Rate-limit caveat:** limits key on the client IP via `trust proxy 1`. If the API is reachable directly (not only through one proxy hop), clients can spoof `X-Forwarded-For` and bypass per-IP limits. Deploy behind exactly one trusted proxy, or adjust `trust proxy`. The cross-IP `AttemptLimiter` lockouts are not affected.
- **Rate-limit store:** the global throttler is in memory per API instance. With several instances the effective limit multiplies. Pending: move the throttler to Redis.

## 6. Financial integrity (security-relevant)

All verified under real concurrency (`concurrency.e2e-spec.ts`, 10 tests, 3 consecutive green runs):
- refunds can't exceed the amount paid
- a return is refunded and restocked once
- the last unit goes to exactly one buyer
- an idempotency key creates one order
- a coupon at its usage limit is redeemed once
- a duplicate payment callback captures once
- the duplicate expiry job restocks once

The ledger reconciliation reports consistent after each.

## 7. Dependencies

`pnpm audit --prod`: **70 → 6 advisories** (critical 4 → 0, high 26 → 1).

| Package | Severity | Status |
| --- | --- | --- |
| next 15.5.6 (critical RCE, DoS, source exposure) | critical/high | Upgraded to 15.5.28 |
| nodemailer 7 (SMTP command injection) | high/moderate | Upgraded to 10.1.7 |
| sharp 0.34 (libvips CVEs), incl. Next's bundled copy | high | 0.35.5 + override |
| postcss (Next's bundled copy), effect, deepmerge-ts | high | pnpm overrides |
| **multer 2.4.0** (DoS) | **high, OPEN** | Fix 2.5.0 is only 12 days old (two-week rule). Mitigated by upload size/count limits on every upload route. Upgrade after 2026-11-05 |
| uuid, csv-parse, js-yaml, minimatch (transitive) | moderate, OPEN | Transitive via exceljs/swagger; no direct exposure found |

CI now fails on any critical advisory (`pnpm audit --prod --audit-level=critical`).

## 8. Not verified

- penetration testing
- TLS and headers on a real deployment
- WAF and DDoS protection
- live third-party webhooks
- secrets management in the target environment
- a real linter / SAST: the `lint` scripts only run `tsc`; there is no ESLint or Semgrep
