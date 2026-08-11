import { DashboardDonutChart } from "@/components/dashboard/dashboard-charts"
import { DASHBOARD_STATUS, type DashboardPanelTheme } from "@/components/dashboard/dashboard-theme"
import { DashboardPanel, StatBreakdown } from "@/components/dashboard/dashboard-kpi"

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

const COLORS = {
  inProgress: DASHBOARD_STATUS.progress,
  closed: DASHBOARD_STATUS.complete,
  rejected: DASHBOARD_STATUS.rejected,
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
  const closed = data.closed
  const rejected = data.rejected
  const inProgress = Math.max(0, data.total - closed - rejected)
  const total = data.total || 1
  const mix = [
    { name: "In progress", value: inProgress },
    { name: "Closed", value: closed },
    { name: "Rejected", value: rejected },
  ]

  return (
    <DashboardPanel title={title} theme={theme}>
      <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_10.5rem]">
        <div className="min-w-0 space-y-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total order</p>
            <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-foreground">{data.total}</p>
          </div>
          <StatBreakdown
            items={[
              {
                label: "In progress",
                value: inProgress,
                share: (inProgress / total) * 100,
                color: COLORS.inProgress,
              },
              {
                label: "Closed",
                value: closed,
                share: (closed / total) * 100,
                color: COLORS.closed,
              },
              {
                label: "Rejected",
                value: rejected,
                share: (rejected / total) * 100,
                color: COLORS.rejected,
              },
            ]}
          />
        </div>

        <DashboardDonutChart
          data={mix}
          colors={[COLORS.inProgress, COLORS.closed, COLORS.rejected]}
          emptyMessage="No orders yet"
          height={168}
          showLegend={false}
        />
      </div>
    </DashboardPanel>
  )
}
