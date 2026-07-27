import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPanel,
  AdminPillBadge,
  AdminPrimaryButton,
  adminSelectClass,
  adminTextareaClass,
} from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ApiError, getJson, postJson } from "@/lib/api"
import {
  transferStatusLabel,
  transferStatusPillTone,
  type TransferOrderDetail,
} from "@/lib/transfer-types"
import { useAssetMasterLookups } from "@/lib/use-asset-masters"
import { cn } from "@/lib/utils"
import { CapexAssigneePickerDialog } from "@/pages/capex/capex-assignee-picker-dialog"

type PickerMode = "submit" | "cf_approve" | "cc2_assign" | null

export function TransferOrderDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const orderId = Number(id)
  const [order, setOrder] = React.useState<TransferOrderDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [pickerMode, setPickerMode] = React.useState<PickerMode>(null)
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [rejectReason, setRejectReason] = React.useState("")
  const [toCostCenterId, setToCostCenterId] = React.useState("")
  const [toFunctionalLocation, setToFunctionalLocation] = React.useState("")
  const [toActualLocation, setToActualLocation] = React.useState("")
  const masters = useAssetMasterLookups(order?.plant_id ?? null)

  const load = React.useCallback(async () => {
    if (!Number.isFinite(orderId)) return
    setLoading(true)
    try {
      const res = await getJson<TransferOrderDetail>(`/admin/transfer-orders/${orderId}`)
      setOrder(res)
      setToCostCenterId(String(res.to_cost_center_id))
      setToFunctionalLocation(res.to_functional_location ?? "")
      setToActualLocation(res.to_actual_location ?? "")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to load transfer order")
      navigate("/dashboard/transfer-orders")
    } finally {
      setLoading(false)
    }
  }, [orderId, navigate])

  React.useEffect(() => {
    void load()
  }, [load])

  async function run(action: () => Promise<TransferOrderDetail>, okMessage: string) {
    setBusy(true)
    try {
      const res = await action()
      setOrder(res)
      toast.success(okMessage)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed")
    } finally {
      setBusy(false)
      setPickerMode(null)
    }
  }

  if (loading || !order) {
    return (
      <AdminPage>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminPage>
    )
  }

  const pickerUrl =
    pickerMode === "cf_approve" || pickerMode === "cc2_assign"
      ? pickerMode === "cf_approve"
        ? "/admin/transfer-orders/assignees?level=cost_center"
        : "/admin/transfer-orders/assignees?level=central_finance"
      : "/admin/transfer-orders/assignees?level=central_finance"

  const pickerLabel =
    pickerMode === "cf_approve"
      ? "Cost Center User (CC2)"
      : pickerMode === "cc2_assign"
        ? "Central Finance"
        : "Central Finance"

  return (
    <AdminPage>
      <AdminBackLink to="/dashboard/transfer-orders">Transfer orders</AdminBackLink>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{order.order_number}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.plant_name} · {order.from_cost_center_code ?? "—"} → {order.to_cost_center_code}
          </p>
        </div>
        <AdminPillBadge tone={transferStatusPillTone(order.status)}>
          {transferStatusLabel(order.status)}
        </AdminPillBadge>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {order.can_submit ? (
          <AdminPrimaryButton
            type="button"
            disabled={busy}
            onClick={() => setPickerMode("submit")}
          >
            Submit to CF
          </AdminPrimaryButton>
        ) : null}
        {order.can_cf_decide ? (
          <>
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => setPickerMode("cf_approve")}
            >
              Approve & assign CC2
            </AdminPrimaryButton>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setRejectOpen(true)}>
              Reject
            </Button>
          </>
        ) : null}
        {order.can_cc2_assign ? (
          <AdminPrimaryButton
            type="button"
            disabled={busy}
            onClick={() => setPickerMode("cc2_assign")}
          >
            Assign to CF
          </AdminPrimaryButton>
        ) : null}
        {order.can_cf_confirm ? (
          <AdminPrimaryButton
            type="button"
            disabled={busy}
            onClick={() =>
              void run(
                () => postJson(`/admin/transfer-orders/${order.id}/cf/confirm`, {}),
                "Transfer confirmed and closed.",
              )
            }
          >
            Confirm transfer
          </AdminPrimaryButton>
        ) : null}
      </div>

      {order.rejection_reason ? (
        <AdminPanel className="mt-4 border-destructive/30 bg-destructive/5">
          <p className="text-sm font-medium text-destructive">Rejection reason</p>
          <p className="mt-1 text-sm">{order.rejection_reason}</p>
        </AdminPanel>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <AdminPanel className="space-y-3">
          <h2 className="text-sm font-semibold">Transfer destination</h2>
          <div className="space-y-1.5">
            <Label>Cost center</Label>
            {order.can_cf_decide ? (
              <select
                className={cn(adminSelectClass, "w-full")}
                value={toCostCenterId}
                onChange={(e) => setToCostCenterId(e.target.value)}
              >
                {masters.costCenters.map((cc) => (
                  <option key={cc.id} value={String(cc.id)}>
                    {cc.code}
                    {cc.description ? ` — ${cc.description}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm">
                {order.to_cost_center_code}
                {order.to_cost_center_description ? ` — ${order.to_cost_center_description}` : ""}
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Actual Location 1</Label>
              {order.can_cf_decide ? (
                <Input
                  value={toFunctionalLocation}
                  onChange={(e) => setToFunctionalLocation(e.target.value)}
                />
              ) : (
                <p className="text-sm">{order.to_functional_location ?? "—"}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Actual Location 2</Label>
              {order.can_cf_decide ? (
                <Input value={toActualLocation} onChange={(e) => setToActualLocation(e.target.value)} />
              ) : (
                <p className="text-sm">{order.to_actual_location ?? "—"}</p>
              )}
            </div>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>Created by {order.created_by_name ?? "—"}</p>
            <p>Assigned to {order.assigned_to_name ?? "—"}</p>
            {order.remarks ? <p>Remarks: {order.remarks}</p> : null}
          </div>
        </AdminPanel>

        <AdminPanel>
          <h2 className="mb-3 text-sm font-semibold">Assets ({order.items.length})</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead>From CC</TableHead>
                <TableHead>From Loc 1</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-medium">{item.asset_code}</div>
                    <div className="text-xs text-muted-foreground">{item.asset_name}</div>
                  </TableCell>
                  <TableCell>{item.from_cost_center_code ?? "—"}</TableCell>
                  <TableCell>{item.from_functional_location ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </AdminPanel>
      </div>

      {order.audit.length > 0 ? (
        <AdminPanel className="mt-4">
          <h2 className="mb-3 text-sm font-semibold">Activity</h2>
          <ul className="space-y-2 text-sm">
            {order.audit.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
                <span className="font-medium text-foreground">{a.action}</span>
                <span>{a.actor_name ?? "System"}</span>
                <span>{new Date(a.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </AdminPanel>
      ) : null}

      <CapexAssigneePickerDialog
        open={pickerMode != null}
        onOpenChange={(open) => {
          if (!open) setPickerMode(null)
        }}
        assigneesUrl={pickerUrl}
        roleLabel={pickerLabel}
        confirmLabel={
          pickerMode === "submit"
            ? "Submit"
            : pickerMode === "cf_approve"
              ? "Approve"
              : "Assign"
        }
        busy={busy}
        onConfirm={async (userId) => {
          if (pickerMode === "submit") {
            await run(
              () =>
                postJson(`/admin/transfer-orders/${order.id}/submit`, {
                  assigned_to: userId,
                }),
              "Submitted to Central Finance.",
            )
            return
          }
          if (pickerMode === "cf_approve") {
            await run(
              () =>
                postJson(`/admin/transfer-orders/${order.id}/cf/approve`, {
                  assigned_to: userId,
                  to_cost_center_id: toCostCenterId ? Number(toCostCenterId) : null,
                  to_functional_location: toFunctionalLocation.trim() || null,
                  to_actual_location: toActualLocation.trim() || null,
                }),
              "Approved and assigned to CC2. Asset locations updated.",
            )
            return
          }
          if (pickerMode === "cc2_assign") {
            await run(
              () =>
                postJson(`/admin/transfer-orders/${order.id}/cc2/assign`, {
                  assigned_to: userId,
                }),
              "Assigned to Central Finance for confirmation.",
            )
          }
        }}
      />

      {rejectOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <AdminPanel className="w-full max-w-md space-y-3">
            <h2 className="text-base font-semibold">Reject transfer</h2>
            <textarea
              className={cn(adminTextareaClass, "min-h-24 w-full")}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Rejection reason"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRejectOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy || !rejectReason.trim()}
                onClick={() => {
                  setRejectOpen(false)
                  void run(
                    () =>
                      postJson(`/admin/transfer-orders/${order.id}/cf/reject`, {
                        reason: rejectReason.trim(),
                      }),
                    "Transfer rejected and returned to CC1.",
                  )
                }}
              >
                Reject
              </Button>
            </div>
          </AdminPanel>
        </div>
      ) : null}
    </AdminPage>
  )
}
