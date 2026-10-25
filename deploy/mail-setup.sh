#!/usr/bin/env bash
# Konfiguracja wysyłki e-maili (SMTP), np. skrzynka powiadomienia@twoja-domena.pl w hostingu home.pl.
#   /opt/apt/deploy/mail-setup.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"
[ "$(id -u)" -eq 0 ] || { echo "Uruchom jako root." >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Brak $ENV_FILE" >&2; exit 1; }
cd "$APP_DIR"

DOMAIN="$(grep -E '^APT_DOMAIN=' .env | head -n1 | cut -d= -f2- | cut -d, -f1 | tr -d ' ')"
echo "E-maile z aplikacji – dane skrzynki pocztowej (SMTP)."
echo "W home.pl: załóż skrzynkę np. powiadomienia@${DOMAIN:-twoja-domena.pl} w panelu (Poczta)."
echo
read -rp "Adres nadawcy (skrzynka) [powiadomienia@${DOMAIN}]: " FROM </dev/tty
FROM="${FROM:-powiadomienia@${DOMAIN}}"
read -rp "Serwer SMTP (home.pl: adres serwera hostingu, np. serwer123456.hosting-home.pl): " HOST </dev/tty
read -rp "Szyfrowanie [ssl/starttls] [ssl]: " SEC </dev/tty
SEC="${SEC:-ssl}"
DEF_PORT=465; [ "$SEC" = starttls ] && DEF_PORT=587
read -rp "Port [$DEF_PORT]: " PORT </dev/tty
PORT="${PORT:-$DEF_PORT}"
read -rp "Login skrzynki [$FROM]: " USER_NAME </dev/tty
USER_NAME="${USER_NAME:-$FROM}"
read -rsp "Hasło skrzynki (nie wyświetla się): " PASS </dev/tty; echo
read -rp "Wyślij e-mail testowy na adres: " TEST_TO </dev/tty

set_var() { # klucz wartość – podmienia albo dopisuje w .env (wartość w apostrofach)
  local key="$1" val="$2" esc
  esc="'$(printf '%s' "$val" | sed "s/'/'\\\\''/g")'"
  grep -v "^${key}=" .env > .env.tmp || true
  printf '%s=%s\n' "$key" "$esc" >> .env.tmp
  mv .env.tmp .env
}
cp .env .env.bak
set_var APT_SMTP_HOST "$HOST"
set_var APT_SMTP_PORT "$PORT"
set_var APT_SMTP_SECURITY "$SEC"
set_var APT_SMTP_USER "$USER_NAME"
set_var APT_SMTP_PASSWORD "$PASS"
set_var APT_MAIL_FROM "Identyfikacja APT <$FROM>"
set_var APT_PUBLIC_URL "https://$DOMAIN"
chmod 600 .env

echo "Uruchamiam aplikację z nowymi ustawieniami…"
docker compose up -d >/dev/null
for _ in $(seq 1 30); do
  docker compose exec -T api python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)" >/dev/null 2>&1 && break
  sleep 2
done
if docker compose exec -T api python -m app.cli send-test-mail --to "$TEST_TO"; then
  rm -f .env.bak
  echo "Gotowe. Wpisz adresy e-mail użytkownikom (Użytkownicy → Edytuj), żeby mogli resetować hasło."
else
  echo
  echo "Wysyłka nie działa – przywracam poprzednie ustawienia (.env.bak)." >&2
  mv .env.bak .env
  docker compose up -d >/dev/null
  exit 1
fi
