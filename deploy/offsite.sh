#!/usr/bin/env bash
# Kopie zapasowe poza serwerem (FTP/FTPS lub SFTP, np. hosting home.pl).
# Każda kopia jest szyfrowana (GPG, AES-256) PRZED wysłaniem – hasło w pliku .offsite.key.
#
#   offsite.sh upload [katalog_kopii]   wysyła kopię (domyślnie najnowszą) i usuwa stare
#   offsite.sh list                      lista kopii na serwerze zdalnym
#   offsite.sh fetch NAZWA               pobiera i odszyfrowuje kopię do /var/backups/apt/
#   offsite.sh test                      sprawdza połączenie (zapis, odczyt, usunięcie pliku)
#
# Konfiguracja: /opt/apt/.offsite.env (tworzy ją deploy/offsite-setup.sh)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF="${OFFSITE_CONF:-$APP_DIR/.offsite.env}"
KEY_FILE="${OFFSITE_KEY_FILE:-$APP_DIR/.offsite.key}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/apt}"

[ -f "$CONF" ] || { echo "Brak konfiguracji $CONF – uruchom deploy/offsite-setup.sh" >&2; exit 2; }
# shellcheck disable=SC1090
. "$CONF"
: "${OFFSITE_URL:?Brak OFFSITE_URL w $CONF}"
: "${OFFSITE_USER:?Brak OFFSITE_USER w $CONF}"
: "${OFFSITE_PASS:?Brak OFFSITE_PASS w $CONF}"
OFFSITE_KEEP_DAYS="${OFFSITE_KEEP_DAYS:-30}"
[ -s "$KEY_FILE" ] || { echo "Brak hasła szyfrowania $KEY_FILE" >&2; exit 2; }

URL="${OFFSITE_URL%/}/"
PROTO="${URL%%://*}"

# Hasło przekazujemy przez plik konfiguracyjny curla (nie widać go na liście procesów).
CURL_CFG="$(mktemp)"
trap 'rm -f "$CURL_CFG"' EXIT
chmod 600 "$CURL_CFG"
{
  printf 'user = "%s:%s"\n' "$(printf '%s' "$OFFSITE_USER" | sed 's/[\\"]/\\&/g')" "$(printf '%s' "$OFFSITE_PASS" | sed 's/[\\"]/\\&/g')"
  echo "silent"
  echo "show-error"
  echo "fail"
  echo "connect-timeout = 30"
  echo "retry = 2"
  if [ "$PROTO" = "ftp" ]; then
    echo "ssl-reqd"           # FTP tylko szyfrowany (FTPS / explicit TLS)
    echo "ftp-create-dirs"
  fi
  if [ "$PROTO" = "sftp" ]; then
    echo "ftp-create-dirs"
    [ -n "${OFFSITE_SSH_HOSTKEY:-}" ] && echo "hostpubsha256 = \"$OFFSITE_SSH_HOSTKEY\""
    [ -z "${OFFSITE_SSH_HOSTKEY:-}" ] && echo "insecure"
  fi
  [ "${OFFSITE_TLS_INSECURE:-false}" = "true" ] && echo "insecure"
  [ -n "${OFFSITE_CACERT:-}" ] && echo "cacert = \"$OFFSITE_CACERT\""
} > "$CURL_CFG"

rcurl() { curl -K "$CURL_CFG" "$@"; }

remote_path() { # ścieżka na serwerze (dla poleceń usuwania)
  local rest="${URL#*://}"
  rest="/${rest#*/}"
  printf '%s%s' "$rest" "$1"
}

remote_delete() {
  if [ "$PROTO" = "sftp" ]; then
    rcurl -Q "rm $(remote_path "$1")" "$URL" -o /dev/null
  else
    # polecenia FTP idą przed przejściem do katalogu – ścieżka względem katalogu logowania
    local rel; rel="$(remote_path "$1")"
    rcurl -Q "DELE ${rel#/}" "$URL" -o /dev/null --list-only
  fi
}

list_remote() { rcurl --list-only "$URL" | tr -d '\r' | sed 's#.*/##' | grep -E '^apt-[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}\.tar\.gpg$' | sort || true; }

cmd="${1:-upload}"
case "$cmd" in
  upload)
    SRC="${2:-$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort | tail -n1)}"
    [ -d "$SRC" ] || { echo "Brak kopii do wysłania." >&2; exit 1; }
    NAME="apt-$(basename "$SRC").tar.gpg"
    TMP="$(mktemp -d)"
    trap 'rm -f "$CURL_CFG"; rm -rf "$TMP"' EXIT
    tar -C "$(dirname "$SRC")" -cf - "$(basename "$SRC")" \
      | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$KEY_FILE" \
            --symmetric --cipher-algo AES256 --compress-algo none -o "$TMP/$NAME"
    LOCAL_SIZE="$(stat -c %s "$TMP/$NAME")"
    rcurl -T "$TMP/$NAME" "$URL$NAME"
    # kontrola: plik jest na serwerze
    list_remote | grep -qx "$NAME" || { echo "Nie widać wysłanego pliku na serwerze." >&2; exit 1; }

    # usuwanie kopii starszych niż OFFSITE_KEEP_DAYS
    cutoff="$(date -d "-${OFFSITE_KEEP_DAYS} days" '+%Y-%m-%d')"
    removed=0
    for f in $(list_remote); do
      d="${f#apt-}"; d="${d%%_*}"
      if [[ "$d" < "$cutoff" ]]; then remote_delete "$f" && removed=$((removed + 1)); fi
    done
    echo "$(date '+%F %T') poza serwerem OK: $NAME ($((LOCAL_SIZE / 1024)) KB), usunięto starych: $removed"
    ;;
  list)
    list_remote
    ;;
  fetch)
    NAME="${2:?Podaj nazwę kopii (offsite.sh list)}"
    mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
    TMP="$(mktemp -d)"
    trap 'rm -f "$CURL_CFG"; rm -rf "$TMP"' EXIT
    rcurl -o "$TMP/$NAME" "$URL$NAME"
    gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$KEY_FILE" -d "$TMP/$NAME" | tar -C "$TMP" -xf -
    dir="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -n1)"
    target="$BACKUP_DIR/zdalna-$(basename "$dir")"
    rm -rf "$target"; mv "$dir" "$target"
    echo "Pobrano i odszyfrowano: $target"
    echo "Odtworzenie: $APP_DIR/deploy/restore.sh $target"
    ;;
  test)
    probe="apt-test-$(date +%s).txt"
    TMP="$(mktemp -d)"
    trap 'rm -f "$CURL_CFG"; rm -rf "$TMP"' EXIT
    echo "test $(date)" > "$TMP/$probe"
    rcurl -T "$TMP/$probe" "$URL$probe"
    rcurl --list-only "$URL" | tr -d '\r' | sed 's#.*/##' | grep -qx "$probe"
    remote_delete "$probe"
    echo "Połączenie działa: zapis, odczyt i usuwanie plików w $URL"
    ;;
  *)
    echo "Użycie: $0 upload|list|fetch NAZWA|test" >&2
    exit 2
    ;;
esac
