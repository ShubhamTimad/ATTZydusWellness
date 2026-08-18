import { DashboardInsightCard } from "@/components/dashboard/dashboard-insight-card"
import {
  DASHBOARD_COLOR,
  DASHBOARD_THEMES,
  dashboardPct,
} from "@/components/dashboard/dashboard-theme"
import type { AssetsDashboardModule } from "@/lib/assets-types"

export function AssetDashboard({ data }: { data: AssetsDashboardModule }) {
  const theme = DASHBOARD_THEMES.assets
  const total = data.total_assets
  const tagged = data.rfid_tagged
  const untagged = data.rfid_not_tagged
  const taggedPct = dashboardPct(tagged, total)
  const slices = [
    { name: "Tagged", value: tagged, color: DASHBOARD_COLOR.green },
    { name: "Untagged", value: untagged, color: DASHBOARD_COLOR.blue },
  ]

  return (
    <DashboardInsightCard
      title="Asset Register"
      icon={theme.icon}
      iconWrap={theme.iconWrap}
      metrics={[
        { value: total, label: "Total" },
        { value: tagged, label: "Tagged" },
        { value: untagged, label: "Untagged" },
      ]}
      slices={slices}
      centerLabel={`${taggedPct}%`}
      centerCaption="Tagged"
    />
  )
}
