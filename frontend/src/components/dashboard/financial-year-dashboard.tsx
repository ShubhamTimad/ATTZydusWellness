import { Calendar } from "lucide-react"

import { DashboardInsightCard } from "@/components/dashboard/dashboard-insight-card"
import {
  DASHBOARD_COLOR,
  DASHBOARD_THEMES,
  dashboardPct,
} from "@/components/dashboard/dashboard-theme"
import type { FinancialYearDashboardModule } from "@/lib/assets-types"

function parseIsoDate(iso?: string) {
  if (!iso?.trim()) return null
  const d = new Date(`${iso.trim()}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Matches toolbar date chips: "1 Apr · 30 Jun 2026" / "1 Apr 2026 · 31 Mar 2027". */
function formatFyChipRange(start?: string, end?: string) {
  const from = parseIsoDate(start)
  const to = parseIsoDate(end)
  if (!from || !to) return null
  const part = (d: Date, withYear: boolean) =>
    d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" as const } : {}),
    })
  if (from.getFullYear() === to.getFullYear()) {
    return `${part(from, false)} · ${part(to, true)}`
  }
  return `${part(from, true)} · ${part(to, true)}`
}

export function DashboardFyBadge({
  data,
}: {
  data: Pick<FinancialYearDashboardModule, "label" | "start" | "end">
}) {
  const range = formatFyChipRange(data.start, data.end)
  const label = data.label?.trim()
  if (!range && !label) return null

  return (
    <div
      className="inline-flex h-9 max-w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-foreground shadow-sm"
      title={label ? `Financial year · ${label}` : "Current financial year"}
      aria-label={label ? `Financial year ${label}` : "Current financial year"}
    >
      <Calendar className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate tabular-nums">{range ?? label}</span>
    </div>
  )
}

export function FinancialYearDashboard({ data }: { data: FinancialYearDashboardModule }) {
  const theme = DASHBOARD_THEMES.fy
  const total = data.total_rfid_assets
  const verified = data.verified_in_fy
  const pending = data.pending_fy_verification
  const coverage = data.coverage_pct > 0 ? Math.round(data.coverage_pct) : dashboardPct(verified, total)
  const slices = [
    { name: "Pending", value: pending, color: DASHBOARD_COLOR.orange },
    { name: "Verified", value: verified, color: DASHBOARD_COLOR.green },
  ]

  return (
    <DashboardInsightCard
      title="Physical Verification"
      icon={theme.icon}
      iconWrap={theme.iconWrap}
      metrics={[
        { value: verified, label: "Total Verified Assets" },
        { value: pending, label: "Remaining Verification" },
      ]}
      slices={slices}
      centerLabel={`${coverage}%`}
      centerCaption="Coverage"
    />
  )
}
