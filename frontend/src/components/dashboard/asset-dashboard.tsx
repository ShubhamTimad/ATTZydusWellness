import { DashboardBarChart, DashboardChartGrid, ChartPanel } from "@/components/dashboard/dashboard-charts"
import { DashboardPanel, KpiCard, KpiGrid } from "@/components/dashboard/dashboard-kpi"
import type { AssetsDashboardModule } from "@/lib/assets-types"
import { shouldShowPlantBreakdown } from "@/lib/dashboard-utils"

export function AssetDashboard({ data }: { data: AssetsDashboardModule }) {
  const showPlantBreakdown = shouldShowPlantBreakdown(data.by_plant)

  const stats = [
    { label: "Total assets", value: data.total_assets },
    { label: "Active assets", value: data.active_assets },
    { label: "RFID tagged", value: data.rfid_tagged, hint: "Eligible for verification" },
    { label: "Added (7 days)", value: data.recently_added },
  ]

  return (
    <DashboardPanel
      title="Asset register"
      description={`${data.active_assets} active assets across the organisation.`}
      action={{ label: "Open register", to: "/dashboard/assets" }}
    >
      <KpiGrid>
        {stats.map((s) => (
          <KpiCard key={s.label} label={s.label} value={s.value} hint={s.hint} accent />
        ))}
      </KpiGrid>

      <DashboardChartGrid columns={showPlantBreakdown ? 2 : 1}>
        <ChartPanel title="Assets by category">
          <DashboardBarChart
            data={data.by_category}
            xKey="category"
            xAngle={-18}
            xHeight={44}
            series={[{ dataKey: "count" }]}
            emptyMessage="No assets yet"
          />
        </ChartPanel>

        {showPlantBreakdown ? (
          <ChartPanel title="Assets by plant">
            <DashboardBarChart
              data={data.by_plant}
              xKey="plant"
              series={[{ dataKey: "count" }]}
              emptyMessage="No plant data"
            />
          </ChartPanel>
        ) : null}
      </DashboardChartGrid>
    </DashboardPanel>
  )
}
