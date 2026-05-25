import * as React from "react"

import { cn } from "@/lib/utils"

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
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
      <p className={cn("app-kpi-value", accent && "text-primary")}>{value}</p>
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
