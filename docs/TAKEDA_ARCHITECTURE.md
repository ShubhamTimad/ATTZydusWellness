# ATT on Takeda Enterprise Cloud (TEC) — architecture

For the architecture and security review. Deployment steps: [SERVER_DEPLOY.md](./SERVER_DEPLOY.md).

## Overview

```
Users ──HTTPS──▶ AWS Load Balancer (Takeda certificate)
                        │ HTTP, port 8090
                        ▼
        RedHat Linux EC2 (Docker Engine + Compose plugin)
        ┌──────────────────────────────────────────────┐
        │ frontend container (nginx)                   │
        │   serves the web app, forwards /api ──┐      │
        │ backend container (FastAPI, Python 3.14) ◀─┘ │
        │   uploads + logs on the EC2 disk (EBS)        │
        └──────────────────────────────────────────────┘
                        │ TLS
                        ▼
                  PostgreSQL database (Amazon RDS)

Outbound from the backend: SMTP relay (email), Microsoft Entra ID (SSO).
```

| Takeda requirement | How ATT meets it |
|---|---|
| RedHat Linux EC2 with Docker; no Hyper-V, WSL or Ubuntu | The app is two Linux containers. Only Docker Engine + Compose 2.24+ are needed on the host. |
| No builds on application servers | CI builds the images and pushes them to the artifact repository. The server only pulls them (`IMAGE_REGISTRY` set → `docker-up.sh` pulls; `docker-rebuild.sh` refuses to run). |
| Code in onetakeda GitHub with CI/CD | `.github/workflows/ci.yml`: backend tests, frontend build, image build; push to the registry on `main`. |
| No Git on servers | Git is used only in GitHub and CI. The server needs `docker-compose.yml`, `docker-compose.rds.yml`, `scripts/` and `.env.docker`. |
| SSH only via HCP Boundary | The app runs no SSH service. |
| Only AWS load balancers; no IIS/ARR | Routing is done inside the frontend container (nginx). No Windows/IIS server is needed. |
| No CA certificates injected into the VM | HTTPS ends at the AWS load balancer with the Takeda certificate. The containers hold no certificates. |
| Python 3.11 not accepted | Backend on Python 3.14; frontend built with Node.js 24, served by nginx 1.30. Runtime images contain no compilers. |

## Containers

| Container | Image | Listens on | Notes |
|---|---|---|---|
| frontend | `takeda_att-frontend` (nginx 1.30, Alpine) | 8090 on the host → 80 | Only published port |
| backend | `takeda_att-backend` (Python 3.14, Debian slim) | 9005, internal only | Runs as non-root user `app` (uid 10001) |

Both restart automatically and have health checks. The backend runs database migrations on start.

## Network

| From | To | Port | Purpose |
|---|---|---|---|
| Load balancer | EC2 | 8090/TCP | Application traffic (health check: `/api/health`) |
| EC2 | Database | 5432/TCP (or the RDS port) | Application database |
| EC2 | SMTP relay | 25 / 465 / 587 | Email notifications |
| EC2 | Microsoft Entra ID | 443 | SSO sign-in |
| EC2 | Artifact repository | 443 | Pull images at deploy time |
| Admins | EC2 | via HCP Boundary | Operations |

Load balancer settings: idle timeout 300 s (large imports/exports), forward `X-Forwarded-For` and
`X-Forwarded-Proto`.

## Data and storage

- **Database:** all application data. Backups by RDS (automated backups + snapshot before each release).
- **Uploads** (asset images, attachments): Docker volume on the EC2 EBS disk — include in EBS snapshots.
- **Logs:** `./logs` on the EC2 disk, 30 days retention (`LOG_RETENTION_DAYS`).
- **Secrets:** `.env.docker` on the server (mode 600): database URL, JWT key, data-encryption key.
  SMTP and SSO secrets are stored encrypted in the database.

## Release flow

1. Developer opens a pull request → CI runs tests and builds.
2. Merge to `main` → CI pushes `takeda_att-backend:<VERSION>` and `takeda_att-frontend:<VERSION>`.
3. On the EC2: set `IMAGE_TAG=<VERSION>` in `.env.docker` → `./scripts/docker-up.sh` (pull + restart).
4. Rollback: set the previous `IMAGE_TAG` → `./scripts/docker-up.sh`.

## Sizing (proposed)

EC2: 2–4 vCPU, 8–16 GB RAM, 40 GB gp3 EBS (x86_64 or ARM64 — CI must build for the same architecture).

## Needed from Takeda

- RedHat EC2 with Docker Engine and the Compose plugin, and its CPU architecture
- Repository in the onetakeda GitHub organisation; allowed runners and actions
- Artifact repository URL, push credentials for CI, pull access for the EC2
- HCP Boundary access for the Timad support engineers
- AWS load balancer, certificate, domain and DNS record
- Database endpoint, database name, dedicated app user; backup policy
- EBS snapshot policy for uploads and logs
- SMTP relay details; Entra app registration (redirect `https://<domain>/api/auth/sso/callback`)
- Outbound TLS inspection / corporate CA policy, and approved base images
