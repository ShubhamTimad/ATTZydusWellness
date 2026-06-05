import * as React from "react"

import { getJson } from "@/lib/api"
import { SESSION_IDLE_LOGOUT_EVENT } from "@/lib/session-idle-events"

type SessionPolicy = {
  idle_timeout_minutes: number
}

export type SessionIdleState = {
  /** Seconds until auto sign-out; null when idle tracking is off. */
  remainingSeconds: number | null
  /** True while the tab is in the background (timer still counts down). */
  isTabHidden: boolean
  idleTimeoutMinutes: number
}

const SessionIdleContext = React.createContext<SessionIdleState>({
  remainingSeconds: null,
  isTabHidden: false,
  idleTimeoutMinutes: 10,
})

export function useSessionIdle() {
  return React.useContext(SessionIdleContext)
}

export function formatIdleCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

type SessionIdleProviderProps = {
  enabled: boolean
  onIdleLogout: () => void
  children: React.ReactNode
}

export function SessionIdleProvider({ enabled, onIdleLogout, children }: SessionIdleProviderProps) {
  const timeoutMsRef = React.useRef(10 * 60 * 1000)
  const lastActiveRef = React.useRef(Date.now())
  const hiddenAtRef = React.useRef<number | null>(null)
  const onLogoutRef = React.useRef(onIdleLogout)
  const [remainingSeconds, setRemainingSeconds] = React.useState<number | null>(enabled ? 600 : null)
  const [isTabHidden, setIsTabHidden] = React.useState(false)
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = React.useState(10)

  React.useEffect(() => {
    onLogoutRef.current = onIdleLogout
  }, [onIdleLogout])

  const computeRemainingMs = React.useCallback(() => {
    const timeout = timeoutMsRef.current
    const now = Date.now()
    if (document.hidden) {
      const hiddenAt = hiddenAtRef.current ?? now
      return Math.max(0, timeout - (now - hiddenAt))
    }
    return Math.max(0, timeout - (now - lastActiveRef.current))
  }, [])

  React.useEffect(() => {
    if (!enabled) {
      setRemainingSeconds(null)
      setIsTabHidden(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const policy = await getJson<SessionPolicy>("/auth/session-policy")
        if (cancelled) return
        const minutes = Number(policy.idle_timeout_minutes)
        if (Number.isFinite(minutes) && minutes >= 1) {
          timeoutMsRef.current = minutes * 60 * 1000
          setIdleTimeoutMinutes(minutes)
          lastActiveRef.current = Date.now()
          hiddenAtRef.current = document.hidden ? Date.now() : null
          setRemainingSeconds(Math.ceil(timeoutMsRef.current / 1000))
        }
      } catch {
        /* keep default */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  React.useEffect(() => {
    if (!enabled) return

    const markActive = () => {
      if (document.hidden) return
      hiddenAtRef.current = null
      lastActiveRef.current = Date.now()
      setRemainingSeconds(Math.ceil(timeoutMsRef.current / 1000))
    }

    const onVisibility = () => {
      const timeout = timeoutMsRef.current
      const now = Date.now()
      setIsTabHidden(document.hidden)
      if (document.hidden) {
        hiddenAtRef.current = now
        return
      }
      const hiddenAt = hiddenAtRef.current
      hiddenAtRef.current = null
      if (hiddenAt !== null && now - hiddenAt >= timeout) {
        onLogoutRef.current()
        return
      }
      lastActiveRef.current = now
      setRemainingSeconds(Math.ceil(timeout / 1000))
    }

    const tick = () => {
      const timeout = timeoutMsRef.current
      const now = Date.now()
      setIsTabHidden(document.hidden)
      if (document.hidden) {
        const hiddenAt = hiddenAtRef.current ?? now
        if (hiddenAtRef.current === null) hiddenAtRef.current = hiddenAt
        const remainingMs = timeout - (now - hiddenAt)
        if (remainingMs <= 0) {
          onLogoutRef.current()
          return
        }
        setRemainingSeconds(Math.ceil(remainingMs / 1000))
        return
      }
      const remainingMs = timeout - (now - lastActiveRef.current)
      if (remainingMs <= 0) {
        onLogoutRef.current()
        return
      }
      setRemainingSeconds(Math.ceil(remainingMs / 1000))
    }

    setIsTabHidden(document.hidden)
    setRemainingSeconds(Math.ceil(computeRemainingMs() / 1000))

    const activityEvents = ["mousedown", "keydown", "touchstart", "scroll", "click"] as const
    for (const name of activityEvents) {
      document.addEventListener(name, markActive, { passive: true })
    }
    document.addEventListener("visibilitychange", onVisibility)
    const intervalId = window.setInterval(tick, 1000)

    const onApiIdle = () => onLogoutRef.current()
    window.addEventListener(SESSION_IDLE_LOGOUT_EVENT, onApiIdle)

    return () => {
      for (const name of activityEvents) {
        document.removeEventListener(name, markActive)
      }
      document.removeEventListener("visibilitychange", onVisibility)
      window.clearInterval(intervalId)
      window.removeEventListener(SESSION_IDLE_LOGOUT_EVENT, onApiIdle)
    }
  }, [computeRemainingMs, enabled])

  const value = React.useMemo(
    () => ({ remainingSeconds, isTabHidden, idleTimeoutMinutes }),
    [idleTimeoutMinutes, isTabHidden, remainingSeconds],
  )

  return <SessionIdleContext.Provider value={value}>{children}</SessionIdleContext.Provider>
}
