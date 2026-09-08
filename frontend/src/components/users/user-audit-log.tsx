import * as React from "react"

import { AuditDetailLine, AuditTrailTable, type AuditTrailRow } from "@/components/audit/audit-trail-table"

export type UserTimelineEvent = {
  type: string
  user?: string | null
  step?: number | null
  action?: string | null
  assigned_to?: string[]
  timestamp?: string | null
  details?: Record<string, unknown>
}

const FIELD_LABELS: Record<string, string> = {
  is_active: "Status",
  role_name: "Role",
  org_unit_name: "Plant",
  department_name: "Departments",
  cost_center_name: "Cost centers",
  full_name: "Full name",
  username: "Username",
  phone: "Phone",
  email: "Email",
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, " ")
}

function titleCaseAction(action: string): string {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function DeltaLines({
  changes,
}: {
  changes: Record<string, { from?: unknown; to?: unknown }>
}) {
  const entries = Object.entries(changes)
  if (entries.length === 0) return null
  return (
    <dl className="mt-1.5 space-y-0.5 rounded-md border border-border/40 bg-muted/15 px-2.5 py-1.5">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="grid grid-cols-[minmax(6.5rem,7.5rem)_1fr] items-baseline gap-x-2 text-[11px] leading-relaxed"
        >
          <dt className="font-bold text-black">{fieldLabel(key)}</dt>
          <dd className="tabular-nums text-black">
            <span>{String(value?.from ?? "—")}</span>
            <span className="mx-1" aria-hidden>
              →
            </span>
            <span>{String(value?.to ?? "—")}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

function activityForEvent(ev: UserTimelineEvent): React.ReactNode {
  const details = ev.details && typeof ev.details === "object" ? ev.details : null

  if (ev.type === "created") {
    const roleName = details && typeof details.role_name === "string" ? details.role_name : null
    const plantName =
      details && typeof details.org_unit_name === "string" ? details.org_unit_name : null
    const awaiting =
      details?.approval_status === "pending" && typeof details.awaiting_role === "string"
        ? details.awaiting_role
        : null
    return (
      <div className="space-y-1">
        <p className="font-medium">User created</p>
        {roleName || plantName || awaiting ? (
          <div className="space-y-0.5">
            {roleName ? <AuditDetailLine line={`Role: ${roleName}`} /> : null}
            {plantName ? <AuditDetailLine line={`Plant: ${plantName}`} /> : null}
            {awaiting ? <AuditDetailLine line={`Awaiting Approval from ${awaiting}`} /> : null}
          </div>
        ) : null}
      </div>
    )
  }

  if (ev.type === "activated") {
    return <p className="font-medium">Activated</p>
  }

  if (ev.type === "deactivated") {
    return <p className="font-medium">Deactivated</p>
  }

  if (ev.type === "approval_step") {
    if (ev.action === "pending") {
      const assignees = (ev.assigned_to ?? []).filter(Boolean).join(", ") || "—"
      const role = details && typeof details.role === "string" ? details.role : null
      return (
        <div className="space-y-1">
          <p className="font-medium">
            {ev.step != null ? `Step ${ev.step} · Awaiting Approval` : "Awaiting Approval"}
          </p>
          <AuditDetailLine line={assignees} />
          {role ? <AuditDetailLine line={`Role: ${role}`} /> : null}
        </div>
      )
    }
    const actionLabel = ev.action ? titleCaseAction(ev.action) : "Action"
    const comment =
      details && typeof details.comment === "string" && details.comment.trim()
        ? details.comment.trim()
        : null
    return (
      <div className="space-y-1">
        <p className="font-medium">
          {ev.step != null ? `Step ${ev.step} · ${actionLabel}` : actionLabel}
        </p>
        {comment ? (
          <AuditDetailLine line={`Note: ${comment}`} />
        ) : null}
      </div>
    )
  }

  if (ev.type === "entity_updated") {
    const changes =
      details && typeof details.changes === "object" && details.changes
        ? (details.changes as Record<string, { from?: unknown; to?: unknown }>)
        : {}
    return (
      <div>
        <p className="font-medium">Updated</p>
        <DeltaLines changes={changes} />
      </div>
    )
  }

  return <p className="font-medium">{titleCaseAction(ev.type)}</p>
}

function eventTimeMs(ev: UserTimelineEvent): number {
  if (ev.timestamp) {
    const t = new Date(ev.timestamp).getTime()
    if (!Number.isNaN(t)) return t
  }
  if (ev.action === "pending") return Number.POSITIVE_INFINITY
  return Number.NEGATIVE_INFINITY
}

export function UserAuditLog({
  events,
  loading,
  canView,
}: {
  events: UserTimelineEvent[] | null
  loading?: boolean
  canView: boolean
}) {
  const rows = React.useMemo((): AuditTrailRow[] => {
    if (!canView || !events) return []
    return [...events]
      .sort((a, b) => eventTimeMs(b) - eventTimeMs(a))
      .map((ev, index) => ({
        id: `${ev.type}-${ev.timestamp ?? "pending"}-${ev.step ?? ""}-${index}`,
        at: ev.timestamp ?? "",
        by: ev.user?.trim() || (ev.action === "pending" ? "—" : "System"),
        activity: activityForEvent(ev),
      }))
  }, [canView, events])

  if (!canView) {
    return (
      <AuditTrailTable
        rows={[]}
        emptyDescription="Requires users.view permission."
        descriptionFallback="Requires users.view permission."
      />
    )
  }

  return (
    <AuditTrailTable
      rows={rows}
      loading={loading}
      emptyDescription="No audit events found."
      descriptionFallback="Creation and change history for this user."
    />
  )
}
