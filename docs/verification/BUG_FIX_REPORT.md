# Bug fix report

Verification pass of 3–4 Nov 2026 on branch `claude/youthful-brown-kd52jo`. Every fix has a regression test that failed (or reproduced the defect) before the fix and passes after it. Severity: **P0** data/money/security, **P1** core flow broken, **P2** missing operational function or reliability, **P3** minor.

| ID | Sev | Module | File:line | Status |
| --- | --- | --- | --- | --- |
| BUG-001 | P0 | Refunds | `apps/api/src/modules/orders/orders.service.ts:612` | Fixed, verified |
| BUG-002 | P0 | Returns | `apps/api/src/modules/orders/orders.service.ts:764` + migration `20261103123000_refund_once_per_return` | Fixed, verified |
| BUG-003 | P0 | Returns / inventory | `apps/api/src/modules/orders/orders.service.ts:764` | Fixed, verified |
| BUG-004 | P1 | Auth (refresh rotation) | `apps/api/src/modules/auth/token.service.ts:58` | Fixed, verified |
| BUG-005 | P0 | Dependencies | `apps/*/package.json`, `pnpm-workspace.yaml` | Fixed (1 high remains, see Security report) |
| BUG-006 | P1 | Admin AI photos | `apps/admin/src/features/products/ai-photo-dialog.tsx:43` | Fixed, verified in browser |
| BUG-007 | P1 | Authorization | `apps/api/src/modules/admin/admin.controller.ts:110` | Fixed, verified |
| BUG-008 | P1 | Sale reminders | `apps/api/src/modules/campaigns/campaigns.service.ts:517` + migration `…_sale_reminder_verification` | Fixed, verified |
| BUG-009 | P1 | Order tracking | `apps/api/src/modules/orders/orders.controller.ts:122` | Fixed, verified |
| BUG-010 | P2 | Health | `apps/api/src/modules/admin/health.controller.ts:31` | Fixed, verified |
| BUG-011 | P1 | Config | `packages/shared/src/http.ts:17`, both `next.config.ts`, `turbo.json` | Fixed, verified |
| BUG-012 | P3 | API prefix / CSRF | `apps/api/src/common/http/request-context.ts:4`, `packages/shared/src/http.ts` | Fixed, verified |
| BUG-013 | P2 | Tracking (introduced and caught in this pass) | `orders.controller.ts` mask helper | Fixed before commit |
| BUG-014 | P2 | Barcodes / import | `apps/api/src/modules/inventory/inventory.controller.ts:93` | Fixed, verified |
| BUG-015 | P1 | Product import | `apps/api/src/modules/products/import.service.ts:29` | Fixed, verified |
| BUG-016 | P1 | Auth (cookies) | `apps/api/src/modules/auth/auth.controller.ts:59` | Fixed, verified |
| BUG-017 | P3 | Admin UI | `apps/admin/src/features/customers/customers.tsx:89` | Fixed, verified in browser |
| BUG-018 | P2 | Logging / privacy | `apps/api/src/common/http/exception.filter.ts:52` | Fixed |
| BUG-019 | P2 | Background jobs | `apps/api/src/common/queue/queue.service.ts:74` | Fixed |

Feature gaps closed (audit items G, H, I): review post-moderation (`apps/api/src/modules/products/admin-reviews.controller.ts:26`), newsletter double opt-in (`apps/api/src/modules/newsletter/newsletter.service.ts:28`), Shiprocket tracking webhook (`apps/api/src/modules/shipping/shiprocket-webhook.service.ts:37`).

---

## BUG-001 (P0): concurrent refunds could exceed the amount paid
- **Reproduction:** an online order paid about ₹838 (test fixture). Two staff requests `POST /admin/orders/:id/refunds` for ₹503 each (60% of the payment), sent at the same time, both returned 201 and ₹1,006.00 was recorded as refunded.
- **Root cause:** `refund()` read the already-refunded total, called the payment provider, then inserted the refund row, with no lock. Both requests passed the balance check before either wrote.
- **Fix:** lock the order row (`SELECT … FOR UPDATE`), re-check the refundable balance and insert the refund as PENDING inside that transaction, then call the provider outside the lock. If the provider call fails the refund is marked FAILED, which releases its amount.
- **Test:** `apps/api/test/concurrency.e2e-spec.ts`, "two simultaneous refunds can never exceed what was paid" (failed before, passes after; 3 repeated runs green).
- **Residual risk:** if the API process dies between recording PENDING and the provider call, a PENDING refund with no provider id needs manual review (the amount stays reserved, which is the safe direction).

## BUG-002 (P0): one return refunded three times
- **Reproduction:** three simultaneous `POST /admin/returns/:id/decision {action: REFUND}` all returned 200; the database had 3 refunds totalling ₹2,277.15 (3 × ₹759.05).
- **Root cause:** the status check (`RECEIVED`) happened outside any transaction, so all three passed it.
- **Fix:** at most one live refund per return, enforced under the order lock in `refund()` and by a partial unique index `refunds_one_live_per_return` (`returnRequestId` where status ≠ FAILED). The status update is conditional.
- **Test:** "two simultaneous REFUND decisions on one return refund it exactly once".

## BUG-003 (P0): concurrent RECEIVE decisions restocked twice
- **Reproduction:** order of 2 units, return of 1, three simultaneous RECEIVE decisions: two succeeded, `onHand` increased by 2 (phantom stock). With 1 unit ordered a DB CHECK masked it, which is why the first probe passed.
- **Root cause:** same status-check-outside-transaction pattern.
- **Fix:** every return transition is claimed atomically (`updateMany … where status = expected`); a lost race returns 409.
- **Test:** "two simultaneous RECEIVE decisions restock a return once".

## BUG-004 (P1): parallel tabs refreshing could fork or wipe the session
- **Root cause:** `rotate()` read the session, created a new one, then revoked the old one, with no atomic claim. The slower tab could hit reuse detection and revoke every session of the user.
- **Fix:** atomic claim of the old session; a token rotated less than 30 s ago gets a sibling session; reuse after that window, or of a logged-out token, still revokes the whole family.
- **Tests:** "concurrent refreshes from two tabs keep the customer signed in", "a reused (stolen) refresh token after the grace window revokes the whole family".

## BUG-005 (P0): vulnerable dependencies
- **Reproduction:** `pnpm audit --prod` reported 70 advisories (4 critical, 26 high), including a critical React flight RCE in next 15.5.6, SMTP command injection in nodemailer 7 and libvips CVEs in sharp 0.34.
- **Fix:** next 15.5.28, nodemailer 10.1.7, sharp 0.35.5, plus pnpm overrides for Next's bundled sharp/postcss, `effect` and `deepmerge-ts`. All pinned exactly and at least two weeks old (nodemailer had resolved to a 5-day-old release and was re-pinned).
- **Result:** 6 advisories remain (1 high: multer, whose fix is only 12 days old; 5 moderate in transitive dev/report libraries). CI now fails on critical advisories.
- **Verification:** typecheck, all tests and production builds re-run green; nodemailer sendMail and sharp encode smoke-tested.

## BUG-006 (P1): AI studio photo button always failed with 404
- **Root cause:** the admin client already prefixes `/api/v1/admin`; the dialog passed `/admin/products/…`, producing `/api/v1/admin/admin/products/:id/images/generate`.
- **Fix:** relative path.
- **Tests:** `apps/admin/src/features/products/ai-photo-dialog.test.tsx` asserts the exact `fetch` URL (fails on the old line with the doubled prefix); `e2e/tests/admin-journeys.spec.ts` intercepts the browser request and asserts `/api/v1/admin/products/:id/images/generate`.

## BUG-007 (P1): support notes written under a read-only permission
- **Root cause:** the notes route inherited the controller's `customers:read`; it also accepted staff ids (writing a profile onto a staff account), turned unknown ids into a 500 FK error, and wasn't audited.
- **Fix:** new `customers:write` (ADMIN, SUPER_ADMIN, ORDER_MANAGER: the same people who could write before, now explicit), customer-only 404, audit entry.
- **Tests:** `hardening.e2e-spec.ts` (allowed role, denied role with unchanged data, unknown id, staff id, cross-realm token); the contract sweep checks the matrix for every role.

## BUG-008 (P1): sale reminders subscribed any phone number
- **Fix:** guests confirm the phone with an OTP (new `SALE_REMINDER` purpose); signed-in customers use only their own verified phone (a phone in the body is ignored); WhatsApp goes only to rows with `phoneVerifiedAt`; reminder emails only to accounts; `DELETE /campaigns/:slug/remind-me` withdraws consent. The migration backfills verification only where the phone equals the account's verified phone.
- **Test:** `campaigns.e2e-spec.ts` "sends opted-in reminders once per phase, only to phones their owner verified" (wrong code, ignored body phone, legacy unverified row gets nothing, consent withdrawal); browser journey J.

## BUG-009 (P1): guest order tracking was enumerable and over-exposed
- **Root cause:** order numbers have about 90,000 values per day; only the global 120/min per IP limit applied; the response included the full address, phone and email.
- **Fix:** 10/min per IP; 5 failed attempts per contact and per order number per hour across IPs (Redis-backed `AttemptLimiter`); masked guest view (street address, phone, email, provider ids).
- **Tests:** `hardening.e2e-spec.ts` (masking, lockout across different IPs, number lockout); browser journey G.

## BUG-010 (P2): public health endpoint disclosed configuration
- **Fix:** public `GET /health` returns `{status, db, redis}` only; version and integration state moved to staff-only `GET /admin/system/health` (admin Integrations card updated).

## BUG-011 (P1): production silently defaulted API_URL to localhost
- **Evidence:** the Phase 1 production build fetched `127.0.0.1:4000`. Turbo's strict env mode didn't pass `API_URL` to builds at all.
- **Fix:** `resolveApiUrl()` throws in production when `API_URL` is missing or invalid (next configs, server fetches, QR route); Turbo declares `API_URL`/`NEXT_PUBLIC_*`; CI sets it.
- **Tests:** `packages/shared/src/http.test.ts`; a production storefront build without `API_URL` exits 1 with a clear message.

## BUG-012 (P3): API prefix hard-coded in six places, CSRF exemption a single string
- **Fix:** shared `API_PREFIX` and exact `WEBHOOK_PATHS`, used by bootstrap, CSRF middleware, cookie paths and both apps.
- **Test:** `shipping-webhook.e2e-spec.ts` checks the exact paths are exempt and look-alike paths are not; the contract sweep checks CSRF on every mutation.

## BUG-013 (P2, caught before commit): masking helper leaked the full street address
`maskTail(v, 0)` used `v.slice(-0)`, which returns the whole string. Caught by the hardening test on first run.

## BUG-014 (P2): JSON errors labelled as PDF/CSV
- **Reproduction:** the contract sweep sent an invalid body to `POST /admin/barcodes/labels`; the 422 error body arrived with `Content-Type: application/pdf`.
- **Root cause:** a static `@Header('content-type', …)` applies to error responses too.
- **Fix:** the content type comes from `StreamableFile` (labels and the import template).

## BUG-015 (P1): the downloadable product-import template could not be imported
- **Reproduction:** importing the template's own example row failed: `Unknown category_slug "VYRA"`.
- **Root cause:** the example description contains commas and fields weren't CSV-quoted, so every column after it shifted.
- **Fix:** RFC 4180 quoting. **Test:** `positive-paths.e2e-spec.ts` (template → dry run → commit creates the product).

## BUG-016 (P1): a guest's refresh probe could log out a fresh session
- **Reproduction:** browser journeys intermittently saw a just-registered shopper treated as a guest at checkout (422 "Add an email") and a failed wishlist call.
- **Root cause:** a guest page calls `/auth/refresh` after `/auth/me` returns 401. With no refresh cookie that refresh failed and responded with `Set-Cookie` clearing the session cookies. If it landed after a login (another request or tab), it wiped the new session.
- **Fix:** cookies are cleared only when a refresh cookie was actually sent.
- **Tests:** `hardening.e2e-spec.ts` "session cookies" (no Set-Cookie on a cookieless refresh, still cleared for an invalid cookie, cookie flags); the customer journeys went from intermittent failures to 3/3 green runs.

## BUG-017 (P3): customer page overflowed horizontally
A long unbroken email widened `/customers/:id` by 52 px at 1280 px. Fixed with `break-all`; found by the admin journey's overflow check across all 30 screens.

## BUG-018 (P2): error logs could contain PII
5xx logs recorded `req.url` including the query string (e.g. `/orders/track?phone=…`). Now path only.

## BUG-019 (P2): exhausted background jobs were invisible
Jobs that used up their retries were only logged at warn level. They are now reported to Sentry with queue, job and attempt context.
