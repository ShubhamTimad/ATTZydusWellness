import { DashboardBarChart, DashboardChartGrid, DashboardDonutChart, ChartPanel } from "@/components/dashboard/dashboard-charts"
import { DASHBOARD_THEMES } from "@/components/dashboard/dashboard-theme"
import { DashboardPanel, KpiCard, KpiGrid } from "@/components/dashboard/dashboard-kpi"
import type { OrdersDashboardModule } from "@/lib/orders-types"

export function OrdersDashboard({ data }: { data: OrdersDashboardModule }) {
  const theme = DASHBOARD_THEMES.orders
  const inPipeline =
    (data.draft ?? 0) + data.assigned + data.in_progress + data.completed
  const finished = data.approved + data.closed
  const mix = [
    { name: "In workflow", value: inPipeline },
    { name: "Finished", value: finished },
  ]

  return (
    <DashboardPanel title="Physical Verification Orders" theme={theme}>
      <KpiGrid className="grid-cols-2 sm:grid-cols-4">
        <KpiCard
          label="Total"
          value={data.total_orders}
          tint={theme.kpiTint}
          accent
          accentClass={theme.accentText}
          className="!p-3"
        />
        <KpiCard
          label="In workflow"
          value={inPipeline}
          tint={theme.kpiTint}
          accent
          accentClass={theme.accentText}
          className="!p-3"
        />
        <KpiCard label="Approved" value={data.approved} tint={theme.kpiTint} className="!p-3" />
        <KpiCard label="Closed" value={data.closed} tint={theme.kpiTint} className="!p-3" />
      </KpiGrid>

      <DashboardChartGrid columns={2}>
        <ChartPanel title="Workflow mix">
          <DashboardDonutChart
            data={mix}
            colors={[theme.chartFill, "#059669"]}
            emptyMessage="No orders"
            height={176}
          />
        </ChartPanel>
        <ChartPanel title="Orders by status">
          <DashboardBarChart
            data={data.by_status}
            xKey="status"
            xAngle={-12}
            height={176}
            series={[{ dataKey: "count", fill: theme.chartFill }]}
            emptyMessage="No orders yet"
          />
        </ChartPanel>
      </DashboardChartGrid>
    </DashboardPanel>
  )
}
