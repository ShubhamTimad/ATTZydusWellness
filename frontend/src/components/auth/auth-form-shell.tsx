import * as React from "react"

import { AuthBrandMark } from "@/components/auth/auth-brand-mark"
import { AuthShellModeContext } from "@/components/auth/auth-shell-mode"
import { getJson } from "@/lib/api"
import { cn } from "@/lib/utils"
import { ShieldCheck } from "lucide-react"

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
  const mode = React.useContext(AuthShellModeContext)
  const isRail = mode === "rail"
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

  if (isRail) {
    return (
      <div className={cn("mx-auto flex h-full w-full flex-col", className)}>
        <div className="mb-6 flex justify-center">
          <AuthBrandMark size="lg" showSubtitle={false} />
        </div>

        <header className="mb-7 space-y-2 text-center">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-foreground sm:text-[32px]">
            {title}
          </h1>
          {description ? (
            <p className="mx-auto max-w-[22rem] text-[13px] leading-relaxed text-muted-foreground sm:text-sm">
              {description}
            </p>
          ) : null}
        </header>

        <div className="flex flex-1 flex-col justify-center space-y-5">{children}</div>

        <div className="mt-8 space-y-1.5 border-t border-neutral-200 pt-5 text-center">
          {footer ? <div className="text-[13px] text-neutral-600">{footer}</div> : null}
          {version ? (
            <p className="text-xs tabular-nums tracking-wide text-neutral-500">
              Version {version}
            </p>
          ) : null}
          <p className="text-xs text-neutral-500">
            {/* © {new Date().getFullYear()} Takeda */}
            {/* {version ? <span className="ml-1 tabular-nums">· v{version}</span> : null} */}
            <span className="inline-flex items-center justify-center gap-1.5">
              <ShieldCheck className="size-3.5 shrink-0 text-primary/80" aria-hidden />
              Powered by TiMAD
            </span>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("w-full max-w-[440px]", className)}>
      <div
        className={cn(
          "relative flex min-h-[min(32rem,calc(100svh-5rem))] flex-col overflow-hidden rounded-2xl",
          "border border-border/50 bg-card/95",
          "px-6 pt-8 pb-7 shadow-[0_8px_24px_rgba(15,23,42,0.08),0_24px_56px_-12px_rgba(15,23,42,0.28)]",
          "backdrop-blur-xl sm:min-h-[34rem] sm:px-9 sm:pt-10 sm:pb-8",
          "ring-1 ring-black/5",
        )}
      >
        <div
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-[#f03a40] to-primary/50"
          aria-hidden
        />

        <div className="mb-8 flex justify-center pt-2">
          <AuthBrandMark size="lg" showSubtitle={false} />
        </div>

        <header className="mb-8 space-y-2 text-center">
          <h1 className="text-[1.35rem] font-semibold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </header>

        <div className="flex flex-1 flex-col justify-center space-y-5">{children}</div>

        {version || footer ? (
          <div className="mt-8 space-y-3 border-t border-border/50 pt-5">
            {footer ? (
              <div className="text-center text-sm text-muted-foreground">{footer}</div>
            ) : null}
            {version ? (
              <p className="text-center text-[11px] tabular-nums tracking-wide text-muted-foreground/80">
                Version {version}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
