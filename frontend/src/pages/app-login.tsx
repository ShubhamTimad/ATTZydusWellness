import * as React from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"

import {
  AUTH_BUTTON_CLASS,
  AUTH_INPUT_CLASS,
  AUTH_LABEL_CLASS,
  AUTH_PASSWORD_CLASS,
} from "@/components/auth/auth-field-styles"
import { AuthFormShell } from "@/components/auth/auth-form-shell"
import { SsoSignInButton } from "@/components/auth/sso-sign-in-button"
import { AppAuthMarketingLayout } from "@/components/layout/app-auth-marketing-layout"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import { ApiError, API_BASE_URL, getJson, postJson } from "@/lib/api"
import { loginRequestFields, validateLoginIdentifier } from "@/lib/login-identifier"
import { clearAuthProfile, persistAuthFromMe } from "@/lib/permissions"
import { clearSharedLastActive, clearStoredAuthMethod, writeStoredAuthMethod } from "@/lib/session-idle-events"

type LoginResponse = {
  access_token?: string
  refresh_token?: string
  token_type?: string
  mfa_required?: boolean
  setup_required?: boolean
  setup_token?: string
  challenge_token?: string
  expires_in?: number
  [k: string]: unknown
}

type MeResponse = {
  is_superuser?: boolean
  permissions?: string[]
  [k: string]: unknown
}

type PublicAuthPolicy = {
  password_enabled: boolean
  mfa_enabled: boolean
  captcha_enabled: boolean
  mfa_enforced: boolean
  sso_enabled?: boolean
  sso_button_label?: string
}

export function AppLoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const legacyReset = (searchParams.get("reset_token") ?? "").trim()
  const ssoErrorParam = (searchParams.get("sso_error") ?? "").trim()
  // After SSO failure (or ?sso_skip=1), stay on the form; do not auto-restart OIDC.
  const skipAutoSso =
    Boolean(ssoErrorParam) || (searchParams.get("sso_skip") ?? "").trim() === "1"

  const [identifier, setIdentifier] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [captchaToken, setCaptchaToken] = React.useState("")
  const [otp, setOtp] = React.useState("")
  const [challengeToken, setChallengeToken] = React.useState<string | null>(null)
  const [step, setStep] = React.useState<"password" | "otp">("password")
  const [error, setError] = React.useState<string | null>(ssoErrorParam || null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [policy, setPolicy] = React.useState<PublicAuthPolicy | null>(null)
  const [ssoRedirecting, setSsoRedirecting] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const p = await getJson<PublicAuthPolicy>("/auth/policy")
        if (!cancelled) setPolicy(p)
      } catch {
        if (!cancelled) setPolicy(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Auto-start Microsoft OIDC (prompt=none). Backend falls back to interactive if needed.
  React.useEffect(() => {
    if (legacyReset || !policy?.sso_enabled || skipAutoSso || step !== "password") return
    setSsoRedirecting(true)
    window.location.replace(`${API_BASE_URL}/auth/sso/login?portal=user&prompt=none`)
  }, [legacyReset, policy, skipAutoSso, step])

  if (legacyReset) {
    return <Navigate to={`/reset-password?token=${encodeURIComponent(legacyReset)}`} replace />
  }

  function clearTokens() {
    localStorage.removeItem("access_token")
    localStorage.removeItem("refresh_token")
    clearSharedLastActive()
    clearStoredAuthMethod()
    clearAuthProfile()
  }

  async function completeSession(accessToken: string, refreshToken: string) {
    localStorage.setItem("access_token", accessToken)
    localStorage.setItem("refresh_token", refreshToken)
    writeStoredAuthMethod("password")
    const me = await getJson<MeResponse>("/me")
    const isSuper = me?.is_superuser === true
    if (isSuper) {
      clearTokens()
      setError("Superadmin accounts must sign in from /admin/login.")
      return
    }
    persistAuthFromMe(me)
    navigate("/dashboard", { replace: true })
  }

  async function onSubmitPassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const idErr = validateLoginIdentifier(identifier)
    const p = password

    if (idErr) {
      setError(idErr)
      return
    }
    if (!p) {
      setError("Password is required.")
      return
    }

    setIsSubmitting(true)
    try {
      const res = await postJson<LoginResponse>("/login", {
        ...loginRequestFields(identifier, p),
        captcha_token: policy?.captcha_enabled ? (captchaToken.trim() || undefined) : undefined,
      })

      if (res.mfa_required === true) {
        if (res.setup_required === true && typeof res.setup_token === "string") {
          navigate(`/mfa/setup?token=${encodeURIComponent(res.setup_token)}`, { replace: true })
          return
        }
        if (typeof res.challenge_token === "string") {
          setChallengeToken(res.challenge_token)
          setStep("otp")
          setOtp("")
          return
        }
      }

      const accessToken = typeof res.access_token === "string" ? res.access_token : ""
      const refreshToken = typeof res.refresh_token === "string" ? res.refresh_token : ""
      if (!accessToken || !refreshToken) {
        throw new Error("Login succeeded but tokens were not returned.")
      }
      await completeSession(accessToken, refreshToken)
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string } | undefined
        if (body?.error === "captcha_invalid") setError("Captcha verification failed.")
        else if (body?.error === "password_login_disabled") setError("Password sign-in is disabled for your organization.")
        else setError(err.message)
      } else if (err instanceof Error) setError(err.message)
      else setError("Login failed")
    } finally {
      setIsSubmitting(false)
    }
  }

  async function onSubmitOtp(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!challengeToken) {
      setError("Session expired. Sign in again.")
      return
    }
    const code = otp.trim()
    if (code.length < 6) {
      setError("Enter the 6-digit code from your authenticator app.")
      return
    }
    setIsSubmitting(true)
    try {
      const res = await postJson<LoginResponse>("/auth/mfa/verify", {
        challenge_token: challengeToken,
        otp: code,
      })
      const accessToken = typeof res.access_token === "string" ? res.access_token : ""
      const refreshToken = typeof res.refresh_token === "string" ? res.refresh_token : ""
      if (!accessToken || !refreshToken) throw new Error("MFA verification incomplete.")
      await completeSession(accessToken, refreshToken)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else if (err instanceof Error) setError(err.message)
      else setError("Verification failed")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (ssoRedirecting && !skipAutoSso) {
    return (
      <AppAuthMarketingLayout>
        <AuthFormShell title="Signing in">
          <p className="text-sm text-muted-foreground">Redirecting to Microsoft…</p>
        </AuthFormShell>
      </AppAuthMarketingLayout>
    )
  }

  return (
    <AppAuthMarketingLayout>
      <AuthFormShell
        title={step === "otp" ? "Authenticator code" : "Login"}
        // description={
        //   step === "otp"
        //     ? "Enter the 6-digit code from your authenticator app to finish signing in."
        //     : "Sign in with your email to open the dashboard."
        // }
      >
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Sign-in failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {step === "password" ? (
          <form onSubmit={onSubmitPassword} className="space-y-5">
            <div className="app-form-field">
              <Label htmlFor="identifier" className={AUTH_LABEL_CLASS}>
                Email Address
              </Label>
              <Input
                id="identifier"
                type="email"
                autoComplete="email"
                placeholder="Enter Email Address"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                disabled={isSubmitting}
                className={AUTH_INPUT_CLASS}
                required
              />
            </div>

            <div className="app-form-field">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="password" className={AUTH_LABEL_CLASS}>
                  Password
                </Label>
                <Link
                  to="/forgot-password"
                  className="text-[12px] font-semibold text-primary underline-offset-2 hover:underline sm:text-[13px]"
                  tabIndex={-1}
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter Password"
                disabled={isSubmitting}
                className={AUTH_PASSWORD_CLASS}
                required
              />
            </div>

            {policy?.captcha_enabled ? (
              <div className="app-form-field">
                <Label htmlFor="captcha" className={AUTH_LABEL_CLASS}>
                  Captcha token
                </Label>
                <Input
                  id="captcha"
                  value={captchaToken}
                  onChange={(e) => setCaptchaToken(e.target.value)}
                  disabled={isSubmitting}
                  placeholder="e.g. captcha-ok"
                  autoComplete="off"
                  className={AUTH_INPUT_CLASS}
                />
              </div>
            ) : null}

            <Button type="submit" disabled={isSubmitting} className={AUTH_BUTTON_CLASS}>
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>

            {policy?.sso_enabled ? (
              <SsoSignInButton
                label={policy.sso_button_label}
                portal="user"
                href={`${API_BASE_URL}/auth/sso/login?portal=user`}
                disabled={isSubmitting}
              />
            ) : null}
          </form>
        ) : (
          <form onSubmit={onSubmitOtp} className="space-y-5">
            <div className="app-form-field">
              <Label htmlFor="otp" className={AUTH_LABEL_CLASS}>
                6-digit code
              </Label>
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                disabled={isSubmitting}
                placeholder="000000"
                className={`${AUTH_INPUT_CLASS} text-center font-mono text-lg tracking-[0.35em]`}
                required
              />
            </div>
            <Button type="submit" disabled={isSubmitting} className={AUTH_BUTTON_CLASS}>
              {isSubmitting ? "Verifying…" : "Continue"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className={AUTH_BUTTON_CLASS}
              disabled={isSubmitting}
              onClick={() => {
                setStep("password")
                setChallengeToken(null)
                setOtp("")
                setError(null)
              }}
            >
              Back to sign in
            </Button>
          </form>
        )}
      </AuthFormShell>
    </AppAuthMarketingLayout>
  )
}
