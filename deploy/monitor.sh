#!/usr/bin/env bash
# Monitoring aplikacji (cron co 5 min). Sprawdza:
#   • czy https://DOMENA/api/health odpowiada (Caddy, certyfikat, API, baza),
#   • czy wszystkie kontenery działają,
#   • zajętość dysku (próg MONITOR_DISK_PCT, domyślnie 85%),
#   • ważność certyfikatu HTTPS (ostrzeżenie, gdy zostało < 14 dni).
# Przy zmianie stanu (awaria / powrót) wysyła e-mail na APT_MONITOR_TO – bezpośrednio przez SMTP,
# bez udziału aplikacji, więc działa także wtedy, gdy aplikacja leży. Trwająca awaria: przypomnienie co 6 h.
#
#   monitor.sh          sprawdzenie (z cron)
#   monitor.sh status   wynik bez wysyłania
#   monitor.sh test     wiadomość testowa
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"
STATE_DIR="${MONITOR_STATE_DIR:-/var/lib/apt-monitor}"
REMIND_SECONDS=$((6 * 3600))
mkdir -p "$STATE_DIR"

env_get() { # wartość z .env (obsługuje 'cudzysłowy' zapisane przez mail-setup.sh)
  local v
  v="$(grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2-)"
  if [[ "$v" == \'*\' ]]; then v="${v:1:${#v}-2}"; v="${v//\'\\\'\'/\'}"; fi
  printf '%s' "$v"
}

DOMAIN="$(env_get APT_DOMAIN | cut -d, -f1 | tr -d ' ')"
TO="$(env_get APT_MONITOR_TO)"
DISK_LIMIT="$(env_get MONITOR_DISK_PCT)"; DISK_LIMIT="${DISK_LIMIT:-85}"

check() { # wypisuje listę problemów (pusta = wszystko w porządku)
  local code
  if [ -n "$DOMAIN" ] && [[ "$DOMAIN" != :* ]]; then
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/api/health")"
    code="${code:-000}"
    [ "$code" = "200" ] || echo "Aplikacja nie odpowiada: https://$DOMAIN/api/health (kod $code)"
  fi
  local svc running
  for svc in db api web; do
    running="$(cd "$APP_DIR" && docker compose ps --status running --services 2>/dev/null | grep -cx "$svc")"
    [ "$running" = "1" ] || echo "Kontener „$svc” nie działa"
  done
  local used
  used="$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')"
  [ "${used:-0}" -lt "$DISK_LIMIT" ] || echo "Dysk zajęty w ${used}% (próg ${DISK_LIMIT}%)"
  if [ -n "$DOMAIN" ] && [[ "$DOMAIN" != :* ]]; then
    local end days
    end="$(echo | timeout 15 openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null \
      | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
    if [ -n "$end" ]; then
      days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
      [ "$days" -ge 14 ] || echo "Certyfikat HTTPS wygasa za $days dni"
    fi
  fi
}

send_mail() { # temat, treść
  local host port sec user pass from cfg msg url rcpt
  host="$(env_get APT_SMTP_HOST)"; port="$(env_get APT_SMTP_PORT)"; sec="$(env_get APT_SMTP_SECURITY)"
  user="$(env_get APT_SMTP_USER)"; pass="$(env_get APT_SMTP_PASSWORD)"; from="$(env_get APT_MAIL_FROM)"
  if [ -z "$host" ] || [ -z "$TO" ]; then
    echo "Brak APT_SMTP_HOST lub APT_MONITOR_TO – nie wysyłam e-maila." >&2
    return 1
  fi
  local addr="${from##*<}"; addr="${addr%>}"
  case "$sec" in
    ssl) url="smtps://$host:${port:-465}" ;;
    starttls) url="smtp://$host:${port:-587}" ;;
    *) url="smtp://$host:${port:-25}" ;;
  esac
  cfg="$(mktemp)"; msg="$(mktemp)"
  chmod 600 "$cfg"
  : > "$cfg"
  [ -n "$user" ] && printf 'user = "%s:%s"\n' "$(printf '%s' "$user" | sed 's/[\\"]/\\&/g')" "$(printf '%s' "$pass" | sed 's/[\\"]/\\&/g')" > "$cfg"
  [ "$sec" = starttls ] && echo "ssl-reqd" >> "$cfg"
  {
    echo "From: Monitoring APT <$addr>"
    echo "To: $TO"
    echo "Subject: =?UTF-8?B?$(printf '%s' "$1" | base64 -w0)?="
    echo "Date: $(date -R)"
    echo "MIME-Version: 1.0"
    echo "Content-Type: text/plain; charset=UTF-8"
    echo "Content-Transfer-Encoding: 8bit"
    echo
    printf '%s\n\n—\nMonitoring serwera %s (%s)\n' "$2" "$(hostname)" "${DOMAIN:-}"
  } > "$msg"
  local args=()
  IFS=',' read -ra rcpts <<< "$TO"
  for rcpt in "${rcpts[@]}"; do args+=(--mail-rcpt "$(echo "$rcpt" | tr -d ' ')"); done
  curl -sS --max-time 30 -K "$cfg" --url "$url" --mail-from "$addr" "${args[@]}" -T "$msg"
  local rc=$?
  rm -f "$cfg" "$msg"
  return $rc
}

PROBLEMS="$(check)"
case "${1:-run}" in
  status)
    if [ -z "$PROBLEMS" ]; then echo "OK"; else echo "$PROBLEMS"; fi
    exit 0
    ;;
  test)
    send_mail "Monitoring APT – wiadomość testowa" \
      "Monitoring działa. Przy awarii aplikacji (lub gdy kończy się miejsce na dysku albo certyfikat) dostaniesz tu wiadomość.

Aktualny stan: ${PROBLEMS:-wszystko w porządku}" && echo "Wysłano wiadomość testową na: $TO"
    exit $?
    ;;
esac

STATE_FILE="$STATE_DIR/state"
LAST_SENT_FILE="$STATE_DIR/last_sent"
prev="$(cat "$STATE_FILE" 2>/dev/null || echo ok)"
now="$(date +%s)"
last_sent="$(cat "$LAST_SENT_FILE" 2>/dev/null || echo 0)"

if [ -n "$PROBLEMS" ]; then
  # pojedyncze potknięcie (np. restart przy aktualizacji) nie alarmuje – dopiero drugi raz z rzędu
  fails="$(cat "$STATE_DIR/fails" 2>/dev/null || echo 0)"; fails=$((fails + 1)); echo "$fails" > "$STATE_DIR/fails"
  [ "$fails" -ge 2 ] || exit 0
  if [ "$prev" = ok ] || [ $((now - last_sent)) -ge "$REMIND_SECONDS" ]; then
    subject="AWARIA – Identyfikacja APT"
    [ "$prev" = problem ] && subject="Awaria trwa – Identyfikacja APT"
    send_mail "$subject" "Wykryto problem ($(date '+%d.%m.%Y %H:%M')):

$PROBLEMS

Co sprawdzić na serwerze:
  cd $APP_DIR && docker compose ps
  docker compose logs --tail 100 api
Naprawa najczęściej: docker compose up -d" && echo "$now" > "$LAST_SENT_FILE"
  fi
  echo problem > "$STATE_FILE"
  echo "$(date '+%F %T') PROBLEM: $PROBLEMS"
else
  echo 0 > "$STATE_DIR/fails"
  if [ "$prev" = problem ]; then
    send_mail "Przywrócono – Identyfikacja APT" "Aplikacja znowu działa poprawnie ($(date '+%d.%m.%Y %H:%M'))." \
      && echo "$now" > "$LAST_SENT_FILE"
  fi
  echo ok > "$STATE_FILE"
fi
