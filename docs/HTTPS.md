# HTTPS (Let's Encrypt) for Docker

Edge proxy terminates TLS and forwards to the existing `frontend` container.
The app stack (db / backend / frontend) is unchanged aside from binding `8083` to loopback.

```text
Internet → :443 / :18080 (proxy, profile https) → frontend:80 → /api → backend
                              ↑
                        Let's Encrypt (certbot)
```

**Default deploy** (`docker compose up -d`) starts only `db` / `backend` / `frontend` on **`APP_PORT=8083`**. The edge `proxy` + `certbot` services use Compose profile **`https`** so a busy host `:80` / `:9080` / `:443` cannot fail the app deploy.

Enable the edge proxy only when needed: `docker compose --env-file .env.docker --profile https up -d` (or `./scripts/ssl-init.sh`).

## Prerequisites

1. DNS A record: `dev.adityatavnoji.in` → server public IP  
2. Firewall / security group: allow **`PROXY_HTTP_PORT` (18080)** and **443** (TCP) when using profile `https`  
3. No other process bound to those host ports  
4. Let's Encrypt HTTP-01 still expects public **:80** — if another process owns :80, forward ACME/`/.well-known` (or all HTTP) to this proxy’s `PROXY_HTTP_PORT`

## Configure `.env.docker`

**Default in `.env.docker.example`:** HTTP via `http://161.97.93.106:8083` (public bind).

HTTPS / domain settings are **commented** in the same file. To switch:

1. Comment out the active `FRONTEND_*` / `APP_HOST_BIND=0.0.0.0` lines (block A).
2. Uncomment block B (`DOMAIN`, `CERTBOT_EMAIL`, HTTPS `FRONTEND_*`, `APP_HOST_BIND=127.0.0.1`, `SSO_REDIRECT_URI`).
3. Apply and issue cert:

```bash
./scripts/sync-docker-env-https.sh   # optional if you edited .env.docker by hand
docker compose --env-file .env.docker up -d
./scripts/ssl-init.sh                # starts proxy/certbot with --profile https
```

4. Entra + ATT SSO Redirect URI:

```text
https://dev.adityatavnoji.in/api/auth/sso/callback
```

To refresh an existing server `.env.docker` from the example’s **active** (uncommented) keys without wiping secrets:

```bash
./scripts/sync-docker-env-https.sh
```

### HTTP mode (current default)

```env
APP_HOST_BIND=0.0.0.0
APP_PORT=8083
PROXY_HTTP_PORT=18080
PROXY_HTTPS_PORT=443
ROOT_PATH=/api
FRONTEND_ORIGIN=http://161.97.93.106:8083
FRONTEND_APP_URL=http://161.97.93.106:8083
FRONTEND_ADMIN_URL=http://161.97.93.106:8083/admin
```

### HTTPS mode (uncomment when ready)

```env
DOMAIN=dev.adityatavnoji.in
CERTBOT_EMAIL=bharat.solanke@timadit.com
APP_HOST_BIND=127.0.0.1
PROXY_HTTP_PORT=18080
PROXY_HTTPS_PORT=443
FRONTEND_ORIGIN=https://dev.adityatavnoji.in
FRONTEND_APP_URL=https://dev.adityatavnoji.in
FRONTEND_ADMIN_URL=https://dev.adityatavnoji.in/admin
SSO_REDIRECT_URI=https://dev.adityatavnoji.in/api/auth/sso/callback
```

SSO redirect URI in Entra / ATT settings (HTTPS only):

```text
https://dev.adityatavnoji.in/api/auth/sso/callback
```

## Start / certificate

On the **server** (in the repo directory):

```bash
# 1) Pull code, then start core stack (no edge proxy — avoids host port fights)
git pull
docker compose --env-file .env.docker up -d

# Frontend image must include nginx-map.conf — rebuild frontend once:
docker compose --env-file .env.docker up -d --build frontend

# 2) Issue certificate (starts profile https proxy/certbot; ACME needs public :80 → proxy)
./scripts/ssl-init.sh

# 3) Restart backend so CORS / email links use https:// URLs from .env.docker
docker compose --env-file .env.docker up -d backend
```

`scripts/ssl-init.sh` requests the cert via webroot, then recreates `proxy` so it loads the HTTPS config.

## Verify

```bash
docker compose --env-file .env.docker ps

# HTTP → HTTPS redirect (via public :80 forward, or direct proxy port)
curl -I http://dev.adityatavnoji.in
curl -I http://127.0.0.1:18080/

# App over HTTPS
curl -I https://dev.adityatavnoji.in
curl -fsS https://dev.adityatavnoji.in/api/docs >/dev/null && echo api_ok

# Certificate
echo | openssl s_client -connect dev.adityatavnoji.in:443 -servername dev.adityatavnoji.in 2>/dev/null | openssl x509 -noout -dates -subject

# Renewal dry-run (uses same certbot volumes)
docker compose --env-file .env.docker run --rm --entrypoint certbot certbot renew --dry-run
```

Local loopback (optional):

```bash
curl -I http://127.0.0.1:8083/
```

## Renewal

The `certbot` service runs `certbot renew` every 12 hours. The `proxy` entrypoint reloads nginx every 6 hours so new certs are picked up. Both use `restart: unless-stopped` (survive reboot).

## Rollback / direct IP:8083 again

```env
APP_HOST_BIND=0.0.0.0
```

Then:

```bash
docker compose --env-file .env.docker --profile https stop proxy certbot
docker compose --env-file .env.docker up -d frontend
```

Or keep proxy and still use `https://dev.adityatavnoji.in`.

## Files

| Path | Role |
|------|------|
| `deploy/proxy/*` | Edge nginx templates + entrypoint |
| `scripts/ssl-init.sh` | First certificate |
| `docker-compose.yml` | `proxy` + `certbot` services |
| `frontend/nginx.conf` | Passes `X-Forwarded-Proto` to the API |
