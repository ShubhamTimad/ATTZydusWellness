# Server deploy (Docker)

> New to this? Follow [DEPLOY_GUIDE.md](./DEPLOY_GUIDE.md) — push to `develop` and deploy to the client, step by step.

One codebase, same images, same scripts. Each server's own **`.env.docker`** decides the port
and the database — nothing in the code changes between servers.

| | Contabo (our server) | Client EC2 (closed network) |
|---|---|---|
| URL | `https://assets.timadit.com` | `http://<EC2-IP-or-DNS>:8090` (dev) |
| `APP_PORT` / `APP_HOST_BIND` | `8083` / `127.0.0.1` (unchanged) | `8090` / `0.0.0.0` |
| HTTPS | existing reverse proxy on the host → `127.0.0.1:8083` | none on dev; later the client's load balancer |
| Database | bundled Postgres container (`POSTGRES_*`) | AWS RDS (`DATABASE_URL`) |
| `DATABASE_URL` in `.env.docker` | **must not be set** | **set** |
| Code / images | `git pull` + build on the server | built on our machine, copied in (no internet on EC2) |
| Backups | `./scripts/backup-db.sh` → `backups/` | RDS automated backups + manual snapshots |

- Only **`.env.docker`** is needed on a server. `.env` is for running the backend locally without Docker.
- The `scripts/docker-*.sh` helpers add `docker-compose.rds.yml` automatically when `DATABASE_URL`
  is set, so no Postgres container starts on EC2.
- **Do not open port `9005`** anywhere — it is the backend port inside Docker only.

## Before every deploy (on your laptop)

There is no CI. Deploy only when both pass:

```bash
source .venv/bin/activate && pytest -q tests
cd frontend && npm run build && cd ..
git push origin develop
```

---

## 1. Deploy on Contabo

### 1.1 URLs

| What | URL |
|------|-----|
| App | `https://assets.timadit.com` |
| Admin | `https://assets.timadit.com/admin/login` |
| API | `https://assets.timadit.com/api/...` |
| SSO callback (Entra) | `https://assets.timadit.com/api/auth/sso/callback` |

TLS is handled by the server's existing reverse proxy, which forwards to `http://127.0.0.1:8083`
(see [HTTPS.md](./HTTPS.md)).

### 1.2 One-time check of `.env.docker`

```bash
ssh <user>@161.97.93.106
cd <repo path on server>
grep -E '^(DATABASE_URL|APP_PORT|APP_HOST_BIND|POSTGRES_PASSWORD|ENABLE_EDGE_PROXY)=' .env.docker
```

Expected:

```env
APP_PORT=8083
APP_HOST_BIND=127.0.0.1
POSTGRES_PASSWORD=<set>
ENABLE_EDGE_PROXY=false
# and NO DATABASE_URL line (or an empty "DATABASE_URL=")
```

A value in `DATABASE_URL` would switch Contabo to external-database mode and skip its Postgres container.

Optional additions (apply with `./scripts/docker-up.sh`):

```env
ERROR_ALERT_EMAILS=you@timadit.com,teammate@timadit.com   # email on every backend ERROR
DATA_ENCRYPTION_KEY=<openssl rand -hex 32>                # set once, never change
```

Existing MFA / SMTP / SSO secrets keep working after adding `DATA_ENCRYPTION_KEY` (decryption tries
both it and `JWT_SECRET_KEY`). Remove the old `DEPLOY_NOW_TOKEN`, `GH_PAT`, `GITHUB_REPOSITORY` lines — unused.

**Log files (once, on the first deploy with per-day log folders):** logs now go to a server folder
(`./logs` by default, or `LOG_HOST_DIR`) instead of the Docker volume `takeda_att_takeda_att_logs`. The old
`LOG_FILE=` line in `.env.docker` is ignored and can be removed. To keep the old file, then drop the volume:

```bash
mkdir -p logs/legacy
sudo cp -a "$(docker volume inspect -f '{{.Mountpoint}}' takeda_att_takeda_att_logs)/." logs/legacy/
docker volume rm takeda_att_takeda_att_logs
```

The same applies on EC2 (run in `~/takeda-att`).

### 1.3 Deploy an update

```bash
cd <repo path on server>

./scripts/backup-db.sh                         # 1. DB backup → backups/takeda_att_<UTC>.dump (keeps 14)
git rev-parse --short HEAD                     # 2. note this commit for rollback
git fetch origin
git checkout develop
git pull --ff-only origin develop              # 3. new code
docker image prune -f                          # 4. optional: free disk
./scripts/docker-rebuild.sh                    # 5. build + restart (several minutes)
```

| What changed | Command | Time |
|---|---|---|
| Code (after `git pull`) | `./scripts/docker-rebuild.sh` | several minutes |
| Backend code only | `./scripts/docker-rebuild.sh backend` | ~2–5 min |
| Frontend code only | `./scripts/docker-rebuild.sh frontend` | ~3–8 min |
| Only `.env.docker` | `./scripts/docker-up.sh` | ~30 s |

### 1.4 Verify

```bash
docker compose --env-file .env.docker ps                                  # db, backend, frontend healthy
curl -fsS http://127.0.0.1:8083/api/health                                # {"status":"ok"}
curl -fsS https://assets.timadit.com/api/health                           # through the HTTPS proxy
docker compose --env-file .env.docker logs --tail=200 backend | grep -i traceback   # expect nothing
```

Then log in at `https://assets.timadit.com` and open an asset list and an order.

### 1.5 Rollback

```bash
git checkout <commit noted in 1.3 step 2>
./scripts/docker-rebuild.sh
```

Only if the new version's migration damaged data, also restore the backup taken in step 1:

```bash
docker compose --env-file .env.docker exec -T db \
  pg_restore -U takeda -d takeda_att --clean --if-exists < backups/takeda_att_<UTC>.dump
```

Optional daily backup (cron): `0 2 * * * cd <repo path> && ./scripts/backup-db.sh`

### 1.6 If the site does not load

1. `docker compose --env-file .env.docker ps` — expect `db`, `backend`, `frontend` healthy. The built-in
   `proxy` should **not** run when `ENABLE_EDGE_PROXY=false`.
2. On the server: `curl -I http://127.0.0.1:8083/` and `curl -I https://assets.timadit.com/`.
3. The external reverse proxy must forward `assets.timadit.com` → `http://127.0.0.1:8083`. Direct
   public `:8083` does not work (bound to loopback). Firewall: **80/443** on the external proxy.
4. `docker compose --env-file .env.docker logs --tail=100 frontend backend`.

### 1.7 Fresh install on a Contabo-style server

```bash
git clone -b develop git@github.com:Timad-Bharat/Asset-Tagging-and-Tracking-Takeda-Web.git takeda-att
cd takeda-att
cp .env.docker.example .env.docker && chmod 600 .env.docker
# Edit: JWT_SECRET_KEY, DATA_ENCRYPTION_KEY, POSTGRES_PASSWORD, FRONTEND_* URLs, BOOTSTRAP_SUPERUSER_*
chmod +x scripts/*.sh
./scripts/docker-rebuild.sh
```

---

## 2. Deploy on client EC2 (closed network)

The EC2 instance has **no internet**: it cannot `git clone`, `pip install`, `npm ci` or pull Docker
images. We build the images on our machine and copy a release in. Open inbound ports on this server:
**8069, 8090, 8091** (web), outbound SMTP **25 / 465 / 587**. The app uses **8090**
(8069 is Odoo's default — leave it).

### 2.1 What the client provides

| Item | Detail |
|---|---|
| Access | SSH (or SSM) to the instance with sudo, and a way to copy files in (scp, SSM, S3) |
| Instance | m7i.xlarge (x86_64) or m7g.xlarge (ARM64) — 4 vCPU / 16 GB. **Check `uname -m`**: images must match |
| Disk | EBS gp3, at least **40 GB** |
| Docker | Docker Engine installed (2.3) — or allow us to install it |
| Security group | inbound TCP **8090** from users' network; SSH only from trusted IPs |
| RDS | endpoint, port **5442**, database name, a **dedicated app user** + password (not the master user) |
| RDS security group | inbound 5442 from the EC2 instance's security group |
| SMTP | host, port (25 / 465 / 587), username, password, allowed "from" address |

### 2.2 Build a release (on our machine, with internet)

From the repo, at the commit you want to ship:

```bash
git checkout develop && git pull
PLATFORM=linux/amd64                   # m7i.  For m7g use linux/arm64
export APP_VERSION=$(./scripts/app-version.sh)   # e.g. 1.0.0 — shown on the login screen (see DEPLOY_GUIDE.md)
VERSION=$APP_VERSION

# .env.docker.example only satisfies compose's required-variable checks; nothing env-specific is baked in.
DOCKER_DEFAULT_PLATFORM=$PLATFORM docker compose --env-file .env.docker.example build backend frontend

docker save takeda_att-backend takeda_att-frontend | gzip > takeda_att_images_${VERSION}.tgz
git archive --format=tar.gz -o takeda_att_source_${VERSION}.tgz HEAD
```

- Apple Silicon Macs build ARM by default — keep `PLATFORM=linux/amd64` for m7i (emulated build, slower).
- The two files are the whole release: images (~1 GB) + compose files/scripts (small).

Copy both to the instance:

```bash
scp takeda_att_images_${VERSION}.tgz takeda_att_source_${VERSION}.tgz <user>@<EC2>:~/
```

### 2.3 One-time: Docker on the instance

Ask the client to install Docker Engine, or install it from the OS repositories if the VPC can reach
them (Amazon Linux 2023: `sudo dnf install -y docker`). Then add the **Compose plugin** — it is a single
file; download it on our machine and copy it in:

```bash
# on our machine — pick the instance's architecture: x86_64 (m7i) or aarch64 (m7g)
curl -fSL -o docker-compose https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64
scp docker-compose <user>@<EC2>:~/

# on EC2
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo install -m 755 ~/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker $USER          # log out and back in
docker compose version                 # must be 2.24 or newer
uname -m                               # must match PLATFORM used in 2.2
```

Buildx is not needed (nothing is built on the instance). If the OS firewall is on, allow 8090
(`sudo ufw allow 8090/tcp` or `sudo firewall-cmd --add-port=8090/tcp --permanent && sudo firewall-cmd --reload`).

### 2.4 First install

**Unpack and load:**

```bash
mkdir -p ~/takeda-att && cd ~/takeda-att
tar -xzf ~/takeda_att_source_<VERSION>.tgz
docker load < ~/takeda_att_images_<VERSION>.tgz
chmod +x scripts/*.sh
```

**Create `.env.docker`:**

```bash
cp .env.docker.example .env.docker && chmod 600 .env.docker
openssl rand -hex 32        # twice: JWT_SECRET_KEY and DATA_ENCRYPTION_KEY
python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" '<rds-password>'
```

Set these values (leave the rest as in the example):

```env
# Database (RDS) — setting this disables the bundled Postgres container
DATABASE_URL=postgresql+psycopg2://<APP_USER>:<URL_ENCODED_PASSWORD>@<RDS_HOST>:5442/<DB_NAME>?sslmode=require

# Secrets — never change DATA_ENCRYPTION_KEY after SMTP/SSO secrets are saved in the UI
JWT_SECRET_KEY=<64 hex chars>
DATA_ENCRYPTION_KEY=<another 64 hex chars>

# Web (dev: plain HTTP on 8090)
APP_HOST_BIND=0.0.0.0
APP_PORT=8090
FRONTEND_ORIGIN=http://<EC2-IP-or-DNS>:8090
FRONTEND_APP_URL=http://<EC2-IP-or-DNS>:8090
FRONTEND_ADMIN_URL=http://<EC2-IP-or-DNS>:8090/admin
ENABLE_EDGE_PROXY=false
DOMAIN=
SSO_ENABLED=false

# Keep as in the example (baked into the images)
BACKEND_PORT=9005
VITE_API_URL=/api
ROOT_PATH=/api
ENABLE_API_DOCS=false

UVICORN_WORKERS=4                     # 4 vCPU

# First admin — created only when no superuser exists
BOOTSTRAP_SUPERUSER_EMAIL=<your email>
BOOTSTRAP_SUPERUSER_PASSWORD='<strong password, 8+ chars>'
BOOTSTRAP_SUPERUSER_FULL_NAME=System Administrator

ERROR_ALERT_EMAILS=<you>@timadit.com,<teammate>@timadit.com
```

- Put values containing `$` in **single quotes** — Compose treats `$` as a variable.
- `POSTGRES_*` are ignored when `DATABASE_URL` is set. Do not add `GH_PAT` / `DEPLOY_NOW_TOKEN`.
- SMTP is set in the web UI (2.5). `SMTP_*` here is optional — a fallback so an error alert can still
  go out while the database is down.

**Check RDS is reachable** (uses the backend image — no extra downloads):

```bash
docker run --rm -e DATABASE_URL="$(grep '^DATABASE_URL=' .env.docker | cut -d= -f2-)" takeda_att-backend \
  python -c "import os; from sqlalchemy import create_engine, text; print(create_engine(os.environ['DATABASE_URL']).connect().execute(text('select version()')).scalar())"
```

A timeout means the RDS security group blocks the instance. `password authentication failed` means a
wrong or un-encoded password. The app user must own the database; no superuser or extensions needed.

**Start** (no build — uses the loaded images):

```bash
docker compose -f docker-compose.yml -f docker-compose.rds.yml --env-file .env.docker config > /dev/null && echo "compose OK"
./scripts/docker-up.sh
docker compose -f docker-compose.yml -f docker-compose.rds.yml --env-file .env.docker logs -f backend
```

**Never run `docker-rebuild.sh` on this instance** — it tries to build and fails without internet.

A clean first start (empty RDS) logs, in order: `Waiting for database...` → `Running database migrations...`
→ `Ensuring system email templates...` → `Ensuring bootstrap superuser...` → `Syncing permission catalog...`
→ `Starting API on port 9005...`

### 2.5 Configure email (web UI)

1. Open `http://<EC2-IP-or-DNS>:8090`, log in as the bootstrap admin, **change the password**.
2. **Settings → General → SMTP & email delivery**:
   - Send real emails: **On**
   - SMTP host / Port: from the client
   - Use TLS: **On** for 587 · Off for a port-25 relay · either for 465 (SSL is automatic)
   - Username / App password: from the client (empty for an unauthenticated relay)
   - From email: an address the SMTP server allows · From name: e.g. `Takeda Asset Tracking`
3. **Send test email to** your address → **Send test** (tests the form, not yet saved).
4. Click **Save**.
5. Restart the backend once so every worker picks up the saved settings (repeat after any SMTP change):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.rds.yml --env-file .env.docker restart backend
   ```

### 2.6 Verify

```bash
curl -fsS http://localhost:8090/api/health            # {"status":"ok"}
```

- Login page → **Forgot password** → reset email arrives with an `http://<EC2>:8090/...` link.
- Error alert email:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.rds.yml --env-file .env.docker exec -u app backend \
    python -c "import logging,threading; from core.logging_setup import configure_logging; configure_logging(); logging.getLogger('alert_test').error('Test alert from EC2'); [t.join() for t in threading.enumerate() if t.name=='error-alert']"
  ```
  Recipients get `[<EC2>:8090] ERROR: Test alert from EC2`. If not:
  `... logs backend | grep error_alert_not_sent`.
- Set up masters (plants, cost centers, roles, users), create an asset, upload an image, export
  Excel/PDF, take one order through approval.

### 2.7 Deploy an update

1. On our machine: build a new release (2.2) and copy both files to the instance.
2. AWS console: take a **manual RDS snapshot** if the release contains migrations.
3. On EC2:

```bash
cd ~/takeda-att
docker tag takeda_att-backend:latest  takeda_att-backend:previous     # keep current images for rollback
docker tag takeda_att-frontend:latest takeda_att-frontend:previous
tar -xzf ~/takeda_att_source_<VERSION>.tgz                              # .env.docker is not in the archive — kept
docker load < ~/takeda_att_images_<VERSION>.tgz
./scripts/docker-up.sh
curl -fsS http://localhost:8090/api/health
```

### 2.8 Rollback

```bash
docker tag takeda_att-backend:previous  takeda_att-backend:latest
docker tag takeda_att-frontend:previous takeda_att-frontend:latest
./scripts/docker-up.sh
```

Restore the RDS snapshot only if the new version's migration damaged data.

### 2.9 Everyday commands

Hand-typed compose commands on this instance need the RDS file:

```bash
alias dc='docker compose -f docker-compose.yml -f docker-compose.rds.yml --env-file .env.docker'
dc ps
dc logs -f backend
dc restart backend
```

### 2.10 Moving the client to production (HTTPS + SSO)

No code change. The client's load balancer terminates HTTPS with their certificate and forwards to
`<EC2>:8090`. In `.env.docker`, then `./scripts/docker-up.sh`:

```env
FRONTEND_ORIGIN=https://<domain>
FRONTEND_APP_URL=https://<domain>
FRONTEND_ADMIN_URL=https://<domain>/admin
SSO_ENABLED=true
SSO_REDIRECT_URI=https://<domain>/api/auth/sso/callback
```

Ask the client to:
- forward `X-Forwarded-Proto` and `X-Forwarded-For` (frontend nginx passes them through),
- allow 50 MB request bodies and a 300 s timeout (imports / large exports),
- register `https://<domain>/api/auth/sso/callback` in the Entra app registration,
- restrict port 8090 to the load balancer only,
- confirm RDS backup retention; if the DB password rotates in Secrets Manager, plan to update
  `DATABASE_URL` and restart after each rotation (or disable rotation for the app user).

---

## Reference (both servers)

### What starts automatically

On backend container start (`backend/docker-entrypoint.sh`):

1. Waits for PostgreSQL (bundled container or RDS)
2. Runs `alembic upgrade head` (schema migrations only — no demo data)
3. Ensures system email templates
4. Creates the bootstrap superuser **only if none exists**
5. Syncs the permission/feature catalog once when `SYNC_MODULES_ON_STARTUP=true`
6. Starts Uvicorn on `BACKEND_PORT` (9005) with `UVICORN_WORKERS` workers

The frontend nginx container serves the React build and proxies `/api/*` to the backend; it is
published on `APP_HOST_BIND:APP_PORT`.

### Environment variables (`.env.docker`)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Set = external DB (RDS), no Postgres container. Unset = bundled Postgres from `POSTGRES_*` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Bundled Postgres (Contabo) |
| `JWT_SECRET_KEY` | Required, 32+ random chars |
| `DATA_ENCRYPTION_KEY` | Encrypts SMTP/SSO/MFA secrets in the DB. Set once, never change |
| `APP_PORT` / `APP_HOST_BIND` | Published web port and bind address (`127.0.0.1` behind a proxy, `0.0.0.0` direct) |
| `FRONTEND_APP_URL` / `FRONTEND_ORIGIN` / `FRONTEND_ADMIN_URL` | Public URL — email links and CORS |
| `BACKEND_PORT` | Internal API port (`9005`; baked into the frontend image) |
| `VITE_API_URL` / `ROOT_PATH` | `/api` (baked into the frontend image) |
| `UVICORN_WORKERS` | API worker processes (default 2; 4 on a 4-vCPU instance) |
| `ENABLE_EDGE_PROXY` | `true` = this repo's proxy/certbot (`--profile https`). Default `false` |
| `ENABLE_API_DOCS` | `false` hides `/docs` |
| `ERROR_ALERT_EMAILS` | Comma-separated addresses that get an email per backend error. See [LOGGING.md](./LOGGING.md) |
| `ERROR_ALERT_THROTTLE_SECONDS` | Same error emailed at most once per window (default 900) |
| `LOG_HOST_DIR` | Server folder for log files (default `./logs` next to `docker-compose.yml`). See [LOGGING.md](./LOGGING.md) |
| `LOG_RETENTION_DAYS` | Days of daily log files to keep (default 30) |
| `SMTP_*` | Fallback when Admin → Settings → Email delivery fields are empty |
| `SSO_*` | Fallback when Admin → Settings → SSO fields are empty |
| `ENFORCE_SUPERUSER_ON_ADMIN` | `false` = RBAC; `true` = superuser-only `/admin/*` |
| `SYNC_MODULES_ON_STARTUP` | Sync permission catalog on start (catalog only, no demo data) |
| `SEED_SYSTEM_EMAIL_TEMPLATES` | Ensure core email templates on start |
| `BOOTSTRAP_SUPERUSER_*` | First admin, used only when no superuser exists |

Do **not** run these on any server — they insert demo plants, assets, orders and users:
`scripts/seed_dummy_data.py`, `scripts/seed_manual_test_users.py`, `scripts/seed_fy_verification_demo.py`,
`scripts/seed_physical_order_states.py`.

### Useful commands

Contabo: `docker compose --env-file .env.docker ...` · EC2: `dc ...` (alias in 2.9).

```bash
# Logs (stdout)
docker compose --env-file .env.docker logs -f backend

# Log files on the server — work even when Docker is down (folder = LOG_HOST_DIR, default ./logs)
tail -f logs/error/error-$(date -u +%F).log     # errors only
tail -f logs/all/all-$(date -u +%F).log         # everything, end-to-end

# Migrations only (normally automatic on start)
docker compose --env-file .env.docker exec backend alembic -c backend/alembic.ini upgrade head

# Permission catalog sync (or Admin → Permissions → Sync from config)
docker compose --env-file .env.docker exec -u app backend python -c "import app.main"

# Another superuser
docker compose --env-file .env.docker exec backend \
  python /app/create_superuser.py --email admin@example.com --password 'ChangeMe@123'
```

### Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Compose error about `!reset` | Docker Compose older than 2.24 — upgrade the plugin |
| Backend stuck on `Waiting for database...` | DB unreachable or wrong `DATABASE_URL`; on EC2 run the RDS check in 2.4 |
| `password authentication failed` | Password not URL-encoded, or contains `$` without single quotes |
| Contabo started without its database | `DATABASE_URL` got set in Contabo's `.env.docker` — remove it, `./scripts/docker-up.sh` |
| EC2 page does not load in the browser | Security group / OS firewall missing 8090, or `APP_HOST_BIND` not `0.0.0.0` |
| `exec format error` on EC2 | Images built for the wrong CPU — rebuild with the right `PLATFORM` (2.2) |
| EC2 tries to build / pull and fails | Used `docker-rebuild.sh` or `--build` — use `./scripts/docker-up.sh` |
| "Password reset email is not configured" | Configure Admin → Settings → Email delivery (or `SMTP_*`), check `FRONTEND_APP_URL`, restart backend |
| Only some emails go out after saving SMTP | Restart the backend (2.5 step 5) |
| Emails fail after changing secrets | `DATA_ENCRYPTION_KEY` / `JWT_SECRET_KEY` changed — re-enter SMTP password and SSO secret in Settings |
| No error alert emails | `ERROR_ALERT_EMAILS` empty or SMTP broken: `logs backend \| grep error_alert_not_sent` |
| 403 on `/api/admin/*` for non-superusers | `ENFORCE_SUPERUSER_ON_ADMIN=false`, restart backend, grant role permissions |
| Disk full | `docker image prune -af && docker builder prune -af`. **Never** `docker volume prune` on Contabo — it deletes the database |
| Backend keeps restarting / crashed | `docker inspect -f '{{.State.ExitCode}} OOM={{.State.OOMKilled}}' takeda_att-backend-1`, then the last lines of `logs/error/` and `logs/all/` |
| Docker itself is down | Log files are still on disk in `LOG_HOST_DIR`. Why: `sudo journalctl -u docker --since "2 hours ago"`, `df -h`. Start: `sudo systemctl start docker` (containers come back) |

## Local Docker (development)

Same `docker-compose.yml`; in `.env.docker`:

```env
APP_HOST_BIND=0.0.0.0
FRONTEND_APP_URL=http://localhost:8083
FRONTEND_ORIGIN=http://localhost:8083
```

Then `./scripts/docker-deploy.sh` and open `http://localhost:8083`.
