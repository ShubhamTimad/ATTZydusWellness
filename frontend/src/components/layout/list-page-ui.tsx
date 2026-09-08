import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import {
  AdminPanel,
  AdminTableEmptyRow,
  AdminTableLoadingRow,
} from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export { AdminTableEmptyRow, AdminTableLoadingRow }

/** Shared page size for administration lists (users, plants, departments, roles, permissions). */
export const LIST_PAGE_SIZE = 20

export type AdminListPage<T> = {
  items: T[]
  total: number
  page: number
  page_size: number
}

/** Page title block for list screens (layout header shows nav title). */
export function ListPageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("app-list-page-header flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0 space-y-1.5">
        <h1 className="app-page-heading">{title}</h1>
        {description ? <p className="app-page-subheading max-w-2xl">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 pt-0.5">{actions}</div> : null}
    </div>
  )
}

export function WorkspaceTabs({
  className,
  ...props
}: React.ComponentProps<typeof Tabs>) {
  return <Tabs className={cn("app-tabs-shell", className)} {...props} />
}

export function WorkspaceTabsList({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className="app-tabs-bar">
      <TabsList variant="line" className={cn("h-auto w-full max-w-none gap-0 bg-transparent p-0", className)}>
        {children}
      </TabsList>
    </div>
  )
}

export function WorkspaceTabsTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      className={cn(
        "h-10 rounded-none px-4 text-sm font-medium text-muted-foreground",
        "data-active:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </TabsTrigger>
  )
}

export function WorkspaceTabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsContent>) {
  return <TabsContent className={cn("mt-0 outline-none", className)} {...props} />
}

/** Panel + scroll wrapper for data tables. */
export function AdminDataTable({
  title,
  description,
  headerActions,
  footer,
  children,
  className,
  contentClassName,
}: {
  title?: string
  description?: string
  headerActions?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <AdminPanel
      title={title}
      description={description}
      headerActions={headerActions}
      className={cn("app-data-table-card flex min-h-0 flex-col overflow-hidden", className)}
      contentClassName={cn("flex min-h-0 flex-1 flex-col overflow-hidden p-0", contentClassName)}
    >
      <div className="app-data-table-wrap min-h-0 flex-1">{children}</div>
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </AdminPanel>
  )
}

export function AdminTableBodyRow({
  className,
  interactive = true,
  onClick,
  children,
  ...props
}: React.ComponentProps<"tr"> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(
        interactive && "app-table-row-interactive",
        onClick && "cursor-pointer",
        className,
      )}
      onClick={onClick}
      {...props}
    >
      {children}
    </tr>
  )
}

export function AdminTablePagination({
  page,
  totalPages,
  total,
  onPageChange,
  itemLabel = "items",
  loading = false,
  selectedCount,
}: {
  page: number
  totalPages: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  itemLabel?: string
  loading?: boolean
  selectedCount?: number
}) {
  const pages = Math.max(1, totalPages)

  return (
    <div className="app-list-pagination shrink-0">
      <span className="inline-flex min-w-[7.5rem] items-center gap-2">
        <span>{loading ? "" : total === 0 ? `0 ${itemLabel}` : `${total} ${itemLabel}`}</span>
        {!loading && selectedCount != null && selectedCount > 0 ? (
          <span className="font-medium text-foreground">{selectedCount} selected</span>
        ) : null}
      </span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1 px-2.5"
          disabled={loading || page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          <ChevronLeft className="size-4" aria-hidden />
          Previous
        </Button>
        <span className="min-w-[5.5rem] px-2 text-center tabular-nums">
          Page {page} of {pages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1 px-2.5"
          disabled={loading || page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}
