# HTTPS (Let's Encrypt) for Docker

Edge proxy terminates TLS and forwards to the existing `frontend` container.
Public URL: **https://assets.timadit.com**

```text
Internet → :443 / :80 (proxy, profile https) → frontend:80 → /api → backend
                         ↑
                   Let's Encrypt (certbot)
```

When `DOMAIN` is set in `.env.docker`, deploy scripts and CI start Compose profile **`https`** (proxy + certbot). Frontend stays on loopback **`APP_PORT=8083`**.

## Prerequisites

1. DNS A record: `assets.timadit.com` → server public IP (`161.97.93.106`)  
2. Firewall: allow **80** and **443** (TCP)  
3. No other process bound to host ports 80/443  
4. First certificate: `./scripts/ssl-init.sh` (once; renewals are automatic)

## Configure `.env.docker`

**Default in `.env.docker.example`:** HTTPS via `assets.timadit.com`.

Sync active keys from the example without wiping secrets:

```bash
./scripts/sync-docker-env-https.sh
```

### HTTPS mode (active)

```env
DOMAIN=assets.timadit.com
CERTBOT_EMAIL=bharat.solanke@timadit.com
APP_HOST_BIND=127.0.0.1
APP_PORT=8083
PROXY_HTTP_PORT=80
PROXY_HTTPS_PORT=443
FRONTEND_ORIGIN=https://assets.timadit.com
FRONTEND_APP_URL=https://assets.timadit.com
FRONTEND_ADMIN_URL=https://assets.timadit.com/admin
SSO_REDIRECT_URI=https://assets.timadit.com/api/auth/sso/callback
```

SSO redirect URI in Entra / ATT settings:

```text
https://assets.timadit.com/api/auth/sso/callback
```

### HTTP IP fallback (optional)

Comment out `DOMAIN` / HTTPS `FRONTEND_*` / set `APP_HOST_BIND=0.0.0.0` and use `http://161.97.93.106:8083` (see block B in `.env.docker.example`).

## Start / certificate

On the **server**:

```bash
git pull origin develop
./scripts/sync-docker-env-https.sh   # optional — applies example public URL keys
docker compose --env-file .env.docker --profile https up -d --build frontend

# First time only — issue Let's Encrypt cert (needs DNS + :80 reachable)
./scripts/ssl-init.sh

docker compose --env-file .env.docker --profile https up -d backend
```

Later deploys (GitHub Actions / `./scripts/docker-deploy.sh`) recreate the stack **including** proxy when `DOMAIN` is set. Cert volumes persist across `docker compose down` (no `-v`).

## Verify

```bash
docker compose --env-file .env.docker --profile https ps

curl -I http://assets.timadit.com
curl -I https://assets.timadit.com
curl -fsS https://assets.timadit.com/api/docs >/dev/null && echo api_ok

echo | openssl s_client -connect assets.timadit.com:443 -servername assets.timadit.com 2>/dev/null | openssl x509 -noout -dates -subject

docker compose --env-file .env.docker --profile https run --rm --entrypoint certbot certbot renew --dry-run
```

Loopback (CI health check):

```bash
curl -I http://127.0.0.1:8083/
```

## Renewal

The `certbot` service runs `certbot renew` every 12 hours. The `proxy` entrypoint reloads nginx every 6 hours so new certs are picked up.

## Files

| Path | Role |
|------|------|
| `deploy/proxy/*` | Edge nginx templates + entrypoint |
| `scripts/ssl-init.sh` | First certificate |
| `docker-compose.yml` | `proxy` + `certbot` (profile `https`) |
| `.github/workflows/deploy-develop.yml` | CI starts profile `https` when `DOMAIN` is set |
| `frontend/nginx.conf` | Passes `X-Forwarded-Proto` to the API |
