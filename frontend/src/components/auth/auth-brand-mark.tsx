import { cn } from "@/lib/utils"

type AuthBrandMarkProps = {
  className?: string
  /** Show product subtitle under the wordmark. */
  showSubtitle?: boolean
  size?: "sm" | "md" | "lg"
}

const sizeStyles = {
  sm: { mark: "size-9", title: "text-lg", subtitle: "text-[11px]" },
  md: { mark: "size-11", title: "text-xl", subtitle: "text-xs" },
  lg: { mark: "size-14", title: "text-3xl", subtitle: "text-sm" },
} as const

export function AuthBrandMark({
  className,
  showSubtitle = true,
  size = "md",
}: AuthBrandMarkProps) {
  const s = sizeStyles[size]

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          "relative flex shrink-0 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/25 ring-1 ring-white/10",
          s.mark,
        )}
        aria-hidden
      >
        <svg viewBox="0 0 32 32" className="size-[58%] text-primary-foreground" fill="currentColor">
          <path d="M8 22V10h3.2l4.8 7.4V10H19v12h-3.1l-4.9-7.6V22H8z" />
        </svg>
      </div>
      <div className="min-w-0">
        <p className={cn("font-semibold tracking-tight text-white", s.title)}>Takeda</p>
        {showSubtitle ? (
          <p className={cn("font-medium tracking-wide text-white/65 uppercase", s.subtitle)}>
            Asset Tracking
          </p>
        ) : null}
      </div>
    </div>
  )
}
