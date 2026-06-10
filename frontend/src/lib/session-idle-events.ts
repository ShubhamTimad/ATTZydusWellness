export const SESSION_IDLE_LOGOUT_EVENT = "att:session-idle-logout"
/** Fired after a successful authenticated API call so the client idle timer can reset. */
export const SESSION_ACTIVITY_EVENT = "att:session-activity"

export type AuthLogoutReason = "session_idle" | "unauthorized"

export type AuthLogoutEventDetail = {
  reason: AuthLogoutReason
}
