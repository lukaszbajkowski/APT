# Etap 1: budowa frontendu
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY frontend/ ./
RUN npm run build
# podgląd linku (og:image) wymaga pełnego adresu: pierwsza domena z APT_DOMAIN („aptid.pl, www.aptid.pl” → https://aptid.pl)
ARG APT_DOMAIN=""
RUN host="$(printf '%s' "$APT_DOMAIN" | cut -d, -f1 | tr -d ' ')"; \
    case "$host" in *.*) sed -i "s|content=\"/og-image.png\"|content=\"https://${host}/og-image.png\"|" dist/index.html ;; esac

# Etap 2: Caddy serwuje frontend i przekazuje /api do backendu
FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
