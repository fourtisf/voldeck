#!/usr/bin/env bash
# ============================================================================
# VOLDECK one-shot deploy for an Ubuntu/Debian VPS (Hostinger-style).
# Idempotent — safe to re-run for updates. Does NOT touch other PM2 apps.
#
# First deploy (as root):
#   git clone https://github.com/fourtisf/voldeck.git /opt/voldeck
#   bash /opt/voldeck/deploy/deploy.sh
#
# Update to latest:
#   bash /opt/voldeck/deploy/deploy.sh          (pulls, rebuilds, reloads)
#
# With a domain (after DNS points here):
#   DOMAIN=voldeck.example.com bash /opt/voldeck/deploy/deploy.sh
#   → writes the nginx site; then run the printed certbot command for SSL.
#
# Without DOMAIN the app is served directly at http://<server-ip>:3020
# (the Next server proxies /api to the API service itself).
# ============================================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/fourtisf/voldeck.git}"
REPO_DIR="${REPO_DIR:-/opt/voldeck}"
DB_NAME="${DB_NAME:-voldeck}"
DB_USER="${DB_USER:-voldeck}"
DOMAIN="${DOMAIN:-}"

say()  { echo -e "\n\033[1;34m▸ $*\033[0m"; }
ok()   { echo -e "\033[1;32m✓ $*\033[0m"; }
warn() { echo -e "\033[1;33m! $*\033[0m"; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

# --- 1. Base packages -------------------------------------------------------
say "Installing base packages (git, curl, postgres, redis)"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates gnupg postgresql redis-server >/dev/null
systemctl enable --now postgresql redis-server >/dev/null 2>&1 || true
ok "postgres + redis running"

# --- 2. Node 20 + pnpm + pm2 ------------------------------------------------
NODE_MAJOR="$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  say "Installing Node 20 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "node $(node -v)"
if ! command -v pnpm >/dev/null 2>&1; then
  say "Installing pnpm"
  npm install -g pnpm@10 >/dev/null 2>&1 || { corepack enable && corepack prepare pnpm@10.33.0 --activate; }
fi
ok "pnpm $(pnpm --version)"
if ! command -v pm2 >/dev/null 2>&1; then
  say "Installing pm2"
  npm install -g pm2 >/dev/null
fi
ok "pm2 $(pm2 -v)"

# --- 3. Repo ----------------------------------------------------------------
if [ -d "$REPO_DIR/.git" ]; then
  say "Updating repo in $REPO_DIR"
  git -C "$REPO_DIR" fetch origin
  BRANCH="$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)"
  git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
else
  say "Cloning $REPO_URL → $REPO_DIR"
  git clone "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"
ok "repo at $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

# --- 4. Database ------------------------------------------------------------
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  say "Creating database role + db"
  DB_PASS="$(openssl rand -hex 16)"
  sudo -u postgres psql -qc "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';"
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
  ok "db '$DB_NAME' owned by '$DB_USER' created"
else
  DB_PASS=""
  ok "db role exists — keeping current credentials"
fi

# --- 5. .env ----------------------------------------------------------------
if [ ! -f "$REPO_DIR/.env" ]; then
  say "Writing $REPO_DIR/.env (DATA_MODE=sim)"
  [ -n "$DB_PASS" ] || { warn "role existed but .env is missing — set DATABASE_URL manually"; DB_PASS="CHANGE_ME"; }
  cat > "$REPO_DIR/.env" <<EOF
DATABASE_URL=postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
REDIS_URL=redis://localhost:6379
DATA_MODE=sim
GECKO_BASE=https://api.geckoterminal.com/api/v2
ROBINFUN_DATABASE_URL=
API_PORT=4020
WEB_ORIGIN=${DOMAIN:+https://$DOMAIN}
EOF
  ok ".env written"
else
  ok ".env exists — untouched (flip DATA_MODE there when going live)"
fi

# --- 6. Build + migrate -----------------------------------------------------
say "Installing dependencies"
pnpm install --frozen-lockfile
say "Building all apps"
pnpm build
say "Applying database migrations"
# subshell: don't leak .env into this shell — pm2 snapshots the environment
# at start time and re-injects it on later restarts
( set -a; . "$REPO_DIR/.env"; set +a; pnpm --filter @voldeck/db migrate:deploy )

# --- 6b. Port preflight (don't fight other apps on this VPS) ----------------
for PORT in 3020 4020; do
  HOLDER="$(ss -ltnp 2>/dev/null | grep ":$PORT " | grep -oP 'users:\(\("\K[^"]+' | head -1 || true)"
  if [ -n "$HOLDER" ] && ! pm2 jlist 2>/dev/null | grep -qE "volread|voldeck"; then
    warn "Port $PORT is already used by '$HOLDER' — pick different ports in ecosystem.config.js/.env before continuing."
    exit 1
  fi
done

# --- 7. PM2 (volread apps only — other apps untouched) ----------------------
# drop legacy-named apps from earlier deploys so they don't hold the ports
pm2 delete voldeck-web voldeck-api voldeck-worker >/dev/null 2>&1 || true
say "Starting/reloading PM2 apps (volread-web :3020, volread-api :4020, volread-worker)"
pm2 startOrReload ecosystem.config.js --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
ok "pm2 apps online"

# --- 8. Firewall ------------------------------------------------------------
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  say "Opening firewall ports"
  ufw allow 3020/tcp >/dev/null || true
  [ -n "$DOMAIN" ] && { ufw allow 80/tcp >/dev/null || true; ufw allow 443/tcp >/dev/null || true; }
  ok "ufw updated"
fi

# --- 9. nginx (only when DOMAIN is set) -------------------------------------
if [ -n "$DOMAIN" ]; then
  say "Configuring nginx for $DOMAIN"
  apt-get install -y -qq nginx python3-certbot-nginx >/dev/null 2>&1 || apt-get install -y -qq nginx >/dev/null
  sed "s/<DOMAIN>/$DOMAIN/g" "$REPO_DIR/deploy/nginx.conf.example" > /etc/nginx/sites-available/voldeck
  ln -sf /etc/nginx/sites-available/voldeck /etc/nginx/sites-enabled/voldeck
  nginx -t && systemctl reload nginx
  ok "nginx serving http://$DOMAIN  → run for SSL:  certbot --nginx -d $DOMAIN -d www.$DOMAIN"
fi

# --- 10. Health check -------------------------------------------------------
say "Health check"
sleep 4
curl -fsS localhost:4020/api/health && echo || warn "API not answering yet — check: pm2 logs volread-api"
curl -fsS -o /dev/null -w "web: HTTP %{http_code}\n" localhost:3020/ || warn "web not answering yet — check: pm2 logs volread-web"

IP="$(curl -fsS -4 --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
echo
MODE_NOW="$(grep -E '^DATA_MODE=' "$REPO_DIR/.env" | cut -d= -f2 || echo '?')"
ok "DONE — VOLREAD deployed (DATA_MODE=$MODE_NOW)."
if [ -n "$DOMAIN" ]; then
  echo "  Open:  http://$DOMAIN   (then: certbot --nginx -d $DOMAIN -d www.$DOMAIN for HTTPS)"
else
  echo "  Open:  http://$IP:3020"
  echo "  Later: DOMAIN=yourdomain.com bash $REPO_DIR/deploy/deploy.sh  → nginx + certbot"
fi
echo "  Logs:  pm2 logs volread-worker | volread-api | volread-web"
echo "  Live:  edit $REPO_DIR/.env → DATA_MODE=live (+ ROBINFUN_DATABASE_URL), then: pm2 restart volread-api volread-worker"
