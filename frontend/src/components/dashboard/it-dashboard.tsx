import { DashboardInsightCard } from "@/components/dashboard/dashboard-insight-card"
import {
  DASHBOARD_COLOR,
  DASHBOARD_THEMES,
  dashboardPct,
} from "@/components/dashboard/dashboard-theme"
import type { ItDashboardModule } from "@/lib/assets-types"

export function ItDashboard({ data }: { data: ItDashboardModule }) {
  const theme = DASHBOARD_THEMES.it
  const active = data.active_users
  const deactive = data.inactive_users
  const activePct = dashboardPct(active, active + deactive)
  const slices = [
    { name: "Active", value: active, color: DASHBOARD_COLOR.orange },
    { name: "Deactive", value: deactive, color: DASHBOARD_COLOR.green },
  ]

  return (
    <DashboardInsightCard
      title="IT User"
      icon={theme.icon}
      iconWrap={theme.iconWrap}
      metrics={[
        { value: active, label: "Active" },
        { value: deactive, label: "Deactive" },
      ]}
      slices={slices}
      centerLabel={`${activePct}%`}
      centerCaption="Active"
    />
  )
}
