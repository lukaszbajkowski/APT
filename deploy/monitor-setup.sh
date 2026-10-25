#!/usr/bin/env bash
# Włączenie monitoringu: e-mail przy awarii aplikacji, braku miejsca na dysku lub kończącym się certyfikacie.
#   /opt/apt/deploy/monitor-setup.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
[ "$(id -u)" -eq 0 ] || { echo "Uruchom jako root." >&2; exit 1; }
grep -q '^APT_SMTP_HOST=.\+' .env || { echo "Najpierw skonfiguruj e-mail: $APP_DIR/deploy/mail-setup.sh" >&2; exit 1; }

read -rp "Adres(y) e-mail do powiadomień o awariach (kilka – po przecinku): " TO </dev/tty
[ -n "$TO" ] || { echo "Podaj co najmniej jeden adres." >&2; exit 1; }
grep -v '^APT_MONITOR_TO=' .env > .env.tmp || true
printf "APT_MONITOR_TO='%s'\n" "$TO" >> .env.tmp
mv .env.tmp .env && chmod 600 .env

chmod +x deploy/monitor.sh
cat > /etc/cron.d/apt-monitor <<CRON
# Monitoring aplikacji co 5 minut
*/5 * * * * root $APP_DIR/deploy/monitor.sh >> /var/log/apt-monitor.log 2>&1
CRON
cat > /etc/logrotate.d/apt-monitor <<'ROT'
/var/log/apt-monitor.log /var/log/apt-backup.log {
  monthly
  rotate 6
  compress
  missingok
  notifempty
}
ROT

echo "Stan teraz: $(deploy/monitor.sh status | tr '\n' ' ')"
deploy/monitor.sh test
echo "Monitoring włączony – sprawdzanie co 5 minut."
