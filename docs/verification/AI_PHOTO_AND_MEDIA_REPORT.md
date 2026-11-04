# Product images, barcodes and AI photo enhancement

Pass on branch `claude/youthful-brown-kd52jo`, 4 Nov 2026, in the same isolated environment as `SYSTEM_VERIFICATION_REPORT.md`: local Postgres and Redis, the dev database, and production builds of the storefront and admin. One real Gemini call was made; everything else used a stubbed generator.

## 1. What existed and was verified before any change (runtime, not just tests)

| Check | Result |
| --- | --- |
| Admin upload `POST /admin/products/:id/images` (a JPEG with EXIF) | 201. Served at `/media/...webp` as `image/webp`: 900×1200 display + 600×800 thumbnail, **EXIF stripped** |
| Image reaches the public PDP API and the storefront page | API immediately. Storefront `/p/:slug` HTML within 3.4 s (production build, ISR 60 s) |
| Delete removes the row and both files | 200, file then 404 |
| Barcode PNGs decoded with ZXing | EAN-13 `2000000001616`, Code 128 = SKU, QR = `${STOREFRONT_URL}/s/<SKU>`. All three decode, and each decoded value scanned back via `POST /admin/scans` to the right SKU |
| Scans never change stock (CLAUDE.md rule 4) | inventory byte-identical before/after three scans |
| Label sheet `POST /admin/barcodes/labels` | 200 `application/pdf` (valid `%PDF-`) |
| `generate-missing` | 200 `{generated: 0}`: every variant already has an EAN-13 |
| Ledger reconcile | `consistent: true` |

Not verified: physical camera scanning on a device (the scanner page decodes in the browser; only the decode library was exercised here). The listing-card check in my runtime script timed out without a match, so I don't count it as verified at runtime. It is covered by the integration test instead (see section 3).

**Gap found in the old AI flow:** `POST /images/generate` saved results straight onto the product with no review. It also accepted live products **without a real source photo**, which breaks CLAUDE.md rule 15. Fixed below.

## 2. What was built

Flow: upload the original, then generate a preview, compare it side by side, then **Use this photo** / **Regenerate** / **Keep original**.

- **Original stays untouched.** It's a normal product image uploaded through the existing route. The AI result is a *separate* `product_images` row with `aiGenerated = true` and a new `sourceImageId` link (FK, `ON DELETE SET NULL`).
- **Real image-to-image.** The stored original's bytes are sent to Gemini (`IMAGE_GEN_MODEL`) as `inline_data` with the prompt. The prompt demands an exact reproduction of colour, texture, print placement, neckline, sleeves, hem, buttons and proportions, and allows changes only to background, lighting, framing and presentation.
- **New `MARKETPLACE` style (default):** product only, pure white `#FFFFFF`, ~85% of the frame, soft contact shadow, no person. The preview reports `edgeWhiteRatio`, and the UI warns when the background isn't white enough for a marketplace main image.
- **Preview is not part of the product.** The raw output is held 30 min in Redis (memory when queues are off), max 6 per product, then expires by itself. No orphan files. The preview is the exact WebP that accept will store (same deterministic pipeline).
- **Accept** stores it through the existing `MediaService` pipeline, optionally as the cover (`PRIMARY`), and re-queues search embeddings. It's race-safe: exactly one of several concurrent accepts wins.
- **Rule 15 enforced on both routes:** an ACTIVE product needs a real (non-AI) source photo. AI-of-AI sources are refused, to stop drift. Refusals happen before the paid call.
- **Admin UI:**
  - upload a photo inside the dialog
  - an "Enhance with AI" action on every real photo
  - loading state, inline errors
  - the "From product details" option hidden for live products
  - a fidelity reminder before accepting
- Audit events: `product.image.ai_preview`, `product.image.ai_accept`.

## 3. Evidence

| Layer | Result |
| --- | --- |
| API integration (`ai-photo.e2e-spec.ts`, stubbed Gemini) | 8/8 tests. Covers:<ul><li>preview saves nothing</li><li>accept PRIMARY becomes cover on the PDP, listing card and scanner</li><li>original row and file byte-identical</li><li>stored bytes equal previewed bytes</li><li>double accept 404</li><li>3 concurrent accepts → 1 image</li><li>regenerate / discard (idempotent)</li><li>rule 15 on both routes with no paid call on refusal</li><li>cross-product accept refused</li><li>expiry</li><li>RBAC</li><li>422</li></ul> |
| Preview store against real Redis (`photo-preview-store.spec.ts`) | binary round-trip, TTL, one-winner `take`, per-product cap, memory fallback. Found and fixed a same-millisecond eviction bug in the memory fallback |
| Contract sweep | 181 routes (178 + 3), all 9 checks green. `DELETE …/ai-previews/:previewId` is a listed idempotent-delete exception |
| Admin unit (`ai-photo-dialog.test.tsx`) | 4 tests: compare view, accept body, regenerate discards the old preview, keep original saves nothing, error shown, live product + in-dialog upload |
| Browser (`admin-journeys.spec.ts`) | real admin build: real-photo upload through the dialog, compare view renders the image, regenerate, keep original (real API), accept. Only the paid generation and its accept are intercepted |
| **Live Gemini** (1 call) | a synthetic "phone photo" (the dress on a model, rotated on a cluttered table) became a 928×1152 white-background product shot in **8.2 s**, `edgeWhiteRatio = 1.0`, accepted as cover through Redis, on the storefront PDP within 3.2 s. Colour, smocked square neckline, elastic puff sleeves, three tiers and floral print were preserved. The model, table and props were removed. Test data was removed afterwards. Side by side: `assets/ai-photo-live-compare.webp` |
| Full regression | typecheck 6/6; tests **413 passed** (shared 40, admin 135, storefront 107, API 131); production build 4/4 |

## 4. Honest limits

- **Prints are re-rendered, not copied.** The live result kept the motif style, colours and density, but individual flowers aren't pixel-identical to the original. Every generative model behaves this way, and it's why acceptance is a human decision with a fidelity reminder, not an automatic step. For prints where exact placement matters, use the real photo as the cover.
- The `edgeWhiteRatio` check covers the background only. Nothing automated checks that the garment matches; staff must compare.
- Each preview is a paid call. It's capped by throttle (10/min per client) and the 6-preview limit, but there is **no daily budget**. Add one (like `TRYON_*`) if many staff will use it.
- The storefront shows a new cover after ISR revalidation (60 s worst case). On-demand revalidation was not added.
- E2E stability:
  - Back-to-back local runs on one long-lived dev database hit two problems that weren't regressions. First, one `409 out of stock`: the 30-minute reservations from about 10 runs in an hour drained the size the tests pick. Second, a funnel test that broke once more than 20 one-session sources tied.
  - Fixed the funnel flake: the API now orders ties deterministically (`ORDER BY sessions DESC, source`), and the test uses a stable source.
  - Not fixed: test helpers still pick the most popular product, so stock drain can recur locally. CI uses a fresh database per run.
- Live verification ran against one product photo; output quality will vary with input photos (blur, crumpled garments, heavy shadows).
