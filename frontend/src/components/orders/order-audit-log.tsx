import * as React from "react"
import { ChevronDown, ListTree } from "lucide-react"

import { AuditDetailLine, AuditTrailTable, type AuditTrailRow } from "@/components/audit/audit-trail-table"
import { Button } from "@/components/ui/button"
import { formatAppDateTime as formatDt } from "@/lib/dates"
import type { PhysicalOrderAudit } from "@/lib/orders-types"

function ActivityCell({
  ev,
  expanded,
  onToggleVerified,
}: {
  ev: PhysicalOrderAudit
  expanded: boolean
  onToggleVerified: () => void
}) {
  const verifiedAssets = ev.verified_assets ?? []
  const showVerifiedToggle = verifiedAssets.length > 0
  const detail = ev.detail?.trim() || ""
  const nextMatch = detail.match(/^(Assigned (?:to|role):\s*.+?)(?:\s+[—-]\s+|$)/i)
  const nextLine = nextMatch?.[1]?.trim() || null
  const restDetail = (() => {
    if (!detail) return null
    if (ev.action === "order_created") return null
    if (nextLine && detail.startsWith(nextLine)) {
      const rest = detail.slice(nextLine.length).replace(/^\s*[—-]\s*/, "").trim()
      return rest || null
    }
    if (ev.action === "reassigned") return detail
    return detail
  })()

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium leading-snug text-foreground">{ev.label}</span>
        {showVerifiedToggle ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onToggleVerified}
            aria-expanded={expanded}
            aria-label={
              expanded
                ? "Hide verified assets"
                : `Show ${verifiedAssets.length} verified asset${verifiedAssets.length === 1 ? "" : "s"}`
            }
            title={
              expanded
                ? "Hide verified assets"
                : `${verifiedAssets.length} verified asset${verifiedAssets.length === 1 ? "" : "s"}`
            }
          >
            {expanded ? (
              <ChevronDown className="size-4" aria-hidden />
            ) : (
              <ListTree className="size-4" aria-hidden />
            )}
          </Button>
        ) : null}
      </div>

      {nextLine && ev.action !== "order_created" ? <AuditDetailLine line={nextLine} /> : null}

      {restDetail
        ? restDetail.split("\n").map((line, i) => <AuditDetailLine key={`${i}-${line}`} line={line} />)
        : null}

      {showVerifiedToggle && !expanded ? (
        <p className="text-[11px] text-black">
          {verifiedAssets.length} Asset{verifiedAssets.length === 1 ? "" : "s"} Verified — click{" "}
          <ListTree className="mb-0.5 inline size-3.5" aria-hidden /> to view
        </p>
      ) : null}

      {showVerifiedToggle && expanded ? (
        <ul className="space-y-1.5 rounded-md border border-border/40 bg-muted/15 px-2.5 py-1.5">
          {verifiedAssets.map((asset) => (
            <li
              key={`${asset.asset_code}-${asset.verified_at ?? "pending"}`}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px]"
            >
              <div className="min-w-0">
                <span className="font-mono font-medium text-foreground">{asset.asset_code}</span>
                {asset.asset_name ? (
                  <span className="text-black"> · {asset.asset_name}</span>
                ) : null}
                {asset.rfid_code ? (
                  <p className="font-mono text-[10px] text-black">
                    <span className="font-bold text-black">RFID:</span> {asset.rfid_code}
                  </p>
                ) : null}
                {asset.remark?.trim() ? (
                  <p className="break-all whitespace-pre-wrap text-[10px] text-black">
                    <span className="font-bold text-black">Remark:</span> {asset.remark}
                  </p>
                ) : null}
              </div>
              <div className="shrink-0 text-right text-black">
                {asset.verified_at ? <div>{formatDt(asset.verified_at)}</div> : null}
                {asset.verified_by_name ? <div>{asset.verified_by_name}</div> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function OrderAuditLog({
  rows,
  fillHeight,
  className,
}: {
  rows: PhysicalOrderAudit[]
  fillHeight?: boolean
  className?: string
}) {
  const [expandedIds, setExpandedIds] = React.useState<Set<number>>(new Set())
  const displayRows = React.useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime() ||
          b.id - a.id,
      ),
    [rows],
  )

  const auditRows = React.useMemo((): AuditTrailRow[] => {
    return displayRows.map((ev) => ({
      id: String(ev.id),
      at: ev.created_at,
      by: ev.actor_name?.trim() || "System",
      activity: (
        <ActivityCell
          ev={ev}
          expanded={expandedIds.has(ev.id)}
          onToggleVerified={() => {
            setExpandedIds((prev) => {
              const next = new Set(prev)
              if (next.has(ev.id)) next.delete(ev.id)
              else next.add(ev.id)
              return next
            })
          }}
        />
      ),
    }))
  }, [displayRows, expandedIds])

  return (
    <AuditTrailTable
      rows={auditRows}
      fillHeight={fillHeight}
      className={className}
      emptyDescription="No audit events recorded yet."
      descriptionFallback=""
    />
  )
}
