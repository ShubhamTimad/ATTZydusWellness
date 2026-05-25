import * as React from "react"
import { ArrowLeft } from "lucide-react"
import { Link } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableCell, TableHead, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

/** Shared panel surface for tables, forms, and detail blocks. */
export const adminPanelClass = "app-panel"

export const adminSelectClass =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-sm transition-colors outline-none focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"

export const adminTextareaClass =
  "min-h-[120px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm shadow-sm transition-colors outline-none focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"

export const adminSwitchRowClass =
  "flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/15 px-4 py-3"

/** Workspace tab bar — compact, no stretched triggers */
export const adminTabsListClass =
  "h-auto min-h-10 w-fit max-w-full flex-wrap gap-1 rounded-[var(--app-radius-surface)] border border-border/70 bg-muted/35 p-1"

export const adminTabsTriggerClass = "h-8 shrink-0 px-3.5"

export function AdminPanel({
  title,
  description,
  headerActions,
  children,
  footer,
  className,
  contentClassName,
}: {
  title?: string
  description?: string
  headerActions?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <div className={cn(adminPanelClass, className)}>
      {title || description || headerActions ? (
        <div className="app-panel-header">
          <div className="min-w-0">
            {title ? <h3 className="app-panel-title">{title}</h3> : null}
            {description ? (
              <p className={cn("app-panel-description", title && "mt-1")}>{description}</p>
            ) : null}
          </div>
          {headerActions ? <div className="flex shrink-0 items-center gap-2">{headerActions}</div> : null}
        </div>
      ) : null}
      <div className={cn(contentClassName)}>{children}</div>
      {footer ? (
        <div className="border-t border-border/60 bg-muted/20 px-[var(--app-card-padding)] py-3 text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </div>
  )
}

export function AdminTableHeaderRow({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <TableRow
      className={cn(
        "border-b border-border/70 bg-muted/30 hover:bg-muted/30",
        className,
      )}
    >
      {children}
    </TableRow>
  )
}

export function AdminTableHeadCell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <TableHead
      className={cn(
        "h-11 px-4 text-xs font-semibold tracking-wide text-muted-foreground",
        className,
      )}
    >
      {children}
    </TableHead>
  )
}

export function AdminTableCell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <TableCell
      className={cn(
        "h-[var(--app-table-row-height)] px-4 py-0 align-middle text-sm",
        className,
      )}
    >
      {children}
    </TableCell>
  )
}

export function AdminStatusBadge({ active }: { active: boolean }) {
  return (
    <Badge
      variant={active ? "default" : "secondary"}
      className={cn(
        "rounded-md px-2.5 font-medium",
        !active && "border-border/80 bg-muted text-muted-foreground",
      )}
    >
      {active ? "Active" : "Inactive"}
    </Badge>
  )
}

export function AdminDetailGrid({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <dl className={cn("grid gap-4 sm:grid-cols-2", className)}>{children}</dl>
}

export function AdminDetailField({
  label,
  value,
  className,
}: {
  label: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 text-sm font-medium leading-snug text-foreground">{value}</dd>
    </div>
  )
}

export function AdminBackLink({ to, children = "Back" }: { to: string; children?: React.ReactNode }) {
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={to}>
        <ArrowLeft className="size-4" aria-hidden />
        {children}
      </Link>
    </Button>
  )
}

export function AdminPrimaryButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return <Button size="sm" className={cn(className)} {...props} />
}

export function AdminDangerButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      size="sm"
      className={cn(
        "bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:ring-red-600/30",
        className,
      )}
      {...props}
    />
  )
}

/** Centered empty row for data tables */
export function AdminTableEmptyRow({
  colSpan,
  children,
}: {
  colSpan: number
  children: React.ReactNode
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="app-empty-state">
        {children}
      </td>
    </tr>
  )
}
