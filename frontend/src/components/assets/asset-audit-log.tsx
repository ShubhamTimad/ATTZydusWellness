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
  physical_order_created: "Order Created",
  physical_verification_reset: "Order Created",
  physical_order_verified: "Verified",
}

const ORDER_LIFECYCLE_ACTIONS = new Set(Object.keys(ORDER_STATUS_LABELS))

type DisplayRow = {
  id: string
  at: string
  actorName: string
  action: string
  orderRef: string | null
  status: string
  changes: AssetAuditLogRow["changes"]
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

function activityHeadline(row: AssetAuditLogRow): string {
  const summary = row.summary?.trim()
  if (summary) {
    let text = summary.split("\n")[0]?.trim() ?? summary
    // Drop legacy parenthetical status notes from older audit rows.
    text = text
      .replace(/\s*\(asset remains inactive(?: until approved)?\)\s*$/i, "")
      .replace(/\s*\(asset is now active\)\s*$/i, "")
      .trim()
    const actor = row.actorName?.trim()
    if (actor && text.endsWith(` · ${actor}`)) {
      text = text.slice(0, -(` · ${actor}`).length).trim()
    }
    // Rejected/Approved with inline reason → title only; reason shown in changes.
    if (actor && text.startsWith(`Rejected by ${actor}:`)) {
      return "Rejected"
    }
    if (actor && text.startsWith(`Approved by ${actor}:`)) {
      return "Approved"
    }
    if (actor && text.startsWith(`Reassigned by ${actor}`)) {
      return "Reassigned"
    }
    if (actor) {
      text = text.replace(` by ${actor}`, "").replace(/\s{2,}/g, " ").trim()
    }
    if (text.endsWith(":")) {
      text = text.slice(0, -1).trim()
    }
    return text
  }
  return row.activityVerb.replace(/\s+by\s*$/i, "").trim() || row.activityVerb
}

function changesForRow(row: AssetAuditLogRow): AssetAuditLogRow["changes"] {
  if (row.changes.length > 0) return row.changes

  // Fallback: parse "Field: from → to" lines from summary body (older or missing change rows).
  const lines = (row.summary || "").split("\n").slice(1)
  const parsed: AssetAuditLogRow["changes"] = []
  for (const line of lines) {
    const m = line.match(/^(.+?):\s*(.*?)\s*→\s*(.*)$/)
    if (!m) continue
    parsed.push({
      field_label: m[1].trim(),
      from_value: m[2].trim() || "—",
      to_value: m[3].trim() || "—",
    })
  }
  if (parsed.length > 0) return parsed

  // Rejected/Approved with inline reason in the headline.
  const summary = row.summary?.trim() || ""
  const actor = row.actorName?.trim()
  if (actor) {
    const rejectPrefix = `Rejected by ${actor}:`
    if (summary.startsWith(rejectPrefix)) {
      const reason = summary.slice(rejectPrefix.length).trim()
      if (reason) {
        return [{ field_label: "Reason", from_value: "—", to_value: reason }]
      }
    }
    const approvePrefix = `Approved by ${actor}:`
    if (summary.startsWith(approvePrefix)) {
      const comment = summary.slice(approvePrefix.length).trim()
      if (comment) {
        return [{ field_label: "Comment", from_value: "—", to_value: comment }]
      }
    }
    const reassignPrefix = `Reassigned by ${actor}:`
    if (summary.startsWith(reassignPrefix)) {
      const rest = summary.slice(reassignPrefix.length).trim()
      const m = rest.match(/^(.*?)\s*→\s*(.*)$/)
      if (m) {
        return [
          {
            field_label: "Approver",
            from_value: m[1].trim() || "—",
            to_value: m[2].trim() || "—",
          },
        ]
      }
    }
    const reassignTo = summary.match(
      new RegExp(`^Reassigned by ${actor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} to (.+)$`),
    )
    if (reassignTo) {
      return [
        {
          field_label: "Approver",
          from_value: "—",
          to_value: reassignTo[1].trim() || "—",
        },
      ]
    }
  }
  return []
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
    const headline = activityHeadline(row)
    const status =
      ORDER_STATUS_LABELS[row.action] ??
      (orderRef && headline.includes(orderRef)
        ? headline.replace(`${orderRef} · `, "").trim()
        : headline)

    return {
      id: row.id,
      at: row.at,
      actorName: row.actorName?.trim() || "System",
      action: row.action,
      orderRef,
      status,
      changes: changesForRow(row),
      isOrder,
    }
  })
}

function auditFieldLabel(label: string): string {
  const normalized = label.trim().toLowerCase()

  const labels: Record<string, string> = {
    "physical count": "Physical Count",
    "physical_count": "Physical Count",
    "last verification date": "Last Verification Date",
    "last_verification_date": "Last Verification Date",
  }

  return labels[normalized] ?? label
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
      <dd className="min-w-0 break-words tabular-nums text-foreground">
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
  const changes = row.changes
  // For reject/approve reason-only rows, show as a single detail line without "— →".
  const reasonOnly =
    changes.length === 1 &&
    (changes[0].field_label === "Reason" || changes[0].field_label === "Comment") &&
    changes[0].from_value === "—"

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

      {changes.length > 0 ? (
        <dl className="space-y-0.5 rounded-md border border-border/40 bg-muted/15 px-2.5 py-1.5">
          {reasonOnly ? (
            <div className="grid grid-cols-[minmax(6.5rem,7.5rem)_1fr] items-baseline gap-x-2 text-[11px] leading-relaxed">
              <dt className="text-muted-foreground">{changes[0].field_label}</dt>
              <dd className="min-w-0 break-words text-foreground font-medium">
                {changes[0].to_value}
              </dd>
            </div>
          ) : (
            changes.map((c) => (
              <DeltaLine
                key={`${c.field_label}-${c.from_value}-${c.to_value}`}
                label={auditFieldLabel(c.field_label)}    
                from={c.from_value}
                to={c.to_value}
              />
            ))
          )}
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
                <AdminTableHeadCell className="px-4 py-2.5 text-black">
                  Date / Time
                </AdminTableHeadCell>

                <AdminTableHeadCell className="px-4 py-2.5 text-black">
                  User
                </AdminTableHeadCell>

                <AdminTableHeadCell className="px-4 py-2.5 text-black">
                  Event
                </AdminTableHeadCell>
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
