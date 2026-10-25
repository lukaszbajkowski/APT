#!/usr/bin/env bash
# Instalacja aplikacji „Identyfikacja pracowników APT” na czystym serwerze Ubuntu 24.04.
#
# Uruchom jako root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/lukaszbajkowski/APT/main/deploy/install.sh) twoja-domena.pl
#
# Skrypt można bezpiecznie uruchomić ponownie: niczego nie nadpisze (np. .env i kluczy),
# tylko uzupełni brakujące elementy i zaktualizuje aplikację.
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR=/opt/apt
REPO=https://github.com/lukaszbajkowski/APT.git
BACKUP_DIR=/var/backups/apt

bold() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m[uwaga] %s\033[0m\n' "$*"; }
die() { printf '\033[31m[błąd] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Uruchom jako root (zaloguj się: ssh root@adres-serwera)."
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || die "Skrypt jest przygotowany dla Ubuntu (wykryto: ${PRETTY_NAME:-?})."

if [ -z "$DOMAIN" ]; then
  read -rp "Domena aplikacji (np. aptid.pl): " DOMAIN
fi
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"; DOMAIN="${DOMAIN#www.}"
[[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || die "Niepoprawna domena: $DOMAIN"

export DEBIAN_FRONTEND=noninteractive

bold "1/8 Aktualizacja systemu i podstawowe pakiety"
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get -y -q install ca-certificates curl git ufw fail2ban unattended-upgrades dnsutils openssl
timedatectl set-timezone Europe/Warsaw || true
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now fail2ban >/dev/null 2>&1 || true

bold "2/8 Pamięć wymiany (swap)"
if swapon --show | grep -q .; then
  echo "Swap już jest – pomijam."
else
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "Dodano 2 GB swap."
fi

bold "3/8 Docker"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "Docker już zainstalowany: $(docker --version)"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
if [ ! -f /etc/docker/daemon.json ]; then
  # logi kontenerów z automatyczną rotacją, żeby nie zapełniły dysku
  echo '{ "log-driver": "local" }' > /etc/docker/daemon.json
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null

bold "4/8 Zapora sieciowa i SSH"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
echo "Otwarte porty: 22 (SSH), 80 i 443 (aplikacja)."
if [ -s /root/.ssh/authorized_keys ]; then
  cat > /etc/ssh/sshd_config.d/99-apt.conf <<'EOF'
# Logowanie tylko kluczem SSH (hasła wyłączone)
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  echo "SSH: logowanie hasłem wyłączone, tylko klucz."
else
  warn "Brak klucza SSH w /root/.ssh/authorized_keys – zostawiam logowanie hasłem."
fi

bold "5/8 Pobranie aplikacji"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

bold "6/8 Konfiguracja (.env)"
NEW_KEY=""
if [ -f .env ]; then
  echo "Plik .env już istnieje – nie zmieniam kluczy."
  sed -i "s|^APT_DOMAIN=.*|APT_DOMAIN=${DOMAIN}, www.${DOMAIN}|" .env
else
  NEW_KEY="$(openssl rand 32 | base64 | tr '+/' '-_' | tr -d '=\n')"
  umask 077
  cat > .env <<EOF
# Wygenerowano przez deploy/install.sh $(date '+%Y-%m-%d %H:%M')
APT_DOMAIN=${DOMAIN}, www.${DOMAIN}
APT_HTTP_PORT=80
APT_HTTPS_PORT=443
POSTGRES_DB=apt
POSTGRES_USER=apt
POSTGRES_PASSWORD=$(openssl rand -hex 24)
APT_SECRET_KEY=$(openssl rand -hex 48)
APT_DATA_KEY=${NEW_KEY}
APT_COOKIE_SECURE=true
APT_SESSION_IDLE_MINUTES=30
APT_SESSION_MAX_HOURS=12
APT_LOGIN_MAX_FAILURES=5
APT_LOGIN_LOCK_MINUTES=15
EOF
  umask 022
  chmod 600 .env
  echo "Utworzono .env z losowymi hasłami i kluczami."
fi

SERVER_IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')"
for host in "$DOMAIN" "www.$DOMAIN"; do
  resolved="$(dig +short A "$host" @1.1.1.1 | tail -n1)"
  if [ "$resolved" = "$SERVER_IP" ]; then
    echo "DNS OK: $host -> $SERVER_IP"
  else
    warn "$host wskazuje na '${resolved:-brak}', a serwer ma $SERVER_IP."
    warn "Ustaw rekord A w panelu domeny. Certyfikat HTTPS pobierze się sam, gdy DNS zacznie działać."
  fi
done

bold "7/8 Uruchomienie aplikacji (pierwsze budowanie trwa kilka minut)"
docker compose up -d --build
docker image prune -f >/dev/null
echo -n "Czekam na API"
for _ in $(seq 1 60); do
  if docker compose exec -T api python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)" >/dev/null 2>&1; then
    echo " – działa."
    break
  fi
  echo -n "."; sleep 3
done

bold "8/8 Kopie zapasowe i polecenia pomocnicze"
chmod +x deploy/backup.sh deploy/restore.sh
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
cat > /etc/cron.d/apt-backup <<EOF
# Codzienna kopia bazy i plików aplikacji o 2:30
30 2 * * * root $APP_DIR/deploy/backup.sh >> /var/log/apt-backup.log 2>&1
EOF
chmod +x deploy/monitor.sh deploy/monitor-setup.sh
cat > /etc/cron.d/apt-monitor <<CRON
# Monitoring aplikacji co 5 minut (e-mail po ustawieniu APT_MONITOR_TO: deploy/monitor-setup.sh)
*/5 * * * * root $APP_DIR/deploy/monitor.sh >> /var/log/apt-monitor.log 2>&1
CRON
cat > /usr/local/bin/aptid-aktualizuj <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd $APP_DIR
$APP_DIR/deploy/backup.sh
git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
echo "Zaktualizowano."
EOF
chmod +x /usr/local/bin/aptid-aktualizuj
echo "Kopia codziennie o 2:30 do $BACKUP_DIR (14 dni). Aktualizacja: aptid-aktualizuj"

USERS="$(docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from users"' 2>/dev/null | tr -d '[:space:]' || echo 0)"
if [ "${USERS:-0}" = "0" ]; then
  bold "Pierwszy administrator"
  read -rp "Login administratora [admin]: " ADMIN_LOGIN </dev/tty
  read -rp "Imię i nazwisko administratora: " ADMIN_NAME </dev/tty
  docker compose exec -T api python -m app.cli create-admin --username "${ADMIN_LOGIN:-admin}" --full-name "${ADMIN_NAME:-Administrator}"
fi

printf '\n\033[1;32mGotowe: https://%s\033[0m\n' "$DOMAIN"
if [ -n "$NEW_KEY" ]; then
  cat <<EOF

=====================================================================
  KLUCZ SZYFROWANIA PESEL (APT_DATA_KEY) – ZAPISZ GO TERAZ
  w menedżerze haseł, poza serwerem:

      $NEW_KEY

  Bez niego zaszyfrowanych numerów PESEL nie da się odczytać,
  także z kopii zapasowych. Jest też w pliku $APP_DIR/.env.
=====================================================================
EOF
fi
