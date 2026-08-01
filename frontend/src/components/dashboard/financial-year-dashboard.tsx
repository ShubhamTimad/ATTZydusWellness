import { DashboardBarChart, DashboardChartGrid, DashboardDonutChart, ChartPanel } from "@/components/dashboard/dashboard-charts"
import { DASHBOARD_CHART, DASHBOARD_THEMES } from "@/components/dashboard/dashboard-theme"
import { DashboardPanel, KpiCard, KpiGrid } from "@/components/dashboard/dashboard-kpi"
import type { FinancialYearDashboardModule } from "@/lib/assets-types"

export function FinancialYearDashboard({ data }: { data: FinancialYearDashboardModule }) {
  const theme = DASHBOARD_THEMES.fy
  const mix = [
    { name: "Verified", value: data.verified_in_fy },
    { name: "Pending", value: data.pending_fy_verification },
  ]
  const plantRows = (data.by_plant ?? []).map((r) => ({
    plant: r.plant,
    verified: r.verified,
    pending: r.pending,
  }))

  return (
    <DashboardPanel title={`Physical Verification · ${data.label}`} theme={theme}>
      <KpiGrid className="grid-cols-2 sm:grid-cols-4">
        <KpiCard
          label="Coverage"
          value={`${data.coverage_pct}%`}
          tint={theme.kpiTint}
          accent
          accentClass={theme.accentText}
          className="!p-3"
        />
        <KpiCard
          label="Verified"
          value={data.verified_in_fy}
          tint={theme.kpiTint}
          accent
          accentClass={theme.accentText}
          className="!p-3"
        />
        <KpiCard label="Pending" value={data.pending_fy_verification} tint={theme.kpiTint} className="!p-3" />
        <KpiCard label="RFID assets" value={data.total_rfid_assets} tint={theme.kpiTint} className="!p-3" />
      </KpiGrid>

      <DashboardChartGrid columns={2}>
        <ChartPanel title="Verified vs pending">
          <DashboardDonutChart
            data={mix}
            colors={[DASHBOARD_CHART.fy, DASHBOARD_CHART.fyPending]}
            emptyMessage="No RFID assets"
            height={176}
          />
        </ChartPanel>
        <ChartPanel title="By plant">
          <DashboardBarChart
            data={plantRows}
            xKey="plant"
            height={176}
            series={[
              {
                dataKey: "verified",
                name: "Verified",
                stackId: "fy",
                fill: DASHBOARD_CHART.fy,
                radius: [0, 0, 0, 0],
              },
              {
                dataKey: "pending",
                name: "Pending",
                stackId: "fy",
                fill: DASHBOARD_CHART.fyPending,
                radius: [4, 4, 0, 0],
              },
            ]}
            emptyMessage="No plant data"
          />
        </ChartPanel>
      </DashboardChartGrid>
    </DashboardPanel>
  )
}
