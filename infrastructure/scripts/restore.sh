#!/usr/bin/env bash
# Restores a dump produced by backup.sh into DATABASE_URL.
#
#   ./infrastructure/scripts/restore.sh backups/aplora-20260101T000000Z.sql.gz
#
# This replaces existing data. Stop the API and worker first.
set -euo pipefail

FILE="${1:?Usage: restore.sh <dump.sql.gz>}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL must be set}"

echo "This will overwrite the database at DATABASE_URL."
read -r -p "Type 'restore' to continue: " CONFIRM
[ "$CONFIRM" = "restore" ] || { echo "Cancelled"; exit 1; }

gunzip -c "$FILE" | psql "$DATABASE_URL"
echo "Restore complete."
