import * as React from "react"

import {
  AdminPanel,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
} from "@/components/layout/admin-ui"
import { AdminTableBodyRow } from "@/components/layout/list-page-ui"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type AssetAuditLogRow = {
  id: string
  at: string
  action: string
  activityVerb: string
  actorName: string | null
  summary: string
  changes: { field_label: string; from_value: string; to_value: string }[]
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  physical_order_created: "Order created",
  physical_verification_reset: "Order created",
  physical_order_verified: "Verified",
}

const ORDER_LIFECYCLE_ACTIONS = new Set(Object.keys(ORDER_STATUS_LABELS))

type InventoryDelta = {
  physicalCount?: { from: string; to: string }
  verificationDate?: { from: string; to: string }
}

type DisplayRow = {
  id: string
  at: string
  actorName: string
  action: string
  orderRef: string | null
  status: string
  inventory: InventoryDelta
  isOrder: boolean
}

function formatWhenParts(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: iso, time: "" }
  return {
    date: d.toLocaleDateString(undefined, { dateStyle: "medium" }),
    time: d.toLocaleTimeString(undefined, { timeStyle: "short" }),
  }
}

function orderRefFromRow(row: AssetAuditLogRow): string | null {
  const text = row.summary || row.activityVerb
  const match = text.match(/\b(PVO-\d{4}-\d+)\b/i)
  return match?.[1]?.toUpperCase() ?? null
}

function parseInventoryChanges(changes: AssetAuditLogRow["changes"]): InventoryDelta {
  const inventory: InventoryDelta = {}
  for (const change of changes) {
    if (change.field_label === "Physical count") {
      inventory.physicalCount = { from: change.from_value, to: change.to_value }
    } else if (change.field_label === "Last verification date") {
      inventory.verificationDate = { from: change.from_value, to: change.to_value }
    }
  }
  return inventory
}

function activityText(row: AssetAuditLogRow): string {
  const summary = row.summary?.trim()
  if (summary) {
    let text = summary.split("\n")[0]?.trim() ?? summary
    const actor = row.actorName?.trim()
    if (actor && text.endsWith(` · ${actor}`)) {
      text = text.slice(0, -(` · ${actor}`).length)
    }
    if (actor && text.endsWith(` by ${actor}`)) {
      text = text.slice(0, -(` by ${actor}`).length)
    }
    return text
  }
  return row.activityVerb.replace(/\s+by\s*$/i, "").trim() || row.activityVerb
}

function minuteBucket(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`
}

function buildDisplayRows(rows: AssetAuditLogRow[]): DisplayRow[] {
  return rows.map((row) => {
    const orderRef = orderRefFromRow(row)
    const isOrder = Boolean(orderRef) || row.action in ORDER_STATUS_LABELS
    const status =
      ORDER_STATUS_LABELS[row.action] ??
      (orderRef && activityText(row).includes(orderRef)
        ? activityText(row).replace(`${orderRef} · `, "").trim()
        : activityText(row))

    return {
      id: row.id,
      at: row.at,
      actorName: row.actorName?.trim() || "System",
      action: row.action,
      orderRef,
      status,
      inventory: parseInventoryChanges(row.changes),
      isOrder,
    }
  })
}

function DeltaLine({
  label,
  from,
  to,
}: {
  label: string
  from: string
  to: string
}) {
  return (
    <div className="grid grid-cols-[minmax(6.5rem,7.5rem)_1fr] items-baseline gap-x-2 text-[11px] leading-relaxed">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums text-foreground">
        <span>{from}</span>
        <span className="mx-1 text-muted-foreground" aria-hidden>
          →
        </span>
        <span className="font-medium">{to}</span>
      </dd>
    </div>
  )
}

function WhenCell({ at, muted }: { at: string; muted?: boolean }) {
  const { date, time } = formatWhenParts(at)
  if (muted) {
    return <span className="text-muted-foreground/40" aria-hidden>·</span>
  }
  return (
    <div className="tabular-nums leading-tight">
      <div className="text-xs text-foreground">{date}</div>
      {time ? <div className="mt-0.5 text-[11px] text-muted-foreground">{time}</div> : null}
    </div>
  )
}

function ActivityCell({ row }: { row: DisplayRow }) {
  const { physicalCount, verificationDate } = row.inventory
  const hasInventory = Boolean(physicalCount || verificationDate)

  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-sm leading-snug text-foreground">
        {row.orderRef ? (
          <>
            <span className="font-mono text-xs font-medium text-primary">{row.orderRef}</span>
            <span className="mx-1.5 text-muted-foreground/50" aria-hidden>
              ·
            </span>
            <span className="font-medium">{row.status}</span>
          </>
        ) : (
          <span className="font-medium">{row.status}</span>
        )}
      </p>

      {hasInventory ? (
        <dl className="space-y-0.5 rounded-md border border-border/40 bg-muted/15 px-2.5 py-1.5">
          {physicalCount ? (
            <DeltaLine label="Physical count" from={physicalCount.from} to={physicalCount.to} />
          ) : null}
          {verificationDate ? (
            <DeltaLine
              label="Verification date"
              from={verificationDate.from}
              to={verificationDate.to}
            />
          ) : null}
        </dl>
      ) : null}
    </div>
  )
}

const cellClass = "px-4 py-2.5 align-top"
const headClass = "px-4 py-2.5"

export function AssetAuditLog({ rows, loading }: { rows: AssetAuditLogRow[]; loading: boolean }) {
  const displayRows = React.useMemo(() => buildDisplayRows(rows), [rows])

  return (
    <AdminPanel
      title="Audit Trail"
      description={
        displayRows.length > 0
          ? `${displayRows.length} ${displayRows.length === 1 ? "entry" : "entries"}`
          : "Asset and physical order history."
      }
      contentClassName="p-0"
    >
      {loading ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Loading audit trail…</p>
      ) : displayRows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No audit events recorded yet.</p>
      ) : (
        <div className="max-h-[min(22rem,48vh)] overflow-auto overscroll-y-contain">
          <Table className="app-table-head-sticky">
            <TableHeader>
              <AdminTableHeaderRow className="bg-muted/30 hover:bg-muted/30">
                <AdminTableHeadCell className={cn(headClass, "w-[9.5rem]")}>When</AdminTableHeadCell>
                <AdminTableHeadCell className={cn(headClass, "w-[7.5rem]")}>By</AdminTableHeadCell>
                <AdminTableHeadCell className={headClass}>Activity</AdminTableHeadCell>
              </AdminTableHeaderRow>
            </TableHeader>
            <TableBody>
              {displayRows.map((row, index) => {
                const prev = index > 0 ? displayRows[index - 1] : null
                const isOrderLifecycle = ORDER_LIFECYCLE_ACTIONS.has(row.action)
                const sameWhen =
                  !isOrderLifecycle &&
                  prev != null &&
                  !ORDER_LIFECYCLE_ACTIONS.has(prev.action) &&
                  minuteBucket(prev.at) === minuteBucket(row.at)
                const sameActor = sameWhen && prev?.actorName === row.actorName

                return (
                  <AdminTableBodyRow
                    key={row.id}
                    interactive={false}
                    className={cn(
                      "border-border/40",
                      row.isOrder && "bg-primary/[0.02]",
                      index % 2 === 1 && !row.isOrder && "bg-muted/[0.18]",
                    )}
                  >
                    <AdminTableCell className={cellClass}>
                      <WhenCell at={row.at} muted={sameWhen} />
                    </AdminTableCell>
                    <AdminTableCell className={cellClass}>
                      {sameActor ? (
                        <span className="text-muted-foreground/40" aria-hidden>
                          ·
                        </span>
                      ) : (
                        <span className="text-sm font-medium text-foreground">{row.actorName}</span>
                      )}
                    </AdminTableCell>
                    <AdminTableCell className={cellClass}>
                      <ActivityCell row={row} />
                    </AdminTableCell>
                  </AdminTableBodyRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </AdminPanel>
  )
}
