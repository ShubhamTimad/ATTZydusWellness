import * as React from "react"

import { AuditTrailTable, type AuditTrailRow } from "@/components/audit/audit-trail-table"
import { disposalStatusLabel, type DisposalOrderAudit } from "@/lib/disposal-types"

function text(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) {
    const parts = value.map(String).map((s) => s.trim()).filter(Boolean)
    return parts.length ? parts.join(", ") : null
  }
  if (typeof value === "object") return null
  const s = String(value).trim()
  return s || null
}

function fromNew(ev: DisposalOrderAudit, key: string): string | null {
  return text(ev.new_value?.[key])
}

function fromOld(ev: DisposalOrderAudit, key: string): string | null {
  return text(ev.old_value?.[key])
}

function statusLine(value: string | null): string | null {
  if (!value) return null
  const labelled = disposalStatusLabel(value)
  return labelled || value
}

function nextAssigneeLine(ev: DisposalOrderAudit): string | null {
  const name =
    fromNew(ev, "next_assignee_name") ||
    fromNew(ev, "assigned_to_name") ||
    fromNew(ev, "assignee_name")
  const role = fromNew(ev, "next_role_name")
  if (role) return `Next: ${role}`
  if (name) return `Next: ${name}`
  return null
}

/** Short headline: decision + step role when present. */
export function disposalAuditHeadline(ev: DisposalOrderAudit): string {
  const step = fromNew(ev, "step_role_name") || fromNew(ev, "role_name")
  switch (ev.action.trim().toLowerCase()) {
    case "created":
      return "Created"
    case "updated":
      return "Updated"
    case "submitted":
      return "Submitted for Approval"
    case "resubmitted":
      return "Resubmitted for Approval"
    case "reassigned":
      return step ? `Reassigned — ${step}` : "Reassigned"
    case "step_approved":
      return step ? `Approved — ${step}` : "Approved"
    case "approved":
      return step ? `Approved — ${step}` : "Approved"
    case "rejected":
      return step ? `Rejected — ${step}` : "Rejected"
    case "received":
      return step ? `Received — ${step}` : "Received"
    case "receive_locations_saved":
      return "Actual Locations Saved"
    case "closed":
      return step ? `Closed — ${step}` : "Closed"
    case "archived":
      return "Archived"
    case "unarchived":
      return "Unarchived"
    case "restarted":
      return "Restarted"
    default:
      return ev.action.replaceAll("_", " ")
  }
}

/**
 * Compact facts under the headline (no empty "— →" rows).
 * Workflow actions: next assignee, comment, receive destinations.
 * Edits: only fields that actually changed, "set to" when there was no prior value.
 */
export function disposalAuditDetailLines(ev: DisposalOrderAudit): string[] {
  const lines: string[] = []
  const action = ev.action.trim().toLowerCase()

  if (
    action === "step_approved" ||
    action === "approved" ||
    action === "rejected" ||
    action === "received" ||
    action === "receive_locations_saved" ||
    action === "closed" ||
    action === "submitted" ||
    action === "resubmitted" ||
    action === "reassigned" ||
    action === "restarted"
  ) {
    const next = nextAssigneeLine(ev)
    if (next) {
      lines.push(action === "rejected" ? next.replace(/^Next:/, "Returned to:") : next)
    }

    const comment = fromNew(ev, "comment")
    if (comment) {
      lines.push(action === "rejected" ? `Rejected Reason: ${comment}` : `Comment: ${comment}`)
    }

    if (action === "received" || action === "receive_locations_saved") {
      const cc = fromNew(ev, "cost_center")
      const loc1 = fromNew(ev, "functional_location")
      const loc2 = fromNew(ev, "actual_location")
      const itemLocs = ev.new_value?.item_locations
      if (cc) lines.push(`Cost center: ${cc}`)
      // Per-asset rows list only what this action changed; empty means nothing new to report.
      if (Array.isArray(itemLocs)) {
        for (const row of itemLocs) {
          if (!row || typeof row !== "object") continue
          const rec = row as Record<string, unknown>
          const code = typeof rec.asset_code === "string" ? rec.asset_code : ""
          const a1 =
            typeof rec.to_functional_location === "string" ? rec.to_functional_location : ""
          const a2 = typeof rec.to_actual_location === "string" ? rec.to_actual_location : ""
          const bits = [
            a1 && `Actual Location 1: ${a1}`,
            a2 && `Actual Location 2: ${a2}`,
          ].filter(Boolean)
          if (code) lines.push(code)
          if (bits.length) lines.push(...bits.map((bit) => `   ${bit}`))
          else if (code) lines.push("   Locations cleared")
        }
      } else {
        if (loc1) lines.push(`Actual Location 1: ${loc1}`)
        if (loc2) lines.push(`Actual Location 2: ${loc2}`)
      }
    }

    if (action === "closed") {
      const disposed = fromNew(ev, "disposed_assets")
      if (disposed) lines.push(`Disposed: ${disposed}`)
    }

    const statusTo = statusLine(fromNew(ev, "status"))
    const statusFrom = statusLine(fromOld(ev, "status"))
    if (statusTo && statusFrom && statusTo !== statusFrom) {
      lines.push(`Status: ${statusFrom} → ${statusTo}`)
    } else if (statusTo && (action === "rejected" || action === "approved" || action === "received")) {
      lines.push(`Status: ${statusTo}`)
    }

    return lines
  }

  // created / updated / archived — field-level changes, skip empties
  const oldV = ev.old_value ?? {}
  const newV = ev.new_value ?? {}
  const skip = new Set([
    "assigned_to",
    "assignee_user_id",
    "next_assignee_user_id",
    "approval_request_id",
    "item_locations",
  ])
  const preferName: [string, string][] = [
    ["assigned_to", "assigned_to_name"],
    ["assignee_user_id", "assignee_name"],
    ["next_assignee_user_id", "next_assignee_name"],
  ]
  for (const [idKey, nameKey] of preferName) {
    if (nameKey in newV || nameKey in oldV) skip.add(idKey)
  }

  const labels: Record<string, string> = {
    status: "Status",
    order_number: "Order Number",
    assets: "Asset",
    asset_count: "Asset count",
    disposed_assets: "Disposed Asset",
    reactivated_assets: "Reactivated Asset",
    requires_engineering: "Engineering Approval",
    remarks: "Disposal Reason",
    comment: "Comment",
    assignee_name: "Assignee",
    assigned_to_name: "Assigned to",
    next_assignee_name: "Next assignee",
    next_role_name: "Next role",
    role_name: "Role",
    step_role_name: "Step",
    cost_center: "Cost center",
    to_cost_center: "Destination",
    functional_location: "Actual Location 1",
    actual_location: "Actual Location 2",
  }

  for (const key of [...new Set([...Object.keys(oldV), ...Object.keys(newV)])]) {
    if (skip.has(key)) continue
    const from = text(oldV[key])
    const to = text(newV[key])
    if (from === to) continue
    if (!from && !to) continue
    const label = labels[key] ?? key.replaceAll("_", " ")
    if (!from && to) lines.push(`${label}: ${to}`)
    else if (from && !to) lines.push(`${label}: cleared (was ${from})`)
    else lines.push(`${label}: ${from} → ${to}`)
  }
  return lines
}

function activityForEvent(ev: DisposalOrderAudit): React.ReactNode {
  const details = disposalAuditDetailLines(ev)
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-sm font-medium leading-snug text-foreground">
        {disposalAuditHeadline(ev)}
      </p>
      {details.map((line, i) => (
        <p
          key={`${i}-${line}`}
          className="break-words text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground"
        >
          {line}
        </p>
      ))}
    </div>
  )
}

export function DisposalAuditLog({
  events,
  loading,
  fillHeight,
  className,
}: {
  events: DisposalOrderAudit[] | null
  loading?: boolean
  fillHeight?: boolean
  className?: string
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
      fillHeight={fillHeight}
      className={className}
      emptyDescription="No audit events recorded yet."
      descriptionFallback="Creation, edits, and workflow actions for this disposal order."
    />
  )
}
