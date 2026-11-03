# System architecture

```
 Browser ──► storefront (Next.js, :3000) ──┐  /api/v1/* rewrite (first-party cookies)
 Staff   ──► admin      (Next.js, :3001) ──┤
                                           ▼
                         API (NestJS modular monolith, :4000)
           ┌──────────────┬───────────────┼────────────────┬──────────────┐
      PostgreSQL 16   Redis/BullMQ    Object storage     Razorpay     Shiprocket / Gemini
      (+pgvector,     (embedding jobs, (local or S3/R2)   (payments)   (shipping / embeddings)
       pg_trgm)        expiry sweeper)
                           ▲
                    worker process (same codebase, `dist/src/worker.js`)
```

## Why a modular monolith
Orders, inventory, coupons and payments must commit together in **one database transaction**. Splitting them into services would replace a transaction with sagas and compensations, which adds failure modes for no benefit at single-vendor scale. Domains are separated by folder (`src/modules/*`) and talk through services. A domain can be extracted later only if it needs independent scaling, and the search/embedding pipeline is the most likely candidate.

## Request path
1. Next.js rewrites `/api/v1/*` to the API, so cookies are first-party and there is no CORS in production.
2. Middleware assigns a request id and enforces CSRF (`X-Requested-With: vyra` on mutations).
3. The throttler runs, then the auth guard. The guard picks the audience: staff for `/admin/**`, customer elsewhere. It re-reads the user on every request so deactivation takes effect immediately, then checks permissions.
4. Zod pipes validate input with the same schemas the frontends use (`@vyra/shared`).
5. Handlers return plain objects. The envelope interceptor wraps them as `{data, meta}` and the exception filter maps errors to `{error:{code,…}}`.

## Critical flows

### Checkout (`OrdersService.checkout`)
idempotency check → resolve address → serviceability → re-read the cart from the DB → coupon rules → `priceCart` (paise, GST-inclusive slabs) → **one transaction**: create the order with an item snapshot, `reserveMany` (guarded UPDATEs, all-or-nothing), consume the coupon (atomic counter), create the payment row and the event → clear the bag → create the provider order (ONLINE). If the provider fails, the order is cancelled and the stock released.

### Payment
The widget returns `order_id|payment_id|signature`. The server verifies the HMAC, re-fetches the payment from Razorpay, checks the order id and amount, and captures if only authorised. `markPaid` then runs under a `SELECT … FOR UPDATE` lock, so it is idempotent. The webhook (`payment.captured`) takes the same path and is deduplicated by event id. If a payment arrives after the reservation expired, the order is re-reserved or auto-refunded.

### Stock states
`available = onHand − reserved`. RESERVATION (+reserved) happens at order placement, RELEASE (−reserved) on cancel or expiry, and FULFILLMENT (−onHand, −reserved) on ship. RETURN_RESTOCK (+onHand) runs when a return is received. Manual STOCK_IN, STOCK_OUT and ADJUSTMENT movements require a reason. Every change writes one append-only ledger row; a DB trigger forbids UPDATE and DELETE on the ledger. CHECK constraints make an oversold state impossible to commit.

### AI search
- **Indexing:** a product or image change enqueues a BullMQ job. The worker builds the product text (name, brand, gender, category path, colours, attributes, tags, description) and reads each image. The provider returns vectors, which are stored with `model` and a content hash, and unchanged content is skipped. Failures are recorded in `embedding_jobs` and retried with backoff. Checkout never waits on any of this.
- **Text query:** `parseSearchQuery` turns price, colour, gender and size into SQL filters. The remaining text is embedded. The HNSW candidate pool is filtered and max-aggregated per product, keyword tokens add a boost, and a relative score cutoff drops the tail. If the provider fails, search falls back to keyword (trigram) search.
- **Visual query:** the photo is validated and re-encoded, embedded, and matched against image vectors (plus text vectors, because Gemini is multimodal). Optional text refinement blends 65/35.
