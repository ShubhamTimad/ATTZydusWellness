const LS_PERMISSIONS = "user_permissions"
const LS_IS_SUPERUSER = "me_is_superuser"
const LS_USER_ID = "me_user_id"

export type MePermissionsPayload = {
  id?: number
  is_superuser?: boolean
  permissions?: string[]
}

/** Persist RBAC snapshot from ``GET /me`` (call after login when token is set). */
export function persistAuthFromMe(me: MePermissionsPayload): void {
  try {
    localStorage.setItem(LS_IS_SUPERUSER, me.is_superuser === true ? "1" : "0")
    if (typeof me.id === "number" && Number.isFinite(me.id)) {
      localStorage.setItem(LS_USER_ID, String(me.id))
    }
    if (Array.isArray(me.permissions)) {
      localStorage.setItem(LS_PERMISSIONS, JSON.stringify(me.permissions))
    } else {
      localStorage.removeItem(LS_PERMISSIONS)
    }
  } catch {
    // ignore storage errors
  }
}

export function clearAuthProfile(): void {
  try {
    localStorage.removeItem(LS_PERMISSIONS)
    localStorage.removeItem(LS_IS_SUPERUSER)
    localStorage.removeItem(LS_USER_ID)
  } catch {
    // ignore
  }
}

/** Logged-in user id from the last ``GET /me`` snapshot, or null if unknown. */
export function currentUserId(): number | null {
  try {
    const raw = localStorage.getItem(LS_USER_ID)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/** True when the last ``GET /me`` snapshot identified a superuser (see ``persistAuthFromMe``). */
export function isSuperuser(): boolean {
  try {
    return localStorage.getItem(LS_IS_SUPERUSER) === "1"
  } catch {
    return false
  }
}

/** Match ``module.action`` ↔ legacy ``module:action`` (first separator only). */
function permissionCodeVariants(code: string): Set<string> {
  const v = new Set<string>([code])
  const ci = code.indexOf(":")
  if (ci !== -1) v.add(`${code.slice(0, ci)}.${code.slice(ci + 1)}`)
  const di = code.indexOf(".")
  if (di !== -1) v.add(`${code.slice(0, di)}:${code.slice(di + 1)}`)
  return v
}

function permissionSetsIntersect(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) {
    if (b.has(x)) return true
  }
  return false
}

/**
 * UI-only permission check. Backend still enforces RBAC on every API call.
 * Superusers are treated as having all permissions.
 */
export function hasPermission(code: string): boolean {
  try {
    if (localStorage.getItem(LS_IS_SUPERUSER) === "1") return true
    const raw = localStorage.getItem(LS_PERMISSIONS)
    if (!raw) return false
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return false
    const required = permissionCodeVariants(code)
    for (const p of arr) {
      if (typeof p !== "string") continue
      if (permissionSetsIntersect(required, permissionCodeVariants(p))) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * True if the user has any RBAC permission outside the ``users.*`` namespace
 * (roles, permissions, settings, features). Used for workspace nav items that are not
 * user-management screens (e.g. Performance) so a role with only ``users.*`` does not see them.
 */
/**
 * List org units (plants) for user/role pickers without opening the Plants admin module.
 * Matches ``GET /admin/org-units`` authorization (OR of these codes).
 */
export function canListOrgUnitsForAssignments(): boolean {
  try {
    if (localStorage.getItem(LS_IS_SUPERUSER) === "1") return true
    return (
      hasPermission("org_units.view") ||
      hasPermission("users.create") ||
      hasPermission("users.update") ||
      hasPermission("roles.create") ||
      hasPermission("roles.update") ||
      hasPermission("asset.view") ||
      hasPermission("asset.create") ||
      hasPermission("asset.update") ||
      hasPermission("masters.view")
    )
  } catch {
    return false
  }
}

/** Permissions that should show the workspace Tasks nav and routes (matches backend ``task.*`` APIs). */
export const TASK_ACCESS_PERMISSIONS = [
  "task.view",
  "approval.view",
  "task.act",
  "task.create",
  "task.assign",
  "task.close",
] as const

/** Settings module: view opens the page; update is required to save. */
export const SETTINGS_ACCESS_PERMISSIONS = ["settings.view", "settings.update"] as const

export function canAccessTasks(): boolean {
  return TASK_ACCESS_PERMISSIONS.some((code) => hasPermission(code))
}

export function canAccessSettings(): boolean {
  return SETTINGS_ACCESS_PERMISSIONS.some((code) => hasPermission(code))
}

export function hasAnyNonUsersRbacPermission(): boolean {
  try {
    if (localStorage.getItem(LS_IS_SUPERUSER) === "1") return true
    const modules = ["roles", "permissions", "settings", "features", "org_units"] as const
    const actions = ["view", "create", "update", "delete"] as const
    for (const m of modules) {
      for (const a of actions) {
        if (hasPermission(`${m}.${a}`)) return true
      }
    }
    return false
  } catch {
    return false
  }
}

