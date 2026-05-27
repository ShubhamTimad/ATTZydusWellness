## Implementation notes (what we built, and how)

This document describes the work completed so far in this repo:

- **Backend**: RBAC with dotted permission codes, `org_units` (Plants) as its own module, strict route guards, and **OR**-style guards where one API serves multiple workflows.
- **Frontend**: **User workspace** (`/login` → `/dashboard/*`) with RBAC-gated sidebar; **Superadmin console** (`/admin/login` → `/admin/*`) superuser-only; shared JWT + `/me` permission snapshot in `localStorage`; **Takeda brand primary** `#E1242A` (not green).
- **Dev ergonomics**: Vite proxy for app API paths (`/login`, `/dashboard`, `/tasks`, `/auth`, `/approvals`, `/audit`, `/admin/*`) so the SPA does not receive HTML for JSON calls.

---

## 1) Backend: RBAC and permission enforcement

### Core mechanics

- **`core/permissions.py`**
  - **`require_permission(code, *more)`** — caller must have **all** listed codes (typically one code).
  - **`require_any_permission(code, *alternatives)`** — caller must have **at least one** of the listed codes (OR). Used where a single endpoint supports more than one product flow.
  - Loads **user → roles → permissions** from the DB; **superuser** bypasses checks.
  - **TTL cache** (~30s) for permission snapshots; **`invalidate_permission_cache(...)`** for tests and after RBAC mutations.
  - Permission codes use **dotted** form (e.g. `users.view`); legacy **`module:action`** is still accepted for the first separator only.

- **`core/auth.py`** — JWT Bearer parsing, **`get_current_user`**.

- **`modules/module_config.py` + `modules/rbac_sync.py`**
  - Declarative modules/tabs/actions; sync script seeds **`features`** / **`permissions`** rows.
  - Modules include: **users**, **org_units** (Plants), **roles**, **permissions**, **settings**, **features**, **approval**, **task**, **asset**, **order**.
  - Run from project root (with `DATABASE_URL` / same DB as the app):  
    `python scripts/sync_modules.py`
  - With the `backend/` folder structure, Alembic lives under `backend/`:
    `alembic -c backend/alembic.ini upgrade head`

- **`alembic/versions/011_org_units_rbac_permissions.py`**
  - Seeds **`org_units`** feature and **`org_units.view|create|update|delete`** if missing (alongside sync).

### Org units (plants): two different concerns

| Action | Permission | Purpose |
|--------|------------|---------|
| **`GET /admin/org-units`** | **Any of** `org_units.view`, `users.create`, `users.update`, `roles.create`, `roles.update` | List plants for **Plants admin UI**, **user create/edit plant picker**, or **role–plant checkboxes**. |
| **`POST /admin/org-units`** | **`org_units.create`** only | Create a new plant (org unit). Does **not** use user permissions. |

This keeps **plant CRUD** under **`org_units.*`** while allowing **user/role assignment** pickers without granting Plants module view.

### Other admin routes (representative)

- **Users** — `users.view` / `users.create` / `users.update` on list, create, patch.
- **Roles** — guarded per router (e.g. create/update).
- **Permissions / features / settings** — per `require_permission` on each handler.

### Tests

- `tests/test_permissions.py` — 403 / allow / superuser patterns.
- `tests/test_rbac_sync.py` — sync creates canonical codes (includes **`org_units.view`** after sync).

---

## 2) Frontend: user workspace vs superadmin console

### Two portals

| Portal | Login | Main UI | Who |
|--------|-------|-----------|-----|
| **User workspace** | `/login` | `/dashboard/*` | All non–superuser accounts (and superusers are redirected away). |
| **Superadmin console** | `/admin/login` | `/admin/*` | **Superuser only**; others with a token are redirected to `/dashboard`. |

### Routing (`frontend/src/App.tsx`)

- **`AppRoute`** (`/dashboard/*`): loads **`GET /me`**, **`persistAuthFromMe`**. If **`is_superuser`**, redirect to **`/admin`**.
- **`AdminRoute`** (`/admin/*`): if not superuser after **`/me`**, redirect to **`/dashboard`**. Otherwise **`AdminLayout`** + nested routes.
- **Workspace management screens** live under **`/dashboard/*`** (Users, Plants, Roles, Permissions, System settings) with **`RequirePermission`** on each route — same pages/APIs as admin, but shell is **`AppShellLayout`**.

### User workspace shell (`frontend/src/components/layout/app-shell-layout.tsx`)

- Sidebar (RBAC-gated): **Dashboard**, **Users**, **Assets**, **Orders**, **My tasks**, **Plants**, **Roles**, **Permissions**, **System settings**. (**Performance** / **Preferences** routes are commented out in `App.tsx`.)
- **My tasks** nav + route: visible when the user has **any** of **`TASK_ACCESS_PERMISSIONS`** (see below) — **not** only `approval.view`.
- **Plants** nav: any of **`org_units.view|create|update|delete`**.
- Top bar: large account chip (avatar + email + chevron); dropdown **Signed in as**, **Profile** (opens modal), **Sign out** (brand primary button). No **Preferences** entry.
- **`canListOrgUnitsForAssignments()`** — mirrors **`GET /admin/org-units`** OR rule; used on **Users** / **Roles** plant pickers.

### Superadmin console shell (`frontend/src/components/layout/admin-layout.tsx`)

- Dark slate sidebar (`.admin-shell` in `index.css`) + neutral **admin canvas**.
- Grouped nav: Overview, Users, Plants, Roles, Permissions, Settings, **Workflows**, **Email templates**.
- Top bar matches workspace pattern (avatar chip); dropdown has **Sign out** only (no Profile / Preferences).
- Reusable page kit: **`AdminPage`**, **`AdminPanel`**, **`AdminTable*`** cells, **`AdminPrimaryButton`**, **`adminSelectClass`**, **`adminSwitchRowClass`** (`frontend/src/components/layout/admin-page.tsx`, `admin-ui.tsx`).

### Profile modal (workspace)

- **`frontend/src/components/profile-dialog.tsx`** — opened from account menu; loads **`GET /me`**; shows name, email, mobile, plant, roles, status, member since. No `/dashboard/profile` route.

### Auth snapshot (`frontend/src/lib/permissions.ts`)

- **`persistAuthFromMe` / `clearAuthProfile`** — store **`is_superuser`** and **`permissions[]`** from **`/me`** in `localStorage`.
- **`hasPermission(code)`** — UI checks (superuser = all true); accepts dotted codes and legacy `module:action` (first separator only).
- **`TASK_ACCESS_PERMISSIONS`** + **`canAccessTasks()`** — sidebar **My tasks**, `/dashboard/tasks` routes, and task dashboard widget. Includes: `task.view`, `approval.view`, `task.act`, `task.create`, `task.assign`, `task.close`. Backend inbox API requires **`task.view`**; UI must not gate solely on **`approval.view`**.
- Helpers: **`hasAnyNonUsersRbacPermission`**, **`canListOrgUnitsForAssignments`**.

### Brand + dialogs (global)

- Primary / brand: **`#E1242A`** (`--brand`, `--primary` in `frontend/src/index.css`; `frontend/src/lib/brand.ts` for chart hex).
- Charts and accents use brand red (no emerald/green dashboard theme).
- **`frontend/src/components/ui/dialog.tsx`** — blurred overlay, rounded card, slide/zoom animation; forms use **`.dialog-body`** padding utility.

### Key files

| Area | File |
|------|------|
| Routes | `frontend/src/App.tsx` |
| User login | `frontend/src/pages/app-login.tsx` — email **or** username; hold-to-show password; superuser blocked |
| Admin login | `frontend/src/pages/login.tsx` — same identifier + password UX |
| Forgot / reset | `frontend/src/pages/forgot-password.tsx`, `reset-password.tsx` |
| Workspace layout | `frontend/src/components/layout/app-shell-layout.tsx` |
| Admin layout | `frontend/src/components/layout/admin-layout.tsx` |
| Profile modal | `frontend/src/components/profile-dialog.tsx` |
| Permission gate | `frontend/src/components/admin/require-permission.tsx` |
| Users (admin) | `frontend/src/pages/users.tsx` — list → row opens detail; **Create** in toolbar; full-page view/edit/create |
| Plants | `frontend/src/pages/plants.tsx` |
| Roles / Permissions / Settings | `frontend/src/pages/roles.tsx`, `permissions.tsx`, `settings.tsx` (auth + password + **email delivery** tabs; password policy JSON block removed from UI) |
| Workflows | `frontend/src/pages/workflow-assignment.tsx` — list → click row to edit levels; create dialog |
| Email templates | `frontend/src/pages/email-templates.tsx` — list → edit; preview + variables |
| Task inbox | `frontend/src/pages/my-tasks.tsx`, `my-task-detail.tsx` — **`GET /tasks/my-tasks`**, unified task APIs |
| Dashboard | `frontend/src/pages/dashboard.tsx` + `components/dashboard/*` |

---

## 3) Frontend auth flow

### Endpoints

- **`POST /login`** → `access_token`, `refresh_token`
- **`GET /me`** → profile + **`is_superuser`** + **`permissions`** (flat codes for RBAC snapshot)

### User login (`/login`)

- Stores tokens, calls **`/me`**, **`persistAuthFromMe`**.
- If **superuser**: clear tokens, error directing to **`/admin/login`**.
- Else: navigate to **`/dashboard`**.

### Token + `/me` on workspace

- **`AppRoute`** refreshes **`/me`** so sidebar permission checks stay in sync (e.g. **`Outlet`** keyed after load).

---

## 4) Dev proxy (Vite)

**Problem**: With `VITE_API_URL` unset, the browser calls the Vite dev server. Paths not proxied return the SPA **`index.html`** → `JSON.parse` fails with **Unrecognized token '<'**.

**Fix**: **`frontend/vite.config.ts`** proxies API prefixes to `http://localhost:9005` (or `BACKEND_PORT`):

| Prefix | Notes |
|--------|--------|
| `/login`, `/forgot-password`, `/reset-password`, `/refresh`, `/me` | Auth |
| `/dashboard` | API only (e.g. `GET /dashboard/summary`); HTML nav to `/dashboard` stays in SPA |
| `/tasks`, `/auth`, `/approvals`, `/audit` | Workspace task + approval APIs |
| `/admin` | Admin JSON APIs; HTML nav to `/admin/login` stays in SPA |

**Alternative**: set `frontend/.env` → `VITE_API_URL=http://localhost:9005` to call the backend directly.

**API client**: `frontend/src/lib/api.ts` — `parseResponseBody()` surfaces a clear error when HTML is returned instead of JSON.

---

## 5) How to verify quickly

### RBAC

- User missing a permission on an admin route → **403**.
- Superuser → allowed (and full permission list in **`/me`** for UI).

### Portals

- **`/login`** → standard user → **`/dashboard`**; superuser → message, use **`/admin/login`**.
- **`/admin/login`** → superuser → **`/admin`**; non-superuser with token → redirected to **`/dashboard`**.

### Plants vs user creation

- Role with **`users.create`** but **no** **`org_units.view`**: can still open **Create user** and load **plant dropdown** (same **`GET /admin/org-units`** OR rule).
- **Plants** sidebar tab and plant **creation** still require **`org_units.*`** as configured in nav and **`POST /admin/org-units`**.

### DB / catalog

- After pulling code: **`alembic upgrade head`** and/or **`python scripts/sync_modules.py`** so **`org_units`** rows exist and the Permissions/Roles UI catalog matches **`MODULE_CONFIG`**.

---

## 6) Auth UX (login, forgot password, MFA)

### Login identifier

- **`POST /login`** accepts normalized **email or username** (frontend: `frontend/src/lib/login-identifier.ts`, `LoginRequest` on backend).
- User and admin login UIs share **hold eye icon** to reveal password (`PasswordInput`).

### Forgot password

- **`POST /forgot-password`**: **404** if email unknown; **403** if account inactive; **503** if email send fails (no vague-only “if account exists” when delivery fails).
- Reset emails use template **`FORGOT_PASSWORD`**; payload includes **`company_name`** (from org context) so templates do not fail on missing variables.
- Routes: `/forgot-password`, `/reset-password`, `/mfa/setup` (frontend pages + Vite proxy where applicable).

### Demo / manual test users

- **`scripts/seed_manual_test_users.py`** — e.g. `hr@demo.com`, `approver@demo.com`, `plantmgr@demo.com`, `operator@demo.com`, password **`ChangeMe@123`**, plant **DEMO-01**, role-appropriate permissions including **task** codes where needed.
- **`scripts/seed_dummy_data.py`** — roles, plants, workflows, email templates, broader demo data.

---

## 6b) Settings & email delivery

- Admin **Settings** (`/admin/settings`): tabs **Authentication**, **Password policy** (form fields only — no raw JSON editor in UI), **Email delivery** (SMTP fields stored in DB).
- Backend: settings service + **`EmailSender`** uses DB SMTP with env fallback.
- Test send: admin can send a test email from the Email tab.

---

## 6c) Notes / possible next steps

- Re-enable or implement **Performance** / **Preferences** under `/dashboard` if product needs them.
- Optional: backend guardrails for “admin UI only for superuser” in addition to frontend redirects (`ENFORCE_SUPERUSER_ON_ADMIN`).
- Workflow **action-code mappings** APIs still exist on backend (`/admin/workflow-mappings/*`); superadmin UI currently focuses on **workflow list + step editor** only.

---

## 7) Production Readiness Improvements

### RBAC Audit Logs

- Added dedicated RBAC change tracking in the table **`rbac_audit_logs`**.
- This log records **who** changed RBAC (**`actor_user_id`**), **what** was changed (**`target_type`** + **`target_id`**), **which action** occurred (create/update/delete/assign), and **before/after** snapshots (**`old_value`** / **`new_value`**, JSON).
- Logged RBAC mutations include:
  - Role creation and update
  - Permission creation and deletion
  - User-role assignment (both initial role at user creation and subsequent role changes)

### Permission Versioning

The permission snapshot cache in **`core/permissions.py`** previously relied on a TTL (~30s), which can still serve stale permissions after RBAC changes.

Fix: introduce version counters and include them in the cache key.

- Version keys (stored in DB):
  - **`company_permission_version:{company_id}`** → implemented by **`rbac_company_permission_versions`** (single-tenant default company id = `1`)
  - **`user_permission_version:{user_id}`** → implemented by **`rbac_user_permission_versions`**
- New permission cache key format:
  - `permissions:{user_id}:{company_version}:{user_version}`
- On RBAC changes:
  - Company version is incremented for role/permission mutations.
  - User version is incremented for user-role assignment (and for users affected by a role change).
- TTL remains as a fallback, but the version mismatch forces a cache miss immediately after RBAC changes.

### Backend Admin Enforcement

- Added **`require_superuser()`** dependency for backend-only superadmin enforcement.
- Admin router can enforce superuser on **all** `/admin/*` endpoints when **`ENFORCE_SUPERUSER_ON_ADMIN=true`** is set.
  - This is an opt-in switch to avoid breaking existing non-superuser workflows that use `/admin/*` APIs.

### Safety Checks

RBAC mutations now include guardrails to prevent lockouts:

- Prevent a user from changing a role in a way that removes their own `users.view` access (when they are assigned that role).
- Prevent assigning yourself a role that removes `users.view`.
- Prevent deleting a role if it would strand users with no roles.
- Prevent updates that would remove the last role-based admin-capable account (unless a superuser exists, or the system is already misconfigured and needs recovery).
- Optional guard: prevent setting a role’s permissions to an empty set.

### Auth Protection

- Added basic `/login` protections:
  - Rate limit total login attempts per IP (per-minute budget).
  - Track failed logins and apply a temporary lockout after repeated invalid credentials.
- Implementation is intentionally simple and in-memory (suitable for single-instance deployments; replace with Redis/shared store when running multiple replicas).

---

## 8) Approval Workflow Engine

### Overview

We added a lightweight, role-based approval workflow engine to support “human-in-the-loop” operations without introducing a full BPM system. Workflows are configured by superadmin and executed step-by-step, assigning approval tasks to users who have a configured **approver role**.

The first supported use case is **User Creation Approval** (`entity_type = "user_creation"`), but the data model and engine are generic for future entity types.

### Tables

- **`approval_workflows`**: workflow definition (`name`, `entity_type`, `is_active`, `created_by`, timestamps)
- **`approval_steps`**: ordered steps (`step_order`, `approver_role_id`, `required_approvals`)
- **`approval_requests`**: workflow instance for a specific entity (`entity_type`, `entity_id`, `status`, `current_step`, `payload`)
- **`approval_tasks`**: per-approver assignments for a step (`assigned_user_id`, `status`, `acted_at`)
- **`approval_actions`**: immutable action history (`approve` / `reject`, optional comment)

### Flow (User creation example)

When an admin creates a user via **`POST /admin/users`**:

1. The backend checks for an **active workflow** for `entity_type = "user_creation"`.
2. If a workflow exists:
   - The created user is set to **inactive** (`is_active = false`).
   - An **`approval_requests`** row is created with a safe `payload` snapshot (no password stored).
   - Step 1 **`approval_tasks`** are created for all active users who have the step’s `approver_role_id`.
3. Approvers review their tasks and act via **`POST /approvals/tasks/{task_id}/action`**.
4. When the last step reaches its `required_approvals`, the request is finalized:
   - The user becomes **active** (`is_active = true`).
   - A password setup email is triggered (minimal stub sender for now).

If no active workflow exists, user creation behaves as before (user is active immediately).

### How roles are used for approvals

Each approval step is tied to a single **approver role** (`approver_role_id`). Tasks are assigned to all **active users** who currently have that role. This reuses the existing RBAC role membership model (no separate approver lists).

### APIs + permissions

- **Workflow management (superadmin)**:
  - `POST /admin/approval-workflows` (create)
  - `GET /admin/approval-workflows` (list)
  - `POST /admin/approval-workflows/{id}/steps` (add step)
  - `PATCH /admin/approval-workflows/{id}/activate` (activate; only one active per `entity_type`)
- **Approver/user APIs**:
  - `GET /approvals/my-tasks`
  - `GET /approvals/requests/{id}`
  - `POST /approvals/tasks/{task_id}/action`

New permissions:

- **`approval.view`**: view assigned tasks / requests
- **`approval.act`**: approve/reject assigned tasks
- **`approval.manage`**: configure workflows (superadmin-only endpoints)

### Future extensibility

The engine is designed around `entity_type` + `entity_id` + `payload` snapshots, so additional approval flows (assets, settings changes, org unit provisioning, etc.) can be implemented by:

- defining a new `entity_type` string
- adding a finalization handler for that entity type (optional)
- creating requests + tasks via the same engine service

---

## 9) Workflow Assignment Layer

### Purpose

Approval triggering used to be tied to legacy identifiers like `entity_type="user_creation"`. The **workflow assignment layer** removes that hardcoding for supported actions by letting a superadmin map an **RBAC permission code** (`action_code`, e.g. `users.create`) to an **approval workflow**.

### Table structure (`approval_workflow_mappings`)

- **`action_code`**: canonical permission string (matches a row in `permissions.code`, which is owned by a `features` row).
- **`workflow_id`**: FK to `approval_workflows`.
- **`is_active`**: whether this mapping row is the current assignment (older rows may be retained with `is_active=false` for audit).
- **Constraint**: at most **one active mapping per `action_code`** (Postgres partial unique index on `action_code` where `is_active` is true).

### Flow (`action_code` → workflow → approval)

1. On user creation, the backend calls `get_workflow_for_action("users.create")`.
2. That helper:
   - looks up an **active mapping** for the canonical permission code, and ensures the linked workflow is **active**;
   - otherwise falls back to the legacy **`entity_type=user_creation`** active workflow (backward compatible);
   - otherwise returns **no workflow** (user stays active immediately).
3. When a workflow is returned, the existing approval engine creates the `approval_requests` / `approval_tasks` rows as before.

### Admin APIs

- `GET /admin/workflow-mappings/action-codes` — list all catalog permission codes (with owning feature metadata) for UI dropdowns.
- `GET /admin/workflow-mappings` — list mapping rows.
- `POST /admin/workflow-mappings` — assign `action_code` → `workflow_id` (requires an **active** workflow with steps).

These endpoints are **superadmin-only** and reuse `approval.manage` alongside the existing workflow configuration routes.

### Admin UI (current)

- Superadmin **Workflows** (`/admin/workflow-assignment`): **list-first** — create workflow, click row to edit name/entity type/steps, activate/deactivate. No separate mapping screen in the frontend (backend mapping APIs remain for integrations).

### Backward compatibility

- `approval_requests.entity_type` is still populated (e.g. `user_creation`) so finalization logic and reporting continue to work.
- Deployments that have **not** created a mapping yet keep working via the **`user_creation`** workflow fallback for `users.create`.

---

## 10) Unified task inbox & audit timeline

### My Tasks concept

Workspace **My tasks** (`/dashboard/tasks`) uses the **unified tasks** module:

- List: **`GET /tasks/my-tasks?inbox=active|done`** (requires **`task.view`** on the backend).
- Detail/actions: **`/tasks/{id}`**, comments, start/complete/close for manual tasks; **`POST /approvals/tasks/{id}/action`** for approval tasks (needs **`approval.act`** / **`task.act`** as applicable).

**Frontend visibility** (sidebar + route guard): **`canAccessTasks()`** — any of **`task.view`**, **`approval.view`**, **`task.act`**, **`task.create`**, **`task.assign`**, **`task.close`**. Assign **Task → view** (or act) in Roles if users should see the tab; re-login after RBAC changes so **`/me`** refreshes `localStorage` permissions.

### Timeline concept

For a given domain entity (for example a user id after creation is wired to the approval payload), **`GET /audit/entity/{entity_type}/{entity_id}`** returns a **read-only, ordered timeline**: request **created**, each recorded **approval action**, and a synthetic entry for the **current pending** step (including who still needs to act when known). This complements RBAC audit logs by focusing on the **approval lifecycle** for that entity.

### APIs added or enriched

- **`GET /approvals/my-tasks`** — enriched list: task and request ids, entity, **`action_code`**, step position (**`current_step` / `total_steps`**), optional **`step_name`**, initiator (**`created_by`** / display name), **`created_at`**, **`payload_preview`** (non-sensitive fields only), and task **`status`**.
- **`GET /approvals/requests/{id}/status`** — **`current_step`**, **`total_steps`**, **`pending_approvers`**, **`approved_count`**, **`required_approvals`**, plus overall request status.
- **`GET /audit/entity/{entity_type}/{entity_id}`** — unified timeline for viewers allowed to see that entity’s approval history (requires **`approval.view`**); path `entity_type` may use a short alias (for example **`user`**) mapped to the stored approval **`entity_type`** where applicable.

### Example flow (user creation)

1. An operator with **`users.create`** submits a new user; the engine creates an **`approval_request`** with **`entity_type=user_creation`**, snapshots a safe **`payload`**, and opens **tasks** for the first workflow step.
2. Each approver opens **My tasks**, sees the **action** and **entity preview**, and uses **Approve** or **Reject** (requires **`approval.act`**).
3. **View details** loads **request status** (progress) and the **audit timeline** for that entity so reviewers see **who created**, **who approved**, **when**, and **what is still pending**.

---

## 11) Dynamic Dashboard System (module-based)

We added a modular, permission-driven dashboard system for the **user workspace** (`/dashboard`) where the UI automatically composes dashboard sections based on the modules a user can access.

### Backend API

- `GET /dashboard/summary`
  - Returns a `modules` object where each key is a module dashboard payload.
  - Module enablement is derived from the caller’s permissions snapshot (same DB-backed RBAC as the rest of the system).

Module detection rules (current):

- **Users dashboard** enabled when the user has `users.view`.
- **Tasks dashboard** enabled when the user has any task-access permission (`approval.view`, `task.view`, `task.act`, etc. — same rules as **`canAccessTasks()`**).

Response shape (high-level):

- `modules.platform.users`
  - `total_users`, `active_users`, `inactive_users`, `new_users_last_7_days`
  - `users_by_role`: distinct user counts per role
- `modules.platform.tasks`
  - `pending`, `approved`, `rejected`, `completed`
  - `completed` is treated as “finished work” and aggregates `approved + completed + closed` statuses for tasks assigned to the current user.

Files:

- `modules/dashboard/app_router.py`
- Registered in `app_api/routes.py`

### Frontend composition

- `frontend/src/pages/dashboard.tsx`
  - Fetches `GET /dashboard/summary`
  - Renders module sections dynamically (no hardcoded numbers)
  - Shows an empty-state card when no module dashboards are available

Module components:

- `frontend/src/components/dashboard/user-dashboard.tsx`
  - Stats cards + charts (Recharts):
    - Users by role (bar)
    - Active vs inactive (donut)
- `frontend/src/components/dashboard/task-dashboard.tsx`
  - Stats cards + chart (Recharts):
    - Pending / Approved / Rejected / Completed

### Charts + theming

- Chart library: `recharts` (frontend dependency)
- Dashboard charts use brand color **`#E1242A`** (`frontend/src/lib/brand.ts`), aligned with global primary tokens in `index.css`.

---

## 12) Superadmin overview & email templates

- **`GET /admin/dashboard/summary`** — counts for users, plants, pending tasks (permission-gated); shown on **`/admin`** overview with quick links.
- **Email templates** (`/admin/email-templates`): list → edit; variables per event code; preview with sample JSON; events include `USER_CREATED`, `FORGOT_PASSWORD`, `PASSWORD_RESET`, task notifications, etc.

---

## 13) Asset Master Management

Enterprise asset module aligned with existing RBAC, approval workflows, dashboard framework, audit hooks, and workspace UI patterns (Users / Plants / Tasks).

### Database (normalized)

Migration `030_asset_master_foundation` replaces the legacy flat `assets` table with:

| Table | Purpose |
|-------|---------|
| `asset_categories` | Lookup (seeded codes e.g. equipment, IT) |
| `asset_master` | Identity, lifecycle/approval status, ownership, source, soft delete |
| `asset_information` | Descriptions, allocation, PM equipment id |
| `asset_location_information` | Plant FK → `org_units`, functional/actual location, building/floor/room/zone |
| `asset_financial_information` | Cost/profit center, cap date, vendor, PO, currency |
| `asset_inventory_information` | Counts, verification status/date/remarks |
| `asset_import_batches` | Bulk import metadata (future async-ready) |
| `asset_audit_events` | Module-scoped audit rows |

### RBAC

Catalog in `modules/module_config.py` (sync via `python scripts/sync_modules.py`):

- `asset.view`, `asset.create`, `asset.update`, `asset.delete`, `asset.import`, `asset.approve`, `asset.manage`

All `/admin/assets/*` routes use `require_permission`. Workspace routes and sidebar visibility follow the same dotted-permission pattern as Users/Plants.

### Approval workflows

Workflow mapping actions (see `workflow_mapping`):

- `asset.create` → entity type `asset_creation`
- `asset.import` → entity type `asset_import`

When a mapped workflow exists, create/import sets `lifecycle_status=pending_approval` and `approval_status=pending`, opens `approval_requests` / tasks in the inbox; finalize activates the asset (`approvals/service.py`). Without a workflow, assets activate immediately.

Demo seeds (`scripts/seed_dummy_data.py`): asset workflows + role permission grants for Operator / Plant Manager / Approver.

### Backend API (`/admin/assets`)

| Endpoint | Permission | Notes |
|----------|------------|-------|
| `GET /` | `asset.view` | Paginated list, search, filters, sort |
| `POST /` | `asset.create` | Manual create + optional approval |
| `GET /{id}` | `asset.view` | Full detail (all child tables) |
| `PATCH /{id}` | `asset.update` | Section updates |
| `DELETE /{id}` | `asset.delete` | Soft delete |
| `POST /import/preview` | `asset.import` | CSV/XLSX upload, validation + duplicates |
| `POST /import/confirm` | `asset.import` | Commit batch + optional approval |
| `GET /{id}/audit` | `asset.view` | Module audit events |
| `GET /categories` | `asset.view` | Category picker |

Files: `backend/modules/assets/` (`model.py`, `schema.py`, `service.py`, `router.py`, `import_parser.py`, `field_definitions.py`, `import_row_mapper.py`, `audit_helpers.py`).

Migration `036_asset_master_excel_fields` adds columns used by the Excel template: `asset_class`, `asset_type` on `asset_master`; `sub_location` on location; invoice/voucher/GRN/put-to-use/depreciation/life span on financial.

### Excel import template (canonical columns)

Row 1 headers (case-insensitive aliases supported):

`Asset Name` · `Asset Class` · `Asset Type` · `Asset Category` · `Asset Code` · `RFID Code` · `Sub Location` · `Cost Center` · `Party Details` · `Invoice No.` · `Invoice Date` · `Inventory Count` · `Voucher No` · `Voucher Date` · `GRN Date` · `GRN No` · `Put to Use` · `Rate Of Depreciation` · `Gross Block` · `Life Span` · `Plant Name`

| Excel header | Storage |
|--------------|---------|
| Asset Name | `asset_master.asset_name` |
| Asset Class / Type | `asset_master.asset_class`, `asset_type` |
| Asset Category | category code → `asset_category_id` |
| Asset Code / RFID | `asset_code`, `rfid_code` |
| Sub Location | `asset_location_information.sub_location` |
| Plant Name | plant code → `plant_id` |
| Cost Center, Party Details, Invoice*, Voucher*, GRN*, Put to Use, Depreciation, Gross Block, Life Span | `asset_financial_information.*` |
| Inventory Count | Ignored on import; new assets always get `inventory_count=1` |

Frontend field order mirrors the template: `frontend/src/lib/asset-master-fields.ts`, rendered on asset detail via `asset-master-panel.tsx`.

**Uniqueness:** `asset_code` is required and unique per asset. `rfid_code` is optional but must be unique when not empty (DB + import validation).

**Import review UI:** After upload, `asset-import.tsx` shows an Excel-style editable grid (`asset-import-grid.tsx`) with per-cell error highlighting. Users fix cells → **Re-validate** (`POST /import/validate`) → **Submit import** only when all rows are valid. Confirm re-validates server-side and returns `422` with the grid payload if anything fails.

### Dashboard

`GET /dashboard/summary` includes `modules.assets` when the user has `asset.view`:

- Total assets, pending approvals, inventory mismatch, recently added, by category, by plant

Frontend: `frontend/src/components/dashboard/asset-dashboard.tsx` composed from `dashboard.tsx`.

### Frontend (workspace)

Routes under `/dashboard/assets` (parent requires `asset.view`):

- **List** — `assets-list.tsx`: compact sticky table, selection checkboxes (bulk actions placeholder), pagination/filters/search
- **Detail** — `asset-detail.tsx`: single **Asset master** panel (21 Excel fields), edit/read-only, approval banner, audit trail (When / By / Activity)
- **Import** — `asset-import.tsx`: upload → preview → confirm (`asset.import` guard)

Types: `frontend/src/lib/assets-types.ts`.

### Reference masters (hierarchical)

Migration `032_hierarchical_asset_masters`. Plants remain superadmin-only (`org_units` type `PLANT`); workspace **Masters** (`/dashboard/masters`, `masters.*` permissions) maintains:

| Chain | Parent → child |
|-------|----------------|
| Financial | Plant → cost center → profit center |
| Location | Plant → functional location → actual location |

API (`/admin/asset-masters/`): `categories`, `cost-centers?plant_id=`, `profit-centers?cost_center_id=`, `functional-locations?plant_id=`, `actual-locations?functional_location_id=`. Asset create/detail dropdowns cascade: selecting plant loads cost centers and functional locations; selecting cost center loads profit centers; selecting functional location loads actual locations.

### Audit

`asset_audit_events` for create/update/import/approve/reject and section changes; integrates with global entity timeline where `entity_type` is `asset` / `asset_creation` / `asset_import`.

### Future-ready (not implemented)

Row multi-select and API shape support future bulk transfer, verification, export, RFID; import batch table supports background jobs; detail placeholders for attachments, verification cycles, disposal/transfer workflows.

### Setup after pull

```bash
alembic -c backend/alembic.ini upgrade head
python scripts/sync_modules.py
python scripts/seed_dummy_data.py   # optional demo workflows + permissions on roles
```
