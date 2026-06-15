import * as React from "react"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type MobileNavDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  header?: React.ReactNode
  className?: string
  ariaLabel?: string
}

export function MobileNavDrawer({
  open,
  onOpenChange,
  children,
  header,
  className,
  ariaLabel = "Navigation menu",
}: MobileNavDrawerProps) {
  React.useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false)
    }
    document.addEventListener("keydown", onKeyDown)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = prev
    }
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/45 supports-backdrop-filter:backdrop-blur-sm"
        aria-label="Close navigation menu"
        onClick={() => onOpenChange(false)}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={cn(
          "absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] max-w-full flex-col border-r border-border/80 bg-card shadow-xl",
          className,
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border/70 px-3">
          <div className="min-w-0 flex-1">{header}</div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close navigation menu"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </aside>
    </div>
  )
}
