import { AppBrandMark } from "@/components/layout/app-brand-mark"

type AuthBrandMarkProps = {
  className?: string
  /** Show product subtitle under the logo. */
  showSubtitle?: boolean
  size?: "sm" | "md" | "lg"
  /** Use white logo treatment on dark marketing panels. */
  onDark?: boolean
}

export function AuthBrandMark({
  className,
  showSubtitle = true,
  size = "md",
  onDark = false,
}: AuthBrandMarkProps) {
  return (
    <AppBrandMark
      className={className}
      showSubtitle={showSubtitle}
      size={size}
      onDark={onDark}
    />
  )
}
