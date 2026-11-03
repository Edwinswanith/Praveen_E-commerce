#!/usr/bin/env bash
# VYRA database backup: compressed custom-format pg_dump, optional upload to S3/R2,
# local retention. Schedule daily (cron / platform scheduler). Restore drill:
#   ./restore-check.sh <dump-file>   (restores into a scratch DB and sanity-checks it)
#
# Env: DATABASE_URL (required), BACKUP_DIR (default ./backups), BACKUP_RETENTION_DAYS (default 14),
#      BACKUP_S3_URI (optional, e.g. s3://vyra-backups/db), AWS creds / AWS_ENDPOINT_URL for R2.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
DIR="${BACKUP_DIR:-./backups}"
KEEP="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DIR/vyra-$STAMP.dump"

# Strip Prisma's ?schema= param, which libpq does not understand.
PGURL="${DATABASE_URL%%\?*}"
pg_dump "$PGURL" --format=custom --compress=9 --no-owner --no-privileges --file="$FILE"
pg_restore --list "$FILE" > /dev/null  # fail loudly on a corrupt dump
sha256sum "$FILE" > "$FILE.sha256"
echo "backup: $FILE ($(du -h "$FILE" | cut -f1))"

if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  aws s3 cp "$FILE" "$BACKUP_S3_URI/" --only-show-errors
  aws s3 cp "$FILE.sha256" "$BACKUP_S3_URI/" --only-show-errors
  echo "uploaded to $BACKUP_S3_URI"
fi

find "$DIR" -name 'vyra-*.dump*' -mtime +"$KEEP" -delete
