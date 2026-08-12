import * as React from "react"
import { ChevronDown, ListTree } from "lucide-react"

import {
  AdminPanel,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
} from "@/components/layout/admin-ui"
import { AdminTableBodyRow } from "@/components/layout/list-page-ui"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import type { PhysicalOrderAudit } from "@/lib/orders-types"
import { cn } from "@/lib/utils"

function formatWhenParts(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: iso, time: "" }
  return {
    date: d.toLocaleDateString(undefined, { dateStyle: "medium" }),
    time: d.toLocaleTimeString(undefined, { timeStyle: "short" }),
  }
}

function formatDt(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function WhenCell({ at }: { at: string }) {
  const { date, time } = formatWhenParts(at)
  return (
    <div className="tabular-nums leading-tight">
      <div className="text-xs text-foreground">{date}</div>
      {time ? <div className="mt-0.5 text-[11px] text-muted-foreground">{time}</div> : null}
    </div>
  )
}

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
  const showVerifiedToggle = ev.action === "started" && verifiedAssets.length > 0
  const detail = ev.detail?.trim() || ""
  const nextMatch = detail.match(/^(Assigned (?:to|role):\s*.+?)(?:\s+[—-]\s+|$)/i)
  const nextLine = nextMatch?.[1]?.trim() || null
  const executorOnCreate =
    ev.action === "order_created" &&
    detail &&
    !/^Assigned (?:to|role):/i.test(detail) &&
    !detail.startsWith("Next")
      ? detail
      : null
  const restDetail = (() => {
    if (!detail) return null
    if (executorOnCreate) return null
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

      {executorOnCreate ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <span>Executor: </span>
          <span className="text-foreground">{executorOnCreate}</span>
        </p>
      ) : null}

      {nextLine ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <span className="text-foreground">{nextLine}</span>
        </p>
      ) : null}

      {restDetail ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{restDetail}</p>
      ) : null}

      {showVerifiedToggle && !expanded ? (
        <p className="text-[11px] text-muted-foreground">
          {verifiedAssets.length} asset{verifiedAssets.length === 1 ? "" : "s"} verified — click{" "}
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
                  <span className="text-muted-foreground"> · {asset.asset_name}</span>
                ) : null}
                {asset.rfid_code ? (
                  <p className="font-mono text-[10px] text-muted-foreground">RFID {asset.rfid_code}</p>
                ) : null}
              </div>
              <div className="shrink-0 text-right text-muted-foreground">
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

const cellClass = "px-4 py-2.5 align-top"
const headClass = "px-4 py-2.5"

export function OrderAuditLog({ rows }: { rows: PhysicalOrderAudit[] }) {
  const [expandedIds, setExpandedIds] = React.useState<Set<number>>(new Set())
  const displayRows = React.useMemo(
    () => [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [rows],
  )

  if (displayRows.length === 0) return null

  return (
    <AdminPanel
      title="Audit Trail"
      description={`${displayRows.length} ${displayRows.length === 1 ? "entry" : "entries"}`}
      contentClassName="p-0"
      className="shrink-0 overflow-hidden"
    >
      <div className="max-h-[min(22rem,48vh)] overflow-auto overscroll-y-contain">
        <Table className="app-table-head-sticky">
          <TableHeader>
            <AdminTableHeaderRow className="bg-muted/30 hover:bg-muted/30">
              <AdminTableHeadCell className={cn(headClass, "w-[9.5rem]")}>When</AdminTableHeadCell>
              <AdminTableHeadCell className={cn(headClass, "w-[7.5rem]")}>By</AdminTableHeadCell>
              <AdminTableHeadCell className={headClass}>Activity</AdminTableHeadCell>
            </AdminTableHeaderRow>
          </TableHeader>
          <TableBody>
            {displayRows.map((ev, index) => (
              <AdminTableBodyRow
                key={ev.id}
                interactive={false}
                className={cn("border-border/40", index % 2 === 1 && "bg-muted/[0.18]")}
              >
                <AdminTableCell className={cellClass}>
                  <WhenCell at={ev.created_at} />
                </AdminTableCell>
                <AdminTableCell className={cellClass}>
                  <span className="text-sm font-medium text-foreground">
                    {ev.actor_name?.trim() || "System"}
                  </span>
                </AdminTableCell>
                <AdminTableCell className={cellClass}>
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
                </AdminTableCell>
              </AdminTableBodyRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </AdminPanel>
  )
}
