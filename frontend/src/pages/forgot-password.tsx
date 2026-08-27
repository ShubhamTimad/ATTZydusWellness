import * as React from "react"
import { Link, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS, AUTH_LABEL_CLASS } from "@/components/auth/auth-field-styles"
import { AuthFormShell } from "@/components/auth/auth-form-shell"
import { AppAuthMarketingLayout } from "@/components/layout/app-auth-marketing-layout"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, postJson } from "@/lib/api"
import { safeReturnTo, storePasswordResetReturnTo } from "@/lib/auth-routes"

type ForgotPasswordResponse = {
  ok: boolean
  message?: string
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function ForgotPasswordPage() {
  const [searchParams] = useSearchParams()
  const returnTo = safeReturnTo(searchParams.get("returnTo"))

  const [email, setEmail] = React.useState("")
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [submitted, setSubmitted] = React.useState(false)
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const eNorm = email.trim().toLowerCase()
    if (!eNorm) {
      setError("Enter the email for your account.")
      return
    }
    if (!isValidEmail(eNorm)) {
      setError("Enter a valid email address.")
      return
    }

    setIsSubmitting(true)
    try {
      const res = await postJson<ForgotPasswordResponse>("/forgot-password", { email: eNorm })
      storePasswordResetReturnTo(returnTo)
      setSuccessMessage(
        res.message ?? "A password reset link has been sent to your registered email address.",
      )
      setSubmitted(true)
      toast.success("Password reset link sent successfully. Please check your registered email address.")
    } catch (err) {
      let message = "Request failed. Try again later."
      if (err instanceof ApiError) {
        if (err.status === 404) {
          message = "No account found with this email address."
        } else if (err.status === 403) {
          message = err.message
        } else if (err.status === 422) {
          message = "Enter a valid email address."
        } else {
          message = err.message
        }
      } else if (err instanceof Error) {
        message = err.message
      }
      setError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AppAuthMarketingLayout>
      <AuthFormShell
        title="Forgot Password"
        description="Enter your registered email address."
      >
        {submitted ? (
          <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            <p className="text-foreground">{successMessage}</p>
            <p>The link expires after a limited time. Check your spam folder if you do not see it.</p>
            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              <Button asChild variant="outline" className="h-10 flex-1">
                <Link to={returnTo}>Back to sign in</Link>
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-10 flex-1"
                onClick={() => {
                  setSubmitted(false)
                  setSuccessMessage(null)
                  setError(null)
                }}
              >
                Use a different email
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Could not send reset link</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="app-form-field">
              <Label htmlFor="forgot-email" className={AUTH_LABEL_CLASS}>
                Email
              </Label>
              <Input
                id="forgot-email"
                type="email"
                autoComplete="email"
                placeholder="Enter your email address"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                disabled={isSubmitting}
                className={AUTH_INPUT_CLASS}
                required
              />
            </div>
            <Button type="submit" className={AUTH_BUTTON_CLASS} disabled={isSubmitting}>
              {isSubmitting ? "Sending…" : "Send Reset Link"}
            </Button>
            <p className="text-center text-sm">
              <Link to={returnTo} className="font-medium text-primary underline-offset-2 hover:underline">
                Back to Sign In
              </Link>
            </p>
          </form>
        )}
      </AuthFormShell>
    </AppAuthMarketingLayout>
  )
}
