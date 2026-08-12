import * as React from "react"

import { getJson } from "@/lib/api"
import { cn } from "@/lib/utils"

type AuthFormShellProps = {
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}

export function AuthFormShell({
  title,
  description,
  children,
  footer,
  className,
}: AuthFormShellProps) {
  const [version, setVersion] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void getJson<{ version: string }>("/auth/app-version")
      .then((res) => {
        if (!cancelled && res.version?.trim()) setVersion(res.version.trim())
      })
      .catch(() => {
        if (!cancelled) setVersion(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className={cn("w-full max-w-[420px]", className)}>
      <div className="rounded-[1.25rem] border border-border/70 bg-card p-8 shadow-[var(--app-shadow-elevated)] sm:p-9">
        <header className="mb-7 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </header>

        <div className="space-y-5">{children}</div>

        {version ? (
          <p className="mt-4 text-center text-xs tabular-nums text-muted-foreground">
            Version {version}
          </p>
        ) : null}

        {footer ? (
          <div className="mt-6 border-t border-border/60 pt-5 text-center text-sm text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}
