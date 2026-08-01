import { DashboardBarChart, DashboardChartGrid, DashboardDonutChart, ChartPanel } from "@/components/dashboard/dashboard-charts"
import { DASHBOARD_CHART, DASHBOARD_THEMES } from "@/components/dashboard/dashboard-theme"
import { CoverageBar, DashboardPanel, KpiCard, KpiGrid } from "@/components/dashboard/dashboard-kpi"
import type { AssetsDashboardModule } from "@/lib/assets-types"

export function AssetDashboard({ data }: { data: AssetsDashboardModule }) {
  const theme = DASHBOARD_THEMES.assets
  const rfidMix = [
    { name: "Tagged", value: data.rfid_tagged },
    { name: "Not tagged", value: data.rfid_not_tagged },
  ]
  const categoryRows = (data.by_category ?? []).slice(0, 8)

  return (
    <DashboardPanel title="Asset register" theme={theme}>
      <KpiGrid className="sm:grid-cols-3">
        <KpiCard
          label="Total"
          value={data.total_assets}
          tint={theme.kpiTint}
          accent
          accentClass={theme.accentText}
          className="!p-3"
        />
        <KpiCard
          label="Active"
          value={data.active_assets}
          tint={theme.kpiTint}
          accent
          accentClass={theme.accentText}
          className="!p-3"
        />
        <KpiCard label="Added (7d)" value={data.recently_added} tint={theme.kpiTint} className="!p-3" />
      </KpiGrid>

      <CoverageBar
        value={data.rfid_coverage_pct}
        label="RFID coverage"
        className="border-0 bg-transparent p-0"
      />

      <DashboardChartGrid columns={2}>
        <ChartPanel title="RFID mix">
          <DashboardDonutChart
            data={rfidMix}
            colors={[DASHBOARD_CHART.assets, "#94a3b8"]}
            emptyMessage="No assets"
            height={168}
          />
        </ChartPanel>
        <ChartPanel title="By category">
          <DashboardBarChart
            data={categoryRows}
            xKey="category"
            xAngle={-18}
            height={168}
            series={[{ dataKey: "count", fill: theme.chartFill }]}
            emptyMessage="No categories"
          />
        </ChartPanel>
      </DashboardChartGrid>
    </DashboardPanel>
  )
}
