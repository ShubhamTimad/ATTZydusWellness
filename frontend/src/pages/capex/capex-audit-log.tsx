import * as React from "react"

import { AuditTrailTable, type AuditTrailRow } from "@/components/audit/audit-trail-table"
import type { CapexAuditEvent } from "@/lib/capex-types"

function activityForEvent(ev: CapexAuditEvent): React.ReactNode {
  return (
    <div className="space-y-1">
      <p className="font-medium">{ev.label}</p>
      {ev.detail ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{ev.detail}</p>
      ) : null}
      {ev.changes.length > 0 ? (
        <dl className="mt-0.5 space-y-0.5 rounded-md border border-border/40 bg-muted/15 px-2.5 py-1.5">
          {ev.changes.map((c) => (
            <div
              key={c.field}
              className="grid grid-cols-[minmax(6.5rem,8rem)_1fr] items-baseline gap-x-2 text-[11px] leading-relaxed"
            >
              <dt className="text-muted-foreground">{c.field}</dt>
              <dd className="tabular-nums text-foreground">
                <span>{c.from_value ?? "—"}</span>
                <span className="mx-1 text-muted-foreground" aria-hidden>
                  →
                </span>
                <span className="font-medium">{c.to_value ?? "—"}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

export function CapexAuditLog({
  events,
  loading,
}: {
  events: CapexAuditEvent[] | null
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
      descriptionFallback="Creation, edits, and approval actions for this form."
    />
  )
}
