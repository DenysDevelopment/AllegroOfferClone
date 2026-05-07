#!/usr/bin/env bash
# Bootstrap script for a fresh Debian/Ubuntu VPS.
#
# What it does:
#   1. Installs Docker + Compose plugin (skips if already present)
#   2. Installs Caddy (skips if already present)
#   3. Clones / pulls this repo into /opt/allegro-clone
#   4. Prompts for Allegro CLIENT_ID / CLIENT_SECRET and writes .env
#   5. Configures Caddy to reverse-proxy <PUBLIC_HOST> → 127.0.0.1:3000 with auto HTTPS
#   6. Starts the app via docker compose
#
# Usage on the VPS:
#   curl -fsSL https://raw.githubusercontent.com/DenysDevelopment/AllegroOfferClone/main/scripts/deploy-vps.sh | bash
# Or after `git clone`:
#   bash scripts/deploy-vps.sh

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/DenysDevelopment/AllegroOfferClone.git}"
APP_DIR="${APP_DIR:-/opt/allegro-clone}"

note() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m✗ %s\033[0m\n' "$*"; }

if [[ "${EUID}" -ne 0 ]]; then
  err "Run as root (sudo)."
  exit 1
fi

# --- Detect public IP and pick a sslip.io hostname ---
PUBLIC_IP="$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me || true)"
if [[ -z "${PUBLIC_IP}" ]]; then
  err "Could not detect the server's public IP. Set PUBLIC_HOST manually and re-run."
  exit 1
fi
PUBLIC_HOST="${PUBLIC_HOST:-${PUBLIC_IP}.sslip.io}"
note "Public IP: ${PUBLIC_IP}"
note "Public host (auto via sslip.io): ${PUBLIC_HOST}"

# --- 1. Docker ---
if ! command -v docker >/dev/null 2>&1; then
  note "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  ok "Docker installed"
else
  ok "Docker already installed"
fi

if ! docker compose version >/dev/null 2>&1; then
  note "Installing docker compose plugin..."
  apt-get update -y
  apt-get install -y docker-compose-plugin
  ok "docker compose plugin installed"
else
  ok "docker compose plugin already installed"
fi

# --- 2. Caddy: detect existing container; if none, install host-level ---
USE_DOCKER_CADDY=false
EXISTING_CADDY_CONTAINER=""

# Look for a running Caddy *container* (not the host-level apt package)
maybe_caddy="$(docker ps --filter 'ancestor=caddy' --format '{{.Names}}' 2>/dev/null | head -n 1 || true)"
if [[ -z "${maybe_caddy}" ]]; then
  maybe_caddy="$(docker ps --format '{{.Image}} {{.Names}}' 2>/dev/null \
    | awk 'tolower($1) ~ /caddy/ {print $NF}' | head -n 1 || true)"
fi

if [[ -n "${maybe_caddy}" ]]; then
  EXISTING_CADDY_CONTAINER="${maybe_caddy}"
  USE_DOCKER_CADDY=true
  ok "Reusing existing Caddy container: ${EXISTING_CADDY_CONTAINER}"
elif ! command -v caddy >/dev/null 2>&1; then
  note "No Caddy detected — installing host-level Caddy..."
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
  ok "Caddy installed"
else
  ok "Host-level Caddy already installed"
fi

# --- 3. Repo ---
if [[ ! -d "${APP_DIR}/.git" ]]; then
  note "Cloning ${REPO_URL} → ${APP_DIR}"
  mkdir -p "$(dirname "${APP_DIR}")"
  git clone "${REPO_URL}" "${APP_DIR}"
  ok "Repo cloned"
else
  note "Pulling latest changes in ${APP_DIR}"
  git -C "${APP_DIR}" pull --ff-only
  ok "Repo up to date"
fi

cd "${APP_DIR}"

# --- 4. .env (prompt for missing values) ---
ENV_FILE="${APP_DIR}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  note "Creating .env (you will be prompted for Allegro credentials)"
  read -rp "ALLEGRO_ENV [production]: " ALLEGRO_ENV_IN
  ALLEGRO_ENV_IN="${ALLEGRO_ENV_IN:-production}"

  if [[ "${ALLEGRO_ENV_IN}" == "production" ]]; then
    read -rp "ALLEGRO_PROD_CLIENT_ID: " CID
    read -rsp "ALLEGRO_PROD_CLIENT_SECRET: " CSEC; echo
    PROD_ID="${CID}"
    PROD_SECRET="${CSEC}"
    SAND_ID=""
    SAND_SECRET=""
  else
    read -rp "ALLEGRO_SANDBOX_CLIENT_ID: " CID
    read -rsp "ALLEGRO_SANDBOX_CLIENT_SECRET: " CSEC; echo
    SAND_ID="${CID}"
    SAND_SECRET="${CSEC}"
    PROD_ID=""
    PROD_SECRET=""
  fi

  SESSION_SECRET="$(openssl rand -hex 32)"

  cat > "${ENV_FILE}" <<EOF
ALLEGRO_ENV=${ALLEGRO_ENV_IN}

ALLEGRO_SANDBOX_CLIENT_ID=${SAND_ID}
ALLEGRO_SANDBOX_CLIENT_SECRET=${SAND_SECRET}

ALLEGRO_PROD_CLIENT_ID=${PROD_ID}
ALLEGRO_PROD_CLIENT_SECRET=${PROD_SECRET}

PORT=3000
PUBLIC_URL=https://${PUBLIC_HOST}
SESSION_SECRET=${SESSION_SECRET}
DATA_DIR=/app/data
EOF
  chmod 600 "${ENV_FILE}"
  ok ".env created (mode 600)"
else
  ok ".env already exists — keeping it"
  # Best-effort: keep PUBLIC_URL in sync with the chosen host.
  if grep -q '^PUBLIC_URL=' "${ENV_FILE}"; then
    sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://${PUBLIC_HOST}|" "${ENV_FILE}"
    note "PUBLIC_URL set to https://${PUBLIC_HOST} in existing .env"
  fi
fi

# --- 5. Caddy config ---
if [[ "${USE_DOCKER_CADDY}" == "true" ]]; then
  note "Adding ${PUBLIC_HOST} to existing Caddyfile in ${EXISTING_CADDY_CONTAINER}"

  # Find the Caddyfile mount on the host
  CADDYFILE_HOST=$(docker inspect "${EXISTING_CADDY_CONTAINER}" \
    --format '{{range .Mounts}}{{if or (eq .Destination "/etc/caddy/Caddyfile") (eq .Destination "/etc/caddy")}}{{.Source}}{{"\n"}}{{end}}{{end}}' \
    | head -n 1)
  if [[ -z "${CADDYFILE_HOST}" ]]; then
    err "Could not find Caddyfile mount on container ${EXISTING_CADDY_CONTAINER}."
    err "Find it manually: docker inspect ${EXISTING_CADDY_CONTAINER} | grep -B2 -A2 caddy"
    exit 1
  fi
  if [[ -d "${CADDYFILE_HOST}" ]]; then
    CADDYFILE_HOST="${CADDYFILE_HOST}/Caddyfile"
  fi
  note "Caddyfile path: ${CADDYFILE_HOST}"

  # Idempotent: replace any prior block for this host
  if grep -q "^${PUBLIC_HOST}\s*{" "${CADDYFILE_HOST}" 2>/dev/null; then
    note "Block for ${PUBLIC_HOST} already present — leaving it"
  else
    cp "${CADDYFILE_HOST}" "${CADDYFILE_HOST}.bak.$(date +%s)"
    cat >> "${CADDYFILE_HOST}" <<EOF

# --- allegro-clone (managed by deploy-vps.sh) ---
${PUBLIC_HOST} {
  encode gzip
  reverse_proxy allegro-clone:3000
}
EOF
    ok "Appended block to ${CADDYFILE_HOST} (backup saved alongside)"
  fi

  # Validate config inside the container, then reload
  docker exec "${EXISTING_CADDY_CONTAINER}" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile \
    || { err "Caddyfile is invalid — review ${CADDYFILE_HOST}"; exit 1; }
  docker exec "${EXISTING_CADDY_CONTAINER}" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  ok "Reloaded ${EXISTING_CADDY_CONTAINER}"

  # Find which network that Caddy is on so our app can join it
  CADDY_NETWORK="$(docker inspect "${EXISTING_CADDY_CONTAINER}" \
    --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' \
    | grep -v '^bridge$' | head -n 1)"
  if [[ -z "${CADDY_NETWORK}" ]]; then
    err "Could not detect docker network of ${EXISTING_CADDY_CONTAINER}"
    exit 1
  fi
  note "Caddy network: ${CADDY_NETWORK} — writing docker-compose.override.yml"
  cat > "${APP_DIR}/docker-compose.override.yml" <<EOF
# Auto-generated by deploy-vps.sh — joins our app to the existing Caddy network
# so the proxy can reach us at allegro-clone:3000.
services:
  app:
    ports: !reset []
    networks:
      - default
      - ${CADDY_NETWORK}
networks:
  ${CADDY_NETWORK}:
    external: true
EOF
  ok "Wrote docker-compose.override.yml"
else
  note "Writing host Caddyfile"
  cat > /etc/caddy/Caddyfile <<EOF
${PUBLIC_HOST} {
  encode gzip
  reverse_proxy 127.0.0.1:3000
}
EOF
  systemctl reload caddy || systemctl restart caddy
  ok "Caddy configured for ${PUBLIC_HOST}"
fi

# --- 6. App (docker compose) ---
note "Starting docker compose stack"
docker compose -f "${APP_DIR}/docker-compose.yml" pull --ignore-pull-failures || true
docker compose -f "${APP_DIR}/docker-compose.yml" up -d --build
ok "Stack started"

# --- 7. Health check ---
note "Waiting for /api/health"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
    ok "App is healthy on http://127.0.0.1:3000"
    break
  fi
  sleep 2
  if [[ "$i" -eq 30 ]]; then
    warn "Health check timed out — see: docker compose logs --tail=50"
  fi
done

cat <<EOF

========================================================
  All set.

  Public URL:  https://${PUBLIC_HOST}
  Allegro callback URI to register at apps.developer.allegro.pl:
      https://${PUBLIC_HOST}/api/auth/callback

  Useful commands:
      cd ${APP_DIR}
      docker compose logs -f                   # tail logs
      docker compose pull && docker compose up -d --build   # update
      caddy fmt /etc/caddy/Caddyfile           # validate caddy
========================================================
EOF
