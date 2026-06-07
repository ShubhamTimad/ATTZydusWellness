import { Skeleton } from "@/components/ui/skeleton"

function HeroSkeleton() {
  return (
    <div className="app-grid app-grid-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-[9.5rem] rounded-[var(--app-radius-surface)]" />
      ))}
    </div>
  )
}

function PanelSkeleton({ kpiCount = 4, chartCount = 0 }: { kpiCount?: number; chartCount?: 0 | 1 | 2 }) {
  return (
    <div className="app-panel overflow-hidden">
      <Skeleton className="h-1 w-full rounded-none" />
      <div className="app-panel-header">
        <div className="flex items-start gap-3">
          <Skeleton className="size-10 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
      <div className="app-dashboard-panel-body">
        <div className="app-grid app-grid-kpi">
          {Array.from({ length: kpiCount }).map((_, i) => (
            <Skeleton key={i} className="h-[5.5rem] rounded-[var(--app-radius-surface)]" />
          ))}
        </div>
        {chartCount > 0 ? (
          <div className={chartCount === 2 ? "app-grid app-grid-2" : undefined}>
            {Array.from({ length: chartCount }).map((_, i) => (
              <Skeleton key={i} className="h-52 rounded-[var(--app-radius-surface)]" />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function DashboardLoading() {
  return (
    <div className="flex flex-col gap-[var(--app-section-gap)]">
      <HeroSkeleton />
      <PanelSkeleton kpiCount={4} chartCount={2} />
      <div className="grid gap-[var(--app-section-gap)] xl:grid-cols-2">
        <PanelSkeleton kpiCount={3} />
        <PanelSkeleton kpiCount={4} chartCount={1} />
      </div>
    </div>
  )
}
