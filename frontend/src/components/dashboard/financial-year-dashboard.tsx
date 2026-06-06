import { DashboardBarChart, DashboardChartGrid, ChartPanel, PENDING_COLOR } from "@/components/dashboard/dashboard-charts"
import { CoverageBar, DashboardPanel, KpiCard, KpiGrid } from "@/components/dashboard/dashboard-kpi"
import type { FinancialYearDashboardModule } from "@/lib/assets-types"
import { BRAND_COLOR } from "@/lib/brand"
import { shouldShowPlantBreakdown } from "@/lib/dashboard-utils"

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString()
}

export function FinancialYearDashboard({ data }: { data: FinancialYearDashboardModule }) {
  const showPlantBreakdown = shouldShowPlantBreakdown(data.by_plant)
  const periodLabel = `${formatDate(data.start)} – ${formatDate(data.end)}`

  const stats = [
    { label: "Verified this FY", value: data.verified_in_fy, hint: data.label },
    { label: "Pending verification", value: data.pending_fy_verification, hint: "RFID assets not yet verified" },
    { label: "Coverage", value: `${data.coverage_pct}%`, hint: `${data.verified_in_fy} of ${data.total_rfid_assets} assets` },
  ]

  return (
    <DashboardPanel
      title={`Financial year tagging · ${data.label}`}
      description={`Verification window ${periodLabel}. Assets scanned in this period count as tagged for the current financial year.`}
      action={{ label: "Open register", to: "/dashboard/assets" }}
    >
      <CoverageBar value={data.coverage_pct} />

      <KpiGrid>
        {stats.map((s) => (
          <KpiCard key={s.label} label={s.label} value={s.value} hint={s.hint} accent />
        ))}
      </KpiGrid>

      {showPlantBreakdown ? (
        <DashboardChartGrid columns={1}>
          <ChartPanel
            title="FY verification by plant"
            description="Verified vs pending RFID assets per plant."
          >
            <DashboardBarChart
              data={data.by_plant}
              xKey="plant"
              height={224}
              series={[
                { dataKey: "verified", name: "Verified", stackId: "fy", fill: BRAND_COLOR, radius: [0, 0, 0, 0] },
                { dataKey: "pending", name: "Pending", stackId: "fy", fill: PENDING_COLOR, radius: [4, 4, 0, 0] },
              ]}
              emptyMessage="No RFID assets to verify"
            />
          </ChartPanel>
        </DashboardChartGrid>
      ) : null}
    </DashboardPanel>
  )
}
