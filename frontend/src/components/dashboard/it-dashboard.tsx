import { DashboardBarChart, DashboardChartGrid, DashboardDonutChart, ChartPanel } from "@/components/dashboard/dashboard-charts"
import { DASHBOARD_CHART, DASHBOARD_THEMES } from "@/components/dashboard/dashboard-theme"
import { DashboardPanel, KpiCard, KpiGrid } from "@/components/dashboard/dashboard-kpi"
import type { ItDashboardModule } from "@/lib/assets-types"

export function ItDashboard({ data }: { data: ItDashboardModule }) {
  const theme = DASHBOARD_THEMES.it
  const roleRows = (data.users_by_role ?? []).map((r) => ({
    role: r.role,
    count: r.count,
  }))
  const statusMix = [
    { name: "Active", value: data.active_users },
    { name: "Inactive", value: data.inactive_users },
  ]

  return (
    <DashboardPanel title="IT · Users" theme={theme}>
      <KpiGrid className="sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total"
          value={data.total_users}
          tint={theme.kpiTint}
          accent
          accentClass={theme.accentText}
          className="!p-3"
        />
        <KpiCard
          label="Active"
          value={data.active_users}
          tint={theme.kpiTint}
          accent
          accentClass={theme.accentText}
          className="!p-3"
        />
        <KpiCard label="Inactive" value={data.inactive_users} tint={theme.kpiTint} className="!p-3" />
        <KpiCard
          label="New (7d)"
          value={data.new_users_last_7_days}
          tint={theme.kpiTint}
          accent
          accentClass={theme.accentText}
          className="!p-3"
        />
      </KpiGrid>

      <DashboardChartGrid columns={2}>
        <ChartPanel title="Active vs inactive">
          <DashboardDonutChart
            data={statusMix}
            colors={[DASHBOARD_CHART.it, "#94a3b8"]}
            emptyMessage="No users"
            height={180}
          />
        </ChartPanel>
        <ChartPanel title="Users by role">
          <DashboardBarChart
            data={roleRows}
            xKey="role"
            xAngle={-18}
            height={180}
            series={[{ dataKey: "count", fill: theme.chartFill }]}
            emptyMessage="No role assignments"
          />
        </ChartPanel>
      </DashboardChartGrid>
    </DashboardPanel>
  )
}
