# Single Sign-On (OIDC)

Provider-agnostic OpenID Connect (OIDC) SSO for ATT. Works with **Microsoft Entra ID** (Azure AD), Okta, Auth0, Keycloak, and any standard OIDC IdP.

Configure under **Admin → Settings → Authentication → Single sign-on (OIDC)**.

---

## How it works (high level)

```
Browser                ATT API                         Identity Provider (Entra / Okta / …)
   |                      |                                      |
   |  Sign in with SSO    |                                      |
   |--------------------->|  GET /auth/sso/login                 |
   |                      |  302 → IdP authorize URL             |
   |<---------------------|                                      |
   |  User signs in at IdP                                       |
   |------------------------------------------------------------>|
   |  302 → /auth/sso/callback?code&state                        |
   |--------------------->|  Exchange code → ID token            |
   |                      |  Map claims → ATT User               |
   |                      |  Issue ATT access + refresh JWTs     |
   |  302 → /sso/callback?tokens                                 |
   |<---------------------|                                      |
   |  Store tokens, GET /me, enter app                           |
```

**Important design choice:** Entra (or any IdP) proves *who you are*. ATT still issues its **own JWTs** afterward. Refresh tokens, idle timeout, permissions (`/me`), and RBAC stay unchanged.

---

## Implementation process (how SSO was built in ATT)

Use this as the end-to-end guide to implement or re-implement OIDC SSO in this codebase.

### Step 0 — Decide before coding

| Decision | ATT choice |
|----------|------------|
| Protocol | **OIDC** Authorization Code (+ PKCE); not SAML unless IT mandates it |
| Who owns the OIDC dance? | **Backend** (confidential client + secret). SPA only starts redirect and receives ATT JWTs |
| Session after SSO | Keep **ATT JWTs** + `UserSession` (do not put Entra access tokens on every API call) |
| Who may enter ATT? | Prefer **pre-provisioned** users; JIT optional via settings |
| MFA | Entra MFA for SSO path; ATT TOTP MFA remains for **password** login only |
| Idle timeout | Unchanged — same 10‑minute (configurable) idle for SSO and password sessions |

Collect from the client / IdP admin: **Tenant ID**, **Client ID**, **Client secret**, **Redirect URI(s)** per environment, email vs UPN claim, group assignment, JIT yes/no.

### Step 1 — Persist settings (admin-configurable)

1. Store provider-agnostic keys in the `settings` table (`sso.*`), same pattern as SMTP.
2. Admin API: `GET/PUT /admin/settings/sso` with secret blank on GET + `client_secret_configured`.
3. Superadmin UI: **Settings → Authentication → Single sign-on (OIDC)**.
4. Public `GET /auth/policy` exposes only `sso_enabled` + `sso_button_label` (never the secret).
5. Optional env fallbacks (`SSO_ISSUER`, `SSO_CLIENT_ID`, …) when a DB key is unset.

### Step 2 — Link IdP identity to ATT users

1. Add nullable unique `users.external_subject` (Alembic `094`).
2. On first successful SSO, set it from the configured **subject claim** (`oid` for Entra, else `sub`).
3. Match order: `external_subject` → email (from **email claim** / fallbacks) → JIT create if allowed → else reject.

### Step 3 — Backend OIDC endpoints

1. `GET /auth/sso/login?portal=user|admin`  
   - Load config via `get_sso_config()`.  
   - Fetch `{issuer}/.well-known/openid-configuration`.  
   - Build authorize URL with `client_id`, `redirect_uri`, `scope`, PKCE, signed `state`.  
   - Return **302** to the IdP.
2. `GET /auth/sso/callback`  
   - Validate `state`; exchange `code` at token endpoint.  
   - Verify ID token (JWKS, audience = client ID, issuer).  
   - Resolve/create `User`; enforce portal rules (superuser ↔ admin).  
   - Call `AuthService.issue_token_pair(user)`.  
   - **302** to frontend `/sso/callback?access_token&refresh_token&portal`.
3. Skip idle middleware for `/auth/sso/*` (unauthenticated entry).

Core modules:

- `backend/modules/platform/auth/sso_oidc.py` — OIDC + user linking  
- `backend/modules/platform/auth/sso_routes.py` — HTTP routes  
- `backend/modules/platform/settings/sso_config.py` — runtime config  

### Step 4 — Frontend login + handoff

1. Login pages call `GET /auth/policy`; if `sso_enabled`, show **Sign in with Microsoft** (or configured label).
2. Button navigates to `{API}/auth/sso/login?portal=user|admin`.
3. `/sso/callback` reads tokens from the query string, stashes them briefly in `sessionStorage` (survives React Strict Mode remount), stores ATT JWTs in `localStorage`, calls `GET /me`, then routes to `/dashboard` or `/admin`.
4. Shared UI: `frontend/src/components/auth/sso-sign-in-button.tsx`.

### Step 5 — Configure IdP + ATT (go-live)

1. Register a **Web** app in Entra (or other OIDC IdP).  
2. Set redirect URI to ATT’s **backend** callback (e.g. `https://<host>/auth/sso/callback` or local Vite-proxied `http://localhost:5173/auth/sso/callback`).  
3. Fill Admin SSO settings; enable SSO; save.  
4. Confirm discovery JSON opens in a browser.  
5. Create ATT users with matching emails (if JIT off) and assign roles.  
6. Test workspace SSO and admin SSO separately.  
7. Restrict Entra app to assigned users/groups for production.  
8. Prefer **JIT off** in production.

### Step 6 — Verify (test plan)

| # | Test | Expected |
|---|------|----------|
| 1 | SSO button appears when enabled | Button on `/login` and `/admin/login` |
| 2 | Happy path (existing active user) | Lands on dashboard / admin with valid `/me` |
| 3 | Unknown email + JIT off | “Not authorized” |
| 4 | Unknown email + JIT on | User created; can enter (limited until roles assigned) |
| 5 | Inactive ATT user | Rejected |
| 6 | Superuser on `/login` SSO | Told to use admin SSO |
| 7 | Non-superuser on `/admin/login` SSO | Rejected |
| 8 | Idle timeout after SSO | Same idle sign-out as password login |
| 9 | Wrong redirect URI / secret | Clear error (token exchange / IdP mismatch) |

### What not to rebuild

- Do not replace `get_current_user` / Bearer ATT JWTs with raw Entra tokens.  
- Do not duplicate idle/refresh/RBAC for SSO — reuse `issue_token_pair`.  
- Do not put the client secret in the SPA or in `GET /auth/policy`.

### Rollout order (summary)

```text
IdP app registration
    → ATT SSO settings (disabled until complete)
    → User linking column + OIDC routes
    → Login button + /sso/callback
    → Enable SSO
    → UAT tests
    → Production (JIT off, group-restricted, secret rotation)
```

---

## Settings fields (what / why / how)


| UI field | Setting key | What it is | Why it is needed | How ATT uses it |
|----------|-------------|------------|------------------|-----------------|
| **Enable SSO** | `sso.enabled` | Master on/off switch | Hides SSO until config is ready; avoids broken login buttons | Exposed on public `GET /auth/policy` as `sso_enabled`. Login pages show the SSO button only when true. Runtime `get_sso_config()` returns `None` if off. |
| **Button label** | `sso.button_label` | Text on the login button | Branding (“Sign in with Microsoft” vs “Sign in with Okta”) | Returned as `sso_button_label` on `/auth/policy`; rendered on `/login` and `/admin/login`. |
| **OIDC issuer** | `sso.issuer` | Base URL of the IdP’s OIDC authority | Locates discovery, authorize, token, and JWKS endpoints | Trimmed of trailing `/`. Discovery: `{issuer}/.well-known/openid-configuration`. Used to validate the ID token `iss` claim. **Entra example:** `https://login.microsoftonline.com/{tenant-id}/v2.0` (real GUID, not the placeholder `{tenant-id}`). |
| **Client ID** | `sso.client_id` | Application ID from the IdP app registration | Identifies this app to the IdP | Sent on authorize + token requests; must match ID token `aud`. **Entra:** Application (client) ID — a GUID. Do **not** paste the client secret here. |
| **Client secret** | `sso.client_secret` | Confidential client credential | Proves the backend is the registered app when exchanging the auth code | Stored in DB; **never returned on GET** (only `client_secret_configured`). Leave blank on save to keep the existing secret. Env fallback: `SSO_CLIENT_SECRET`. **Entra:** secret **Value** (contains `~`), not Secret ID. |
| **Redirect URI** | `sso.redirect_uri` | Exact callback URL registered at the IdP | IdP will only redirect here after login | Must match byte-for-byte with the IdP app registration. Local Vite: `http://localhost:5173/auth/sso/callback` (proxied to the API). Direct API: `http://localhost:8000/auth/sso/callback`. Path is always **`/auth/sso/callback`** (backend), not the React page `/sso/callback`. |
| **Scopes** | `sso.scopes` | Space-separated OIDC scopes | Controls what the IdP puts in the ID token | Default `openid profile email`. Passed on the authorize request. `openid` is required for an ID token. |
| **Email claim** | `sso.email_claim` | Which ID token claim holds the user’s email | ATT matches/creates users by email | Primary lookup claim (default `email`). If missing, code also tries `preferred_username`, `upn`, and `unique_name` (common for Entra). Must contain `@`. |
| **Subject claim** | `sso.subject_claim` | Stable unique user id from the IdP | Links the IdP identity to `users.external_subject` | Default `sub`. For **Entra**, prefer **`oid`** (object id). Stored once and reused on later logins. Falls back to `sub` if empty. |
| **Allow JIT user creation** | `sso.allow_jit` | Just-in-time provisioning | Controls whether unknown users can enter on first SSO | **Off (recommended for production):** user must already exist in ATT (matching email) and be active. **On:** creates an active non-superuser with a random unusable password if no match is found. |

### Validation when enabling

Saving with **Enable SSO** on requires issuer, client ID, redirect URI, and a client secret (new or already stored). Incomplete config is rejected by the API.

---

## Access control (who can use the app)

Two gates:

1. **IdP** — who can complete Microsoft/Okta login (app assignment / security group in Entra).
2. **ATT** — after a valid ID token:
   - Find user by `external_subject`, else by email.
   - Optionally link `external_subject` on first match.
   - If still missing: JIT create **or** reject (“not authorized”).
   - Inactive users are always rejected.
   - `/login` SSO (`portal=user`): superusers are redirected to use admin SSO.
   - `/admin/login` SSO (`portal=admin`): requires `is_superuser`.

After that, **roles and permissions** work as usual via `GET /me`.

---

## Implementation map

| Area | Path / endpoint |
|------|-----------------|
| Admin UI | `frontend/src/pages/settings.tsx` (Authentication tab) |
| Admin API | `GET/PUT /admin/settings/sso` → `SettingsService.get_sso_settings` / `put_sso_settings` |
| Schema | `backend/modules/platform/settings/schema.py` → `SsoSettingsPublic` |
| Runtime config | `backend/modules/platform/settings/sso_config.py` → `get_sso_config()` (DB + env fallback) |
| Public policy | `GET /auth/policy` includes `sso_enabled`, `sso_button_label` |
| OIDC start | `GET /auth/sso/login?portal=user\|admin` |
| OIDC callback | `GET /auth/sso/callback` |
| OIDC logic | `backend/modules/platform/auth/sso_oidc.py` |
| Routes | `backend/modules/platform/auth/sso_routes.py` |
| User link column | `users.external_subject` (migration `094`) |
| Login buttons | `frontend/src/pages/app-login.tsx`, `login.tsx` |
| Token handoff page | `frontend/src/pages/sso-callback.tsx` → `/sso/callback` |

### Flow details

1. **Authorize** — Backend builds IdP URL with `client_id`, `redirect_uri`, `scope`, PKCE (`code_challenge`), and signed `state` (portal + `code_verifier`, JWT signed with `JWT_SECRET_KEY`).
2. **Callback** — Validates `state`, exchanges `code` + `code_verifier` + `client_secret` at the token endpoint, verifies ID token signature via JWKS, checks audience/issuer.
3. **User** — Resolve/create ATT user; call `AuthService.issue_token_pair` (same sessions as password login).
4. **Frontend** — Redirect to `/sso/callback?access_token&refresh_token&portal`; page stores tokens (sessionStorage handoff for React Strict Mode), calls `/me`, navigates to dashboard or admin.

---

## Microsoft Entra ID setup (checklist)

1. Entra → **App registrations** → register a **Web** app.
2. Copy **Directory (tenant) ID** and **Application (client) ID**.
3. **Certificates & secrets** → create a secret; copy the **Value** once.
4. **Authentication** → add redirect URI, e.g. `http://localhost:5173/auth/sso/callback`.
5. Optional: **Token configuration** → add optional claim **email** if the ID token lacks email (UPN/`preferred_username` is also accepted by ATT).
6. Paste into ATT SSO settings (issuer uses the **real** tenant GUID).
7. Ensure `FRONTEND_APP_URL` / `FRONTEND_ORIGIN` point at the SPA (e.g. `http://localhost:5173`).

### Field mapping (Entra → ATT)

| Entra | ATT field |
|-------|-----------|
| Directory (tenant) ID | Part of **OIDC issuer** |
| Application (client) ID | **Client ID** |
| Client secret **Value** | **Client secret** |
| Redirect URI (Web) | **Redirect URI** |
| — | **Subject claim** = `oid` (recommended) |

Do **not** use Object ID or Secret ID as Client ID / Client secret.

---

## Environment fallbacks (optional)

Prefer Admin Settings (DB). If a key is unset in the database, these env vars are used (see `.env.example`):

```bash
SSO_ENABLED=false
SSO_ISSUER=
SSO_CLIENT_ID=
SSO_CLIENT_SECRET=
SSO_REDIRECT_URI=
# SSO_BUTTON_LABEL=Sign in with SSO
# SSO_SCOPES=openid profile email
# SSO_EMAIL_CLAIM=email
# SSO_SUBJECT_CLAIM=sub
# SSO_ALLOW_JIT=false
```

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `invalid_tenant` / discovery failed | Issuer still has `{tenant-id}` placeholder, or wrong tenant GUID |
| No SSO button | SSO not enabled / not saved; check `GET /auth/policy` → `sso_enabled` |
| Redirect URI mismatch | URI in Settings ≠ URI in IdP registration (http/https, port, path) |
| Token exchange failed | Wrong client secret (use Value with `~`), or redirect_uri mismatch on exchange |
| ID token missing email | Add optional `email` claim in Entra, or rely on `preferred_username` / set Email claim |
| Not authorized | User not in ATT and JIT off; or `is_active=false` |
| Missing SSO tokens (frontend) | Fixed via sessionStorage handoff on `/sso/callback`; hard-refresh and retry |
| Superadmin on user login | Use **Admin login** SSO (`portal=admin`) |

Verify discovery in a browser (must return JSON):

```text
{issuer}/.well-known/openid-configuration
```

---

## Security notes

- Client secret is admin-only; never expose it on public APIs or login UI.
- Rotate secrets that were pasted into chat, tickets, or screenshots.
- Prefer **JIT off** in production; provision users (and roles) in ATT deliberately.
- Restrict the Entra app to assigned users/groups so the whole tenant cannot SSO into ATT.
- ATT JWTs remain the session credential; revoke access by deactivating the ATT user and/or removing IdP app assignment.
