import { DashboardDonutChart } from "@/components/dashboard/dashboard-charts"
import { DASHBOARD_CHART, DASHBOARD_STATUS, DASHBOARD_THEMES } from "@/components/dashboard/dashboard-theme"
import { DashboardPanel, StatBreakdown } from "@/components/dashboard/dashboard-kpi"
import type { ItDashboardModule } from "@/lib/assets-types"

const COLORS = {
  active: DASHBOARD_CHART.it,
  inactive: DASHBOARD_STATUS.rest,
}

export function ItDashboard({ data }: { data: ItDashboardModule }) {
  const theme = DASHBOARD_THEMES.it
  const total = data.total_users
  const active = data.active_users
  const inactive = data.inactive_users
  const denom = total || 1
  const activePct = total > 0 ? Math.round((active / total) * 100) : 0
  const mix = [
    { name: "Active", value: active },
    { name: "Inactive", value: inactive },
  ]

  return (
    <DashboardPanel title="IT User" theme={theme}>
      <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_10.5rem]">
        <div className="min-w-0 space-y-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total users
            </p>
            <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-foreground">
              {total}
            </p>
          </div>
          <StatBreakdown
            items={[
              {
                label: "Active",
                value: active,
                share: (active / denom) * 100,
                color: COLORS.active,
              },
              {
                label: "Inactive",
                value: inactive,
                share: (inactive / denom) * 100,
                color: COLORS.inactive,
              },
            ]}
          />
        </div>

        <DashboardDonutChart
          data={mix}
          colors={[COLORS.active, COLORS.inactive]}
          emptyMessage="No users"
          height={168}
          showLegend={false}
          centerLabel={`${activePct}%`}
          centerCaption="Active"
        />
      </div>
    </DashboardPanel>
  )
}
