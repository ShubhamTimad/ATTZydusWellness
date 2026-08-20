import { DashboardInsightCard } from "@/components/dashboard/dashboard-insight-card"
import {
  DASHBOARD_COLOR,
  DASHBOARD_THEMES,
  dashboardPct,
} from "@/components/dashboard/dashboard-theme"
import type { FinancialYearDashboardModule } from "@/lib/assets-types"

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
      title={`Physical Verification · ${data.label}`}
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
