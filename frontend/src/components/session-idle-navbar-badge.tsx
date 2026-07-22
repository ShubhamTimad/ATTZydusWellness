import { Timer } from "lucide-react"

import {
  formatIdleCountdown,
  useSessionIdle,
} from "@/context/session-idle-context"
import { cn } from "@/lib/utils"

export function SessionIdleNavbarBadge() {
  const { remainingSeconds, isTabHidden } = useSessionIdle()

  if (remainingSeconds === null) return null

  const urgent = remainingSeconds <= 120
  const critical = remainingSeconds <= 30

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums",
        critical
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : urgent
            ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
            : "border-border/80 bg-muted/40 text-muted-foreground",
      )}
      title={
        isTabHidden
          ? "Session expires while this tab is in the background"
          : "Time until automatic sign-out due to inactivity"
      }
      aria-live="polite"
      aria-label={`Session expires in ${formatIdleCountdown(remainingSeconds)}`}
    >
      <Timer className="size-3.5 shrink-0 opacity-80" aria-hidden />
      <span className="hidden sm:inline">{isTabHidden ? "Background" : ""}</span>
      <span>{formatIdleCountdown(remainingSeconds)}</span>
    </div>
  )
}
