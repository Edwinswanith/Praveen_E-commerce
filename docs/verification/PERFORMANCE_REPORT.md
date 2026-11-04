# Performance report

Measured 4 Nov 2026 in an isolated local environment. These numbers describe this machine, not production; no targets were set in advance and none are invented here.

## Environment
- 4 vCPU, 16 GB RAM, Linux 6.18; Node 22.23.4; PostgreSQL 16.15 + pgvector 0.6.0; Redis 7.0.15; all on one host.
- API: one Node process (compiled NestJS, `NODE_ENV=development`, Gemini embeddings configured). Dev database: 33 products / ~150 variants, seeded orders.
- Tool: `scripts/perf/bench.mjs` (no dependencies). Per endpoint: 10 warm-up requests, then N requests at concurrency C. Queries per request come from `pg_stat_statements` deltas; RSS and CPU from `/proc`. Each request carries a distinct `X-Forwarded-For` so per-IP throttles model many shoppers.
- Reproduce:

```bash
API_URL=http://localhost:4000 DB_URL=postgresql://… API_PID=<api pid> STAFF_EMAIL=… STAFF_PASSWORD=… node scripts/perf/bench.mjs 200 10
```

## Results (c=1: 100 requests, c=10: 200, c=50: 500 per endpoint)

| Endpoint | Queries/req | c=1 p50 / p95 ms | c=10 p50 / p95 / p99 ms | c=10 req/s | c=50 p50 / p95 / p99 ms | c=50 req/s | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GET /health | 1 | 3 / 4.7 | 11.4 / 30.3 / 34.5 | 716 | 49.2 / 92.8 / 102 | 890 | 0 |
| GET /home | 27 | 28.6 / 37.7 | 174.4 / 235.4 / 305.2 | 55 | 848.6 / 909.8 / 950.9 | 59 | 0 |
| GET /categories | 2 | 6.3 / 9.4 | 17.6 / 26.2 / 32.2 | 543 | 68.5 / 91 / 99.3 | 686 | 0 |
| GET /campaigns/current | 3 | 6 / 9.4 | 21.2 / 32.1 / 37.3 | 445 | 65.9 / 92.5 / 100.3 | 715 | 0 |
| GET /products (24, in stock) | 14 | 22.4 / 29.8 | 90.8 / 126.2 / 142.7 | 107 | 406.8 / 481.3 / 613.5 | 118 | 0 |
| GET /products (sort + size filter) | 14 | 24.6 / 33.2 | 81.6 / 114.6 / 127.1 | 118 | 408.6 / 494.5 / 608.3 | 120 | 0 |
| GET /products/:slug | 11 | 16.9 / 21.7 | 49.3 / 68.1 / 85.1 | 193 | 237.8 / 275.8 / 281 | 209 | 0 |
| GET /products/:slug/related | 9 | 19.4 / 24 | 59.1 / 81.8 / 103.3 | 164 | 258.3 / 310.3 / 323.6 | 191 | 0 |
| GET /search/suggest | 2 | 3.4 / 6.4 | 11.7 / 25 / 28.1 | 747 | 48.5 / 62.7 / 68 | 998 | 0 |
| GET /cart (1 line) | 10 | 13.9 / 17.5 | 40.4 / 58.4 / 66.9 | 238 | 177 / 194 / 205.6 | 286 | 0 |
| POST /checkout/quote | 11 | 15.6 / 19.3 | 38.7 / 50.1 / 58.1 | 256 | 164.7 / 198.1 / 215.7 | 295 | 0 |
| GET /admin/dashboard | 20 | 15.4 / 18.4 | 71.1 / 102.6 / 106.3 | 137 | 300.7 / 376 / 424 | 161 | 0 |
| GET /admin/orders | 6 | 13.6 / 18 | 38.2 / 54.7 / 58.2 | 256 | 177 / 221.4 / 236.8 | 271 | 0 |
| GET /admin/inventory | 5 | 8.8 / 12.6 | 29 / 40.7 / 48.7 | 334 | 125.2 / 151.1 / 190.3 | 382 | 0 |
| GET /admin/campaigns/:id/report | 7 | 12.4 / 18.8 | 33.1 / 55.2 / 61 | 285 | 127 / 164.5 / 173.3 | 386 | 0 |

**Errors:** 0 across 12,000 measured requests (15 endpoints × (100 + 200 + 500)), plus three more rounds of 15 × 400 requests at c=50 for the memory check.

## Findings
1. **Throughput is CPU-bound on one process, not database-bound.** For `/home`, 50 requests spent about 200 ms in SQL in total (about 4 ms each), while each request costs about 18 ms of Node/Prisma CPU. At c=50 the process used about 2.5 cores (Node plus Prisma's engine threads). Latency at higher concurrency is queueing on one event loop, so scale horizontally (more API processes) rather than tuning SQL.
2. **No N+1 patterns.** Query counts are constant per request, not per item: the 24-card listing runs 14 queries; product detail runs 11.
3. **No connection-pool exhaustion** at c=50 (0 errors, no timeouts).
4. **Memory plateaus.** RSS rose from 228 MB at start to about 546 MB under c=50, then stayed at 559 → 561 → 561 → 563 MB across three further full load rounds. That's a warm V8 heap, not a leak.
5. **`/home` is the heaviest read** (27 queries, about 29 ms uncontended). In production the storefront caches it with ISR for 60 s, so it's computed about once a minute per instance, not per visitor. One inefficiency, not changed (no demonstrated bottleneck): Prisma's per-parent `take: 2` on images loads about 70 image rows to show 24.

## Not measured
- frontend bundle sizes and Core Web Vitals on real devices
- hydration profiling
- the storefront's server-side render throughput
- multi-instance deployments
- a production-sized catalogue (thousands of products)
- Gemini-backed `/search` and `/visual-search` (paid external calls; earlier live checks only)
