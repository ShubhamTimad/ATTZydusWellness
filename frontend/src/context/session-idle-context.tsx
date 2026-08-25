import * as React from "react"

import { getJson } from "@/lib/api"
import {
  SESSION_ACTIVITY_EVENT,
  SESSION_IDLE_LOGOUT_EVENT,
  SESSION_LAST_ACTIVE_STORAGE_KEY,
  readAccessTokenAmr,
  readSharedLastActive,
  readStoredAuthMethod,
  writeSharedLastActive,
  type AuthLogoutReason,
} from "@/lib/session-idle-events"

type SessionPolicy = {
  idle_enabled?: boolean
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

function isLikelySsoSession(): boolean {
  return readAccessTokenAmr() === "sso" || readStoredAuthMethod() === "sso"
}

type SessionIdleProviderProps = {
  enabled: boolean
  onIdleLogout: (reason?: AuthLogoutReason) => void
  children: React.ReactNode
}

export function SessionIdleProvider({ enabled, onIdleLogout, children }: SessionIdleProviderProps) {
  const timeoutMsRef = React.useRef(10 * 60 * 1000)
  const idleOnRef = React.useRef(true)
  const lastActiveRef = React.useRef(Date.now())
  const lastUiRef = React.useRef(0)
  const lastStorageWriteRef = React.useRef(0)
  const lastServerTouchRef = React.useRef(0)
  const onLogoutRef = React.useRef(onIdleLogout)
  const [remainingSeconds, setRemainingSeconds] = React.useState<number | null>(null)
  const [isTabHidden, setIsTabHidden] = React.useState(false)
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = React.useState(10)
  const [idleTracking, setIdleTracking] = React.useState(false)

  React.useEffect(() => {
    onLogoutRef.current = onIdleLogout
  }, [onIdleLogout])

  React.useEffect(() => {
    if (!enabled) {
      idleOnRef.current = false
      timeoutMsRef.current = Number.POSITIVE_INFINITY
      setIdleTracking(false)
      setRemainingSeconds(null)
      setIsTabHidden(false)
      return
    }

    // Do not start the countdown until /auth/session-policy responds.
    idleOnRef.current = false
    timeoutMsRef.current = Number.POSITIVE_INFINITY
    setIdleTracking(false)
    setRemainingSeconds(null)

    const now = Date.now()
    lastActiveRef.current = readSharedLastActive(now)
    if (lastActiveRef.current === now) writeSharedLastActive(now)
    let cancelled = false
    ;(async () => {
      try {
        const policy = await getJson<SessionPolicy>("/auth/session-policy")
        if (cancelled) return
        const minutes = Number(policy.idle_timeout_minutes)
        // Only show navbar timer when the server says idle is on for this session.
        if (policy.idle_enabled === true && Number.isFinite(minutes) && minutes >= 1) {
          idleOnRef.current = true
          timeoutMsRef.current = minutes * 60 * 1000
          setIdleTimeoutMinutes(minutes)
          setIdleTracking(true)
          lastActiveRef.current = readSharedLastActive(Date.now())
          setRemainingSeconds(
            Math.ceil(Math.max(0, timeoutMsRef.current - (Date.now() - lastActiveRef.current)) / 1000),
          )
          return
        }
        idleOnRef.current = false
        timeoutMsRef.current = Number.POSITIVE_INFINITY
        setIdleTracking(false)
        setIdleTimeoutMinutes(0)
        setRemainingSeconds(null)
      } catch {
        // Password sessions: fall back to 10m if policy cannot load. SSO stays off.
        if (cancelled || isLikelySsoSession()) return
        idleOnRef.current = true
        timeoutMsRef.current = 10 * 60 * 1000
        setIdleTimeoutMinutes(10)
        setIdleTracking(true)
        lastActiveRef.current = readSharedLastActive(Date.now())
        setRemainingSeconds(Math.ceil(timeoutMsRef.current / 1000))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  React.useEffect(() => {
    if (!enabled || !idleTracking) return

    const markActive = (source: "user" | "api") => {
      if (!idleOnRef.current || !Number.isFinite(timeoutMsRef.current)) return
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
      if (!idleOnRef.current || !Number.isFinite(timeoutMsRef.current)) {
        setRemainingSeconds(null)
        return
      }
      const remainingMs = timeoutMsRef.current - (Date.now() - lastActiveRef.current)
      if (remainingMs <= 0) {
        onLogoutRef.current("session_idle")
        return
      }
      setRemainingSeconds(Math.ceil(remainingMs / 1000))
    }

    const onStorage = (event: StorageEvent) => {
      if (!idleOnRef.current || !Number.isFinite(timeoutMsRef.current)) return
      if (event.key !== SESSION_LAST_ACTIVE_STORAGE_KEY || event.newValue == null) return
      const n = Number(event.newValue)
      if (!Number.isFinite(n) || n <= lastActiveRef.current) return
      lastActiveRef.current = n
      setRemainingSeconds(Math.ceil((timeoutMsRef.current - (Date.now() - n)) / 1000))
    }

    setIsTabHidden(document.hidden)
    setRemainingSeconds(
      Math.ceil(Math.max(0, timeoutMsRef.current - (Date.now() - lastActiveRef.current)) / 1000),
    )

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
      if (!idleOnRef.current) return
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
  }, [enabled, idleTracking])

  const value = React.useMemo(
    () => ({ remainingSeconds, isTabHidden, idleTimeoutMinutes }),
    [idleTimeoutMinutes, isTabHidden, remainingSeconds],
  )

  return <SessionIdleContext.Provider value={value}>{children}</SessionIdleContext.Provider>
}
