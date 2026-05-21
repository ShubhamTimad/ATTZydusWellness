import * as React from "react"
import { Link, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { AppAuthMarketingLayout } from "@/components/layout/app-auth-marketing-layout"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
        res.message ?? "A password reset link has been sent to your email.",
      )
      setSubmitted(true)
      toast.success("Reset link sent. Check your inbox.")
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
      <Card className="w-full max-w-md min-h-[520px] rounded-3xl border border-white/20 bg-white/95 p-8 shadow-2xl backdrop-blur-md">
        <CardHeader className="space-y-2 p-0 pb-6">
          <div className="mb-6 flex justify-center">
            <img
              src="/logo.png"
              alt="Takeda"
              className="h-14 w-auto object-contain"
            />
          </div>
          <CardTitle className="text-2xl">Forgot password</CardTitle>
          <CardDescription>
            Enter your account email. If we find an account, we will send a link to reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex h-full flex-col justify-between space-y-4 p-0">
          {submitted ? (
            <div className="space-y-4 text-sm text-muted-foreground">
              <p>{successMessage}</p>
              <p>The link expires after a limited time. Check your spam folder if you do not see it.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
                  <Link to={returnTo}>Back to sign in</Link>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="w-full sm:w-auto"
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
            <form onSubmit={onSubmit} className="space-y-4">
              {error ? (
                <Alert variant="destructive">
                  <AlertTitle>Could not send reset link</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(ev) => setEmail(ev.target.value)}
                  disabled={isSubmitting}
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-red-700 text-white hover:bg-red-800"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Checking…" : "Send reset link"}
              </Button>
              <p className="text-center text-sm">
                <Link to={returnTo} className="text-red-700 underline-offset-2 hover:underline">
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </AppAuthMarketingLayout>
  )
}
