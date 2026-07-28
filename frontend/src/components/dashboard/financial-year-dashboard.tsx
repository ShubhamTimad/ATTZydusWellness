import { CalendarRange, ScanLine, ShieldCheck, Timer } from "lucide-react"

import { DashboardBarChart, DashboardChartGrid, ChartPanel, PENDING_COLOR } from "@/components/dashboard/dashboard-charts"
import { DASHBOARD_THEMES } from "@/components/dashboard/dashboard-theme"
import { CoverageBar, DashboardPanel, KpiCard, KpiGrid } from "@/components/dashboard/dashboard-kpi"
import type { FinancialYearDashboardModule } from "@/lib/assets-types"
import { BRAND_COLOR } from "@/lib/brand"
import { shouldShowPlantBreakdown } from "@/lib/dashboard-utils"

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString()
}

export function FinancialYearDashboard({ data }: { data: FinancialYearDashboardModule }) {
  const theme = DASHBOARD_THEMES.fy
  const showPlantBreakdown = shouldShowPlantBreakdown(data.by_plant)
  const periodLabel = `${formatDate(data.start)} – ${formatDate(data.end)}`

  return (
    <DashboardPanel
      title={`Physical Verification · ${data.label}`}
      description={`Scan window ${periodLabel}`}
      theme={theme}
    >
      <CoverageBar value={data.coverage_pct} label="FY verification coverage" tone="emerald" />

      <KpiGrid className="sm:grid-cols-2">
        <KpiCard
          label="Verified this FY"
          value={data.verified_in_fy}
          hint={data.label}
          icon={ShieldCheck}
          tint={theme.kpiTint}
          accent
        />
        <KpiCard
          label="Verification scans"
          value={data.total_fy_verification_events}
          hint="RFID scans recorded"
          icon={ScanLine}
          tint={theme.kpiTint}
          accent
        />
        <KpiCard
          label="Pending verification"
          value={data.pending_fy_verification}
          hint="Not yet verified"
          icon={Timer}
          tint={theme.kpiTint}
        />
        <KpiCard
          label="RFID assets"
          value={data.total_rfid_assets}
          hint={`${data.coverage_pct}% coverage`}
          icon={CalendarRange}
          tint={theme.kpiTint}
        />
      </KpiGrid>

      {showPlantBreakdown ? (
        <DashboardChartGrid columns={1}>
          <ChartPanel
            title="Verification by plant"
            description="Verified vs pending RFID assets."
          >
            <DashboardBarChart
              data={data.by_plant}
              xKey="plant"
              height={200}
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
