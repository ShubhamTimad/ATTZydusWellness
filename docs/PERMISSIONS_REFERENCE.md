# Permissions reference

This document explains **every permission** available in the Takeda ATT application: what it means, what it unlocks in the UI, and which API endpoints enforce it.

---

## How permissions work

### Backend is the source of truth

Every protected API route checks permissions on the server (`core/permissions.py`). If a user lacks the required permission, the API returns **403 Forbidden** even if the UI was visible.

### Frontend uses a cached snapshot

After login, `GET /me` returns the user’s permission codes. The web app stores them in `localStorage` and uses `hasPermission()` (`frontend/src/lib/permissions.ts`) only to show or hide menus, buttons, and pages.

**Superusers** bypass all permission checks (backend and frontend).

### Permission code format

Codes use dotted names: `module.action` (for example `users.view`, `asset.create`).

Legacy colon form is still accepted for the **first** separator only (`users:view` ≡ `users.view`).

### Where permissions are defined

| Source | What it contains |
|--------|------------------|
| `backend/modules/module_config.py` | Main catalog (users, assets, orders, masters, mobile, etc.) |
| Alembic migrations | Extra features not in `MODULE_CONFIG` (auth policy, MFA, email templates) |
| `scripts/sync_modules.py` / startup sync | Upserts catalog permissions into the `permissions` table |

Assign permissions to **roles** in **Admin → Roles**. Users inherit permissions through their assigned roles.

### Admin API and superuser gate

All routes under `/admin/*` can optionally require superuser when `ENFORCE_SUPERUSER_ON_ADMIN=true` (see `.env` / `docs/SERVER_DEPLOY.md`). When that flag is **false**, each endpoint relies only on its specific permission (for example `asset.view`).

Some admin areas **always** require superuser in addition to a permission:

- Email templates (`/admin/email-templates/*`)
- Approval workflow builder (`/admin/approval-workflows/*`)
- Workflow permission mappings (`/admin/workflow-mappings/*`)

Permanent user deletion (`DELETE /admin/users/{id}`) requires **superuser** regardless of `users.delete`.

---

## Quick reference by area

| Area | Primary permissions |
|------|---------------------|
| Sign in (web) | Any valid user account |
| Sign in (mobile APK) | `mobile.access` |
| Workspace navigation | See each module below |
| Admin panel (`/admin`) | Mix of module permissions; may also need superuser |

---

## User management (`users.*`)

| Permission | Meaning | UI / behavior | API (examples) |
|------------|---------|---------------|----------------|
| `users.view` | View user directory and profiles | **Users** nav, user list, user detail, audit trail on profile | `GET /admin/users` |
| `users.create` | Create new users | **Add user** button, create-user form | `POST /admin/users` |
| `users.update` | Edit users, assign roles, resend welcome email | Edit user, role assignment, welcome resend | `PATCH /admin/users/{id}`, `POST .../roles/{role_id}`, `POST .../resend-welcome` |
| `users.delete` | Listed in RBAC catalog for role design | **Not used for API delete** — permanent delete is superuser-only | — |

**Also used for plant pickers:** `users.create` or `users.update` (with several others) allows loading plants via `GET /admin/org-units` without `org_units.view`.

---

## Plants / org units (`org_units.*`)

Plants are stored as org units of type `PLANT`.

| Permission | Meaning | UI / behavior | API (examples) |
|------------|---------|---------------|----------------|
| `org_units.view` | View plant list and details | **Plants** nav (with create/update/delete) | `GET /admin/org-units`, `GET /admin/org-units/{id}` |
| `org_units.create` | Add plants | **Add plant** on Plants page | `POST /admin/org-units` |
| `org_units.update` | Edit plant name, code, status | Edit plant | `PATCH /admin/org-units/{id}` |
| `org_units.delete` | Remove plants not referenced elsewhere | Delete plant (blocked if in use) | `DELETE /admin/org-units/{id}` |

---

## Roles (`roles.*`)

| Permission | Meaning | UI / behavior | API (examples) |
|------------|---------|---------------|----------------|
| `roles.view` | Open Roles screen and browse roles | **Roles** nav | `GET /admin/roles` (list is open to authenticated admin users) |
| `roles.create` | Create roles | **New role** | `POST /admin/roles` |
| `roles.update` | Edit role name, description, **permission assignments** | Save role, permission checkboxes; also allows **Sync permissions** on Permissions page | `PATCH /admin/roles/{id}` |
| `roles.delete` | Delete roles | Delete role (with safety guards) | `DELETE /admin/roles/{id}` |

---

## Permissions catalog (`permissions.*`)

| Permission | Meaning | UI / behavior | API (examples) |
|------------|---------|---------------|----------------|
| `permissions.view` | View permission catalog | **Permissions** nav | `GET /admin/permissions/catalog` |
| `permissions.create` | Create permissions manually; sync catalog from code | **Sync from modules** button; create custom permission | `POST /admin/permissions`, `POST /admin/permissions/sync` |
| `permissions.update` | Edit permission metadata | Edit permission row | `PATCH /admin/permissions/{id}` |
| `permissions.delete` | Remove custom permissions | Delete permission | `DELETE /admin/permissions/{id}` |

`POST /admin/permissions/sync` is also allowed with `roles.update` (so role admins can refresh the catalog).

---

## System settings (`settings.*`)

| Permission | Meaning | UI / behavior | API (examples) |
|------------|---------|---------------|----------------|
| `settings.view` | In RBAC catalog | **Not separately gated in UI** — System settings page uses `settings.update` | — |
| `settings.create` | In RBAC catalog | Not used by current UI/API | — |
| `settings.update` | Change system configuration | **System settings** nav and page: password policy, SMTP/email delivery, session idle timeout, financial year | `PUT /admin/settings/*` (except auth-policy reads) |
| `settings.delete` | In RBAC catalog | Not used by current UI/API | — |

Password policy **read** (`GET /admin/settings/password-policy`) is available without a settings permission (used during flows that need policy text).

---

## Authentication policy (`auth_policy.*`)

Separate from `settings.*`; controls login/MFA/captcha policy flags.

| Permission | Meaning | UI / behavior | API (examples) |
|------------|---------|---------------|----------------|
| `auth_policy.view` | View auth policy | Auth policy section (if exposed in settings UI) | `GET /admin/settings/auth-policy` |
| `auth_policy.update` | Change auth policy | Toggle password / MFA / captcha / MFA enforced | `PUT /admin/settings/auth-policy` |

---

## MFA (`mfa.manage`)

| Permission | Meaning | UI / behavior | API (examples) |
|------------|---------|---------------|----------------|
| `mfa.manage` | Administer MFA for users | **Resend MFA setup** on user profile | `POST /admin/users/{id}/resend-mfa` |

---

## Features (`features.*`)

Low-level RBAC feature registry (advanced admin).

| Permission | Meaning | UI / behavior | API (examples) |
|------------|---------|---------------|----------------|
| `features.view` | In RBAC catalog | Not separately gated | `GET /admin/features` (list open) |
| `features.create` | Register features | — | `POST /admin/features` |
| `features.update` | In RBAC catalog | — | `PATCH /admin/features/{id}` (currently unguarded) |
| `features.delete` | In RBAC catalog | — | `DELETE /admin/features/{id}` (currently unguarded) |

Prefer syncing from `module_config.py` rather than hand-creating features.

---

## Email templates (`email_templates.*`)

| Permission | Meaning | UI / behavior | API (examples) |
|------------|---------|---------------|----------------|
| `email_templates.view` | View templates and preview | **Email templates** admin card/page | `GET /admin/email-templates/*` |
| `email_templates.create` | Create templates | Add template | `POST /admin/email-templates` |
| `email_templates.update` | Edit templates, activate/deactivate | Edit, save, toggle active | `PATCH /admin/email-templates/{id}` |
| `email_templates.delete` | Remove templates | Delete template | `DELETE /admin/email-templates/{id}` |

All email-template admin routes also require **superuser**.

---

## Approvals (`approval.*`)

Generic approval engine (user creation, asset workflows, etc.).

| Permission | Meaning | UI / behavior | API (examples) |
|------------|---------|---------------|----------------|
| `approval.view` | See approval inbox and request details | **My tasks** nav (with other task permissions); view approval tasks | `GET /approvals/my-tasks`, `GET /approvals/requests/{id}` |
| `approval.act` | Approve, reject, or otherwise act on assigned approval tasks | Approve / reject buttons on task detail | `POST /approvals/tasks/{id}/action` |
| `approval.manage` | Configure approval workflows and permission mappings | **Workflow assignment** admin page; workflow CRUD | `/admin/approval-workflows/*`, `/admin/workflow-mappings/*` |

Workflow admin routes also require **superuser**.

---

## Tasks (`task.*`)

Manual and system-linked tasks (separate from approval engine routes).

| Permission | Meaning | UI / behavior | API (examples) |
|------------|---------|---------------|----------------|
| `task.view` | View task inbox and task detail | **My tasks** nav; open tasks; comment on tasks | `GET /tasks/my-tasks`, `GET /tasks/{id}`, `POST .../comments` |
| `task.create` | Create manual tasks | Create task (if exposed) | `POST /tasks` |
| `task.assign` | Reassign tasks | Assign task to another user | `POST /tasks/{id}/assign` |
| `task.act` | Start or complete work on a task | Start / complete actions | `POST /tasks/{id}/start`, `POST /tasks/{id}/complete` |
| `task.close` | Close tasks without completing | Close task | `POST /tasks/{id}/close` |

**Note:** Approvers viewing asset data from a task use `GET /tasks/{id}/asset`, which requires `task.view` but **not** `asset.view`.

---

## Assets (`asset.*`)

| Permission | Meaning | UI / behavior | API (examples) |
|------------|---------|---------------|----------------|
| `asset.view` | Browse and open assets | **Assets** nav, list, detail, export dialog, audit log | `GET /admin/assets/*` (read) |
| `asset.create` | Create assets manually | **New asset**, create form | `POST /admin/assets` |
| `asset.update` | Edit asset fields, attach RFID | Edit on detail; RFID attach | `PATCH /admin/assets/{id}`, RFID endpoints |
| `asset.delete` | Soft-delete assets | Delete from list | `DELETE /admin/assets/{id}` |
| `asset.import` | Bulk import assets | **Import** page and import APIs | `POST /admin/assets/import/*` |
| `asset.approve` | In RBAC catalog for workflow design | Used when mapping approval steps to roles; asset approval in tasks uses `approval.act` / workflow rules | — |
| `asset.manage` | Elevated asset operations | Treated as **update + delete + import** in API checks | Same as update/delete where `asset.manage` is accepted |

`asset.manage` is a convenience permission for power users who should edit, delete, and import without granting each code separately.

---

## Asset reference masters (`masters.*`)

Categories, tag colors, cost/profit centers, functional/actual locations.

| Permission | Meaning | UI / behavior | API (examples) |
|------------|---------|---------------|----------------|
| `masters.view` | Open masters screens | **Masters** nav; all master tabs | `GET /admin/asset-masters/*` |
| `masters.create` | Add master rows | **Add** on each master tab | `POST /admin/asset-masters/*` |
| `masters.update` | Edit master rows | Edit (pencil) on each tab | `PATCH /admin/asset-masters/*` |
| `masters.delete` | Delete unused master rows | Delete (trash) when not assigned to assets or child masters | `DELETE /admin/asset-masters/*` |

**Read fallback:** `GET /admin/asset-masters/*` also allows `asset.view` so asset forms can load dropdown data without full masters access.

---

## Physical verification orders (`order.*`)

| Permission | Meaning | UI / behavior | API (examples) |
|------------|---------|---------------|----------------|
| `order.view` | List and open orders | **Orders** nav, order list and detail | `GET /admin/physical-orders`, `GET .../{id}` |
| `order.create` | Create and submit orders; approve items when combined with approve flows | Create order from assets; submit; some approve-item actions | `POST /admin/physical-orders`, `POST .../submit`, validate assets |
| `order.update` | Edit draft orders | Edit remarks, assets, assignment on draft | `PATCH /admin/physical-orders/{id}` |
| `order.approve` | Approve or reject orders and items | Approve/reject creation and closure | `POST .../approval/*`, reject order |
| `order.execute` | Field execution: scan, start, submit closure | Start order, scan assets, execution rejections | `POST .../start`, `POST .../scan`, `POST .../submit-closure` |
| `order.reassign` | Change assigned executor | Reassign executor | `POST .../reassign` |
| `order.close` | In RBAC catalog | Close order API accepts `order.approve`, `order.update`, or `order.create` (not `order.close` alone today) | — |
| `order.complete` | In RBAC catalog | Used in **workflow permission mappings** to decide who may complete order approval steps | Workflow mapping service |
| `order.manage` | Broad order administration | List executors; reassign (with create/update) | `GET .../executors`, `POST .../reassign` |

---

## Reports (`report.*`)

| Permission | Meaning | UI / behavior | API (examples) |
|------------|---------|---------------|----------------|
| `report.view` | In RBAC catalog | Reports page is available to any logged-in workspace user today | `GET /reports/catalog` (auth only) |
| `report.export` | In RBAC catalog | Download report files | `GET /reports/generate` (auth only) |

These permissions exist for role design and future enforcement; wire them into routes when stricter report access is required.

---

## Mobile application (`mobile.*`)

Used by the Android/mobile client (`client=mobile` on login).

| Permission | Meaning | UI / behavior | API (examples) |
|------------|---------|---------------|----------------|
| `mobile.access` | Sign in to mobile app | Required for mobile login | Login with `client=mobile` |
| `mobile.asset.view` | View assets on mobile | Asset screens in APK | Mobile asset APIs |
| `mobile.asset.scan` | Scan RFID/barcodes for assets | Scan action on mobile | Mobile scan APIs |
| `mobile.order.view` | View physical orders on mobile | Order list/detail on mobile | Mobile order APIs |
| `mobile.order.execute` | Execute orders on mobile | Start/complete verification on device | Mobile execution APIs |
| `mobile.order.scan` | Scan during order execution | Scan items within an order | Mobile order scan APIs |

Web workspace permissions (`asset.*`, `order.*`) do **not** automatically grant mobile permissions.

---

## Typical permission bundles (examples)

These are **suggestions**, not built-in roles:

| Role idea | Suggested permissions |
|-----------|----------------------|
| Read-only analyst | `asset.view`, `order.view`, `masters.view`, `report.view`, `report.export` |
| Asset registrar | `asset.view`, `asset.create`, `asset.update`, `asset.import`, `masters.view` |
| Plant master admin | `masters.view`, `masters.create`, `masters.update`, `masters.delete`, `org_units.view` |
| Order coordinator | `order.view`, `order.create`, `order.update`, `order.reassign`, `asset.view` |
| Field verifier | `order.view`, `order.execute`, `mobile.access`, `mobile.order.view`, `mobile.order.execute`, `mobile.order.scan` |
| Approver | `approval.view`, `approval.act`, `task.view` |
| User admin | `users.view`, `users.create`, `users.update`, `roles.view`, `roles.update` |
| System admin | `settings.update`, `auth_policy.view`, `auth_policy.update`, `email_templates.*`, `approval.manage` (+ superuser for template/workflow UIs) |

---

## Checking effective permissions

1. Log in as the user.
2. Call `GET /me` (or inspect browser `localStorage` key `user_permissions` after login).
3. Confirm the role in **Admin → Roles** includes the expected codes.
4. If a new module was added to `module_config.py`, run **Permissions → Sync from modules** or restart with `SYNC_MODULES_ON_STARTUP=true`.

---

## Related documentation

- [How to add permissions and build a module](how-to-add-permissions-and-build-a-module-vendor-master.md)
- [API documentation](API_DOCUMENTATION.md) — endpoint-level permission matrix for some modules
- [Server deploy](SERVER_DEPLOY.md) — `ENFORCE_SUPERUSER_ON_ADMIN` and bootstrap superuser
