import { cn } from "@/lib/utils"

/** Official Takeda logo served from `frontend/public/logo.png`. */
export const TAKEDA_LOGO_SRC = "/logo.png"

type AppBrandMarkProps = {
  className?: string
  /** Compact treatment for collapsed sidebar. */
  collapsed?: boolean
  /** Show product subtitle under the logo. */
  showSubtitle?: boolean
  size?: "sm" | "md" | "lg"
  /** Use light panel behind logo on dark marketing backgrounds. */
  onDark?: boolean
}

const logoHeights = {
  sm: "h-8",
  md: "h-9",
  lg: "h-11",
} as const

const logoWidths = {
  sm: "max-w-[108px]",
  md: "max-w-[128px]",
  lg: "max-w-[156px]",
} as const

const subtitleSizes = {
  sm: "text-[9px]",
  md: "text-[10px]",
  lg: "text-[11px]",
} as const

export function AppBrandMark({
  className,
  collapsed = false,
  showSubtitle = true,
  size = "md",
  onDark = false,
}: AppBrandMarkProps) {
  const logo = (
    <img
      src={TAKEDA_LOGO_SRC}
      alt="Takeda"
      className={cn(
        logoHeights[size],
        collapsed ? "mx-auto w-auto max-w-[3.5rem] object-contain" : cn("mx-auto w-auto object-contain", logoWidths[size]),
      )}
    />
  )

  if (collapsed) {
    return <div className={cn(onDark && "rounded-md bg-white px-1.5 py-1", className)}>{logo}</div>
  }

  return (
    <div className={cn("flex min-w-0 flex-col items-center gap-1.5 text-center", className)}>
      <div className={cn(onDark && "inline-flex w-fit rounded-lg bg-white px-3 py-2 shadow-sm")}>{logo}</div>
      {showSubtitle ? (
        <p
          className={cn(
            "truncate font-semibold uppercase tracking-[0.16em]",
            subtitleSizes[size],
            onDark ? "text-white/60" : "text-muted-foreground",
          )}
        >
          Asset Tracking
        </p>
      ) : null}
    </div>
  )
}
