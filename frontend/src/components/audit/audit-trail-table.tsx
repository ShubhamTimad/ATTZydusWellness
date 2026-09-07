import * as React from "react"

import {
  AdminPanel,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
} from "@/components/layout/admin-ui"
import { AdminTableBodyRow } from "@/components/layout/list-page-ui"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { formatAppWhenParts } from "@/lib/dates"
import { cn } from "@/lib/utils"

export type AuditTrailRow = {
  id: string
  at: string
  by: string
  activity: React.ReactNode
}

export function formatWhenParts(iso: string): { date: string; time: string } {
  return formatAppWhenParts(iso)
}

export function WhenCell({ at, muted }: { at: string; muted?: boolean }) {
  if (!at.trim()) {
    return <span className="text-xs text-muted-foreground">Now</span>
  }
  const { date, time } = formatWhenParts(at)
  if (muted) {
    return (
      <span className="text-muted-foreground/40" aria-hidden>
        ·
      </span>
    )
  }
  return (
    <div className="tabular-nums leading-tight">
      <div className="text-xs text-foreground">{date}</div>
      {time ? <div className="mt-0.5 text-[11px] text-muted-foreground">{time}</div> : null}
    </div>
  )
}

const cellClass = "px-2.5 py-2.5 align-top whitespace-normal xl:px-4"
const headClass = "px-2.5 py-2.5 xl:px-4"

export function AuditTrailTable({
  rows,
  loading,
  emptyDescription = "No audit events recorded yet.",
  loadingLabel = "Loading audit trail…",
  descriptionFallback,
  fillHeight = false,
  className,
}: {
  rows: AuditTrailRow[]
  loading?: boolean
  emptyDescription?: string
  loadingLabel?: string
  /** Shown when there are no rows and not loading (panel description). */
  descriptionFallback?: string
  /** Grow to fill remaining column height; table body scrolls inside the panel. */
  fillHeight?: boolean
  className?: string
}) {
  return (
    <AdminPanel
      title="Audit Trail"
      description={
        rows.length > 0
          ? `${rows.length} ${rows.length === 1 ? "Entry" : "Entries"}`
          : (descriptionFallback ?? emptyDescription)
      }
      contentClassName={cn("p-0", fillHeight && "flex min-h-0 flex-1 flex-col")}
      className={cn(
        fillHeight && "flex min-h-[24rem] shrink-0 flex-1 flex-col overflow-hidden",
        className,
      )}
    >
      {loading ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{loadingLabel}</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">{emptyDescription}</p>
      ) : (
        <div
          className={cn(
            "app-data-table-wrap",
            fillHeight && "overscroll-y-contain",
            fillHeight ? "min-h-0 flex-1" : "min-h-[14rem] max-h-[min(22rem,48vh)]",
          )}
        >
          <Table className="app-table-head-sticky w-full table-fixed">
            <TableHeader>
              <AdminTableHeaderRow className="bg-muted/30 hover:bg-muted/30">
                <AdminTableHeadCell className={cn(headClass, "w-[9.5rem] !text-black")}>
                  Date / Time
                </AdminTableHeadCell>
                <AdminTableHeadCell className={cn(headClass, "w-[12rem] !text-black")}>
                  User
                </AdminTableHeadCell>
                <AdminTableHeadCell className={cn(headClass, "!text-black")}>Event</AdminTableHeadCell>
              </AdminTableHeaderRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <AdminTableBodyRow
                  key={row.id}
                  interactive={false}
                  className={cn("border-border/40", index % 2 === 1 && "bg-muted/[0.18]")}
                >
                  <AdminTableCell className={cellClass}>
                    <WhenCell at={row.at} />
                  </AdminTableCell>
                  <AdminTableCell className={cn(cellClass, "max-w-0 overflow-hidden")}>
                    <span className="break-words text-sm font-medium text-foreground">
                      {row.by}
                    </span>
                  </AdminTableCell>
                  <AdminTableCell className={cn(cellClass, "max-w-0 overflow-hidden")}>
                    <div className="min-w-0 break-words text-sm leading-snug text-foreground">
                      {row.activity}
                    </div>
                  </AdminTableCell>
                </AdminTableBodyRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AdminPanel>
  )
}
