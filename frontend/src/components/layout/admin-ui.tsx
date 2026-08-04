import * as React from "react"
import { ArrowLeft, type LucideIcon } from "lucide-react"
import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { TableCell, TableHead } from "@/components/ui/table"
import { cn } from "@/lib/utils"

/** Shared panel surface for tables, forms, and detail blocks. */
export const adminPanelClass = "app-panel"

export const adminSelectClass =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-sm transition-colors outline-none focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"

export const adminTextareaClass =
  "min-h-[120px] w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm shadow-sm transition-colors outline-none focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"

/** Compact textarea: 2 lines by default, grows with text, drag corner to enlarge. */
export const adminAutoGrowTextareaClass =
  "box-border min-h-[3rem] w-full resize-y overflow-x-hidden overflow-y-hidden rounded-lg border border-input bg-background px-3 py-1.5 text-sm leading-5 shadow-sm transition-[border-color,box-shadow] outline-none focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/15"

export function AutoGrowTextarea({
  value,
  onChange,
  className,
  minRows = 2,
  ...props
}: Omit<React.ComponentProps<"textarea">, "rows" | "onChange"> & {
  value: string
  onChange: (value: string) => void
  minRows?: number
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null)
  /** User-dragged height floor; content can still grow above it. */
  const manualMinRef = React.useRef(0)

  const syncHeight = React.useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "0px"
    const contentH = el.scrollHeight
    const next = Math.max(contentH, manualMinRef.current)
    el.style.height = `${next}px`
  }, [])

  React.useLayoutEffect(() => {
    syncHeight()
  }, [value, syncHeight])

  return (
    <textarea
      {...props}
      ref={ref}
      rows={minRows}
      value={value}
      className={cn(adminAutoGrowTextareaClass, className)}
      onChange={(e) => {
        onChange(e.target.value)
        const el = e.currentTarget
        el.style.height = "0px"
        const contentH = el.scrollHeight
        el.style.height = `${Math.max(contentH, manualMinRef.current)}px`
      }}
      onMouseUp={() => {
        const el = ref.current
        if (!el) return
        manualMinRef.current = el.offsetHeight
      }}
      onBlur={() => {
        const el = ref.current
        if (!el) return
        // Collapse back to content height when leaving the field.
        manualMinRef.current = 0
        el.style.height = "0px"
        el.style.height = `${el.scrollHeight}px`
      }}
    />
  )
}

export const adminSwitchRowClass =
  "flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/15 px-4 py-3"

/** Workspace tab bar — prefer WorkspaceTabsList from list-page-ui for list pages */
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
          {headerActions ? (
            <div className="flex shrink-0 items-center gap-2 self-start pt-0.5">{headerActions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={cn(contentClassName)}>{children}</div>
      {footer ? (
        <div className="shrink-0 border-t border-border/60 bg-muted/20 px-[var(--app-card-padding)] py-3">
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
  return <tr className={cn("hover:bg-transparent", className)}>{children}</tr>
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
        "h-auto px-5 py-3 text-[11px] font-semibold tracking-[0.08em] uppercase",
        "text-muted-foreground/85 whitespace-nowrap",
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
        "h-auto min-h-[var(--app-table-row-height)] px-5 py-3.5 align-middle text-sm leading-snug",
        className,
      )}
    >
      {children}
    </TableCell>
  )
}

export type AdminPillTone =
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "neutral"
  | "info"
  | "disposed"

const pillToneClass: Record<AdminPillTone, string> = {
  primary: "border-primary/30 bg-primary/10 text-primary",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200",
  danger: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300",
  neutral: "border-border/70 bg-muted/35 text-muted-foreground",
  info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-950/40 dark:text-sky-300",
  disposed:
    "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/40 dark:bg-violet-950/40 dark:text-violet-200",
}

/** Outline pill badge — reference-style status chips. */
export function AdminPillBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode
  tone?: AdminPillTone
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium leading-none",
        pillToneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function AdminStatusBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <span className="inline-flex items-center rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm">
        Active
      </span>
    )
  }
  return <AdminPillBadge tone="neutral">Inactive</AdminPillBadge>
}

export function AdminRowActions({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("inline-flex items-center justify-end gap-0.5", className)}>{children}</div>
  )
}

export function AdminRowAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  className,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={disabled}
      className={cn(
        "h-8 gap-1.5 px-2.5 font-normal text-foreground/75 hover:bg-muted/50 hover:text-foreground",
        className,
      )}
      onClick={onClick}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label}
    </Button>
  )
}

/** Stacked primary + secondary line — e.g. name + email. */
export function AdminTablePrimaryCell({
  primary,
  secondary,
  onPrimaryClick,
  className,
}: {
  primary: React.ReactNode
  secondary?: React.ReactNode
  onPrimaryClick?: () => void
  className?: string
}) {
  const primaryNode = onPrimaryClick ? (
    <button
      type="button"
      className="block max-w-[16rem] truncate text-left text-sm font-semibold text-foreground transition-colors hover:text-primary"
      onClick={onPrimaryClick}
    >
      {primary}
    </button>
  ) : (
    <span className="block max-w-[16rem] truncate text-sm font-semibold text-foreground">{primary}</span>
  )

  return (
    <div className={cn("min-w-0", className)}>
      {primaryNode}
      {secondary ? (
        <div className="mt-0.5 max-w-[16rem] truncate text-xs text-muted-foreground">{secondary}</div>
      ) : null}
    </div>
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
