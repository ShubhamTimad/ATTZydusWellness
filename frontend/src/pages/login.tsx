import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { ShieldCheck } from "lucide-react"

import { AuthFormShell } from "@/components/auth/auth-form-shell"
import { AppAuthMarketingLayout } from "@/components/layout/app-auth-marketing-layout"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import { getJson, postJson } from "@/lib/api"
import { loginRequestFields, validateLoginIdentifier } from "@/lib/login-identifier"
import { persistAuthFromMe } from "@/lib/permissions"

const loginSchema = z.object({
  identifier: z
    .string()
    .min(1, "Email is required")
    .superRefine((val, ctx) => {
      const err = validateLoginIdentifier(val)
      if (err) ctx.addIssue({ code: "custom", message: err })
    }),
  password: z.string().min(1, "Password is required"),
})

type LoginValues = z.infer<typeof loginSchema>

type LoginResponse = {
  access_token?: string
  refresh_token?: string
  token_type?: string
  mfa_required?: boolean
  setup_required?: boolean
  setup_token?: string
  challenge_token?: string
  [k: string]: unknown
}

type PublicAuthPolicy = {
  password_enabled: boolean
  mfa_enabled: boolean
  captcha_enabled: boolean
  mfa_enforced: boolean
}

export type LoginPageProps = {
  onLoggedIn?: (tokens: { accessToken: string; refreshToken?: string }) => void
}

export function LoginPage({ onLoggedIn }: LoginPageProps) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const legacyReset = (searchParams.get("reset_token") ?? "").trim()

  const [serverError, setServerError] = React.useState<string | null>(null)
  const [mfaChallenge, setMfaChallenge] = React.useState<string | null>(null)
  const [otp, setOtp] = React.useState("")
  const [policy, setPolicy] = React.useState<PublicAuthPolicy | null>(null)
  const [captchaToken, setCaptchaToken] = React.useState("")

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
    mode: "onSubmit",
  })

  const isSubmitting = form.formState.isSubmitting

  if (legacyReset) {
    return <Navigate to={`/reset-password?token=${encodeURIComponent(legacyReset)}&returnTo=%2Fadmin%2Flogin`} replace />
  }

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

  async function onSubmit(values: LoginValues) {
    setServerError(null)
    toast.loading("Signing in…", { id: "login" })

    try {
      const res = await postJson<LoginResponse>("/login", {
        ...loginRequestFields(values.identifier, values.password),
        captcha_token: policy?.captcha_enabled ? (captchaToken.trim() || undefined) : undefined,
      })

      if (res.mfa_required === true) {
        if (res.setup_required === true && typeof res.setup_token === "string") {
          toast.dismiss("login")
          navigate(`/mfa/setup?token=${encodeURIComponent(res.setup_token)}`)
          return
        }
        if (typeof res.challenge_token === "string") {
          setMfaChallenge(res.challenge_token)
          toast.dismiss("login")
          return
        }
      }

      const accessToken = typeof res.access_token === "string" ? res.access_token : ""
      const refreshToken = typeof res.refresh_token === "string" ? res.refresh_token : undefined
      if (!accessToken) {
        throw new Error("Login succeeded but no access token was returned.")
      }

      localStorage.setItem("access_token", accessToken)
      if (refreshToken) localStorage.setItem("refresh_token", refreshToken)

      const me = await getJson<{
        is_superuser?: boolean
        permissions?: string[]
      }>("/me")
      persistAuthFromMe(me)

      toast.success("Signed in", { id: "login" })
      onLoggedIn?.({ accessToken, refreshToken })
    } catch (e) {
      const message = e instanceof Error ? e.message : "Login failed"
      setServerError(message)
      toast.error(message, { id: "login" })
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault()
    if (!mfaChallenge) return
    setServerError(null)
    toast.loading("Verifying…", { id: "mfa" })
    try {
      const res = await postJson<LoginResponse>("/auth/mfa/verify", {
        challenge_token: mfaChallenge,
        otp: otp.trim(),
      })
      const accessToken = typeof res.access_token === "string" ? res.access_token : ""
      const refreshToken = typeof res.refresh_token === "string" ? res.refresh_token : undefined
      if (!accessToken) throw new Error("No access token")
      localStorage.setItem("access_token", accessToken)
      if (refreshToken) localStorage.setItem("refresh_token", refreshToken)
      const me = await getJson<{ is_superuser?: boolean; permissions?: string[] }>("/me")
      persistAuthFromMe(me)
      toast.success("Signed in", { id: "mfa" })
      onLoggedIn?.({ accessToken, refreshToken })
    } catch (e) {
      const message = e instanceof Error ? e.message : "Verification failed"
      setServerError(message)
      toast.error(message, { id: "mfa" })
    }
  }

  return (
    <AppAuthMarketingLayout variant="admin">
      <AuthFormShell
        title={mfaChallenge ? "Authenticator code" : "Admin sign in"}
        description={
          mfaChallenge
            ? "Enter the code from your authenticator app."
            : "Superadmin access to platform settings, users, and workflows."
        }
        footer={
          !mfaChallenge ? (
            <span className="inline-flex items-center justify-center gap-1.5">
              <ShieldCheck className="size-3.5 shrink-0 text-primary/80" aria-hidden />
              Restricted to platform administrators
            </span>
          ) : undefined
        }
      >
        {serverError ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t sign in</AlertTitle>
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        ) : null}

        {mfaChallenge ? (
          <form className="space-y-4" onSubmit={submitOtp}>
            <div className="app-form-field">
              <Label htmlFor="otp">6-digit code</Label>
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="000000"
                className="h-11 text-center font-mono text-lg tracking-[0.35em]"
              />
            </div>
            <Button type="submit" className="h-11 w-full text-sm font-semibold">
              Continue
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full"
              onClick={() => {
                setMfaChallenge(null)
                setOtp("")
                setServerError(null)
              }}
            >
              Back to sign in
            </Button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <div className="app-form-field">
              <Label htmlFor="identifier">Email Address</Label>
              <Input
                id="identifier"
                type="email"
                autoComplete="email"
                placeholder="admin@example.com"
                aria-invalid={!!form.formState.errors.identifier}
                className="h-11"
                {...form.register("identifier")}
              />
              {form.formState.errors.identifier?.message ? (
                <p className="text-xs text-destructive">{form.formState.errors.identifier.message}</p>
              ) : null}
            </div>

            <div className="app-form-field">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="password">Password</Label>
                <Link
                  to="/forgot-password?returnTo=%2Fadmin%2Flogin"
                  className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                  tabIndex={-1}
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                aria-invalid={!!form.formState.errors.password}
                className="h-11"
                {...form.register("password")}
              />
              {form.formState.errors.password?.message ? (
                <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
              ) : null}
            </div>

            {policy?.captcha_enabled ? (
              <div className="app-form-field">
                <Label htmlFor="captcha_token">Captcha token</Label>
                <Input
                  id="captcha_token"
                  autoComplete="off"
                  value={captchaToken}
                  onChange={(e) => setCaptchaToken(e.target.value)}
                  placeholder="e.g. captcha-ok"
                  className="h-11"
                />
              </div>
            ) : null}

            <Button type="submit" className="h-11 w-full text-sm font-semibold" disabled={isSubmitting}>
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              <Link to="/login" className="font-medium text-primary underline-offset-2 hover:underline">
                Workspace sign in
              </Link>
            </p>
          </form>
        )}
      </AuthFormShell>
    </AppAuthMarketingLayout>
  )
}
