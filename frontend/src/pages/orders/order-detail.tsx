import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { Clock } from "lucide-react"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPanel,
  AdminPrimaryButton,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
} from "@/components/layout/admin-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { ApiError, getJson, postJson } from "@/lib/api"
import { orderStatusLabel, type PhysicalOrderDetail } from "@/lib/orders-types"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

function formatDt(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function auditLabel(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function OrderDetailPage() {
  const { id } = useParams()
  const [order, setOrder] = React.useState<PhysicalOrderDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [scanValue, setScanValue] = React.useState("")
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [rejectReason, setRejectReason] = React.useState("")
  const [rejectMode, setRejectMode] = React.useState<"items" | "order">("items")

  const canApprove = hasPermission("order.approve")
  const canExecute = hasPermission("order.execute")
  const canCreate = hasPermission("order.create")

  const load = React.useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const res = await getJson<PhysicalOrderDetail>(`/admin/physical-orders/${id}`)
      setOrder(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load order")
    } finally {
      setLoading(false)
    }
  }, [id])

  React.useEffect(() => {
    void load()
  }, [load])

  async function runAction(path: string, body?: Record<string, unknown>) {
    if (!id) return
    setBusy(true)
    try {
      const res = await postJson<PhysicalOrderDetail>(
        `/admin/physical-orders/${id}${path}`,
        body ?? {},
      )
      setOrder(res)
      setSelected(new Set())
      toast.success("Updated.")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed.")
    } finally {
      setBusy(false)
    }
  }

  async function scan() {
    if (!scanValue.trim()) return
    setBusy(true)
    try {
      await postJson(`/admin/physical-orders/${id}/scan`, { scan_value: scanValue.trim() })
      setScanValue("")
      await load()
      toast.success("Asset verified.")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Scan failed.")
    } finally {
      setBusy(false)
    }
  }

  if (loading || !order) {
    return (
      <AdminPage>
        <p className="text-muted-foreground">{loading ? "Loading…" : "Order not found."}</p>
      </AdminPage>
    )
  }

  const isPendingApproval = order.status === "pending_approval"
  const isPendingClosure = order.status === "pending_closure_approval"
  const isApproved = order.status === "approved"
  const isInProgress = order.status === "in_progress"
  const isRejected = order.status === "rejected"

  return (
    <AdminPage description={`${order.plant_name} · ${order.cost_center_code}`}>
      <AdminBackLink to="/dashboard/orders">Back to orders</AdminBackLink>
      <h1 className="app-page-heading">{order.order_number}</h1>

      <AdminPanel className="mt-4 space-y-4 p-[var(--app-card-padding)]">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{orderStatusLabel(order.status)}</Badge>
          <span className="text-sm text-muted-foreground">
            Verified {order.verified_count} / {order.total_count}
          </span>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Created by</dt>
            <dd className="font-medium">{order.created_by_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Assigned to</dt>
            <dd className="font-medium">{order.assigned_to_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDt(order.created_at)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Started</dt>
            <dd>{formatDt(order.started_at)}</dd>
          </div>
        </dl>
        {order.remarks ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Remarks: </span>
            {order.remarks}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {isRejected && canCreate ? (
            <AdminPrimaryButton type="button" disabled={busy} onClick={() => void runAction("/submit")}>
              Resubmit for approval
            </AdminPrimaryButton>
          ) : null}
          {isApproved && canExecute ? (
            <AdminPrimaryButton type="button" disabled={busy} onClick={() => void runAction("/start")}>
              Start order
            </AdminPrimaryButton>
          ) : null}
          {isInProgress && canExecute ? (
            <>
              <div className="flex flex-1 flex-wrap items-end gap-2">
                <div className="min-w-[12rem] flex-1 space-y-1">
                  <Label htmlFor="scan">Scan RFID or asset code</Label>
                  <Input
                    id="scan"
                    value={scanValue}
                    onChange={(e) => setScanValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void scan()
                    }}
                    placeholder="Scan or type code…"
                  />
                </div>
                <Button type="button" variant="outline" disabled={busy} onClick={() => void scan()}>
                  Verify asset
                </Button>
              </div>
              <AdminPrimaryButton
                type="button"
                disabled={busy || order.verified_count < order.total_count}
                onClick={() => void runAction("/submit-closure")}
              >
                Submit for closure approval
              </AdminPrimaryButton>
            </>
          ) : null}
          {(isPendingApproval || isPendingClosure) && canApprove ? (
            <>
              <AdminPrimaryButton
                type="button"
                disabled={busy}
                onClick={() => void runAction("/approval/approve-all")}
              >
                Approve all assets
              </AdminPrimaryButton>
              <Button
                type="button"
                variant="outline"
                disabled={busy || selected.size === 0}
                onClick={() => void runAction("/approval/approve-items", { item_ids: [...selected] })}
              >
                Approve selected
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy || selected.size === 0}
                onClick={() => {
                  setRejectMode("items")
                  setRejectOpen(true)
                }}
              >
                Reject selected
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  setRejectMode("order")
                  setRejectOpen(true)
                }}
              >
                Reject entire order
              </Button>
              {isPendingClosure ? (
                <AdminPrimaryButton
                  type="button"
                  disabled={busy}
                  onClick={() => void runAction("/closure/approve-order")}
                >
                  Approve order (closure)
                </AdminPrimaryButton>
              ) : null}
            </>
          ) : null}
        </div>
      </AdminPanel>

      <AdminPanel className="mt-4 overflow-hidden p-0">
        <Table>
          <TableHeader>
            <AdminTableHeaderRow>
              {(isPendingApproval || isPendingClosure) && canApprove ? (
                <AdminTableHeadCell className="w-10">
                  <Checkbox
                    checked={selected.size === order.items.length && order.items.length > 0}
                    onCheckedChange={(on) => {
                      if (on) setSelected(new Set(order.items.map((i) => i.id)))
                      else setSelected(new Set())
                    }}
                  />
                </AdminTableHeadCell>
              ) : null}
              <AdminTableHeadCell>Asset code</AdminTableHeadCell>
              <AdminTableHeadCell>Asset name</AdminTableHeadCell>
              <AdminTableHeadCell>RFID</AdminTableHeadCell>
              <AdminTableHeadCell>Verification</AdminTableHeadCell>
              <AdminTableHeadCell>Rejection reason</AdminTableHeadCell>
            </AdminTableHeaderRow>
          </TableHeader>
          <TableBody>
            {order.items.map((item) => (
              <tr key={item.id} className="border-b border-border/60">
                {(isPendingApproval || isPendingClosure) && canApprove ? (
                  <AdminTableCell>
                    <Checkbox
                      checked={selected.has(item.id)}
                      onCheckedChange={(on) => {
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (on) next.add(item.id)
                          else next.delete(item.id)
                          return next
                        })
                      }}
                    />
                  </AdminTableCell>
                ) : null}
                <AdminTableCell className="font-mono text-xs">
                  <Link to={`/dashboard/assets/${item.asset_id}`} className="text-primary hover:underline">
                    {item.asset_code}
                  </Link>
                </AdminTableCell>
                <AdminTableCell>{item.asset_name}</AdminTableCell>
                <AdminTableCell className="font-mono text-xs">{item.rfid_code ?? "—"}</AdminTableCell>
                <AdminTableCell>
                  <Badge
                    variant={
                      item.verification_status === "approved"
                        ? "default"
                        : item.verification_status === "rejected"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {item.verification_status}
                  </Badge>
                </AdminTableCell>
                <AdminTableCell className="text-sm text-muted-foreground">
                  {item.rejection_reason ?? "—"}
                </AdminTableCell>
              </tr>
            ))}
          </TableBody>
        </Table>
      </AdminPanel>

      <AdminPanel className="mt-4 p-[var(--app-card-padding)]">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Clock className="size-4" aria-hidden />
          Audit timeline
        </h2>
        <ul className="space-y-3">
          {order.audit.length === 0 ? (
            <li className="text-sm text-muted-foreground">No audit events yet.</li>
          ) : (
            order.audit.map((ev) => (
              <li key={ev.id} className="border-l-2 border-primary/30 pl-3 text-sm">
                <p className="font-medium">{auditLabel(ev.action)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDt(ev.created_at)}
                  {ev.actor_name ? ` · ${ev.actor_name}` : ""}
                </p>
              </li>
            ))
          )}
        </ul>
      </AdminPanel>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {rejectMode === "order" ? "Reject entire order" : "Reject selected assets"}
            </DialogTitle>
            <DialogDescription>Rejection reason is required.</DialogDescription>
          </DialogHeader>
          <div className="dialog-body space-y-4">
            <textarea
              className={cn("w-full rounded-md border border-input bg-background px-3 py-2 text-sm")}
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRejectOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!rejectReason.trim() || busy}
                onClick={() => {
                  const reason = rejectReason.trim()
                  if (rejectMode === "order") {
                    void runAction("/approval/reject-order", { reason }).then(() => setRejectOpen(false))
                  } else {
                    void runAction("/approval/reject-items", {
                      item_ids: [...selected],
                      rejection_reason: reason,
                    }).then(() => setRejectOpen(false))
                  }
                }}
              >
                Confirm reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}
