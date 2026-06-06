import { Skeleton } from "@/components/ui/skeleton"

function PanelSkeleton({ kpiCount = 4, chartCount = 1 }: { kpiCount?: number; chartCount?: 1 | 2 }) {
  return (
    <div className="app-panel">
      <div className="app-panel-header">
        <div className="space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="app-dashboard-panel-body">
        <div className="app-grid app-grid-kpi">
          {Array.from({ length: kpiCount }).map((_, i) => (
            <Skeleton key={i} className="h-[5.5rem] rounded-[var(--app-radius-surface)]" />
          ))}
        </div>
        <div className={chartCount === 2 ? "app-grid app-grid-2" : undefined}>
          {Array.from({ length: chartCount }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-[var(--app-radius-surface)]" />
          ))}
        </div>
      </div>
    </div>
  )
}

export function DashboardLoading() {
  return (
    <div className="flex flex-col gap-[var(--app-section-gap)]">
      <div className="app-grid app-grid-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[5.5rem] rounded-[var(--app-radius-surface)]" />
        ))}
      </div>
      <PanelSkeleton kpiCount={7} chartCount={1} />
      <PanelSkeleton kpiCount={4} chartCount={1} />
      <PanelSkeleton kpiCount={3} chartCount={1} />
    </div>
  )
}
