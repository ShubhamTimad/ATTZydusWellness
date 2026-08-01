import * as React from "react"
import { type LucideIcon } from "lucide-react"

import type { DashboardPanelTheme } from "@/components/dashboard/dashboard-theme"
import { cn } from "@/lib/utils"

export function DashboardPanel({
  title,
  description,
  theme,
  children,
  className,
}: {
  title: string
  description?: string
  theme?: DashboardPanelTheme
  children: React.ReactNode
  className?: string
}) {
  const Icon = theme?.icon

  return (
    <section
      className={cn(
        "app-panel relative flex h-full min-h-0 flex-col overflow-hidden",
        theme?.surface,
        className,
      )}
    >
      {theme?.accentBar ? (
        <div className={cn("h-1 w-full shrink-0 bg-gradient-to-r", theme.accentBar)} aria-hidden />
      ) : null}
      {theme?.pattern ? (
        <div className={cn("pointer-events-none absolute inset-0", theme.pattern)} aria-hidden />
      ) : null}

      <div className="app-panel-header relative shrink-0">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && theme ? (
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
                theme.iconWrap,
              )}
            >
              <Icon className="size-4" aria-hidden />
            </div>
          ) : null}
          <div className="min-w-0">
            {theme?.tag ? (
              <span className="inline-flex rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {theme.tag}
              </span>
            ) : null}
            <h2 className={cn("app-panel-title", theme?.tag && "mt-1")}>{title}</h2>
            {description ? <p className="app-panel-description mt-0.5">{description}</p> : null}
          </div>
        </div>
      </div>
      <div className="app-dashboard-panel-body relative flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}

export function HeroStatCard({
  theme,
  label,
  value,
  hint,
  compact = false,
}: {
  theme: DashboardPanelTheme
  label: string
  value: React.ReactNode
  hint?: string
  compact?: boolean
}) {
  const Icon = theme.icon

  return (
    <div
      className={cn(
        "app-hero-stat relative overflow-hidden rounded-[var(--app-radius-surface)] border shadow-[var(--app-shadow-surface)]",
        theme.surface,
      )}
    >
      <div className={cn("h-0.5 w-full bg-gradient-to-r", theme.accentBar)} aria-hidden />
      {theme.pattern ? (
        <div className={cn("pointer-events-none absolute inset-0", theme.pattern)} aria-hidden />
      ) : null}
      <div className={cn("relative", compact ? "p-3.5" : "p-5")}>
        <div className={cn("min-w-0", compact ? "space-y-2" : "space-y-3")}>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center justify-center rounded-lg ring-1 ring-inset",
                compact ? "size-8" : "size-10 rounded-xl",
                theme.iconWrap,
              )}
            >
              <Icon className={compact ? "size-4" : "size-5"} aria-hidden />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {theme.tag}
            </span>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p
              className={cn(
                "mt-0.5 font-semibold tracking-tight text-foreground tabular-nums",
                compact ? "text-2xl" : "text-3xl sm:text-4xl",
              )}
            >
              {value}
            </p>
            {hint ? (
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = false,
  accentClass = "text-primary",
  tint,
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  icon?: LucideIcon
  accent?: boolean
  /** Theme accent color for icon/value when accent is set. */
  accentClass?: string
  tint?: string
  className?: string
}) {
  return (
    <div className={cn("app-kpi-card", tint, className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="app-kpi-label">{label}</p>
        {Icon ? (
          <Icon
            className={cn("size-4 shrink-0 opacity-50", accent && cn(accentClass, "opacity-70"))}
            aria-hidden
          />
        ) : null}
      </div>
      <p className={cn("app-kpi-value", accent && accentClass)}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function KpiGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("app-grid app-grid-kpi", className)}>{children}</div>
}

export function StatChipRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-2 rounded-[var(--app-radius-surface)] border border-border/60 bg-muted/20 p-2.5",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function StatChip({
  label,
  value,
  active,
  tone = "default",
  className,
}: {
  label: string
  value: React.ReactNode
  active?: boolean
  tone?: "default" | "success" | "warning" | "danger" | "info"
  className?: string
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100"
        : tone === "danger"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200"
          : tone === "info"
            ? "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/40 dark:bg-sky-950/30 dark:text-sky-200"
            : active
              ? "border-primary/25 bg-primary/[0.06]"
              : "border-transparent bg-background/60"

  return (
    <div className={cn("flex min-w-[7rem] flex-1 flex-col rounded-lg border px-3 py-2", toneClass, className)}>
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  )
}

export function CoverageBar({
  value,
  label = "FY verification progress",
  tone = "primary",
  className,
}: {
  value: number
  label?: string
  tone?: "primary" | "emerald"
  className?: string
}) {
  const pct = Math.max(0, Math.min(100, value))
  const barClass = tone === "emerald" ? "bg-emerald-500" : "bg-primary"

  return (
    <div
      className={cn(
        "space-y-2.5 rounded-[var(--app-radius-surface)] border border-border/60 bg-background/50 p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="font-semibold tabular-nums text-foreground">{pct}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted/80">
        <div
          className={cn("h-full rounded-full transition-[width] duration-700 ease-out", barClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function ChartPanel({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("app-chart-card flex flex-col", className)}>
      <div className="mb-3 space-y-0.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

export function ChartEmpty({ message = "No data yet" }: { message?: string }) {
  return (
    <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/15 text-sm text-muted-foreground">
      {message}
    </div>
  )
}

/** @deprecated Use DashboardPanel instead */
export function DashboardSectionTitle({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-[var(--app-grid-gap)]">
      <h2 className="app-section-heading">{children}</h2>
      {action}
    </div>
  )
}
