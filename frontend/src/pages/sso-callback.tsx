import * as React from "react"
import { Link, useNavigate } from "react-router-dom"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { getJson } from "@/lib/api"
import { clearAuthProfile, persistAuthFromMe } from "@/lib/permissions"
import { clearSharedLastActive, clearStoredAuthMethod, writeStoredAuthMethod } from "@/lib/session-idle-events"

type MeResponse = {
  id: number
  full_name: string
  username: string
  email: string | null
  is_superuser: boolean
  is_active: boolean
  permission_codes?: string[]
  [k: string]: unknown
}

type SsoHandoff = {
  access_token: string
  refresh_token: string
  portal: "user" | "admin"
}

const HANDOFF_KEY = "sso_handoff"

function readHandoffFromUrl(): SsoHandoff | null {
  const hash = window.location.hash.replace(/^#/, "")
  const query = window.location.search.replace(/^\?/, "")
  const params = new URLSearchParams(hash || query)
  const access_token = params.get("access_token")
  const refresh_token = params.get("refresh_token")
  if (!access_token || !refresh_token) return null
  return {
    access_token,
    refresh_token,
    portal: params.get("portal") === "admin" ? "admin" : "user",
  }
}

function takeHandoff(): SsoHandoff | null {
  // Prefer URL once; stash so React Strict Mode remount still sees tokens.
  const fromUrl = readHandoffFromUrl()
  if (fromUrl) {
    try {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(fromUrl))
    } catch {
      /* ignore quota / private mode */
    }
    if (window.location.hash || window.location.search) {
      window.history.replaceState(null, "", window.location.pathname)
    }
    return fromUrl
  }
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SsoHandoff>
    if (
      typeof parsed.access_token === "string" &&
      parsed.access_token &&
      typeof parsed.refresh_token === "string" &&
      parsed.refresh_token
    ) {
      return {
        access_token: parsed.access_token,
        refresh_token: parsed.refresh_token,
        portal: parsed.portal === "admin" ? "admin" : "user",
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

function clearHandoff() {
  try {
    sessionStorage.removeItem(HANDOFF_KEY)
  } catch {
    /* ignore */
  }
}

export function SsoCallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = React.useState<string | null>(null)
  const [portal, setPortal] = React.useState<"user" | "admin">("user")

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      const handoff = takeHandoff()
      if (!handoff) {
        if (!cancelled) setError("Missing SSO tokens. Try signing in again.")
        return
      }
      setPortal(handoff.portal)
      try {
        localStorage.setItem("access_token", handoff.access_token)
        localStorage.setItem("refresh_token", handoff.refresh_token)
        writeStoredAuthMethod("sso")
        clearSharedLastActive()
        const me = await getJson<MeResponse>("/me")
        if (cancelled) return
        persistAuthFromMe(me)
        clearHandoff()
        if (handoff.portal === "admin") {
          if (!me.is_superuser) {
            localStorage.removeItem("access_token")
            localStorage.removeItem("refresh_token")
            clearStoredAuthMethod()
            clearAuthProfile()
            setError("Admin SSO requires a superuser account.")
            return
          }
          navigate("/admin", { replace: true })
          return
        }
        if (me.is_superuser) {
          navigate("/admin", { replace: true })
          return
        }
        navigate("/dashboard", { replace: true })
      } catch (e) {
        clearHandoff()
        localStorage.removeItem("access_token")
        localStorage.removeItem("refresh_token")
        clearStoredAuthMethod()
        clearAuthProfile()
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "SSO sign-in failed.")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (error) {
    const loginHref = portal === "admin" ? "/admin/login" : "/login"
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4">
          <Alert variant="destructive">
            <AlertTitle>SSO sign-in failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button asChild variant="outline" className="w-full">
            <Link to={loginHref}>Back to sign in</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <p className="text-sm text-muted-foreground">Completing sign-in…</p>
    </div>
  )
}
