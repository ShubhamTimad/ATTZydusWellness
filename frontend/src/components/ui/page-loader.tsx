import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

export function PageLoader({
  className,
  compact = false,
}: {
  /** Ignored. The caption is always "Loading". */
  label?: string
  className?: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        compact ? "py-6" : "min-h-[16rem] w-full flex-1",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading"
    >
      <Loader2 className="size-7 animate-spin text-primary" aria-hidden />
      <p className="text-sm font-medium text-muted-foreground">Loading</p>
    </div>
  )
}

export function ScreenLoader() {
  return (
    <div className="flex h-svh w-full items-center justify-center bg-background">
      <PageLoader className="min-h-0 flex-none" />
    </div>
  )
}
