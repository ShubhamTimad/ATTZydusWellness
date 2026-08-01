import { DashboardBarChart, DashboardChartGrid, DashboardDonutChart, ChartPanel } from "@/components/dashboard/dashboard-charts"
import type { DashboardPanelTheme } from "@/components/dashboard/dashboard-theme"
import { DashboardPanel, KpiCard, KpiGrid } from "@/components/dashboard/dashboard-kpi"

export type WorkflowOrdersModule = {
  total: number
  open: number
  closed: number
  rejected: number
  draft: number
  pending_approval: number
  awaiting_action: number
  by_status: { status: string; count: number }[]
}

export function WorkflowOrdersDashboard({
  title,
  theme,
  data,
}: {
  title: string
  theme: DashboardPanelTheme
  data: WorkflowOrdersModule
}) {
  const mix = [
    { name: "Open", value: data.open },
    { name: "Closed", value: data.closed },
  ]
  const pipeline = [
    { name: "Draft", value: data.draft },
    { name: "Pending", value: data.pending_approval },
    { name: "Action", value: data.awaiting_action },
    { name: "Rejected", value: data.rejected },
    { name: "Closed", value: data.closed },
  ].filter((r) => r.value > 0)

  return (
    <DashboardPanel title={title} theme={theme} className="min-h-0">
      <KpiGrid className="grid-cols-2 sm:grid-cols-4">
        <KpiCard
          label="Total"
          value={data.total}
          tint={theme.kpiTint}
          accent
          accentClass={theme.accentText}
          className="!p-3"
        />
        <KpiCard
          label="Open"
          value={data.open}
          tint={theme.kpiTint}
          accent
          accentClass={theme.accentText}
          className="!p-3"
        />
        <KpiCard label="Action" value={data.awaiting_action} tint={theme.kpiTint} className="!p-3" />
        <KpiCard label="Closed" value={data.closed} tint={theme.kpiTint} className="!p-3" />
      </KpiGrid>

      <DashboardChartGrid columns={2}>
        <ChartPanel title="Open vs closed">
          <DashboardDonutChart
            data={mix}
            colors={[theme.chartFill, "#059669"]}
            emptyMessage="No orders"
            height={168}
          />
        </ChartPanel>
        <ChartPanel title="By status">
          <DashboardBarChart
            data={pipeline.length ? pipeline : data.by_status}
            xKey={pipeline.length ? "name" : "status"}
            xAngle={-20}
            height={168}
            series={[{ dataKey: pipeline.length ? "value" : "count", fill: theme.chartFill }]}
            emptyMessage="No status data"
          />
        </ChartPanel>
      </DashboardChartGrid>
    </DashboardPanel>
  )
}
