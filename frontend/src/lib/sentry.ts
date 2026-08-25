// Browser Sentry init — no-op when VITE_SENTRY_DSN is unset.

import { browserTracingIntegration, init } from "@sentry/react"

const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim() ?? ""

export function initSentry(): boolean {
  if (!dsn) {
    return false
  }

  const tracesSampleRate = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? "0.1")
  const safeTraces = Number.isFinite(tracesSampleRate)
    ? Math.min(1, Math.max(0, tracesSampleRate))
    : 0.1

  init({
    dsn,
    environment:
      (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined)?.trim() ||
      import.meta.env.MODE ||
      "development",
    sendDefaultPii: false,
    tracesSampleRate: safeTraces,
    integrations: [browserTracingIntegration()],
  })
  return true
}
