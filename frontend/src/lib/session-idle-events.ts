export const SESSION_IDLE_LOGOUT_EVENT = "att:session-idle-logout"
/** Fired after a successful authenticated API call so the client idle timer can reset. */
export const SESSION_ACTIVITY_EVENT = "att:session-activity"
/** Shared across tabs so a background tab does not expire an active session. */
export const SESSION_LAST_ACTIVE_STORAGE_KEY = "att:session-last-active"

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
