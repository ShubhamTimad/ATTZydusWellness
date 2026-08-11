import { DashboardDonutChart } from "@/components/dashboard/dashboard-charts"
import { DASHBOARD_STATUS, DASHBOARD_THEMES } from "@/components/dashboard/dashboard-theme"
import { DashboardPanel, StatBreakdown } from "@/components/dashboard/dashboard-kpi"
import type { OrdersDashboardModule } from "@/lib/orders-types"

const COLORS = {
  inProgress: DASHBOARD_STATUS.progress,
  closed: DASHBOARD_STATUS.complete,
  rejected: DASHBOARD_STATUS.rejected,
}

export function OrdersDashboard({ data }: { data: OrdersDashboardModule }) {
  const theme = DASHBOARD_THEMES.orders
  const closed = data.closed
  const rejected = data.rejected
  const inProgress = Math.max(0, data.total_orders - closed - rejected)
  const total = data.total_orders || 1
  const mix = [
    { name: "In progress", value: inProgress },
    { name: "Closed", value: closed },
    { name: "Rejected", value: rejected },
  ]

  return (
    <DashboardPanel title="Physical Verification Orders" theme={theme}>
      <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_10.5rem]">
        <div className="min-w-0 space-y-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total order</p>
            <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-foreground">
              {data.total_orders}
            </p>
          </div>
          <StatBreakdown
            items={[
              {
                label: "In progress",
                value: inProgress,
                share: (inProgress / total) * 100,
                color: COLORS.inProgress,
              },
              {
                label: "Closed",
                value: closed,
                share: (closed / total) * 100,
                color: COLORS.closed,
              },
              {
                label: "Rejected",
                value: rejected,
                share: (rejected / total) * 100,
                color: COLORS.rejected,
              },
            ]}
          />
        </div>

        <DashboardDonutChart
          data={mix}
          colors={[COLORS.inProgress, COLORS.closed, COLORS.rejected]}
          emptyMessage="No orders yet"
          height={168}
          showLegend={false}
        />
      </div>
    </DashboardPanel>
  )
}
