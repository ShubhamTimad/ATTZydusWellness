import * as React from "react"

import { AuditDetailLine, AuditTrailTable, type AuditTrailRow } from "@/components/audit/audit-trail-table"
import { formatAppDateIfDate } from "@/lib/dates"

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

function orderRefFromRow(row: AssetAuditLogRow): string | null {
  const text = row.summary || row.activityVerb
  const match = text.match(/\b(PVO-\d{4}-\d+)\b/i)
  return match?.[1]?.toUpperCase() ?? null
}

function activityHeadline(row: AssetAuditLogRow): string {
  const summary = row.summary?.trim()
  if (summary) {
    let text = summary.split("\n")[0]?.trim() ?? summary
    text = text
      .replace(/\s*\(asset remains inactive(?: until approved)?\)\s*$/i, "")
      .replace(/\s*\(asset is now active\)\s*$/i, "")
      .trim()
    const actor = row.actorName?.trim()
    if (actor && text.endsWith(` · ${actor}`)) {
      text = text.slice(0, -(` · ${actor}`).length).trim()
    }
    if (actor && text.startsWith(`Rejected by ${actor}:`)) return "Rejected"
    if (actor && text.startsWith(`Approved by ${actor}:`)) return "Approved"
    if (actor && text.startsWith(`Reassigned by ${actor}`)) return "Reassigned"
    if (actor) {
      text = text.replace(` by ${actor}`, "").replace(/\s{2,}/g, " ").trim()
    }
    if (text.endsWith(":")) text = text.slice(0, -1).trim()
    return text
  }
  return row.activityVerb.replace(/\s+by\s*$/i, "").trim() || row.activityVerb
}

function changesForRow(row: AssetAuditLogRow): AssetAuditLogRow["changes"] {
  if (row.changes.length > 0) return row.changes

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

  const summary = row.summary?.trim() || ""
  const actor = row.actorName?.trim()
  if (!actor) return []

  const rejectPrefix = `Rejected by ${actor}:`
  if (summary.startsWith(rejectPrefix)) {
    const reason = summary.slice(rejectPrefix.length).trim()
    if (reason) return [{ field_label: "Reason", from_value: "—", to_value: reason }]
  }
  const approvePrefix = `Approved by ${actor}:`
  if (summary.startsWith(approvePrefix)) {
    const comment = summary.slice(approvePrefix.length).trim()
    if (comment) return [{ field_label: "Comment", from_value: "—", to_value: comment }]
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
  return []
}

/** Match physical-order audit: bold title + muted wrapping detail lines (no boxed grid). */
function dash(value: string): string {
  const s = value.trim()
  if (!s || s === "-") return "—"
  return formatAppDateIfDate(s)
}

function detailLinesFromChanges(changes: AssetAuditLogRow["changes"]): string[] {
  const lines: string[] = []
  for (const c of changes) {
    const from = dash(c.from_value || "")
    const to = dash(c.to_value || "")
    const label = c.field_label.trim()
    if (label === "Reason" && from === "—" && to !== "—") {
      lines.push(`Rejected Reason: ${to}`)
      continue
    }
    if (label === "Comment" && from === "—" && to !== "—") {
      lines.push(`Comment: ${to}`)
      continue
    }
    if (from === to) continue
    if (from === "—") {
      lines.push(`${label}: ${to}`)
      continue
    }
    lines.push(`${label}: ${from} → ${to}`)
  }
  return lines
}

function activityForRow(row: AssetAuditLogRow): React.ReactNode {
  const orderRef = orderRefFromRow(row)
  const headline = activityHeadline(row)
  let status =
    ORDER_STATUS_LABELS[row.action] ??
    (orderRef && headline.includes(orderRef)
      ? headline.replace(`${orderRef} · `, "").trim()
      : headline)
  if (orderRef) {
    status = status
      .replace(new RegExp(`\\s*${orderRef}\\s*`, "i"), " ")
      .replace(/\s*·\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
  }
  const details = detailLinesFromChanges(changesForRow(row))
  if (orderRef && !details.some((line) => line.startsWith("Order Number:"))) {
    details.unshift(`Order Number: ${orderRef}`)
  }

  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-sm font-medium leading-snug text-foreground">{status}</p>
      {details.map((line) => (
        <AuditDetailLine key={line} line={line} />
      ))}
    </div>
  )
}

export function AssetAuditLog({ rows, loading }: { rows: AssetAuditLogRow[]; loading: boolean }) {
  const auditRows = React.useMemo((): AuditTrailRow[] => {
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      by: row.actorName?.trim() || "System",
      activity: activityForRow(row),
    }))
  }, [rows])

  return (
    <AuditTrailTable
      rows={auditRows}
      loading={loading}
      emptyDescription="No audit events recorded yet."
      descriptionFallback="Asset and physical order history."
    />
  )
}
