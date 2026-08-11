import { DashboardDonutChart } from "@/components/dashboard/dashboard-charts"
import { DASHBOARD_STATUS, DASHBOARD_THEMES } from "@/components/dashboard/dashboard-theme"
import { DashboardPanel, StatBreakdown } from "@/components/dashboard/dashboard-kpi"
import type { AssetsDashboardModule } from "@/lib/assets-types"

const COLORS = {
  approved: DASHBOARD_STATUS.complete,
  progress: DASHBOARD_STATUS.progress,
}

export function AssetDashboard({ data }: { data: AssetsDashboardModule }) {
  const theme = DASHBOARD_THEMES.assets
  const total = data.total_assets
  const approved = data.approved_assets ?? 0
  const inProgress = Math.max(0, total - approved)
  const denom = total || 1
  const mix = [
    { name: "Total approved", value: approved },
    { name: "In progress", value: inProgress },
  ]

  return (
    <DashboardPanel title="Asset register" theme={theme}>
      <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_10.5rem]">
        <div className="min-w-0 space-y-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total asset</p>
            <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-foreground">
              {total}
            </p>
          </div>
          <StatBreakdown
            items={[
              {
                label: "Total approved",
                value: approved,
                share: (approved / denom) * 100,
                color: COLORS.approved,
              },
              {
                label: "In progress",
                value: inProgress,
                share: (inProgress / denom) * 100,
                color: COLORS.progress,
              },
            ]}
          />
        </div>

        <DashboardDonutChart
          data={mix}
          colors={[COLORS.approved, COLORS.progress]}
          emptyMessage="No assets"
          height={168}
          showLegend={false}
        />
      </div>
    </DashboardPanel>
  )
}
