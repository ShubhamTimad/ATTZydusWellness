# HTTPS for Docker (external reverse proxy)

Public URL: **https://assets.timadit.com**

Host **:80 / :443** are owned by another reverse proxy on this server. This stack
does **not** bind those ports. TLS terminates on the external proxy; it forwards
to the ATT frontend on loopback:

```text
Internet → :443/:80 (your existing proxy) → http://127.0.0.1:8083 → frontend → /api → backend
```

`ENABLE_EDGE_PROXY=false` (default) — CI and deploy scripts start only `db` /
`backend` / `frontend`. Set `ENABLE_EDGE_PROXY=true` only if you want this repo’s
optional `proxy` + `certbot` (and free host ports for them).

## Prerequisites

1. DNS A: `assets.timadit.com` → `161.97.93.106`  
2. External proxy vhost for `assets.timadit.com` with TLS → `http://127.0.0.1:8083`  
3. `.env.docker` public URLs set to `https://assets.timadit.com`  
4. `APP_HOST_BIND=127.0.0.1` so the app is not exposed on a second public port  

### Example external nginx server block

```nginx
server {
    listen 80;
    server_name assets.timadit.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name assets.timadit.com;
    # ssl_certificate / ssl_certificate_key — your certs

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:8083;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 300s;
    }
}
```

## Configure `.env.docker`

```bash
./scripts/sync-docker-env-https.sh
```

Active keys (from `.env.docker.example`):

```env
DOMAIN=assets.timadit.com
ENABLE_EDGE_PROXY=false
APP_HOST_BIND=127.0.0.1
APP_PORT=8083
FRONTEND_ORIGIN=https://assets.timadit.com
FRONTEND_APP_URL=https://assets.timadit.com
FRONTEND_ADMIN_URL=https://assets.timadit.com/admin
SSO_REDIRECT_URI=https://assets.timadit.com/api/auth/sso/callback
```

SSO (Entra) redirect URI:

```text
https://assets.timadit.com/api/auth/sso/callback
```

## Start / deploy

```bash
git pull origin develop
./scripts/sync-docker-env-https.sh
./scripts/docker-deploy.sh --build
docker compose --env-file .env.docker up -d backend
```

Do **not** run `./scripts/ssl-init.sh` in this mode (that starts this repo’s edge proxy).

## Verify

```bash
curl -I http://127.0.0.1:8083/
curl -I https://assets.timadit.com
curl -fsS https://assets.timadit.com/api/docs >/dev/null && echo api_ok
```

## Optional: built-in edge proxy

Only if host ports are free and you set `ENABLE_EDGE_PROXY=true`, then
`./scripts/ssl-init.sh` / Compose profile `https`. Prefer non-80 ports
(`PROXY_HTTP_PORT=18080`, `PROXY_HTTPS_PORT=8443`) if 80/443 stay taken.

## Files

| Path | Role |
|------|------|
| `.env.docker.example` | `ENABLE_EDGE_PROXY=false` + HTTPS public URLs |
| `scripts/compose-profile.sh` | Adds `--profile https` only when edge proxy enabled |
| `deploy/proxy/*` | Optional built-in edge (off by default) |
