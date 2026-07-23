import * as React from "react"

import { cn } from "@/lib/utils"

export type AdminPageProps = {
  children: React.ReactNode
  /** Shown below the layout header title when you need extra context */
  description?: string
  /** Toolbar actions (buttons) aligned to the right */
  actions?: React.ReactNode
  /** Use full viewport width (no max-w-7xl cap) */
  fullWidth?: boolean
  /** Tighter vertical rhythm for data-dense screens */
  dense?: boolean
  /** Fill viewport height; table area scrolls internally (list pages). */
  viewportFill?: boolean
  className?: string
}

/** Consistent content width and spacing for workspace / admin pages. */
export function AdminPage({
  children,
  description,
  actions,
  fullWidth = false,
  dense = false,
  viewportFill = false,
  className,
}: AdminPageProps) {
  return (
    <div
      className={cn(
        "app-page mx-auto w-full",
        fullWidth ? "max-w-none" : "max-w-7xl",
        dense ? "gap-[var(--app-grid-gap)]" : "gap-[var(--app-section-gap)]",
        viewportFill
          ? "flex min-h-0 flex-1 flex-col overflow-hidden"
          : "min-h-0 flex-1 overflow-y-auto",
        className,
      )}
    >
      {description || actions ? (
        <div
          className={cn(
            "flex shrink-0 flex-wrap items-center justify-between gap-2",
            dense ? "gap-2" : "gap-4 sm:flex-row sm:items-start",
          )}
        >
          {description ? (
            <p
              className={cn(
                "text-foreground",
                dense ? "text-xs" : "max-w-2xl text-sm leading-relaxed",
              )}
            >
              {description}
            </p>
          ) : (
            <span />
          )}
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}

export function AdminSection({
  title,
  description,
  children,
  className,
}: {
  title?: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("app-section", className)}>
      {title ? (
        <div className="space-y-1">
          <h3 className="app-section-heading">{title}</h3>
          {description ? <p className="text-xs leading-relaxed text-foreground">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
