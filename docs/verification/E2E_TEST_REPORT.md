# End-to-end test report

Final run: 4 Nov 2026, `pnpm e2e` (Playwright 1.63, Chromium). It ran against production builds (`next build` + `next start`) of the storefront (:3000) and admin (:3001), and the compiled API (:4000) on the seeded dev database. Payments used the mock provider (`TEST MODE`); SMS used the console provider (OTP shown in dev).

**Result: 28 passed, 1 skipped, 0 failed (1.2 min).** The skip is a mobile-only test that the desktop project skips by design; it runs and passes in the mobile (Pixel 7) project.

The new journey specs were also run 3 times in a row before the final run: 3/3 green.

Every new journey:
- fails on any browser console error (guest `/auth/me` 401 probes excepted, by design)
- verifies server state through the API after its UI actions

## Customer journeys

| Journey | Test | What is verified | Result |
| --- | --- | --- | --- |
| A. Account | `journeys.spec.ts` A | email sign-up via the form, session confirmed by `/auth/me`, sign out from the account menu (401 afterwards), sign in again, account page shows the name | PASS |
| A'. Phone account | `phone-cod.spec.ts` | phone OTP sign-up (existing) | PASS |
| B. Discovery | `journeys.spec.ts` B | category page, sort by price (listing API order checked ascending), product page, size selection (`aria-checked`) | PASS |
| C. Search | `journeys.spec.ts` C | suggestions listbox, Enter → results; a no-result query shows the empty state; `<script>` and special characters render as text (no injected script, HTTP 200); an empty query doesn't error | PASS |
| D. Bag | `journeys.spec.ts` D | quantity +1, save for later, move to bag, apply the seed coupon VIBE10 (UI total equals the server's `grandTotal`), remove coupon, remove item; each step checked against `GET /cart` | PASS |
| E. Online checkout | `prepaid-and-ops.spec.ts` | guest prepaid purchase, TEST MODE payment, server-side signature verification, confirmation (existing) | PASS (mock provider; live Razorpay BLOCKED) |
| F. Cash on delivery | `phone-cod.spec.ts` (×2) | COD order → OTP confirmation → staff packs and ships; unconfirmed COD can't be packed (existing) | PASS (console SMS; live MSG91 BLOCKED) |
| G. Order management | `journeys.spec.ts` G | order detail page, guest tracking (masked address note shown), cancel with a reason → CANCELLED, a second cancel → 400 | PASS |
| H. Returns and refunds | `journeys.spec.ts` H | delivered order, return dialog, refund preview shown before submitting, return created, staff APPROVE → RECEIVE → REFUND; refunds sum equals the previewed amount; return REFUNDED; ledger consistent | PASS |
| I. Wishlist and reviews | `journeys.spec.ts` I | wishlist heart → `/wishlist/ids`, wishlist page; write a 4-star review → visible on the page and in the public reviews API (post-moderation: publishes immediately) | PASS |
| J. Campaigns and AI | `journeys.spec.ts` J; `festival-sale.spec.ts` (×2) | teaser sale published via the admin API; guest reminder: phone → OTP code step → subscribed (then cleaned up); visual search with a product photo returns products. Festival banner claim, landing page, PDP sale price and bag agree with the server; unknown sale → 404 | PASS. Virtual try-on: NOT RUN live (paid Gemini call; covered by API tests with a stub) |
| Mobile | `prepaid-and-ops.spec.ts`, `funnel-and-mobile.spec.ts` | phone-width layout, sticky add-to-bag, garment-tag QR deep link, funnel attribution (desktop and Pixel 7) | PASS |

## Admin journeys (`admin-journeys.spec.ts`, one shared staff login)

| Area | What is verified | Result |
| --- | --- | --- |
| All screens | 30 admin screens load (dashboard, products, product detail/new/import, categories, inventory, movements, purchase orders, suppliers, barcodes, scanner, orders + detail, returns, COD, customers + detail, campaigns + detail/new/edit, promotions, reviews, newsletter, analytics, conversion, settings) with no console errors and no horizontal overflow at 1280 px | PASS (after fixing BUG-017) |
| Categories | create, edit, delete through the UI (in-app confirm), each checked via the API; leftovers from interrupted runs cleaned | PASS |
| AI studio photo | dialog sends `POST /api/v1/admin/products/:id/images/generate`, intercepted so no paid generation runs; a doubled `/admin` prefix fails the test | PASS (BUG-006) |
| Reviews | hide with a reason → hidden in the API; restore with a reason → published | PASS |
| Inventory and newsletter | stock ledger check shows consistent (API agrees); "Export confirmed (CSV)" downloads a `.csv` | PASS |
| Customer notes | edit and save on the customer page → API shows the note; original restored | PASS |
| Scanner and ledger | barcode scan identifies without changing stock; explicit receive writes the ledger (existing) | PASS |

## API integration coverage behind the journeys

13 jest suites, 119 tests against real PostgreSQL. Among them:
- `contract-sweep` (9 checks × 178 routes)
- `positive-paths` (14)
- `concurrency` (10)
- `hardening` (15)
- `shipping-webhook` (5)

With the route recorder enabled, **178 of 178 routes** were observed returning a success status inside a passing test. Details per endpoint: `API_VERIFICATION_MATRIX.csv`.

## Defects found by the journeys
- **BUG-016:** intermittent sign-out caused by the guest refresh probe.
- **BUG-017:** customer page overflow.

Several test-side selector issues were also fixed; the UI's own labels were correct (e.g. descriptive review button names).

## Not covered in the browser
- real payment pages and real SMS/WhatsApp/email delivery (no provider credentials)
- live virtual try-on and live AI photo generation (paid)
- physical-device camera scanning
- Safari and Firefox (Chromium only)
