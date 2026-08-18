import { Skeleton } from "@/components/ui/skeleton"

function StripSkeleton() {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3.5 w-[3px] rounded-full" />
        <Skeleton className="h-3 w-14" />
      </div>
      <Skeleton className="mt-2.5 h-6 w-20" />
      <Skeleton className="mt-2 h-3 w-24" />
    </div>
  )
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card px-5 py-5">
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-5 rounded" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="mt-5 flex">
        <Skeleton className="h-10 w-12" />
        <Skeleton className="mx-4 h-10 w-px flex-none" />
        <Skeleton className="h-10 w-12" />
        <Skeleton className="mx-4 h-10 w-px flex-none" />
        <Skeleton className="h-10 w-12" />
        <Skeleton className="mx-4 h-10 w-px flex-none" />
        <Skeleton className="h-10 w-12" />
      </div>
      <Skeleton className="mx-auto mt-8 h-28 w-64 rounded-t-full" />
    </div>
  )
}

export function DashboardLoading() {
  return (
    <>
      <div className="grid shrink-0 grid-cols-2 divide-x divide-border overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-3 xl:grid-cols-5">
        <StripSkeleton />
        <StripSkeleton />
        <StripSkeleton />
        <StripSkeleton />
        <StripSkeleton />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PanelSkeleton />
        <PanelSkeleton />
        <PanelSkeleton />
        <PanelSkeleton />
        <PanelSkeleton />
        <PanelSkeleton />
      </div>
    </>
  )
}
