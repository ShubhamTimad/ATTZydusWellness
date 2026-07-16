# Asset Tagging and Tracking — Takeda Web

Enterprise web application for **asset master data**, **tagging**, **physical verification orders**, and **workflow-driven tracking** for Takeda operations.

Built by **TiMAD** as a full-stack platform with role-based access control (RBAC), approval workflows, audit logging, and a branded user workspace plus super-admin console.

**Repository:** [Timad-Bharat/Asset-Tagging-and-Tracking-Takeda-Web](https://github.com/Timad-Bharat/Asset-Tagging-and-Tracking-Takeda-Web)

---

## Tech stack

| Layer | Stack |
|-------|--------|
| **Backend** | Python 3.11+, FastAPI, SQLAlchemy, Alembic, PostgreSQL |
| **Frontend** | Vite, React 19, TypeScript, Tailwind CSS v4, shadcn/ui |
| **Auth** | JWT (access + refresh), MFA, password policy, session idle |
| **Deploy** | Docker Compose (nginx + API + Postgres) |

---

## Features

- **Asset master** — import/export, hierarchical masters, financial & location fields, lifecycle tracking
- **Physical verification orders** — assignment, progress, closure, email notifications
- **RBAC** — features → permissions → roles → users, org-unit (plant) scoping
- **Approvals & tasks** — unified task inbox, configurable approval workflows
- **Audit trail** — admin and asset mutation logging
- **Email engine** — SMTP or DB-backed settings, templated notifications
- **Dual portals**
  - **User workspace:** `/login` → `/dashboard/*`
  - **Super-admin console:** `/admin/login` → `/admin/*`

---

## Repository layout

```
.
├── backend/           # FastAPI app, modules, Alembic migrations
├── frontend/          # React SPA (Vite)
├── scripts/           # Ops helpers (sync_modules, seeds, docker scripts)
├── tests/             # Pytest suite
├── docs/              # Deployment and permissions reference
├── docker-compose.yml
├── requirements.txt
├── create_superuser.py
├── .env.example       # Local dev template (copy to .env)
└── .env.docker.example
```

---

## Branching

| Branch | Purpose |
|--------|---------|
| `main` | Stable, release-ready code |
| `develop` | Active integration branch for ongoing work |

Clone and work from `develop` unless you are cutting a release.

---

## Quick start (local development)

### Prerequisites

- Python 3.11+
- Node.js 20+ and npm
- PostgreSQL

### 1. Environment

```bash
cp .env.example .env
```

Edit `.env` — at minimum set:

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET_KEY` — long random secret for token signing

Never commit `.env`. Only `.env.example` and `.env.docker.example` belong in git.

### 2. Backend

From the repo root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

alembic -c backend/alembic.ini upgrade head
python scripts/sync_modules.py

uvicorn app.main:app --reload --app-dir backend --port 8000
```

API docs: `http://localhost:8000/docs`

### 3. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open:

- User login: `http://localhost:5173/login`
- Dashboard: `http://localhost:5173/dashboard`
- Admin login: `http://localhost:5173/admin/login`

### 4. Create a superuser

```bash
source .venv/bin/activate
python create_superuser.py --email admin@example.com --password 'ChangeMe@123'
```

---

## Docker deployment

```bash
cp .env.docker.example .env.docker
# Edit JWT_SECRET_KEY, POSTGRES_PASSWORD, FRONTEND_* URLs, SMTP_* as needed

docker compose --env-file .env.docker up -d --build
```

Default browser URL: `http://localhost:8083`

See `docs/SERVER_DEPLOY.md` for production notes (firewall, `APP_HOST_BIND`, reverse proxy).

After first boot:

```bash
docker compose --env-file .env.docker exec backend \
  python create_superuser.py --email admin@example.com --password 'ChangeMe@123'
```

---

## Environment variables

### Backend (`.env` at repo root)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL URL |
| `JWT_SECRET_KEY` | Yes | JWT signing secret |
| `FRONTEND_APP_URL` | No | Links in emails (default `http://localhost:5173`) |
| `FRONTEND_ORIGIN` | No | CORS origin |
| `SMTP_*` | No | Email delivery; leave `SMTP_HOST` empty to log emails in dev |

Full list: `.env.example` and `.env.docker.example`.

### Frontend

In local dev, Vite proxies API calls — `VITE_API_URL` is usually **unset**.

For production builds, set `VITE_API_URL=/api` (Docker default).

---

## Database migrations

```bash
alembic -c backend/alembic.ini upgrade head
alembic -c backend/alembic.ini revision --autogenerate -m "describe change"
```

Sync RBAC feature/permission catalog after schema changes:

```bash
python scripts/sync_modules.py
```

---

## Testing

```bash
source .venv/bin/activate
pytest
```

---

## What is not committed to git

The following are intentionally excluded via `.gitignore`:

- `.env`, `.env.docker`, and other secret files
- Python virtualenvs (`.venv/`, `venv/`, `engin/`)
- `node_modules/`, `frontend/dist/`, build caches
- `backend/uploads/` (runtime file storage)
- IDE folders, logs, `__pycache__`, `.pytest_cache`

---

## Documentation

| File | Contents |
|------|----------|
| `docs/SERVER_DEPLOY.md` | Docker server deployment |
| `docs/PERMISSIONS_REFERENCE.md` | RBAC permission codes |
| `docs/API_DOCUMENTATION.md` | API overview |
| `IMPLEMENTATION_NOTES.md` | Internal build notes and module map |

---

## Troubleshooting

**`RuntimeError: JWT_SECRET_KEY is required`** — set it in `.env` and restart the backend.

**Database connection errors** — verify PostgreSQL is running and `DATABASE_URL` matches your local DB name/user/password.

**Blank page after login** — check browser console and that both backend (`:8000`) and frontend (`:5173`) are running.

**CORS / proxy issues in dev** — see `frontend/vite.config.ts`; HTML navigations stay in the SPA while API calls proxy to the backend.

---

## License

Proprietary — Takeda / TiMAD. All rights reserved unless otherwise agreed in writing.
