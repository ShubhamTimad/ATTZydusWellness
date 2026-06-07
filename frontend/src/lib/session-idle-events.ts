export const SESSION_IDLE_LOGOUT_EVENT = "att:session-idle-logout"

export type AuthLogoutReason = "session_idle" | "unauthorized"

export type AuthLogoutEventDetail = {
  reason: AuthLogoutReason
}
