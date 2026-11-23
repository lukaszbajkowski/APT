#!/usr/bin/env bash
# Konfiguracja kopii zapasowych poza serwerem (np. FTP hostingu home.pl).
#   /opt/apt/deploy/offsite-setup.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONF="$APP_DIR/.offsite.env"
KEY_FILE="$APP_DIR/.offsite.key"

[ "$(id -u)" -eq 0 ] || { echo "Uruchom jako root." >&2; exit 1; }
command -v gpg >/dev/null || apt-get install -y -q gnupg

echo "Kopie poza serwerem – dane dostępowe (FTP lub SFTP)."
echo "W home.pl: panel → Hosting → Konta FTP. Najlepiej osobne konto ograniczone do jednego katalogu."
echo
read -rp "Protokół [ftp/sftp] (ftp = FTP z szyfrowaniem TLS) [ftp]: " PROTO </dev/tty
PROTO="${PROTO:-ftp}"
[[ "$PROTO" =~ ^(ftp|sftp)$ ]] || { echo "Nieznany protokół: $PROTO" >&2; exit 1; }
read -rp "Serwer (np. serwer123456.home.pl): " HOST </dev/tty
DEFAULT_PORT=21; [ "$PROTO" = sftp ] && DEFAULT_PORT=22
read -rp "Port [$DEFAULT_PORT]: " PORT </dev/tty
PORT="${PORT:-$DEFAULT_PORT}"
read -rp "Użytkownik: " USER_NAME </dev/tty
read -rsp "Hasło (nie wyświetla się): " PASS </dev/tty; echo
read -rp "Katalog na kopie [kopie-apt]: " DIR </dev/tty
DIR="${DIR:-kopie-apt}"; DIR="${DIR#/}"; DIR="${DIR%/}"
read -rp "Ile dni trzymać kopie na serwerze zdalnym [30]: " KEEP </dev/tty
KEEP="${KEEP:-30}"

HOSTKEY=""
if [ "$PROTO" = sftp ]; then
  # odcisk klucza serwera SSH – bez niego połączenie nie byłoby sprawdzone, więc bez niego nie zapisujemy konfiguracji
  echo "Pobieram odcisk klucza serwera SFTP…"
  HOSTKEY="$( (ssh-keyscan -T 15 -p "$PORT" -t ed25519,rsa "$HOST" 2>/dev/null || true) | head -n1 | (ssh-keygen -lf - -E sha256 2>/dev/null || true) | awk '{print $2}' | sed 's/^SHA256://')"
  if [ -z "$HOSTKEY" ]; then
    echo "Nie udało się pobrać klucza serwera $HOST:$PORT (SSH). Sprawdź adres i port oraz czy dostęp przez SSH jest włączony." >&2
    exit 1
  fi
  echo "Odcisk klucza serwera SFTP: SHA256:$HOSTKEY"
fi


# FTP z certyfikatem na inną nazwę niż adres (home.pl: adres serwerNNN.hosting-home.pl, certyfikat *.home.pl):
# sprawdzamy, że to ważny, zaufany certyfikat dostawcy, pytamy o zgodę i przypinamy klucz serwera
TLS_PIN=""
if [ "$PROTO" = ftp ]; then
  PEM="$(timeout 20 openssl s_client -starttls ftp -connect "$HOST:$PORT" </dev/null 2>/dev/null | openssl x509 2>/dev/null || true)"
  CERT_CN="$(printf '%s' "$PEM" | openssl x509 -noout -subject 2>/dev/null | sed -n 's/.*CN *= *//p' || true)"
  case "$CERT_CN" in
    "*."*)
      DOM="${CERT_CN#\*.}"
      case "$HOST" in
        *".$DOM") ;;
        *)
          if timeout 20 openssl s_client -starttls ftp -connect "$HOST:$PORT" -verify_return_error -verify_hostname "x.$DOM" </dev/null >/dev/null 2>&1; then
            echo "Certyfikat serwera jest na $CERT_CN – ważny i zaufany, ale nie pasuje do adresu $HOST."
            read -rp "Przypiąć klucz tego serwera (kopie będą wysyłane tylko do serwera z tym kluczem)? [t/N]: " PIN_OK </dev/tty
            if [[ "${PIN_OK:-}" =~ ^[tTyY] ]]; then
              TLS_PIN="sha256//$(printf '%s' "$PEM" | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64)"
              echo "Przypięty klucz: $TLS_PIN"
            fi
          else
            echo "Certyfikat serwera ($CERT_CN) nie przeszedł sprawdzenia łańcucha zaufania – nie przypinam klucza." >&2
          fi
          ;;
      esac
      ;;
  esac
fi

q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
umask 077
cat > "$CONF.new" <<EOF
# Kopie poza serwerem – konfiguracja dla deploy/offsite.sh
OFFSITE_URL=$(q "$PROTO://$HOST:$PORT/$DIR/")
OFFSITE_USER=$(q "$USER_NAME")
OFFSITE_PASS=$(q "$PASS")
OFFSITE_KEEP_DAYS=$KEEP
OFFSITE_SSH_HOSTKEY=$(q "$HOSTKEY")
OFFSITE_TLS_PIN=$(q "$TLS_PIN")
EOF

NEW_KEY=""
if [ ! -s "$KEY_FILE" ]; then
  NEW_KEY="$(openssl rand -base64 33 | tr -d '\n')"
  printf '%s' "$NEW_KEY" > "$KEY_FILE"
fi
chmod 600 "$KEY_FILE"

echo
echo "Sprawdzam połączenie…"
if ! OFFSITE_CONF="$CONF.new" "$APP_DIR/deploy/offsite.sh" test; then
  rm -f "$CONF.new"
  echo
  echo "Nie udało się połączyć. Sprawdź serwer, użytkownika i hasło (konfiguracja NIE została zapisana)." >&2
  echo "Jeśli FTP odrzuca szyfrowanie TLS, zapytaj dostawcę o FTPS albo SFTP." >&2
  exit 1
fi
mv "$CONF.new" "$CONF"
chmod 600 "$CONF"

echo "Wysyłam pierwszą kopię…"
"$APP_DIR/deploy/backup.sh"

if [ -n "$NEW_KEY" ]; then
  cat <<EOF

=====================================================================
  HASŁO SZYFROWANIA KOPII ZDALNYCH – ZAPISZ JE TERAZ
  w menedżerze haseł (obok klucza APT_DATA_KEY):

      $NEW_KEY

  Bez niego kopii z serwera zdalnego nie da się odszyfrować.
  Jest też w pliku $KEY_FILE.
=====================================================================
EOF
fi
echo "Gotowe. Kopie będą wysyłane codziennie o 2:30 razem z kopią lokalną."
