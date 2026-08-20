import { DashboardInsightCard } from "@/components/dashboard/dashboard-insight-card"
import {
  DASHBOARD_COLOR,
  DASHBOARD_THEMES,
  dashboardPct,
} from "@/components/dashboard/dashboard-theme"
import type { OrdersDashboardModule } from "@/lib/orders-types"

export function orderInsightParts(data: OrdersDashboardModule) {
  const total = Math.max(0, data.total_orders)
  const closed = Math.max(0, data.closed + data.rejected)
  const inProgress = Math.max(0, total - closed)
  return { total, closed, inProgress, open: inProgress }
}

export function OrdersDashboard({ data }: { data: OrdersDashboardModule }) {
  const theme = DASHBOARD_THEMES.orders
  const parts = orderInsightParts(data)
  const inProgressPct = dashboardPct(parts.inProgress, parts.total)
  const slices = [
    { name: "In Progress", value: parts.inProgress, color: DASHBOARD_COLOR.blue },
    { name: "Closed", value: parts.closed, color: DASHBOARD_COLOR.green },
  ]

  return (
    <DashboardInsightCard
      title="Physical Verification Orders"
      icon={theme.icon}
      iconWrap={theme.iconWrap}
      metrics={[
        { value: parts.total, label: "Total" },
        { value: parts.inProgress, label: "In Progress" },
        { value: parts.closed, label: "Closed" },
      ]}
      slices={slices}
      centerLabel={`${inProgressPct}%`}
      centerCaption="In Progress"
    />
  )
}
