import * as React from "react"

import { getJson } from "@/lib/api"
import {
  SESSION_ACTIVITY_EVENT,
  SESSION_IDLE_LOGOUT_EVENT,
  SESSION_LAST_ACTIVE_STORAGE_KEY,
  readSharedLastActive,
  writeSharedLastActive,
  type AuthLogoutReason,
} from "@/lib/session-idle-events"

type SessionPolicy = {
  idle_timeout_minutes: number
}

export type SessionIdleState = {
  /** Seconds until auto sign-out; null when idle tracking is off. */
  remainingSeconds: number | null
  /** True while this tab is in the background. Idle still uses last interaction, not hide time. */
  isTabHidden: boolean
  idleTimeoutMinutes: number
}

const SessionIdleContext = React.createContext<SessionIdleState>({
  remainingSeconds: null,
  isTabHidden: false,
  idleTimeoutMinutes: 10,
})

const SERVER_TOUCH_MIN_MS = 60_000
const UI_THROTTLE_MS = 1000

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
  onIdleLogout: (reason?: AuthLogoutReason) => void
  children: React.ReactNode
}

export function SessionIdleProvider({ enabled, onIdleLogout, children }: SessionIdleProviderProps) {
  const timeoutMsRef = React.useRef(10 * 60 * 1000)
  const lastActiveRef = React.useRef(Date.now())
  const lastUiRef = React.useRef(0)
  const lastStorageWriteRef = React.useRef(0)
  const lastServerTouchRef = React.useRef(0)
  const onLogoutRef = React.useRef(onIdleLogout)
  const [remainingSeconds, setRemainingSeconds] = React.useState<number | null>(enabled ? 600 : null)
  const [isTabHidden, setIsTabHidden] = React.useState(false)
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = React.useState(10)

  React.useEffect(() => {
    onLogoutRef.current = onIdleLogout
  }, [onIdleLogout])

  const computeRemainingMs = React.useCallback(() => {
    return Math.max(0, timeoutMsRef.current - (Date.now() - lastActiveRef.current))
  }, [])

  React.useEffect(() => {
    if (!enabled) {
      setRemainingSeconds(null)
      setIsTabHidden(false)
      return
    }
    const now = Date.now()
    lastActiveRef.current = readSharedLastActive(now)
    if (lastActiveRef.current === now) writeSharedLastActive(now)
    let cancelled = false
    ;(async () => {
      try {
        const policy = await getJson<SessionPolicy>("/auth/session-policy")
        if (cancelled) return
        const minutes = Number(policy.idle_timeout_minutes)
        if (Number.isFinite(minutes) && minutes >= 1) {
          timeoutMsRef.current = minutes * 60 * 1000
          setIdleTimeoutMinutes(minutes)
          lastActiveRef.current = readSharedLastActive(Date.now())
          setRemainingSeconds(Math.ceil(computeRemainingMs() / 1000))
        }
      } catch {
        /* keep default */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [computeRemainingMs, enabled])

  React.useEffect(() => {
    if (!enabled) return

    const markActive = (source: "user" | "api") => {
      const now = Date.now()
      lastActiveRef.current = now
      if (now - lastStorageWriteRef.current >= UI_THROTTLE_MS) {
        lastStorageWriteRef.current = now
        writeSharedLastActive(now)
      }
      if (now - lastUiRef.current >= UI_THROTTLE_MS) {
        lastUiRef.current = now
        setRemainingSeconds(Math.ceil(timeoutMsRef.current / 1000))
      }
      if (source === "user" && now - lastServerTouchRef.current >= SERVER_TOUCH_MIN_MS) {
        lastServerTouchRef.current = now
        void getJson("/auth/session-touch").catch(() => {
          /* 401 idle logout is dispatched by api.ts */
        })
      }
    }

    const onVisibility = () => {
      setIsTabHidden(document.hidden)
      if (!document.hidden) markActive("user")
    }

    const tick = () => {
      setIsTabHidden(document.hidden)
      const remainingMs = timeoutMsRef.current - (Date.now() - lastActiveRef.current)
      if (remainingMs <= 0) {
        onLogoutRef.current("session_idle")
        return
      }
      setRemainingSeconds(Math.ceil(remainingMs / 1000))
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== SESSION_LAST_ACTIVE_STORAGE_KEY || event.newValue == null) return
      const n = Number(event.newValue)
      if (!Number.isFinite(n) || n <= lastActiveRef.current) return
      lastActiveRef.current = n
      setRemainingSeconds(Math.ceil((timeoutMsRef.current - (Date.now() - n)) / 1000))
    }

    setIsTabHidden(document.hidden)
    setRemainingSeconds(Math.ceil(computeRemainingMs() / 1000))

    const onUser = () => markActive("user")
    const userEvents = ["mousedown", "mousemove", "keydown", "touchstart", "wheel", "click"] as const
    for (const name of userEvents) {
      document.addEventListener(name, onUser, { passive: true })
    }
    document.addEventListener("scroll", onUser, { passive: true, capture: true })
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("storage", onStorage)
    const intervalId = window.setInterval(tick, 1000)

    const onApiIdle = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: AuthLogoutReason }>).detail?.reason
      onLogoutRef.current(reason)
    }
    const onApiActivity = () => markActive("api")
    window.addEventListener(SESSION_IDLE_LOGOUT_EVENT, onApiIdle)
    window.addEventListener(SESSION_ACTIVITY_EVENT, onApiActivity)

    return () => {
      for (const name of userEvents) {
        document.removeEventListener(name, onUser)
      }
      document.removeEventListener("scroll", onUser, true)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("storage", onStorage)
      window.clearInterval(intervalId)
      window.removeEventListener(SESSION_IDLE_LOGOUT_EVENT, onApiIdle)
      window.removeEventListener(SESSION_ACTIVITY_EVENT, onApiActivity)
    }
  }, [computeRemainingMs, enabled])

  const value = React.useMemo(
    () => ({ remainingSeconds, isTabHidden, idleTimeoutMinutes }),
    [idleTimeoutMinutes, isTabHidden, remainingSeconds],
  )

  return <SessionIdleContext.Provider value={value}>{children}</SessionIdleContext.Provider>
}
