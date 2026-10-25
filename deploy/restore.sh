#!/usr/bin/env bash
# Odtworzenie kopii zapasowej: ./deploy/restore.sh /var/backups/apt/RRRR-MM-DD_GGMM
# ZASTĘPUJE obecną bazę i pliki aplikacji zawartością kopii.
# Wymaga tego samego APT_DATA_KEY w .env, który był w chwili wykonania kopii.
set -euo pipefail

SRC="${1:-}"
[ -n "$SRC" ] && [ -f "$SRC/baza.dump" ] && [ -f "$SRC/pliki.tar.gz" ] || {
  echo "Użycie: $0 /var/backups/apt/RRRR-MM-DD_GGMM" >&2
  ls -1 /var/backups/apt 2>/dev/null | tail -n 5 >&2 || true
  exit 1
}
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

read -rp "Obecne dane zostaną zastąpione kopią z $(basename "$SRC"). Wpisz TAK, aby kontynuować: " ok
[ "$ok" = "TAK" ] || { echo "Przerwano."; exit 1; }

# kopia bezpieczeństwa stanu przed odtworzeniem
"$APP_DIR/deploy/backup.sh" || true

docker compose stop api web
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < "$SRC/baza.dump"
docker compose run --rm -T --no-deps --entrypoint sh api -c 'find /app/data -mindepth 1 -delete && tar -C /app/data -xzf -' < "$SRC/pliki.tar.gz"
docker compose up -d
echo "Odtworzono kopię $(basename "$SRC")."
