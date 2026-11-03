#!/usr/bin/env bash
# Restore drill: loads a dump into a throwaway database and checks core tables.
# Usage: ADMIN_DATABASE_URL=postgresql://user:pass@host:5432/postgres ./restore-check.sh backups/vyra-XXXX.dump
set -euo pipefail
DUMP="${1:?usage: restore-check.sh <dump>}"
: "${ADMIN_DATABASE_URL:?ADMIN_DATABASE_URL (a URL to the postgres maintenance DB) is required}"
ADMIN="${ADMIN_DATABASE_URL%%\?*}"
DB="vyra_restore_check_$(date +%s)"
psql "$ADMIN" -qc "CREATE DATABASE $DB"
trap 'psql "$ADMIN" -qc "DROP DATABASE IF EXISTS $DB" >/dev/null' EXIT
TARGET="${ADMIN%/*}/$DB"
pg_restore --no-owner --no-privileges --dbname="$TARGET" "$DUMP"
psql "$TARGET" -At <<'SQL'
SELECT 'products', count(*) FROM products;
SELECT 'variants', count(*) FROM product_variants;
SELECT 'orders', count(*) FROM orders;
SELECT 'ledger rows', count(*) FROM inventory_movements;
SELECT 'stock consistent', bool_and("onHand" >= 0 AND reserved >= 0 AND reserved <= "onHand") FROM inventory;
SQL
echo "restore check OK ($DB dropped)"
