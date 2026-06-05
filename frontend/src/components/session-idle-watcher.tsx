import * as React from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { SessionIdleProvider } from "@/context/session-idle-context"
import { clearAuthProfile } from "@/lib/permissions"

function hasToken() {
  try {
    const t = localStorage.getItem("access_token")
    return !!(t && t.length > 0)
  } catch {
    return false
  }
}

function clearTokens() {
  localStorage.removeItem("access_token")
  localStorage.removeItem("refresh_token")
  clearAuthProfile()
}

type SessionIdleWatcherProps = {
  /** Where to send the user after idle sign-out (e.g. `/login` or `/admin/login`). */
  loginPath: string
  children: React.ReactNode
}

export function SessionIdleWatcher({ loginPath, children }: SessionIdleWatcherProps) {
  const navigate = useNavigate()
  const [enabled, setEnabled] = React.useState(hasToken)

  const handleIdleLogout = React.useCallback(() => {
    if (!hasToken()) return
    clearTokens()
    setEnabled(false)
    toast.info("Signed out due to inactivity.")
    navigate(loginPath, { replace: true })
  }, [loginPath, navigate])

  React.useEffect(() => {
    const sync = () => setEnabled(hasToken())
    window.addEventListener("storage", sync)
    return () => window.removeEventListener("storage", sync)
  }, [])

  return (
    <SessionIdleProvider enabled={enabled} onIdleLogout={handleIdleLogout}>
      {children}
    </SessionIdleProvider>
  )
}
