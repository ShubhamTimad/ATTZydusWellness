import { DashboardBarChart, DashboardChartGrid, ChartPanel } from "@/components/dashboard/dashboard-charts"
import { DashboardPanel, KpiCard, KpiGrid } from "@/components/dashboard/dashboard-kpi"
import type { OrdersDashboardModule } from "@/lib/orders-types"
import { shouldShowPlantBreakdown } from "@/lib/dashboard-utils"

export function OrdersDashboard({ data }: { data: OrdersDashboardModule }) {
  const showPlantBreakdown = shouldShowPlantBreakdown(data.by_plant)
  const inPipeline =
    data.pending_approval + data.assigned + data.in_progress + data.pending_closure_approval

  const stats = [
    { label: "Total orders", value: data.total_orders },
    { label: "Pending approval", value: data.pending_approval },
    { label: "Assigned", value: data.assigned },
    { label: "In progress", value: data.in_progress },
    { label: "Pending closure", value: data.pending_closure_approval },
    { label: "Completed", value: data.completed },
    { label: "Closed", value: data.closed },
  ]

  return (
    <DashboardPanel
      title="Physical verification orders"
      description={`${inPipeline} order${inPipeline === 1 ? "" : "s"} currently in the workflow.`}
      action={{ label: "Open orders", to: "/dashboard/orders" }}
    >
      <KpiGrid>
        {stats.map((s) => (
          <KpiCard key={s.label} label={s.label} value={s.value} accent />
        ))}
      </KpiGrid>

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
