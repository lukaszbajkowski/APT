#!/usr/bin/env bash
# Test odtwarzania kopii: ./deploy/restore-test.sh [/var/backups/apt/RRRR-MM-DD_GGMM]
# Niczego nie zastępuje: kopię bazy wczytuje do tymczasowej bazy obok produkcyjnej (apt_restore_test),
# sprawdza kluczowe tabele i czy archiwum plików da się odczytać, po czym usuwa tymczasową bazę.
# Wynik trafia do aplikacji (Administrator dostaje ostrzeżenie, gdy test się nie udał albo dawno go nie było).
# Wywoływany raz w tygodniu z backup.sh (w niedzielę); można też uruchomić ręcznie.
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/apt}"
SRC="${1:-$(ls -1d "$BACKUP_DIR"/20* 2>/dev/null | tail -n1)}"
TMP_DB="apt_restore_test"
NOW="$(date -Iseconds)"
cd "$APP_DIR" || exit 1

json_str() { printf '%s' "$1" | head -c 400 | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""'; }
write_status() { # ok info
  printf '{"at": "%s", "ok": %s, "backup": %s, "info": %s}\n' "$NOW" "$1" "$(json_str "$(basename "${SRC:-brak}")")" "$(json_str "$2")" \
    | docker compose exec -T api sh -c 'cat > /app/data/restore-test.json' 2>/dev/null || true
}
fail() {
  echo "$(date '+%F %T') BŁĄD testu odtwarzania: $1" >&2
  docker compose exec -T db sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $TMP_DB" >/dev/null 2>&1 || true
  write_status false "$1"
  docker compose exec -T api python -m app.cli notify-daily >/dev/null 2>&1 || true
  exit 1
}

[ -n "$SRC" ] && [ -f "$SRC/baza.dump" ] && [ -f "$SRC/pliki.tar.gz" ] || fail "nie znaleziono kopii do sprawdzenia"

docker compose exec -T db sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $TMP_DB && createdb -U \"\$POSTGRES_USER\" $TMP_DB" \
  || fail "nie można utworzyć tymczasowej bazy"
docker compose exec -T db sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $TMP_DB --no-owner" < "$SRC/baza.dump" >/dev/null 2>&1 \
  || fail "wczytanie zrzutu bazy nie powiodło się"

q() { docker compose exec -T db sh -c "psql -U \"\$POSTGRES_USER\" -d $TMP_DB -tAc \"$1\"" 2>/dev/null | tr -d '[:space:]'; }
EMP="$(q 'select count(*) from employees')"
USR="$(q 'select count(*) from users')"
VER="$(q 'select version_num from alembic_version')"
[[ "$EMP" =~ ^[0-9]+$ && "$USR" =~ ^[0-9]+$ && -n "$VER" ]] || fail "w odtworzonej bazie brakuje kluczowych tabel"
[ "$USR" -gt 0 ] || fail "w odtworzonej bazie nie ma żadnych użytkowników"

FILES="$(tar -tzf "$SRC/pliki.tar.gz" 2>/dev/null | wc -l)" && [ "$FILES" -gt 0 ] || fail "archiwum plików jest uszkodzone albo puste"

docker compose exec -T db sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $TMP_DB" >/dev/null 2>&1 || true
INFO="$(basename "$SRC"): pracownicy $EMP, użytkownicy $USR, migracja $VER, plików $FILES"
echo "$(date '+%F %T') test odtwarzania OK: $INFO"
write_status true "$INFO"
