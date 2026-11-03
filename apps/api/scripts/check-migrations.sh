#!/usr/bin/env bash
# Prisma cannot model the pgvector HNSW index, so `prisma migrate dev` will try to
# DROP it in every newly generated migration. Fail fast if one slips through.
set -euo pipefail
dir="$(dirname "$0")/../prisma/migrations"
if grep -RIl 'DROP INDEX "product_embeddings_vector_hnsw"' "$dir" >/dev/null 2>&1; then
  echo "ERROR: a migration drops product_embeddings_vector_hnsw. Remove that statement." >&2
  grep -RIn 'DROP INDEX "product_embeddings_vector_hnsw"' "$dir" >&2
  exit 1
fi
echo "migrations OK"
