export const SESSION_IDLE_LOGOUT_EVENT = "att:session-idle-logout"
/** Fired after a successful authenticated API call so the client idle timer can reset. */
export const SESSION_ACTIVITY_EVENT = "att:session-activity"
/** Shared across tabs so a background tab does not expire an active session. */
export const SESSION_LAST_ACTIVE_STORAGE_KEY = "att:session-last-active"
/** password | sso — optimistic client hint until /auth/session-policy responds. */
export const AUTH_METHOD_STORAGE_KEY = "auth_method"

export function writeStoredAuthMethod(method: "password" | "sso"): void {
  try {
    localStorage.setItem(AUTH_METHOD_STORAGE_KEY, method)
  } catch {
    /* ignore */
  }
}

export function clearStoredAuthMethod(): void {
  try {
    localStorage.removeItem(AUTH_METHOD_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function readStoredAuthMethod(): "password" | "sso" | null {
  try {
    const v = localStorage.getItem(AUTH_METHOD_STORAGE_KEY)
    if (v === "password" || v === "sso") return v
    return null
  } catch {
    return null
  }
}

/** Unverified JWT peek for optimistic idle UX (server still enforces). */
export function readAccessTokenAmr(): "password" | "sso" | null {
  try {
    const t = localStorage.getItem("access_token")
    if (!t) return null
    const payload = t.split(".")[1]
    if (!payload) return null
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      amr?: unknown
    }
    const amr = typeof json.amr === "string" ? json.amr.trim().toLowerCase() : ""
    if (amr === "password" || amr === "sso") return amr
    return null
  } catch {
    return null
  }
}

export function readSharedLastActive(fallback: number): number {
  try {
    const raw = localStorage.getItem(SESSION_LAST_ACTIVE_STORAGE_KEY)
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

export function writeSharedLastActive(at: number): void {
  try {
    localStorage.setItem(SESSION_LAST_ACTIVE_STORAGE_KEY, String(at))
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearSharedLastActive(): void {
  try {
    localStorage.removeItem(SESSION_LAST_ACTIVE_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export type AuthLogoutReason = "session_idle" | "unauthorized"

export type AuthLogoutEventDetail = {
  reason: AuthLogoutReason
}
