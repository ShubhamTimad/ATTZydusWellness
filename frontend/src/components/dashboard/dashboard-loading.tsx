import { Skeleton } from "@/components/ui/skeleton"

function PanelSkeleton() {
  return (
    <div className="app-panel flex h-full min-h-[12rem] flex-col overflow-hidden">
      <Skeleton className="h-1 w-full shrink-0 rounded-none" />
      <div className="app-panel-header shrink-0">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="app-dashboard-panel-body flex flex-1 flex-col justify-center">
        <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_10.5rem]">
          <div className="space-y-4">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-10 w-20" />
            <div className="space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          </div>
          <Skeleton className="mx-auto size-[10.5rem] rounded-full" />
        </div>
      </div>
    </div>
  )
}

export function DashboardLoading() {
  return (
    <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 [&>*:last-child:nth-child(odd)]:sm:col-span-2">
      <PanelSkeleton />
      <PanelSkeleton />
      <PanelSkeleton />
      <PanelSkeleton />
    </div>
  )
}
