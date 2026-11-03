# Technical decisions (ADR log)

| # | Decision | Why | Trade-off / revisit when |
|---|---|---|---|
| 1 | pnpm + Turborepo monorepo | One contract package (`@vyra/shared`) is type-checked against all three apps | — |
| 2 | Pinned majors: Next **15.5**, React 19.1, NestJS **11**, Prisma **6.19**, Tailwind 4, zod 4, BullMQ 5 | Newest *mature* lines. Next 16, Nest 12 and Prisma 8 (RC) were available but newer than what the code was validated against | Upgrade one major at a time behind CI |
| 3 | Modular monolith, single Nest module | Orders, inventory and payments need one transaction boundary | Extract search/embeddings first if it needs separate scaling |
| 4 | Zod (shared) for validation, not class-validator | Same schema validates forms (react-hook-form) and the API; no duplicated rules | Swagger bodies are less detailed; the contract lives in `packages/shared` |
| 5 | Stock as a guarded `UPDATE … WHERE onHand+Δ ≥ 0 AND reserved+Δ ≤ onHand+Δ` + ledger + CHECK constraints | Correct under READ COMMITTED (Postgres re-evaluates the predicate after a row-lock wait). No optimistic retry loops and no distributed locks | Hot single-SKU flash sales serialise on one row, which is acceptable at this scale |
| 6 | Internal EAN-13 with GS1 prefix **20** (restricted circulation) + Code128(SKU) + QR(`VYRA:<sku>`) | Legally correct without GS1 membership. Inventing an "890" India prefix would be wrong | Get a GS1 India prefix before selling on marketplaces, then set `BARCODE_EAN_PREFIX` |
| 7 | Gemini `gemini-embedding-2` @768 as the embedding provider | Natively multimodal: text and images share one space, so text→image and image→text search work without CLIP hosting | Vendor dependency. `local` provider keeps CI/dev offline. Model id is stored per vector, so a switch requires a reindex, never mixing |
| 8 | pgvector HNSW in Postgres, no vector DB | One datastore, transactional deletes (cascade), structured filters in the same query | Prisma can't model the index (see CLAUDE.md rule 9) |
| 9 | Prices GST-inclusive, slab by per-unit value (5% ≤ ₹2,500 else 18%) | Matches Indian retail display practice after the 2025 GST rationalisation | **Rates are config, not law: confirm with your CA** |
| 10 | Separate staff/customer cookies and `/admin/**` namespace | A storefront XSS or session cannot reach admin endpoints; least privilege | — |
| 11 | CSRF via required custom header + SameSite=Lax | No token plumbing; a custom header forces a CORS preflight that the allowlist rejects | Mobile/API clients use Bearer tokens (exempt) |
| 12 | Dev API runs compiled JS (`tsc --watch` + node), not tsx | esbuild/tsx drop `emitDecoratorMetadata`, which breaks Nest DI silently | — |
| 13 | Excel via `exceljs`, not `xlsx` | The npm `xlsx` build has unpatched CVEs; the SheetJS CDN build is not on npm | — |
| 14 | Seed data goes through real services | The seed exercises SKU/barcode/ledger/checkout code paths instead of bypassing them | Seed is slower (~10 min with Gemini) |
| 15 | No separate `shared-types` / `validation` / `utilities` packages | The requested split would be three packages that always change together; merged into `@vyra/shared` | Split only if a consumer needs one without the others |
