#!/usr/bin/env bash
# Dumps the Aplora database to a timestamped, compressed file.
#
#   ./infrastructure/scripts/backup.sh [output-directory]
#
# Restore with infrastructure/scripts/restore.sh <file>.
set -euo pipefail

OUT_DIR="${1:-./backups}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL must be set}"

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$OUT_DIR/aplora-$STAMP.sql.gz"

echo "Backing up to $TARGET"
pg_dump --no-owner --no-privileges --format=plain "$DATABASE_URL" | gzip -9 > "$TARGET"

# Keep the last 14 archives.
ls -1t "$OUT_DIR"/aplora-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --
echo "Done: $(du -h "$TARGET" | cut -f1)"
