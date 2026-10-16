import * as React from "react"

import { API_BASE_URL, getJson } from "@/lib/api"
import { cn } from "@/lib/utils"

/** Shown wherever the logo goes until an admin uploads one in Settings. */
export const LOGO_PLACEHOLDER_TEXT = "Your Logo"

const LOGO_VERSION_KEY = "auth.brandLogo.version"
const LOGO_CHANGED = "att:brand-logo-changed"

type BrandLogoMeta = {
  configured: boolean
  version: string | null
}

function brandLogoUrl(version: string | null | undefined): string | null {
  if (!version) return null
  const base = API_BASE_URL.replace(/\/+$/, "")
  return `${base}/auth/brand-logo?v=${encodeURIComponent(version)}`
}

function readStoredBrandLogoVersion() {
  try {
    return sessionStorage.getItem(LOGO_VERSION_KEY)
  } catch {
    return null
  }
}

export function writeStoredBrandLogoVersion(version: string | null) {
  try {
    if (version) sessionStorage.setItem(LOGO_VERSION_KEY, version)
    else sessionStorage.removeItem(LOGO_VERSION_KEY)
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(LOGO_CHANGED))
}

export function currentBrandLogoSrc() {
  return brandLogoUrl(readStoredBrandLogoVersion())
}

export function BrandLogoPlaceholder({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md border border-dashed border-muted-foreground/50",
        "px-2 text-center text-xs leading-tight font-semibold tracking-wide text-muted-foreground uppercase",
        className,
      )}
    >
      {LOGO_PLACEHOLDER_TEXT}
    </span>
  )
}

export function useBrandLogoSrc() {
  const [src, setSrc] = React.useState(() => brandLogoUrl(readStoredBrandLogoVersion()))

  React.useEffect(() => {
    let cancelled = false

    function apply(version: string | null) {
      if (!cancelled) setSrc(brandLogoUrl(version))
    }

    function onChanged() {
      apply(readStoredBrandLogoVersion())
    }

    window.addEventListener(LOGO_CHANGED, onChanged)
    void getJson<BrandLogoMeta>("/auth/brand-logo/meta")
      .then((meta) => {
        const version = meta.configured ? meta.version : null
        if (version !== readStoredBrandLogoVersion()) {
          writeStoredBrandLogoVersion(version)
        }
        apply(version)
      })
      .catch(() => {
        apply(readStoredBrandLogoVersion())
      })

    return () => {
      cancelled = true
      window.removeEventListener(LOGO_CHANGED, onChanged)
    }
  }, [])

  return src
}

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
  const src = useBrandLogoSrc()
  const logo = src ? (
    <img
      src={src}
      alt="Logo"
      className={cn(
        logoHeights[size],
        collapsed ? "mx-auto w-auto max-w-[3.5rem] object-contain" : cn("mx-auto w-auto object-contain", logoWidths[size]),
      )}
    />
  ) : (
    <BrandLogoPlaceholder
      className={cn(
        logoHeights[size],
        collapsed ? "mx-auto flex max-w-[3.5rem] text-[9px]" : cn("mx-auto flex min-w-24", logoWidths[size]),
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
            "truncate font-bold uppercase tracking-[0.16em]",
            subtitleSizes[size],
            onDark ? "text-white/60" : "text-foreground",
          )}
        >
          Asset Tagging & Tracking
        </p>
      ) : null}
    </div>
  )
}
