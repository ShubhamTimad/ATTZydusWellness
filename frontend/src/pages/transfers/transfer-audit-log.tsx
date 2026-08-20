import * as React from "react"

import { AuditTrailTable, type AuditTrailRow } from "@/components/audit/audit-trail-table"
import { transferStatusLabel, type TransferOrderAudit } from "@/lib/transfer-types"

function text(value: unknown, assetCodeById?: Map<number, string>): string | null {
  if (value == null) return null
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (typeof item === "number" && assetCodeById?.has(item)) {
          return assetCodeById.get(item) ?? String(item)
        }
        if (typeof item === "string" && /^\d+$/.test(item) && assetCodeById) {
          const id = Number(item)
          if (assetCodeById.has(id)) return assetCodeById.get(id) ?? item
        }
        return String(item).trim()
      })
      .filter(Boolean)
    return parts.length ? parts.join(", ") : null
  }
  if (typeof value === "object") return null
  const s = String(value).trim()
  return s || null
}

function fromNew(ev: TransferOrderAudit, key: string): string | null {
  return text(ev.new_value?.[key])
}

function fromOld(ev: TransferOrderAudit, key: string): string | null {
  return text(ev.old_value?.[key])
}

function statusLine(value: string | null): string | null {
  if (!value) return null
  const labelled = transferStatusLabel(value)
  return labelled || value
}

function nextAssigneeLine(ev: TransferOrderAudit): string | null {
  const name =
    fromNew(ev, "next_assignee_name") ||
    fromNew(ev, "assigned_to_name") ||
    fromNew(ev, "assignee_name")
  const role = fromNew(ev, "next_role_name") || fromNew(ev, "role_name")
  if (name && role) return `Next: ${name} (${role})`
  if (name) return `Next: ${name}`
  if (role) return `Next role: ${role}`
  return null
}

const WORKFLOW_ACTIONS = new Set([
  "submitted",
  "resubmitted",
  "step_approved",
  "approved",
  "rejected",
  "cf_rejected",
  "cf_approved",
  "cc2_assigned_to_cf",
  "cf_confirmed",
  "cf_closed",
  "restart_transfer",
  "restarted",
  "reassigned",
])

/** Short headline: decision + step role when present. */
export function transferAuditHeadline(ev: TransferOrderAudit): string {
  const step = fromNew(ev, "step_role_name") || fromNew(ev, "role_name")
  switch (ev.action) {
    case "created":
      return "Created"
    case "updated":
      return "Updated"
    case "submitted":
      return "Submitted for approval"
    case "resubmitted":
      return "Resubmitted for approval"
    case "restart_transfer":
    case "restarted":
      return "Transfer restarted"
    case "reassigned":
      return step ? `Reassigned — ${step}` : "Reassigned"
    case "step_approved":
      return step ? `Approved — ${step}` : "Approved"
    case "approved":
    case "cf_approved":
      return step ? `Final Approval — ${step}` : "Final Approval — sent to receive"
    case "rejected":
    case "cf_rejected":
      return step ? `Rejected — ${step}` : "Rejected"
    case "cc2_assigned_to_cf":
      return step ? `Received — ${step}` : "Received"
    case "cf_confirmed":
      return step ? `Confirmed — ${step}` : "Confirmed by CF"
    case "cf_closed":
      return step ? `Closed — ${step}` : "Closed"
    case "archived":
      return "Archived"
    case "unarchived":
      return "Unarchived"
    default:
      return ev.action.replaceAll("_", " ")
  }
}

/**
 * Compact facts under the headline (no empty "— →" rows).
 * Workflow actions: next assignee, comment, receive destinations.
 * Edits: only fields that actually changed.
 */
export function transferAuditDetailLines(
  ev: TransferOrderAudit,
  assetCodeById?: Map<number, string>,
): string[] {
  const lines: string[] = []
  const action = ev.action

  if (WORKFLOW_ACTIONS.has(action)) {
    const next = nextAssigneeLine(ev)
    if (next) {
      lines.push(
        action === "rejected" || action === "cf_rejected"
          ? next.replace(/^Next:/, "Returned to:")
          : next,
      )
    }

    const comment = fromNew(ev, "comment") || fromNew(ev, "rejection_reason")
    if (comment) lines.push(`Comment: ${comment}`)

    if (action === "cc2_assigned_to_cf") {
      const cc = fromNew(ev, "to_cost_center") || fromNew(ev, "cost_center")
      const loc1 = fromNew(ev, "to_functional_location") || fromNew(ev, "functional_location")
      const loc2 = fromNew(ev, "to_actual_location") || fromNew(ev, "actual_location")
      if (cc) lines.push(`Cost center: ${cc}`)
      if (loc1) lines.push(`Location 1: ${loc1}`)
      if (loc2) lines.push(`Location 2: ${loc2}`)
    }

    const statusTo = statusLine(fromNew(ev, "status"))
    const statusFrom = statusLine(fromOld(ev, "status"))
    if (statusTo && statusFrom && statusTo !== statusFrom) {
      lines.push(`Status: ${statusFrom} → ${statusTo}`)
    } else if (
      statusTo &&
      (action === "rejected" ||
        action === "cf_rejected" ||
        action === "approved" ||
        action === "cc2_assigned_to_cf")
    ) {
      lines.push(`Status: ${statusTo}`)
    }

    return lines
  }

  const oldV = ev.old_value ?? {}
  const newV = ev.new_value ?? {}
  const skip = new Set([
    "assigned_to",
    "assignee_user_id",
    "next_assignee_user_id",
    "to_asset_custodian_id",
    "asset_custodian_id",
    "to_cost_center_id",
    "approval_request_id",
    "returned_to",
    "note",
  ])
  const preferName: [string, string][] = [
    ["assigned_to", "assigned_to_name"],
    ["assignee_user_id", "assignee_name"],
    ["next_assignee_user_id", "next_assignee_name"],
    ["to_asset_custodian_id", "to_asset_custodian_name"],
  ]
  for (const [idKey, nameKey] of preferName) {
    if (nameKey in newV || nameKey in oldV) skip.add(idKey)
  }
  if ("assets" in newV || "assets" in oldV || "asset_codes" in newV) {
    skip.add("asset_ids")
  }

  const labels: Record<string, string> = {
    status: "Status",
    order_number: "Order number",
    assets: "Assets",
    asset_codes: "Assets",
    asset_count: "Asset count",
    remarks: "Remarks",
    comment: "Comment",
    rejection_reason: "Comment",
    assignee_name: "Assignee",
    assigned_to_name: "Assigned to",
    next_assignee_name: "Next assignee",
    next_role_name: "Next role",
    role_name: "Role",
    step_role_name: "Step",
    to_cost_center: "Destination cost center",
    to_asset_custodian_name: "Asset custodian",
    to_functional_location: "Location 1",
    to_actual_location: "Location 2",
    functional_location: "Location 1",
    actual_location: "Location 2",
  }

  for (const key of [...new Set([...Object.keys(oldV), ...Object.keys(newV)])]) {
    if (skip.has(key)) continue
    const fromRaw = text(oldV[key], key === "asset_ids" ? assetCodeById : undefined)
    const toRaw = text(newV[key], key === "asset_ids" ? assetCodeById : undefined)
    const from = key === "status" ? statusLine(fromRaw) : fromRaw
    const to = key === "status" ? statusLine(toRaw) : toRaw
    if (from === to) continue
    if (!from && !to) continue
    const label = labels[key] ?? key.replaceAll("_", " ")
    if (!from && to) lines.push(`${label}: ${to}`)
    else if (from && !to) lines.push(`${label}: cleared (was ${from})`)
    else lines.push(`${label}: ${from} → ${to}`)
  }
  return lines
}

function activityForEvent(
  ev: TransferOrderAudit,
  assetCodeById?: Map<number, string>,
): React.ReactNode {
  const details = transferAuditDetailLines(ev, assetCodeById)
  return (
    <div className="space-y-0.5">
      <p className="font-medium">{transferAuditHeadline(ev)}</p>
      {details.length > 0 ? (
        <ul className="space-y-0.5 text-[11px] leading-relaxed text-muted-foreground">
          {details.map((line, i) => (
            <li key={`${i}-${line}`} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function TransferAuditLog({
  events,
  loading,
  assetCodeById,
  fillHeight,
  className,
}: {
  events: TransferOrderAudit[] | null
  loading?: boolean
  /** Resolve legacy audit asset_ids → asset codes when present. */
  assetCodeById?: Map<number, string>
  fillHeight?: boolean
  className?: string
}) {
  const rows = React.useMemo((): AuditTrailRow[] => {
    if (!events) return []
    return events.map((ev) => ({
      id: String(ev.id),
      at: ev.created_at,
      by: ev.actor_name?.trim() || "System",
      activity: activityForEvent(ev, assetCodeById),
    }))
  }, [events, assetCodeById])

  return (
    <AuditTrailTable
      rows={rows}
      loading={loading}
      fillHeight={fillHeight}
      className={className}
      emptyDescription="No audit events recorded yet."
      descriptionFallback="Creation, edits, and workflow actions for this transfer."
    />
  )
}
