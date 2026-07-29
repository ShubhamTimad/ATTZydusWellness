import * as React from "react"

import { AuditTrailTable, type AuditTrailRow } from "@/components/audit/audit-trail-table"
import type { DisposalOrderAudit } from "@/lib/disposal-types"

const ACTION_LABELS: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  submitted: "Submitted for approval",
  resubmitted: "Resubmitted for approval",
  reassigned: "Approver reassigned",
  step_approved: "Approved a step",
  approved: "Final approval — sent to scrapyard",
  rejected: "Rejected",
  received: "Received at scrapyard",
  closed: "Closed",
  archived: "Archived",
}

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  order_number: "Order number",
  assets: "Assets",
  asset_count: "Asset count",
  disposed_assets: "Disposed assets",
  reactivated_assets: "Reactivated assets",
  requires_engineering: "Engineering approval",
  remarks: "Remarks",
  comment: "Comment",
  assignee_name: "Assignee",
  assigned_to_name: "Assigned to",
  next_assignee_name: "Next assignee",
  next_role_name: "Next role",
  role_name: "Role",
  step_role_name: "Step",
  cost_center: "Cost center",
  functional_location: "Location 1",
  actual_location: "Location 2",
}

function label(map: Record<string, string>, key: string): string {
  return map[key] ?? key.replaceAll("_", " ")
}

function formatValue(value: unknown): string {
  if (value == null || value === "") return "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.map(String).join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function changesForEvent(ev: DisposalOrderAudit) {
  const oldV = ev.old_value ?? {}
  const newV = ev.new_value ?? {}
  const out: { field: string; from_value: string; to_value: string }[] = []
  for (const key of [...new Set([...Object.keys(oldV), ...Object.keys(newV)])]) {
    if (JSON.stringify(oldV[key]) === JSON.stringify(newV[key])) continue
    out.push({
      field: label(FIELD_LABELS, key),
      from_value: formatValue(oldV[key]),
      to_value: formatValue(newV[key]),
    })
  }
  return out
}

function activityForEvent(ev: DisposalOrderAudit): React.ReactNode {
  const changes = changesForEvent(ev)
  return (
    <div className="space-y-1">
      <p className="font-medium">{label(ACTION_LABELS, ev.action)}</p>
      {changes.length > 0 ? (
        <dl className="mt-0.5 space-y-0.5 rounded-md border border-border/40 bg-muted/15 px-2.5 py-1.5">
          {changes.map((c) => (
            <div
              key={c.field}
              className="grid grid-cols-1 gap-0.5 text-[11px] leading-relaxed sm:grid-cols-[minmax(0,12.5rem)_minmax(0,1fr)] sm:items-baseline sm:gap-x-3"
            >
              <dt className="break-words text-muted-foreground">{c.field}</dt>
              <dd className="min-w-0 break-words tabular-nums text-foreground">
                <span>{c.from_value}</span>
                <span className="mx-1 text-muted-foreground" aria-hidden>
                  →
                </span>
                <span className="font-medium">{c.to_value}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

export function DisposalAuditLog({
  events,
  loading,
}: {
  events: DisposalOrderAudit[] | null
  loading?: boolean
}) {
  const rows = React.useMemo((): AuditTrailRow[] => {
    if (!events) return []
    return events.map((ev) => ({
      id: String(ev.id),
      at: ev.created_at,
      by: ev.actor_name?.trim() || "System",
      activity: activityForEvent(ev),
    }))
  }, [events])

  return (
    <AuditTrailTable
      rows={rows}
      loading={loading}
      emptyDescription="No audit events recorded yet."
      descriptionFallback="Creation, edits, and workflow actions for this disposal order."
    />
  )
}
