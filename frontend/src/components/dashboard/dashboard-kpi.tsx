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
        <div className="flex min-w-0 items-center gap-3">
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
            <h2 className="app-panel-title">{title}</h2>
            {description ? <p className="app-panel-description mt-0.5">{description}</p> : null}
          </div>
        </div>
      </div>
      <div className="app-dashboard-panel-body relative flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
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

export function StatBreakdown({
  items,
}: {
  items: { label: string; value: React.ReactNode; share?: number; color: string }[]
}) {
  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const share = item.share == null ? null : Math.max(0, Math.min(100, item.share))
        return (
          <li key={item.label} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
              <span className="text-sm font-semibold tabular-nums text-foreground">{item.value}</span>
            </div>
            {share != null && share > 0 ? (
              <div className="h-1.5 overflow-hidden rounded-full bg-muted/70">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${share}%`, backgroundColor: item.color }}
                />
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
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
