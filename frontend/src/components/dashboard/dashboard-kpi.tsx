import * as React from "react"
import { ArrowRight } from "lucide-react"
import { Link } from "react-router-dom"

import { cn } from "@/lib/utils"

export function DashboardPanel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  action?: { label: string; to: string }
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("app-panel", className)}>
      <div className="app-panel-header">
        <div className="min-w-0">
          <h2 className="app-panel-title">{title}</h2>
          {description ? <p className="app-panel-description mt-1">{description}</p> : null}
        </div>
        {action ? (
          <Link
            to={action.to}
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
          >
            {action.label}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>
      <div className="app-dashboard-panel-body">{children}</div>
    </section>
  )
}

export function KpiCard({
  label,
  value,
  hint,
  accent = false,
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  accent?: boolean
  className?: string
}) {
  return (
    <div className={cn("app-kpi-card", className)}>
      <p className="app-kpi-label">{label}</p>
      <p className={cn("app-kpi-value", accent && "text-primary")}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function KpiGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("app-grid app-grid-kpi", className)}>{children}</div>
}

export function CoverageBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>FY verification progress</span>
        <span className="font-medium tabular-nums text-foreground">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
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
