import { CheckCircle2, ClipboardList, Loader2, ShieldCheck } from "lucide-react"

import { DashboardBarChart, DashboardChartGrid, ChartPanel } from "@/components/dashboard/dashboard-charts"
import { DASHBOARD_THEMES } from "@/components/dashboard/dashboard-theme"
import { DashboardPanel, KpiCard, KpiGrid, StatChip, StatChipRow } from "@/components/dashboard/dashboard-kpi"
import type { OrdersDashboardModule } from "@/lib/orders-types"
import { shouldShowPlantBreakdown } from "@/lib/dashboard-utils"

export function OrdersDashboard({ data }: { data: OrdersDashboardModule }) {
  const theme = DASHBOARD_THEMES.orders
  const showPlantBreakdown = shouldShowPlantBreakdown(data.by_plant)
  const inPipeline =
    data.pending_approval + data.assigned + data.in_progress + data.pending_closure_approval
  const finished = data.completed + data.closed

  return (
    <DashboardPanel
      title="Physical verification orders"
      description={`${inPipeline} in workflow · ${finished} finished`}
      theme={theme}
    >
      <KpiGrid className="lg:grid-cols-4">
        <KpiCard label="Total orders" value={data.total_orders} icon={ClipboardList} tint={theme.kpiTint} accent />
        <KpiCard label="In workflow" value={inPipeline} icon={Loader2} tint={theme.kpiTint} accent />
        <KpiCard label="Completed" value={data.completed} icon={CheckCircle2} tint={theme.kpiTint} />
        <KpiCard label="Closed" value={data.closed} icon={ShieldCheck} tint={theme.kpiTint} />
      </KpiGrid>

      <StatChipRow>
        <StatChip label="Pending approval" value={data.pending_approval} active={data.pending_approval > 0} />
        <StatChip label="Assigned" value={data.assigned} />
        <StatChip label="In progress" value={data.in_progress} active={data.in_progress > 0} />
        <StatChip label="Pending closure" value={data.pending_closure_approval} />
        <StatChip label="Rejected" value={data.rejected} />
      </StatChipRow>

      <DashboardChartGrid columns={showPlantBreakdown ? 2 : 1}>
        <ChartPanel title="Orders by status">
          <DashboardBarChart
            data={data.by_status}
            xKey="status"
            xAngle={-12}
            series={[{ dataKey: "count" }]}
            emptyMessage="No orders yet"
          />
        </ChartPanel>

        {showPlantBreakdown ? (
          <ChartPanel title="Orders by plant">
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
