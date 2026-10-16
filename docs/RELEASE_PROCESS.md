# Release Process

How code moves from `develop` to Non-Prod and Prod, how versions change, and what must be signed off.
Server commands: [SERVER_DEPLOY.md](./SERVER_DEPLOY.md) · [DEPLOY_GUIDE.md](./DEPLOY_GUIDE.md).

---

## 1. Branches and tags

| Name | Purpose | Changed by |
|---|---|---|
| `develop` | Work for the next version | PR from `feature/*` / `bug/*` |
| `feature/*`, `bug/*` | One change each | Developer |
| `release/X.Y.Z` | Frozen version. Fixes only, no features | PR only, merged by Release Owner |
| `hotfix/*` | Fix for a live version, branched from its `release/*` | Developer |
| `vX.Y.Z-rc.N` | Release candidate → **Non-Prod** | Release Owner |
| `vX.Y.Z` | Approved build → **Prod** | Release Owner |

**Rules**
- Deploy **tags only**. Never deploy `develop`.
- Never move or delete a tag. If it is wrong, release the next number.
- No direct push to `release/*` (GitHub free plan cannot enforce this — it is a team rule).
- Every fix on `release/*` is merged back into `develop`.

---

## 2. Version number

Format `MAJOR.MINOR.PATCH`, stored in the `VERSION` file and shown on the login screen.

| Bump | When | Example |
|---|---|---|
| **PATCH** | Bug fix, text/UI fix, no new feature | `1.0.0 → 1.0.1` |
| **MINOR** | New feature, screen, report or field; backward-compatible DB change | `1.0.3 → 1.1.0` |
| **MAJOR** | Breaking change: workflow/data-model redesign, removed feature, migration needing downtime, new contract phase | `1.4.2 → 2.0.0` |

- Lower numbers reset to `0` on a bump.
- Change `VERSION` in the same PR as the release.

---

## 3. Environments

| | **Non-Prod** (QA / UAT) | **Prod** |
|---|---|---|
| Server | Client EC2 `:8090` (internal QA: Contabo) | Client production server |
| Deploys | `vX.Y.Z-rc.N` | `vX.Y.Z` only |
| Data | Test data | Live RDS — snapshot before every deploy |
| Deployed by | Dev team | Release Owner, after sign-off |
| Config | Own `.env.docker` (test SMTP/SSO) | Own `.env.docker` (live SMTP/SSO) |

**Flow:** `develop` → `release/X.Y.Z` → `rc` tag → **Non-Prod** → UAT sign-off → final tag on the **same commit** → **Prod**.

---

## 4. Procedures

### 4.1 New release (MINOR / MAJOR)

```bash
git checkout develop && git pull
git checkout -b release/1.1.0
echo 1.1.0 > VERSION && git commit -am "Bump version to 1.1.0"
git push -u origin release/1.1.0
git tag -a v1.1.0-rc.1 -m "1.1.0 RC1" && git push origin v1.1.0-rc.1   # → Non-Prod
```

### 4.2 Bug found in Non-Prod

```bash
git checkout -b bug/<short-name> origin/release/1.1.0
# fix, test, push, PR → release/1.1.0, Release Owner merges
git checkout release/1.1.0 && git pull
git tag -a v1.1.0-rc.2 -m "1.1.0 RC2" && git push origin v1.1.0-rc.2   # redeploy Non-Prod
```

### 4.3 Promote to Prod (after UAT sign-off)

```bash
git checkout release/1.1.0 && git pull          # must equal the signed-off rc commit
git tag -a v1.1.0 -m "Release 1.1.0" && git push origin v1.1.0
git checkout develop && git merge release/1.1.0 && git push    # bring fixes back
```

### 4.4 Hotfix on live (PATCH)

```bash
git checkout -b hotfix/<short-name> origin/release/1.0.0
# fix + echo 1.0.1 > VERSION, PR → release/1.0.0
git checkout release/1.0.0 && git pull
git tag -a v1.0.1-rc.1 -m "1.0.1 RC1" && git push origin v1.0.1-rc.1  # quick check on Non-Prod
git tag -a v1.0.1 -m "Release 1.0.1" && git push origin v1.0.1        # → Prod
git checkout develop && git merge release/1.0.0 && git push
```

### 4.5 Deploy (Non-Prod or Prod)

```bash
./scripts/backup-db.sh            # Prod on RDS: take a manual snapshot "before-<VERSION>" instead
git fetch origin --tags
git checkout <tag>                # e.g. v1.1.0-rc.1 or v1.1.0
./scripts/docker-rebuild.sh
```

If the server cannot reach Docker Hub / npm / PyPI: build images from the tag on our machine and copy
them in ([DEPLOY_GUIDE.md](./DEPLOY_GUIDE.md) Part 4).

**Verify:** login screen shows the version · `/api/health` → `ok` · `/api/auth/app-version` → new number · open an asset list and an order.

### 4.6 Rollback

```bash
git checkout <previous tag> && ./scripts/docker-rebuild.sh
```

Restore the DB backup/snapshot only if the new version's migration damaged data.

### 4.7 Publish (after Prod deploy)

```bash
mkdir -p ~/Releases/Takeda-ATT && cd ~/Releases/Takeda-ATT
git -C <repo> archive --format=zip --prefix=takeda-att-1.1.0/ -o takeda-att-1.1.0.zip v1.1.0
shasum -a 256 takeda-att-1.1.0.zip > takeda-att-1.1.0.zip.sha256
cd <repo> && gh release create v1.1.0 ~/Releases/Takeda-ATT/takeda-att-1.1.0.zip* \
  --title "v1.1.0" --notes-file <release-notes.md>
```

Attach the signed documents (section 5) to the same GitHub Release.

---

## 5. Required documents

| # | Document | Needed before | Owner |
|---|---|---|---|
| 1 | Change Request / User Requirement (CR-ID) | Development starts | Client / BA |
| 2 | Impact analysis (modules, DB migration, config) | Development starts | Dev Lead |
| 3 | Test cases | Non-Prod deploy | QA |
| 4 | Test execution report (Non-Prod) | UAT | QA |
| 5 | UAT sign-off | Prod deploy | Client |
| 6 | Release notes | Prod deploy | Dev Lead |
| 7 | Deployment checklist + rollback plan | Prod deploy | Release Owner |
| 8 | Backup / snapshot evidence | Prod deploy | Release Owner |
| 9 | Post-deployment verification | After Prod deploy | Release Owner + Client |

| Release type | Documents |
|---|---|
| MAJOR / MINOR | All 1–9 |
| PATCH | 1, 3–4 (affected cases only), 5 (email approval OK), 6–9 |
| Emergency hotfix | Dev Lead + Client email approval before deploy; documents 1–9 within 2 working days |

**Storage:** attach to the GitHub Release `vX.Y.Z`. Put the CR-ID in every PR title, e.g. `CR-012: Add vendor master`.

---

## 6. Templates

**Change Request**

| Field | Value |
|---|---|
| CR-ID / Date | |
| Requested by | |
| Requirement | |
| Acceptance criteria | |
| Priority | High / Medium / Low |
| Target version | |

**Test case**

| TC-ID | CR-ID | Module | Steps | Expected | Actual | Pass/Fail | Tester / Date |
|---|---|---|---|---|---|---|---|

**Sign-off**

| Role | Name | Decision | Signature / Email ref | Date |
|---|---|---|---|---|
| Dev Lead | | Approved / Rejected | | |
| QA | | | | |
| Client (UAT) | | | | |
| Release Owner | | | | |

**Release notes**

| Field | Value |
|---|---|
| Version / Tag / Commit | |
| CRs included | |
| Bug fixes | |
| DB migration | Yes / No |
| Config changes (`.env.docker`) | |
| Known issues | |

**Deployment checklist**

- [ ] Tests pass (`pytest -q tests`, `npm run build`)
- [ ] `VERSION` = release number
- [ ] Sign-off received (Non-Prod tested rc = Prod commit)
- [ ] Backup / RDS snapshot taken
- [ ] Rollback tag noted: `v_____`
- [ ] Deployed tag: `v_____`
- [ ] Verification passed (version, health, smoke test)
- [ ] GitHub Release published with zip + documents
- [ ] `release/*` merged back into `develop`

---

## 7. Release record

| Version | Commit | Non-Prod date | Prod date | Approved by | Notes |
|---|---|---|---|---|---|
| v1.0.0 | `f7005a2` | | | | First release. Zip + SHA-256 on GitHub Release |
