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
      <DropdownMenuContent align="end" className="w-72 overflow-visible p-1.5">
        <DropdownMenuLabel className="px-2.5 py-2 text-xs font-normal text-muted-foreground">
          Choose an Action
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-1" />
        {actions.map((action, index) => {
          const Icon = action.icon
          const isDisabled = Boolean(action.disabled) || busy
          const showSeparatorBefore =
            action.variant === "destructive" &&
            index > 0 &&
            actions[index - 1]?.variant !== "destructive"

          return (
            <React.Fragment key={action.id}>
              {showSeparatorBefore ? <DropdownMenuSeparator className="my-1.5" /> : null}
              <DropdownMenuItem
                variant={action.variant}
                disabled={isDisabled}
                className="gap-2.5 px-2.5 py-2.5"
                onSelect={(e) => {
                  e.preventDefault()
                  if (isDisabled) return
                  setOpen(false)
                  onAction(action.id)
                }}
              >
                {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
                <span>{action.label}</span>
              </DropdownMenuItem>
            </React.Fragment>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
