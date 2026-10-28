#!/usr/bin/env bash
# Kopia zapasowa: baza danych (pg_dump) + pliki aplikacji (zdjęcia, szablony, dokumenty).
# Domyślnie do /var/backups/apt/RRRR-MM-DD_GGMM, starsze niż KEEP_DAYS dni są usuwane.
# Jeśli jest skonfigurowana kopia poza serwerem (.offsite.env), kopia jest też szyfrowana i wysyłana.
# Wynik (data, rozmiar, błędy) trafia do aplikacji – Administrator widzi go na stronie startowej.
# Uwaga: numery PESEL w kopii są zaszyfrowane – do odtworzenia potrzebny jest APT_DATA_KEY.
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/apt}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date '+%Y-%m-%d_%H%M')"
DEST="$BACKUP_DIR/$STAMP"
NOW="$(date -Iseconds)"

cd "$APP_DIR" || exit 1

json_str() { printf '%s' "$1" | head -c 400 | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""'; }

write_status() { # local_ok local_info offsite_state offsite_info
  local offsite_json='null'
  if [ "$3" != "none" ]; then
    offsite_json="{\"at\": \"$NOW\", \"ok\": $([ "$3" = ok ] && echo true || echo false), \"info\": $(json_str "$4")}"
  fi
  printf '{"local": {"at": "%s", "ok": %s, "info": %s}, "offsite": %s}\n' \
    "$NOW" "$1" "$(json_str "$2")" "$offsite_json" \
    | docker compose exec -T api sh -c 'cat > /app/data/backup-status.json' 2>/dev/null || true
}

fail() {
  echo "$(date '+%F %T') BŁĄD kopii: $1" >&2
  write_status false "$1" none ""
  docker compose exec -T api python -m app.cli notify-daily >/dev/null 2>&1 || true
  exit 1
}

mkdir -p "$DEST" && chmod 700 "$BACKUP_DIR" "$DEST" || fail "nie można utworzyć $DEST"

docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$DEST/baza.dump" \
  || fail "zrzut bazy danych nie powiódł się"
docker compose exec -T api tar -C /app/data -czf - . > "$DEST/pliki.tar.gz" \
  || fail "spakowanie plików aplikacji nie powiodło się"
# kontrola: zrzut bazy musi dać się odczytać
docker compose exec -T db pg_restore --list < "$DEST/baza.dump" > /dev/null \
  || fail "zrzut bazy jest uszkodzony"

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$KEEP_DAYS" -exec rm -rf {} +
SIZE="$(du -sh "$DEST" | cut -f1)"
echo "$(date '+%F %T') kopia OK: $DEST ($SIZE)"

if [ -f "$APP_DIR/.offsite.env" ]; then
  if OUT="$("$APP_DIR/deploy/offsite.sh" upload "$DEST" 2>&1)"; then
    echo "$OUT"
    write_status true "$STAMP, $SIZE" ok "$(echo "$OUT" | tail -n1 | cut -d' ' -f3-)"
  else
    echo "$(date '+%F %T') BŁĄD wysyłki poza serwer: $OUT" >&2
    write_status true "$STAMP, $SIZE" error "$OUT"
    # kopia lokalna jest poprawna – nie przerywamy np. aktualizacji; błąd widać na stronie startowej
  fi
else
  write_status true "$STAMP, $SIZE" none ""
fi

# raz w tygodniu (w niedzielę) sprawdzamy, że najnowszą kopię da się odtworzyć (w osobnej, tymczasowej bazie)
if [ "$(date +%u)" = "7" ] && [ -x "$APP_DIR/deploy/restore-test.sh" ]; then
  "$APP_DIR/deploy/restore-test.sh" "$DEST" || true
fi

# ostrzeżenia e-mail dla administratorów (nieudana kopia, dane do usunięcia) – jeśli e-mail skonfigurowany
docker compose exec -T api python -m app.cli notify-daily >/dev/null 2>&1 || true
