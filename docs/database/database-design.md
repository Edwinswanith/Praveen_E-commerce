# Database design

PostgreSQL 16 with `vector` (pgvector) and `pg_trgm`. Schema: `apps/api/prisma/schema.prisma`; migrations in `apps/api/prisma/migrations`.

## Conventions
- `cuid` string ids. Tables are snake_case (`@@map`). Timestamps are `timestamptz(3)` in UTC (analytics buckets days in Asia/Kolkata).
- Money is `DECIMAL(12,2)` rupees and is computed in integer paise in code.
- Soft delete (`deletedAt`) on users, addresses, categories, products and coupons. History tables are never deleted from.
- Business statuses are Postgres enums, mirrored in `@vyra/shared`; a unit test asserts parity.

## Domains
| Domain | Tables |
| --- | --- |
| Identity | `users`, `roles`, `permissions`, `role_permissions`, `sessions` (hashed rotating refresh tokens), `user_tokens` (email verify / reset, hashed), `customer_profiles`, `addresses` |
| Catalog | `categories` (self-referencing tree, 3-letter SKU code), `products` (denormalised `minPrice`/`maxDiscount`/rating/soldCount for listing speed), `product_attributes` (key/value, filterable), `product_variants` (**the sellable unit**: SKU, colour, size, MRP, price, cost), `product_images`, `product_videos` |
| Barcodes | `barcodes` (unique `value`; EAN13 primary + CODE128), `barcode_sequences` (atomic counter per prefix) |
| Inventory | `inventory` (1:1 variant: `onHand`, `reserved`, `version`), `inventory_movements` (append-only ledger with signed deltas and after-values), `scan_events`, `suppliers`, `purchase_orders`, `purchase_order_items` |
| Shopping | `carts` (user or guest token), `cart_items`, `wishlists`, `wishlist_items` |
| Orders | `orders` (address snapshot JSON, totals, `idempotencyKey` unique, `reservationExpiresAt`), `order_items` (immutable price/tax snapshot), `order_events` (timeline), `payments`, `refunds`, `webhook_events` (unique provider+eventId), `shipments`, `shipment_events`, `return_requests`, `return_items` |
| Promotions | `coupons` (atomic `usedCount`), `coupon_usages` (1 per order), `reviews` (unique per user+product) |
| AI | `product_embeddings` (`vector(768)`, `model`, `kind`, `contentHash`), `embedding_jobs`, `search_history` |
| Platform | `notifications` (every email recorded, status `skipped` when SMTP is pending), `audit_logs`, `newsletter_subscribers` |

## Integrity rules (hand-written SQL in the init migration)
- `inventory`: `onHand ≥ 0`, `reserved ≥ 0`, `reserved ≤ onHand`.
- `product_variants`: `0 ≤ price ≤ mrp`. `order_items`: `0 ≤ returnedQuantity ≤ quantity`. `reviews`: rating 1–5. Coupon value > 0.
- Trigger `inventory_movements_append_only` rejects UPDATE/DELETE on the ledger.
- `product_embeddings_vector_hnsw` HNSW index (`vector_cosine_ops`). `products_name_trgm` GIN trigram index.
- Unique: SKU, barcode value, (product, colour, size), order number, idempotency key, provider order/payment/refund ids, (provider, webhook event id).

## Key indexes
`products(status, categoryId)`, `(status, gender)`, `(status, minPrice)`. `inventory_movements(variantId, createdAt)`. `orders(userId, createdAt)`, `(status, createdAt)`, `(reservationExpiresAt)` for the expiry sweeper. `product_embeddings(model, kind)`.

## Backups
Use the managed Postgres provider's PITR (7–30 days), plus a nightly `pg_dump --format=custom` to a separate bucket and a monthly restore drill. See the deployment guide.
