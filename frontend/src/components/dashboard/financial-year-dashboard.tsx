import { DashboardDonutChart } from "@/components/dashboard/dashboard-charts"
import { DASHBOARD_STATUS, DASHBOARD_THEMES } from "@/components/dashboard/dashboard-theme"
import { DashboardPanel, StatBreakdown } from "@/components/dashboard/dashboard-kpi"
import type { FinancialYearDashboardModule } from "@/lib/assets-types"

const COLORS = {
  verified: DASHBOARD_STATUS.complete,
  pending: DASHBOARD_STATUS.rest,
}

export function FinancialYearDashboard({ data }: { data: FinancialYearDashboardModule }) {
  const theme = DASHBOARD_THEMES.fy
  const total = data.total_rfid_assets || 1
  const mix = [
    { name: "Total verified asset", value: data.verified_in_fy },
    { name: "Pending", value: data.pending_fy_verification },
  ]

  return (
    <DashboardPanel title={`Physical Verification · ${data.label}`} theme={theme}>
      <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_10.5rem]">
        <div className="min-w-0 space-y-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Percentage verification
            </p>
            <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-foreground">
              {data.coverage_pct}%
            </p>
          </div>
          <StatBreakdown
            items={[
              {
                label: "Total approved asset",
                value: data.total_rfid_assets,
                share: 100,
                color: COLORS.pending,
              },
              {
                label: "Total verified asset",
                value: data.verified_in_fy,
                share: (data.verified_in_fy / total) * 100,
                color: COLORS.verified,
              },
            ]}
          />
        </div>

        <DashboardDonutChart
          data={mix}
          colors={[COLORS.verified, COLORS.pending]}
          emptyMessage="No RFID assets"
          height={168}
          showLegend={false}
        />
      </div>
    </DashboardPanel>
  )
}
