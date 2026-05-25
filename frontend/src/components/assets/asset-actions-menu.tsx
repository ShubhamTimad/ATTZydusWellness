import * as React from "react"
import { ChevronDown, MoreHorizontal } from "lucide-react"

import type { AssetActionItem } from "@/lib/asset-actions"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

type AssetActionsMenuProps = {
  actions: AssetActionItem[]
  selectedCount?: number
  onAction: (actionId: string) => void
  busy?: boolean
  triggerLabel?: string
  className?: string
}

export function AssetActionsMenu({
  actions,
  selectedCount,
  onAction,
  busy = false,
  triggerLabel = "Actions",
  className,
}: AssetActionsMenuProps) {
  const [open, setOpen] = React.useState(false)

  if (actions.length === 0) return null

  const label =
    selectedCount != null && selectedCount > 0
      ? `${triggerLabel} (${selectedCount})`
      : triggerLabel

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("shrink-0 gap-1.5", className)}
          disabled={busy}
        >
          <MoreHorizontal className="size-4" aria-hidden />
          {label}
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Choose an action
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {actions.map((action, index) => {
          const Icon = action.icon
          const showSeparatorBefore =
            action.variant === "destructive" &&
            index > 0 &&
            actions[index - 1]?.variant !== "destructive"

          return (
            <React.Fragment key={action.id}>
              {showSeparatorBefore ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                variant={action.variant}
                disabled={Boolean(action.disabled) || busy}
                onSelect={(e) => {
                  e.preventDefault()
                  if (action.disabled || busy) return
                  setOpen(false)
                  onAction(action.id)
                }}
              >
                {Icon ? <Icon className="size-4" aria-hidden /> : null}
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span>{action.label}</span>
                  {action.hint ? (
                    <span className="text-[11px] font-normal text-muted-foreground">{action.hint}</span>
                  ) : null}
                </span>
              </DropdownMenuItem>
            </React.Fragment>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
