import { DashboardInsightCard } from "@/components/dashboard/dashboard-insight-card"
import { dashboardPct, type DashboardPanelTheme } from "@/components/dashboard/dashboard-theme"

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

export function workflowInsightParts(data: WorkflowOrdersModule) {
  const total = Math.max(0, data.total)
  const closed = Math.max(0, data.closed + data.rejected)
  const inProgress = Math.max(0, total - closed)
  return { total, closed, inProgress, open: inProgress }
}

export function WorkflowOrdersDashboard({
  title,
  theme,
  data,
  openColor,
  closedColor,
}: {
  title: string
  theme: DashboardPanelTheme
  data: WorkflowOrdersModule
  openColor: string
  closedColor: string
}) {
  const parts = workflowInsightParts(data)
  const inProgressPct = dashboardPct(parts.inProgress, parts.total)
  const slices = [
    { name: "In progress", value: parts.inProgress, color: openColor },
    { name: "Closed", value: parts.closed, color: closedColor },
  ]

  return (
    <DashboardInsightCard
      title={title}
      icon={theme.icon}
      iconWrap={theme.iconWrap}
      metrics={[
        { value: parts.total, label: "Total" },
        { value: parts.inProgress, label: "In progress" },
        { value: parts.closed, label: "Closed" },
      ]}
      slices={slices}
      centerLabel={`${inProgressPct}%`}
      centerCaption="In progress"
    />
  )
}
