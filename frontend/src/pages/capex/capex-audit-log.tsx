import * as React from "react"

import { AuditDetailLine, AuditTrailTable, type AuditTrailRow } from "@/components/audit/audit-trail-table"
import type { CapexAuditEvent } from "@/lib/capex-types"

function detailLines(ev: CapexAuditEvent): string[] {
  const lines: string[] = []
  if (ev.detail?.trim()) {
    for (const raw of ev.detail.split("\n")) {
      const line = raw.trim()
      if (!line) continue
      const shown = line.replace(/\bNote:/g, "Comment:")
      if (shown.includes("Next:") && shown.includes("Comment:")) {
        lines.push(...shown.split(" · ").map((part) => part.trim()).filter(Boolean))
      } else {
        lines.push(shown)
      }
    }
  }
  for (const c of ev.changes) {
    const from = (c.from_value || "").trim()
    const to = (c.to_value || "").trim()
    const label = c.field.trim()
    if ((from === "—" || !from) && to && to !== "—") {
      lines.push(`${label}: ${to}`)
    } else if (from && to && from !== to && to !== "—") {
      lines.push(`${label}: ${from} → ${to}`)
    } else if (from && from !== "—" && (!to || to === "—")) {
      lines.push(`${label}: cleared (was ${from})`)
    }
  }
  return lines
}

function activityForEvent(ev: CapexAuditEvent): React.ReactNode {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-sm font-medium leading-snug text-foreground">{ev.label}</p>
      {detailLines(ev).map((line, i) => (
        <AuditDetailLine key={`${i}-${line}`} line={line} />
      ))}
    </div>
  )
}

export function CapexAuditLog({
  events,
  loading,
  fillHeight,
}: {
  events: CapexAuditEvent[] | null
  loading?: boolean
  fillHeight?: boolean
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
      emptyDescription="No audit events recorded yet."
      descriptionFallback="Creation, edits, and approval actions for this form."
    />
  )
}
