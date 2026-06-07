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
        "app-panel relative overflow-hidden",
        theme?.surface,
        className,
      )}
    >
      {theme?.accentBar ? (
        <div className={cn("h-1 w-full bg-gradient-to-r", theme.accentBar)} aria-hidden />
      ) : null}
      {theme?.pattern ? (
        <div className={cn("pointer-events-none absolute inset-0", theme.pattern)} aria-hidden />
      ) : null}

      <div className="app-panel-header relative">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && theme ? (
            <div
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
                theme.iconWrap,
              )}
            >
              <Icon className="size-5" aria-hidden />
            </div>
          ) : null}
          <div className="min-w-0">
            {theme?.tag ? (
              <span className="inline-flex rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {theme.tag}
              </span>
            ) : null}
            <h2 className={cn("app-panel-title", theme?.tag && "mt-1.5")}>{title}</h2>
            {description ? <p className="app-panel-description mt-1">{description}</p> : null}
          </div>
        </div>
      </div>
      <div className="app-dashboard-panel-body relative">{children}</div>
    </section>
  )
}

export function HeroStatCard({
  theme,
  label,
  value,
  hint,
}: {
  theme: DashboardPanelTheme
  label: string
  value: React.ReactNode
  hint?: string
}) {
  const Icon = theme.icon

  return (
    <div
      className={cn(
        "app-hero-stat relative overflow-hidden rounded-[var(--app-radius-surface)] border shadow-[var(--app-shadow-surface)]",
        theme.surface,
      )}
    >
      <div className={cn("h-1 w-full bg-gradient-to-r", theme.accentBar)} aria-hidden />
      {theme.pattern ? (
        <div className={cn("pointer-events-none absolute inset-0", theme.pattern)} aria-hidden />
      ) : null}
      <div className="relative p-5">
        <div className="min-w-0 space-y-3">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                "flex size-10 items-center justify-center rounded-xl ring-1 ring-inset",
                theme.iconWrap,
              )}
            >
              <Icon className="size-5" aria-hidden />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {theme.tag}
            </span>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground tabular-nums sm:text-4xl">
              {value}
            </p>
            {hint ? <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
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
  tint,
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  icon?: LucideIcon
  accent?: boolean
  tint?: string
  className?: string
}) {
  return (
    <div className={cn("app-kpi-card", tint, className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="app-kpi-label">{label}</p>
        {Icon ? (
          <Icon
            className={cn("size-4 shrink-0 opacity-50", accent && "text-primary opacity-70")}
            aria-hidden
          />
        ) : null}
      </div>
      <p className={cn("app-kpi-value", accent && "text-primary")}>{value}</p>
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
  className,
}: {
  label: string
  value: React.ReactNode
  active?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex min-w-[7rem] flex-1 flex-col rounded-lg border px-3 py-2",
        active
          ? "border-primary/25 bg-primary/[0.06]"
          : "border-transparent bg-background/60",
        className,
      )}
    >
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
