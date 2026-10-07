# Deploy guide — from a code change to the client server

This is the step-by-step path for every release. Follow it top to bottom.
Deeper reference (all env variables, troubleshooting): [SERVER_DEPLOY.md](./SERVER_DEPLOY.md).

```
 Your laptop ──git push──▶ GitHub (develop) ──git pull──▶ Our server (Contabo, testing)
      │
      └── build release files ──copy──▶ Client server (AWS EC2, no internet) ──▶ AWS RDS database
```

- There is **no automatic deploy**. Pushing to `develop` only stores the code on GitHub.
- The client server has **no internet**, so we build the Docker images on our laptop and copy them in.
- Every build gets a **version number** (e.g. `1.0.2`) that is shown on the login screen and in
  **Settings → Appearance**. That is how you confirm which release is running.

| Step | Where | How often |
|---|---|---|
| [Part 0](#part-0--one-time-laptop-setup) Laptop setup | Laptop | Once |
| [Part 1](#part-1--version-numbers) Version numbers | — | Read once |
| [Part 2](#part-2--push-code-to-develop) Push code to `develop` | Laptop | Every change |
| [Part 3](#part-3--test-on-our-server-contabo) Test on our server | Contabo | Every release |
| [Part 4](#part-4--build-the-release-files) Build release files | Laptop | Every client release |
| [Part 5](#part-5--first-time-install-on-the-client-server) First install | Client EC2 | Once |
| [Part 6](#part-6--deploy-an-update-to-the-client-server) Deploy an update | Client EC2 | Every client release |
| [Part 7](#part-7--rollback) Rollback | Client EC2 | Only if needed |

---

## Part 0 — One-time laptop setup

**0.1 Install the tools**

| Tool | Check | Notes |
|---|---|---|
| Git | `git --version` | |
| Python 3.11 | `python3.11 --version` | Same as the backend image |
| Node.js 20 | `node --version` | Same as the frontend image |
| Docker Desktop | `docker compose version` → 2.24 or newer | Needed only to build client releases (Part 4) |

You also need write access to the GitHub repo
`Timad-Bharat/Asset-Tagging-and-Tracking-Takeda-Web`, and SSH access to our server and the client server.

**0.2 Get the code**

```bash
git clone https://github.com/Timad-Bharat/Asset-Tagging-and-Tracking-Takeda-Web.git Takeda-ATT
cd Takeda-ATT
git checkout develop
```

**0.3 Install dependencies (for tests and the frontend build)**

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cd frontend && npm ci && cd ..
```

---

## Part 1 — Version numbers

The version looks like **`MAJOR.MINOR.PATCH`**. The first release is **`1.0.0`**.

| Part | Who sets it | When it changes |
|---|---|---|
| `MAJOR.MINOR` | You — the `VERSION` file at the repo root (starts at `1.0`) | New feature/module → `1.1`. Big release → `2.0` |
| `PATCH` | Automatic — commits since `VERSION` was last changed | Every commit you push; back to `0` when you bump `VERSION` |

| Event | `VERSION` file | Version shown |
|---|---|---|
| First release | `1.0` | `1.0.0` |
| Next two pushes (fixes) | `1.0` | `1.0.1`, `1.0.2` |
| New feature — you change `VERSION` | `1.1` | `1.1.0` |
| Next push | `1.1` | `1.1.1` |
| Big release — you change `VERSION` | `2.0` | `2.0.0` |

```bash
./scripts/app-version.sh        # prints the version the next build will get, e.g. 1.0.2
```

- You **never type the patch number**. Each push makes it go up by itself.
- To bump MAJOR/MINOR, edit `VERSION` (one line, e.g. `1.1`) and commit it with your change.
- Always build from committed code — an uncommitted `VERSION` change gives a wrong number.
- The version is not stored in the database. It is baked into the backend image when it is built,
  so the screen always shows the code that is really running.
- Never force-push or rewrite `develop` history — that can make the number go down.

---

## Part 2 — Push code to `develop`

Do this for every change, on your laptop, from the repo folder.

**2.1 Start from the latest code**

```bash
git checkout develop
git pull origin develop
```

**2.2 Make your changes** in the editor.

**2.3 Decide the version bump**

- Bug fix / small change → do nothing (PATCH goes up automatically).
- New feature or module → edit `VERSION`, e.g. `1.0` → `1.1`.
- Big release → edit `VERSION`, e.g. `1.4` → `2.0`.

**2.4 Run the checks — both must pass**

```bash
source .venv/bin/activate
pytest -q tests                              # backend tests
cd frontend && npm run build && cd ..        # frontend type-check + build
```

If either fails, fix it before pushing.

**2.5 Review what you are about to commit**

```bash
git status            # list of changed files
git diff              # the actual changes
```

Never commit `.env`, `.env.docker`, passwords, or release files (`*.tgz`).

**2.6 Commit**

```bash
git add <the files you changed>              # or: git add -A   (after checking git status)
git commit -m "Short sentence describing what changed and why"
```

**2.7 Push**

```bash
git push origin develop
```

If the push is rejected because someone else pushed first:

```bash
git pull --rebase origin develop             # puts your commits on top of theirs
pytest -q tests                              # re-check
git push origin develop
```

**2.8 Note the version**

```bash
./scripts/app-version.sh                     # e.g. 1.0.2 — this is the release you will deploy
```

---

## Part 3 — Test on our server (Contabo)

Always check a release on our server before it goes to the client.

```bash
ssh <user>@161.97.93.106
cd <repo path on server>

./scripts/backup-db.sh                       # 1. database backup
git rev-parse --short HEAD                   # 2. note the current commit (for rollback)
git checkout develop
git pull --ff-only origin develop            # 3. get the code you just pushed
./scripts/docker-rebuild.sh                  # 4. build + restart — prints "==> Version 1.0.2"
```

Verify:

```bash
curl -fsS http://127.0.0.1:8083/api/health             # {"status":"ok"}
curl -fsS http://127.0.0.1:8083/api/auth/app-version   # {"version":"1.0.2"}
```

Open `https://assets.timadit.com` — the login screen shows **Version 1.0.2**. Log in and click through
the changed screens. Rollback on Contabo: `git checkout <commit from step 2> && ./scripts/docker-rebuild.sh`.

---

## Part 4 — Build the release files

On your laptop, with internet and Docker Desktop running. The result is two files that are the whole release.

**4.1 Check the client server's CPU type (once).** On the client server run `uname -m`:

| `uname -m` | Instance | Use |
|---|---|---|
| `x86_64` | m7i | `PLATFORM=linux/amd64` |
| `aarch64` | m7g | `PLATFORM=linux/arm64` |

**4.2 Build**

```bash
cd Takeda-ATT
git checkout develop && git pull origin develop
git status                                   # must be clean — the release must match GitHub

export APP_VERSION=$(./scripts/app-version.sh)
echo $APP_VERSION                            # e.g. 1.0.2
PLATFORM=linux/amd64                         # from 4.1

DOCKER_DEFAULT_PLATFORM=$PLATFORM docker compose --env-file .env.docker.example build backend frontend

docker save takeda_att-backend takeda_att-frontend | gzip > takeda_att_images_${APP_VERSION}.tgz
git archive --format=tar.gz -o takeda_att_source_${APP_VERSION}.tgz HEAD
ls -lh takeda_att_*_${APP_VERSION}.tgz       # images ~1 GB, source small
```

- `.env.docker.example` is only used to satisfy compose checks; no secrets go into the images.
- On an Apple Silicon Mac, building `linux/amd64` is slower (emulated). That is expected.

**4.3 Copy both files to the client server**

```bash
scp takeda_att_images_${APP_VERSION}.tgz takeda_att_source_${APP_VERSION}.tgz <user>@<EC2>:~/
```

(If scp is not allowed, use whatever the client provides — SSM, S3 bucket, etc.)

---

## Part 5 — First-time install on the client server

Do this **once**. For later releases go to Part 6.

**5.1 Get these from the client**

| Item | Detail |
|---|---|
| Access | SSH (or SSM) with sudo, and a way to copy files in |
| Server | EC2 m7i.xlarge or m7g.xlarge, at least 40 GB disk |
| Network | Inbound TCP **8090** from users' network; outbound SMTP 25 / 465 / 587 |
| Database | RDS endpoint, port **5442**, database name, a dedicated app user + password (not the master user) |
| RDS access | RDS security group allows 5442 from the EC2 security group |
| Email | SMTP host, port, username, password, allowed "from" address |

**5.2 Install Docker on the client server**

Ask the client to install Docker Engine, or on Amazon Linux 2023: `sudo dnf install -y docker`.
The Compose plugin is a single file — download it on your laptop and copy it in:

```bash
# Laptop — x86_64 for m7i, aarch64 for m7g
curl -fSL -o docker-compose https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64
scp docker-compose <user>@<EC2>:~/
```

```bash
# Client server
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo install -m 755 ~/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker $USER                # then log out and log back in
docker compose version                       # 2.24 or newer
```

If the OS firewall is on, open 8090: `sudo firewall-cmd --add-port=8090/tcp --permanent && sudo firewall-cmd --reload`.

**5.3 Build and copy the first release** — do Part 4 on your laptop.

**5.4 Unpack and load**

```bash
mkdir -p ~/takeda-att && cd ~/takeda-att
tar -xzf ~/takeda_att_source_<VERSION>.tgz
docker load < ~/takeda_att_images_<VERSION>.tgz
chmod +x scripts/*.sh
```

**5.5 Create the settings file `.env.docker`**

```bash
cp .env.docker.example .env.docker && chmod 600 .env.docker
openssl rand -hex 32        # run twice: one for JWT_SECRET_KEY, one for DATA_ENCRYPTION_KEY
python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" '<rds-password>'   # encoded password
nano .env.docker
```

Set these values (leave everything else as in the example):

```env
DATABASE_URL=postgresql+psycopg2://<APP_USER>:<ENCODED_PASSWORD>@<RDS_HOST>:5442/<DB_NAME>?sslmode=require

JWT_SECRET_KEY=<first 64-char value>
DATA_ENCRYPTION_KEY=<second 64-char value>     # never change this later

APP_HOST_BIND=0.0.0.0
APP_PORT=8090
FRONTEND_ORIGIN=http://<EC2-IP-or-DNS>:8090
FRONTEND_APP_URL=http://<EC2-IP-or-DNS>:8090
FRONTEND_ADMIN_URL=http://<EC2-IP-or-DNS>:8090/admin
ENABLE_EDGE_PROXY=false
DOMAIN=
SSO_ENABLED=false
UVICORN_WORKERS=4

BOOTSTRAP_SUPERUSER_EMAIL=<your email>
BOOTSTRAP_SUPERUSER_PASSWORD='<strong password>'
BOOTSTRAP_SUPERUSER_FULL_NAME=System Administrator

ERROR_ALERT_EMAILS=<you>@timadit.com
```

Put any value containing `$` in single quotes.

**5.6 Check the database is reachable**

```bash
docker run --rm -e DATABASE_URL="$(grep '^DATABASE_URL=' .env.docker | cut -d= -f2-)" takeda_att-backend \
  python -c "import os; from sqlalchemy import create_engine, text; print(create_engine(os.environ['DATABASE_URL']).connect().execute(text('select version()')).scalar())"
```

Prints the PostgreSQL version. A timeout = RDS security group blocks the server.
`password authentication failed` = wrong or un-encoded password.

**5.7 Start the application**

```bash
./scripts/docker-up.sh
alias dc='docker compose -f docker-compose.yml -f docker-compose.rds.yml --env-file .env.docker'
dc logs -f backend           # wait for "Starting API on port 9005...", then Ctrl+C
```

**Never run `docker-rebuild.sh` or `docker-deploy.sh --build` on the client server** — it has no internet to build.

**5.8 Set up email**

1. Open `http://<EC2-IP-or-DNS>:8090`, log in as the bootstrap admin, change the password.
2. **Settings → General → SMTP & email delivery**: fill in the client's SMTP details, **Send test**, then **Save**.
3. Restart the backend so it picks up the settings: `dc restart backend`.

**5.9 Verify** — same as Part 6, step 6.4.

---

## Part 6 — Deploy an update to the client server

Every client release, after Part 3 passed on our server.

**6.1 Build and copy the release** — do Part 4 on your laptop.

**6.2 Take a database snapshot** — AWS console → RDS → the database → **Actions → Take snapshot**.
Name it `before-<VERSION>`. (Needed if the release changes the database; cheap to always do.)

**6.3 Install the new release**

```bash
ssh <user>@<EC2>
cd ~/takeda-att

# keep the current images for rollback
docker tag takeda_att-backend:latest  takeda_att-backend:previous
docker tag takeda_att-frontend:latest takeda_att-frontend:previous

tar -xzf ~/takeda_att_source_<VERSION>.tgz        # updates scripts/compose files; .env.docker is kept
docker load < ~/takeda_att_images_<VERSION>.tgz
./scripts/docker-up.sh                            # restarts on the new images; DB migrations run automatically
```

**6.4 Verify**

```bash
curl -fsS http://localhost:8090/api/health             # {"status":"ok"}
curl -fsS http://localhost:8090/api/auth/app-version   # {"version":"<VERSION>"}  ← must be the new number
dc ps                                                  # backend and frontend "healthy"
dc logs --tail=200 backend | grep -i traceback         # expect nothing
```

Then in the browser: the login screen shows **Version `<VERSION>`**; log in, open an asset list and an order.

**6.5 Clean up** (optional, after a day or two without problems)

```bash
rm ~/takeda_att_*_<OLD_VERSION>.tgz
docker image prune -f
```

---

## Part 7 — Rollback

If the new release misbehaves on the client server:

```bash
cd ~/takeda-att
docker tag takeda_att-backend:previous  takeda_att-backend:latest
docker tag takeda_att-frontend:previous takeda_att-frontend:latest
./scripts/docker-up.sh
curl -fsS http://localhost:8090/api/auth/app-version   # shows the previous version again
```

Restore the RDS snapshot from 6.2 **only** if the new release damaged data (it replaces the whole database).

---

## Quick checklist (every release)

1. `git pull` on `develop` → make changes → bump `VERSION` if it is a feature/big release
2. `pytest -q tests` and `npm run build` pass
3. `git commit` → `git push origin develop` → note `./scripts/app-version.sh`
4. Contabo: backup → `git pull` → `./scripts/docker-rebuild.sh` → check version on login screen
5. Laptop: build release files (Part 4) → copy to client server
6. AWS: RDS snapshot
7. Client server: tag `previous` → unpack → `docker load` → `./scripts/docker-up.sh`
8. Check `/api/health`, `/api/auth/app-version`, login screen version
