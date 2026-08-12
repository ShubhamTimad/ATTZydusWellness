import * as React from "react"

import { AuditTrailTable, type AuditTrailRow } from "@/components/audit/audit-trail-table"
import { transferStatusLabel, type TransferOrderAudit } from "@/lib/transfer-types"

const ACTION_LABELS: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  submitted: "Submitted for approval",
  restart_transfer: "Transfer restarted",
  resubmitted: "Resubmitted for approval",
  step_approved: "Step approved",
  approved: "Fully approved",
  cf_approved: "Approved by CF",
  cf_rejected: "Rejected by CF",
  rejected: "Rejected",
  cc2_assigned_to_cf: "Received",
  cf_confirmed: "Confirmed by CF",
  cf_closed: "Closed",
  archived: "Archived",
  unarchived: "Unarchived",
}

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  to_cost_center_id: "Destination cost center",
  to_cost_center: "Destination cost center",
  to_asset_custodian_id: "Asset custodian",
  to_asset_custodian_name: "Asset custodian",
  to_functional_location: "Location 1",
  to_actual_location: "Location 2",
  remarks: "Remarks",
  rejection_reason: "Rejection reason",
  assigned_to: "Assigned to",
  assigned_to_name: "Assigned to",
  assets: "Assets",
  asset_ids: "Assets",
  asset_codes: "Assets",
  asset_count: "Asset count",
  asset_custodian_id: "Asset custodian",
  order_number: "Order number",
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replaceAll("_", " ")
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replaceAll("_", " ")
}

function formatFieldValue(
  key: string,
  value: unknown,
  assetCodeById?: Map<number, string>,
): string {
  if (value == null || value === "") return "—"
  if (key === "status" && typeof value === "string") {
    return transferStatusLabel(value)
  }
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) {
    if (value.length === 0) return "—"
    return value
      .map((item) => {
        if (typeof item === "number" && assetCodeById?.has(item)) {
          return assetCodeById.get(item) ?? String(item)
        }
        if (typeof item === "string" && /^\d+$/.test(item) && assetCodeById) {
          const id = Number(item)
          if (assetCodeById.has(id)) return assetCodeById.get(id) ?? item
        }
        return String(item)
      })
      .join(", ")
  }
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function changesForEvent(
  ev: TransferOrderAudit,
  assetCodeById?: Map<number, string>,
): { field: string; from_value: string; to_value: string }[] {
  const oldV = ev.old_value ?? {}
  const newV = ev.new_value ?? {}
  const keys = [...new Set([...Object.keys(oldV), ...Object.keys(newV)])].filter((key) => {
    if (key === "asset_ids" && ("assets" in newV || "assets" in oldV || "asset_codes" in newV)) {
      return false
    }
    // Prefer display names over raw ids when both are present.
    if (key === "assigned_to" && ("assigned_to_name" in newV || "assigned_to_name" in oldV)) {
      return false
    }
    if (
      key === "to_asset_custodian_id" &&
      ("to_asset_custodian_name" in newV || "to_asset_custodian_name" in oldV)
    ) {
      return false
    }
    if (key === "asset_custodian_id") {
      return false
    }
    return true
  })
  const out: { field: string; from_value: string; to_value: string }[] = []
  for (const key of keys) {
    const from = oldV[key]
    const to = newV[key]
    if (JSON.stringify(from) === JSON.stringify(to)) continue
    out.push({
      field: fieldLabel(key),
      from_value: formatFieldValue(key, from, key === "asset_ids" ? assetCodeById : undefined),
      to_value: formatFieldValue(key, to, key === "asset_ids" ? assetCodeById : undefined),
    })
  }
  return out
}

function activityForEvent(
  ev: TransferOrderAudit,
  assetCodeById?: Map<number, string>,
): React.ReactNode {
  const changes = changesForEvent(ev, assetCodeById)
  return (
    <div className="space-y-1">
      <p className="font-medium">{actionLabel(ev.action)}</p>
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
