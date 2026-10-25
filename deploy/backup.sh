#!/usr/bin/env bash
# Kopia zapasowa: baza danych (pg_dump) + pliki aplikacji (zdjęcia, szablony, dokumenty).
# Domyślnie do /var/backups/apt/RRRR-MM-DD_GGMM, starsze niż KEEP_DAYS dni są usuwane.
# Uwaga: numery PESEL w kopii są zaszyfrowane – do odtworzenia potrzebny jest APT_DATA_KEY.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/apt}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date '+%Y-%m-%d_%H%M')"
DEST="$BACKUP_DIR/$STAMP"

cd "$APP_DIR"
mkdir -p "$DEST"
chmod 700 "$BACKUP_DIR" "$DEST"

docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$DEST/baza.dump"
docker compose exec -T api tar -C /app/data -czf - . > "$DEST/pliki.tar.gz"

# kontrola: zrzut bazy musi dać się odczytać
docker compose exec -T db pg_restore --list < "$DEST/baza.dump" > /dev/null

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "$(date '+%F %T') kopia OK: $DEST ($(du -sh "$DEST" | cut -f1))"
