import { DashboardDonutChart } from "@/components/dashboard/dashboard-charts"
import { DASHBOARD_CHART, DASHBOARD_STATUS, DASHBOARD_THEMES } from "@/components/dashboard/dashboard-theme"
import { DashboardPanel, StatBreakdown } from "@/components/dashboard/dashboard-kpi"
import type { ItDashboardModule } from "@/lib/assets-types"

const COLORS = {
  active: DASHBOARD_CHART.it,
  inactive: DASHBOARD_STATUS.rest,
  neu: DASHBOARD_STATUS.progress,
  gap: "#d97706",
  mfa: DASHBOARD_STATUS.rejected,
}

export function ItDashboard({ data }: { data: ItDashboardModule }) {
  const theme = DASHBOARD_THEMES.it
  const active = data.active_users
  const total = data.total_users || 1
  const inactive = data.inactive_users
  const neu = data.new_users_last_7_days
  const withoutRole = data.without_role ?? 0
  const mfaPending = data.mfa_pending ?? 0
  const mix = [
    { name: "Active", value: active },
    { name: "Inactive", value: inactive },
  ]

  return (
    <DashboardPanel title="IT Users" theme={theme}>
      <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_10.5rem]">
        <div className="min-w-0 space-y-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total active user
            </p>
            <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-foreground">{active}</p>
          </div>
          <StatBreakdown
            items={[
              {
                label: "Inactive",
                value: inactive,
                share: (inactive / total) * 100,
                color: COLORS.inactive,
              },
              {
                label: "New (7d)",
                value: neu,
                share: (neu / total) * 100,
                color: COLORS.neu,
              },
              {
                label: "No role",
                value: withoutRole,
                share: (withoutRole / (active || 1)) * 100,
                color: COLORS.gap,
              },
              {
                label: "MFA pending",
                value: mfaPending,
                share: (mfaPending / (active || 1)) * 100,
                color: COLORS.mfa,
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
        />
      </div>
    </DashboardPanel>
  )
}
