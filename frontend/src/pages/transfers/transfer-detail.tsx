import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"


import { RequiredFieldMark } from "@/components/assets/required-field-mark"
import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPanel,
  AdminPillBadge,
  AdminPrimaryButton,
  AdminTableCell,
  AdminTableEmptyRow,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { AdminTableBodyRow } from "@/components/layout/list-page-ui"
import { Button } from "@/components/ui/button"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { ApiError, deleteJson, getJson, patchJson, postJson } from "@/lib/api"
import { formatAppDateTime as formatDt } from "@/lib/dates"
import { hasPermission, persistAuthFromMe } from "@/lib/permissions"
import {
  buildTransferProgress,
  transferStatusLabel,
  transferStatusPillTone,
  type TransferAssigneeListResponse,
  type TransferAssigneeOption,
  type TransferDestinationCostCenter,
  type TransferOrderDetail,
} from "@/lib/transfer-types"
import {
  actualLocationLabel,
  costCenterLabel,
  formatCostCenterWithCode,
  functionalLocationLabel,
  useAssetMasterLookups,
} from "@/lib/use-asset-masters"
import { cn } from "@/lib/utils"
import { CapexAssigneePickerDialog } from "@/pages/capex/capex-assignee-picker-dialog"
import { CapexDecisionDialog } from "@/pages/capex/capex-decision-dialog"
import { CapexProcessFlow } from "@/pages/capex/capex-process-flow"
import { TransferAuditLog } from "@/pages/transfers/transfer-audit-log"

type PickerMode = "submit" | "cc2_assign" | null

function FormField({
  id,
  labelText,
  required,
  className,
  children,
}: {
  id?: string
  labelText: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("app-form-field", className)}>
      <Label htmlFor={id} className="app-form-label">
        {labelText}
        {required ? <RequiredFieldMark /> : null}
      </Label>
      {children}
    </div>
  )
}

function DetailFact({
  label,
  value,
  className,
}: {
  label: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm leading-snug font-medium text-foreground">
        {value}
      </dd>
    </div>
  )
}

function SummaryField({
  label,
  value,
  tone,
}: {
  label: string
  value: React.ReactNode
  tone?: "warning" | "success"
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md px-2.5 py-1.5",
        tone === "warning" && "bg-amber-50/90 dark:bg-amber-950/25",
        tone === "success" && "bg-emerald-50/90 dark:bg-emerald-950/25",
        !tone && "bg-muted/35",
      )}
    >
      <p
        className={cn(
          "text-[10px] font-medium uppercase tracking-[0.06em]",
          tone === "warning" && "text-amber-800/80 dark:text-amber-200/80",
          tone === "success" && "text-emerald-800/80 dark:text-emerald-200/80",
          !tone && "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 truncate text-sm font-semibold tabular-nums leading-snug",
          tone === "warning" && "text-amber-950 dark:text-amber-50",
          tone === "success" && "text-emerald-950 dark:text-emerald-50",
          !tone && "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  )
}

const transferTextPad = "px-[var(--app-card-padding)]"

export function TransferOrderDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const orderId = Number(id)
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()
  const [order, setOrder] = React.useState<TransferOrderDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [viewerUserId, setViewerUserId] = React.useState<number | null>(null)
  const [pickerMode, setPickerMode] = React.useState<PickerMode>(null)
  const [decisionOpen, setDecisionOpen] = React.useState(false)
  const [decisionMode, setDecisionMode] = React.useState<"approve" | "reject">("approve")
  const [toCostCenterId, setToCostCenterId] = React.useState("")
  const [toAssetCustodianId, setToAssetCustodianId] = React.useState<number | null>(null)
  const [custodianOptions, setCustodianOptions] = React.useState<TransferAssigneeOption[]>([])
  const [custodiansLoading, setCustodiansLoading] = React.useState(false)
  const [toFunctionalLocation, setToFunctionalLocation] = React.useState("")
  const [toActualLocation, setToActualLocation] = React.useState("")
  const [plantCostCenters, setPlantCostCenters] = React.useState<TransferDestinationCostCenter[]>([])

  const masters = useAssetMasterLookups(
    order?.plant_id ?? null,
    null,
    toFunctionalLocation || null,
  )

  const draftEditable = Boolean(order?.can_edit)
  const panel = order?.approval_panel
  const stepKind = (panel?.current_step_kind || "approve").toLowerCase()
  // Prefer the viewer's task; for receive, fall back to the pending receive task when
  // this viewer is the destination custodian (can_cc2_assign) after a CF reject return.
  const myTaskId =
    panel?.my_pending_task_id ??
    (order?.can_cc2_assign && stepKind === "receive" ? panel?.pending_task_id ?? null : null)
  const canDecide = Boolean(myTaskId) && hasPermission("approval.act")
  const engineReceive = canDecide && stepKind === "receive"
  const engineConfirm = canDecide && stepKind === "confirm"
  const engineClose = canDecide && stepKind === "close"
  const engineApprove = canDecide && stepKind === "approve"
  // Legacy operational buttons when engine is not driving this phase
  // (no approval_request, or request already approved / pre-step-kind orders).
  const engineOwnsOps = Boolean(
    order?.approval_request_id && panel?.request_status === "pending",
  )
  const legacyReceive = Boolean(order?.can_cc2_assign) && !engineOwnsOps
  const legacyConfirm = Boolean(order?.can_cf_confirm) && !engineOwnsOps
  const legacyClose = Boolean(order?.can_cf_close) && !engineOwnsOps
  const receiveEditable =
    Boolean(order?.can_cc2_assign) ||
    engineReceive ||
    (stepKind === "receive" &&
      viewerUserId != null &&
      panel?.current_assignee_user_id === viewerUserId)
  const showLocations =
    receiveEditable ||
    Boolean(
      order &&
        (order.to_functional_location ||
          order.to_actual_location ||
          ["received_by_cc2", "confirmed_by_cf", "closed"].includes(order.status)),
    )

  const applyOrder = React.useCallback((res: TransferOrderDetail) => {
    setOrder(res)
    setToCostCenterId(String(res.to_cost_center_id))
    setToAssetCustodianId(res.to_asset_custodian_id)
    setToFunctionalLocation(res.to_functional_location ?? "")
    setToActualLocation(res.to_actual_location ?? "")
  }, [])

  const load = React.useCallback(async () => {
    if (!Number.isFinite(orderId)) return
    setLoading(true)
    try {
      try {
        const me = await getJson<{ id: number; is_superuser?: boolean; permissions?: string[] }>(
          "/me",
        )
        persistAuthFromMe(me)
        setViewerUserId(typeof me.id === "number" ? me.id : null)
      } catch {
        /* keep cached permissions */
      }
      applyOrder(await getJson<TransferOrderDetail>(`/admin/transfer-orders/${orderId}`))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to load transfer order")
      navigate("/dashboard/transfer-orders")
    } finally {
      setLoading(false)
    }
  }, [orderId, navigate, applyOrder])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    const plantId = order?.plant_id
    if (plantId == null) {
      setPlantCostCenters([])
      return
    }
    let cancelled = false
    void getJson<TransferDestinationCostCenter[]>(
      `/admin/transfer-orders/destination-cost-centers?plant_id=${plantId}`,
    )
      .then((rows) => {
        if (!cancelled) setPlantCostCenters(rows)
      })
      .catch(() => {
        if (!cancelled) setPlantCostCenters([])
      })
    return () => {
      cancelled = true
    }
  }, [order?.plant_id])

  React.useEffect(() => {
    if (!toCostCenterId || !draftEditable) {
      setCustodianOptions([])
      return
    }
    let cancelled = false
    setCustodiansLoading(true)
    void getJson<TransferAssigneeListResponse>(
      `/admin/transfer-orders/cost-center-users?cost_center_id=${toCostCenterId}`,
    )
      .then((res) => {
        if (cancelled) return
        setCustodianOptions(res.items)
        setToAssetCustodianId((prev) => {
          if (prev != null && res.items.some((u) => u.id === prev)) return prev
          if (res.items.length === 1) return res.items[0]!.id
          return prev
        })
      })
      .catch(() => {
        if (!cancelled) setCustodianOptions([])
      })
      .finally(() => {
        if (!cancelled) setCustodiansLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [toCostCenterId, draftEditable])

  async function run(action: () => Promise<TransferOrderDetail>, okMessage: string) {
    setBusy(true)
    try {
      applyOrder(await action())
      toast.success(okMessage)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed")
    } finally {
      setBusy(false)
      setPickerMode(null)
    }
  }

  async function confirmDecision(payload: {
    comment: string | null
    nextAssignedUserId: number | null
  }) {
    const taskId = myTaskId
    if (!taskId) return
    const kind = (order?.approval_panel?.current_step_kind || "approve").toLowerCase()
    setBusy(true)
    try {
      await postJson(`/approvals/tasks/${taskId}/action`, {
        action: decisionMode,
        comment: payload.comment,
        ...(decisionMode === "approve" && payload.nextAssignedUserId != null
          ? { next_assigned_user_id: payload.nextAssignedUserId }
          : {}),
        ...(decisionMode === "approve" && kind === "receive"
          ? {
              to_functional_location: toFunctionalLocation.trim(),
              to_actual_location: toActualLocation.trim(),
            }
          : {}),
      })
      setDecisionOpen(false)
      const ok =
        decisionMode === "reject"
          ? kind === "confirm"
            ? "Rejected — returned to the receiver on this same order."
            : "Rejected."
          : kind === "receive"
            ? "Assets received."
            : kind === "confirm"
              ? "Receive confirmed."
              : kind === "close"
                ? "Transfer order closed."
                : "Approved."
      toast.success(ok)
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed.")
    } finally {
      setBusy(false)
    }
  }

  async function confirmReceiveViaEngine(nextUserId: number) {
    const taskId = myTaskId
    if (!taskId) return
    if (!toFunctionalLocation.trim() || !toActualLocation.trim()) {
      toast.error("Select Actual Location 1 and 2 before receiving.")
      return
    }
    setBusy(true)
    try {
      await postJson(`/approvals/tasks/${taskId}/action`, {
        action: "approve",
        next_assigned_user_id: nextUserId,
        to_functional_location: toFunctionalLocation.trim(),
        to_actual_location: toActualLocation.trim(),
      })
      toast.success("Assets received. Assigned for confirmation.")
      setPickerMode(null)
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed.")
    } finally {
      setBusy(false)
    }
  }

  const sourceCostCenterCodes = React.useMemo(() => {
    const codes = new Set<string>()
    if (!order) return codes
    for (const item of order.items) {
      const code = item.from_cost_center_code?.trim()
      if (code) codes.add(code)
    }
    if (order.from_cost_center_code?.trim()) {
      codes.add(order.from_cost_center_code.trim())
    }
    return codes
  }, [order])
  const destinationCostCenters = React.useMemo(
    () => plantCostCenters.filter((cc) => !sourceCostCenterCodes.has(cc.code)),
    [plantCostCenters, sourceCostCenterCodes],
  )

  const assetCodeById = React.useMemo(() => {
    const map = new Map<number, string>()
    for (const item of order?.items ?? []) {
      if (item.asset_id != null && item.asset_code) {
        map.set(item.asset_id, item.asset_code)
      }
    }
    return map
  }, [order?.items])

  // Clear destination if it matches a line item's current cost center (legacy drafts).
  React.useEffect(() => {
    if (!draftEditable || !toCostCenterId) return
    const selected = plantCostCenters.find((cc) => String(cc.id) === toCostCenterId)
    if (selected && sourceCostCenterCodes.has(selected.code)) {
      setToCostCenterId("")
      setToAssetCustodianId(null)
    }
  }, [draftEditable, toCostCenterId, sourceCostCenterCodes, plantCostCenters])

  async function saveDraftChanges() {
    if (!order) return
    if (!toCostCenterId) {
      toast.error("Select destination cost center.")
      return
    }
    const destCc = plantCostCenters.find((cc) => String(cc.id) === toCostCenterId)
    if (destCc && sourceCostCenterCodes.has(destCc.code)) {
      toast.error("Destination cost center must be different from the assets' current cost center.")
      return
    }
    if (toAssetCustodianId == null) {
      toast.error("Select the destination asset custodian.")
      return
    }
    await run(
      () =>
        patchJson(`/admin/transfer-orders/${order.id}`, {
          to_cost_center_id: Number(toCostCenterId),
          to_asset_custodian_id: toAssetCustodianId,
          to_functional_location: null,
          to_actual_location: null,
        }),
      "Transfer details saved.",
    )
  }

  async function deleteDraftOrder() {
    if (!order) return
    const ok = await confirmAsk({
      title: "Delete draft transfer?",
      description: "Permanently delete this draft transfer order? This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await deleteJson(`/admin/transfer-orders/${order.id}`)
      toast.success("Draft transfer order deleted.")
      navigate("/dashboard/transfer-orders")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete transfer order")
    } finally {
      setBusy(false)
    }
  }

  async function archiveTransferOrder() {
    if (!order) return
    const ok = await confirmAsk({
      title: "Archive transfer order?",
      description: "Archive this transfer order? It will be cancelled and kept in the audit trail.",
      confirmLabel: "Archive",
    })
    if (!ok) return
    setBusy(true)
    try {
      applyOrder(await postJson(`/admin/transfer-orders/${order.id}/archive`, {}))
      toast.success("Transfer order archived.")
      navigate("/dashboard/transfer-orders")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not archive transfer order")
    } finally {
      setBusy(false)
    }
  }

  async function unarchiveTransferOrder() {
    if (!order) return
    const ok = await confirmAsk({
      title: "Unarchive transfer order?",
      description: "Restore this transfer order so you can edit and resubmit it.",
      confirmLabel: "Unarchive",
    })
    if (!ok) return
    setBusy(true)
    try {
      applyOrder(await postJson(`/admin/transfer-orders/${order.id}/unarchive`, {}))
      toast.success("Transfer order unarchived.")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not unarchive transfer order")
    } finally {
      setBusy(false)
    }
  }

  async function restartTransfer() {
    if (!order) return
    const ok = await confirmAsk({
      title: "Restart transfer on this same order?",
      description:
        "Change destination cost center / custodian, then submit again for the full approval flow. Same order number and audit trail — no new transfer id.",
      confirmLabel: "Transfer",
    })
    if (!ok) return
    setBusy(true)
    try {
      applyOrder(
        await postJson<TransferOrderDetail>(
          `/admin/transfer-orders/${order.id}/restart-transfer`,
          {},
        ),
      )
      toast.success("Transfer Restarted as Draft — update destination, then submit for approval.")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not restart transfer")
    } finally {
      setBusy(false)
    }
  }

  if (loading || !order) {
    return (
      <AdminPage fullWidth dense description="" className="w-full pb-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminPage>
    )
  }

  const selectedCc = plantCostCenters.find((cc) => String(cc.id) === toCostCenterId)
  const selectedCustodian =
    custodianOptions.find((u) => u.id === toAssetCustodianId) ??
    (order.to_asset_custodian_id != null && order.to_asset_custodian_name
      ? {
          id: order.to_asset_custodian_id,
          full_name: order.to_asset_custodian_name,
          email: null,
        }
      : null)

  const progress = buildTransferProgress(order)
  const decisionConfirmLabel =
    stepKind === "confirm" ? "Confirm" : stepKind === "close" ? "Close" : "Approve"

  return (
    <AdminPage
      fullWidth
      dense
      viewportFill
      description=""
      className="w-full gap-3 pb-6"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AdminPillBadge
            tone={transferStatusPillTone(order.status)}
            className="h-9 px-3.5 text-sm font-semibold"
          >
            {transferStatusLabel(order.status)}
          </AdminPillBadge>
          {order.can_delete ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={() => void deleteDraftOrder()}
            >
              Delete draft
            </Button>
          ) : null}
          {order.can_archive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={() => void archiveTransferOrder()}
            >
              Archive
            </Button>
          ) : null}
          {order.can_unarchive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={() => void unarchiveTransferOrder()}
            >
              Unarchive
            </Button>
          ) : null}
          {order.can_resume ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  applyOrder(
                    await postJson<TransferOrderDetail>(
                      `/admin/transfer-orders/${order.id}/resume`,
                      {},
                    ),
                  )
                  toast.success(
                    "Transfer restarted as draft. Update details, then submit for approval.",
                  )
                } catch (e) {
                  toast.error(
                    e instanceof ApiError ? e.message : "Could not restart transfer order",
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              Restart
            </AdminPrimaryButton>
          ) : null}
          {draftEditable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={() => void saveDraftChanges()}
            >
              {busy ? "Saving…" : "Save Changes"}
            </Button>
          ) : null}
          {order.can_submit ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => {
                if (toAssetCustodianId == null) {
                  toast.error("Select the destination asset custodian before submitting.")
                  return
                }
                setPickerMode("submit")
              }}
            >
              Submit for Approval
            </AdminPrimaryButton>
          ) : null}
          {order.can_restart_transfer ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => void restartTransfer()}
            >
              Transfer
            </AdminPrimaryButton>
          ) : null}
          {engineApprove ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                disabled={busy}
                onClick={() => {
                  setDecisionMode("reject")
                  setDecisionOpen(true)
                }}
              >
                Reject
              </Button>
              <AdminPrimaryButton
                type="button"
                disabled={busy}
                onClick={() => {
                  setDecisionMode("approve")
                  setDecisionOpen(true)
                }}
              >
                Approve
              </AdminPrimaryButton>
            </>
          ) : null}
          {engineReceive ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => {
                if (!toFunctionalLocation.trim() || !toActualLocation.trim()) {
                  toast.error("Select Actual Location 1 and 2 before receiving.")
                  return
                }
                setPickerMode("cc2_assign")
              }}
            >
              Receive
            </AdminPrimaryButton>
          ) : null}
          {engineConfirm ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => {
                setDecisionMode("approve")
                setDecisionOpen(true)
              }}
            >
              Confirm
            </AdminPrimaryButton>
          ) : null}
          {engineClose ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => {
                setDecisionMode("approve")
                setDecisionOpen(true)
              }}
            >
              Close
            </AdminPrimaryButton>
          ) : null}
          {legacyReceive ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => {
                if (!toFunctionalLocation.trim() || !toActualLocation.trim()) {
                  toast.error("Select Actual Location 1 and 2 before receiving.")
                  return
                }
                setPickerMode("cc2_assign")
              }}
            >
              Receive
            </AdminPrimaryButton>
          ) : null}
          {legacyConfirm ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () => postJson(`/admin/transfer-orders/${order.id}/cf/confirm`, {}),
                  "Receive confirmed. Close the transfer order when ready.",
                )
              }
            >
              Confirm
            </AdminPrimaryButton>
          ) : null}
          {legacyClose ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () => postJson(`/admin/transfer-orders/${order.id}/cf/close`, {}),
                  "Transfer order closed.",
                )
              }
            >
              Close
            </AdminPrimaryButton>
          ) : null}
          <AdminBackLink to="/dashboard/transfer-orders">Transfer orders</AdminBackLink>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <div className="shrink-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {order.order_number}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.plant_name}
            {order.from_cost_center_code || order.to_cost_center_code
              ? ` · ${order.from_cost_center_code ?? "—"} → ${order.to_cost_center_code ?? "—"}`
              : null}
            {order.assigned_to_name
              ? ` · ${order.assigned_to_name}`
              : order.created_by_name
                ? ` · ${order.created_by_name}`
                : null}
          </p>
        </div>

        <AdminPanel className="shrink-0 overflow-hidden p-0">
          <div className={cn("border-b border-border/60 bg-muted/15 py-3", transferTextPad)}>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-black">
              Progress
            </p>
            <CapexProcessFlow steps={progress.steps} currentStepKey={progress.currentStepKey} />
          </div>
        </AdminPanel>

        <AdminPanel className="shrink-0 overflow-hidden p-0">
          <div className={cn("space-y-2 py-3", transferTextPad)}>
            <h3 className="text-sm font-semibold text-foreground">Transfer summary</h3>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
              <SummaryField label="Assets" value={order.items.length} />
              <SummaryField
                label="From"
                value={order.from_cost_center_code ?? "—"}
              />
              <SummaryField label="To" value={order.to_cost_center_code ?? "—"} />
              <SummaryField label="Created" value={formatDt(order.created_at)} />
              <SummaryField
                label="Assignee"
                value={order.assigned_to_name || order.to_asset_custodian_name || "—"}
              />
            </div>
          </div>
        </AdminPanel>

        <AdminPanel className="shrink-0 overflow-hidden p-0">
          <div className={cn("space-y-3 py-3", transferTextPad)}>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Transfer destination</h3>
              {order.can_restart_transfer || receiveEditable || draftEditable ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {order.can_restart_transfer
                    ? "Receive again with updated locations, or click Transfer to change destination and restart the full approval flow on this same order."
                    : receiveEditable
                      ? "Set Actual Location 1 / 2, then receive. Destination cost center stays as approved — same order id continues."
                      : "Update destination cost center and asset custodian. Locations are set when the destination custodian receives."}
                </p>
              ) : null}
            </div>
            {draftEditable ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField id="to_cc" labelText="Destination cost center" required>
                  <select
                    id="to_cc"
                    className={adminSelectClass}
                    value={toCostCenterId}
                    onChange={(e) => {
                      setToCostCenterId(e.target.value)
                      setToAssetCustodianId(null)
                    }}
                  >
                    <option value="">Select cost center</option>
                    {destinationCostCenters.map((cc) => (
                      <option key={cc.id} value={String(cc.id)}>
                        {costCenterLabel(cc)}
                        {cc.code ? ` (${cc.code})` : ""}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField id="to_custodian" labelText="Asset custodian" required>
                  {custodiansLoading ? (
                    <p className="text-sm text-muted-foreground">Loading custodians…</p>
                  ) : custodianOptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No asset custodians are assigned to this cost center. Add them under Asset
                      masters → CC custodians.
                    </p>
                  ) : (
                    <select
                      id="to_custodian"
                      className={adminSelectClass}
                      value={toAssetCustodianId != null ? String(toAssetCustodianId) : ""}
                      onChange={(e) =>
                        setToAssetCustodianId(e.target.value ? Number(e.target.value) : null)
                      }
                    >
                      <option value="">Select asset custodian</option>
                      {custodianOptions.map((u) => (
                        <option key={u.id} value={String(u.id)}>
                          {u.full_name}
                          {u.email ? ` — ${u.email}` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <DetailFact
                  label="Destination Cost Center"
                  value={
                    selectedCc
                      ? `${costCenterLabel(selectedCc)}${selectedCc.code ? ` (${selectedCc.code})` : ""}`
                      : order.to_cost_center_code
                        ? `${order.to_cost_center_code}${
                            order.to_cost_center_description
                              ? ` — ${order.to_cost_center_description}`
                              : ""
                          }`
                        : "—"
                  }
                />
                <DetailFact
                  label="Asset Custodian"
                  value={selectedCustodian?.full_name ?? order.to_asset_custodian_name ?? "—"}
                />
                {showLocations ? (
                  receiveEditable ? (
                    <div className="col-span-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <FormField id="loc1" labelText="Actual Location 1" required>
                        <select
                          id="loc1"
                          className={adminSelectClass}
                          value={toFunctionalLocation}
                          onChange={(e) => {
                            setToFunctionalLocation(e.target.value)
                            setToActualLocation("")
                          }}
                        >
                          <option value="">Select location</option>
                          {masters.functionalLocations.map((l) => (
                            <option key={l.id} value={l.code}>
                              {functionalLocationLabel(l)}
                            </option>
                          ))}
                        </select>
                      </FormField>
                      <FormField id="loc2" labelText="Actual Location 2" required>
                        <select
                          id="loc2"
                          className={adminSelectClass}
                          value={toActualLocation}
                          onChange={(e) => setToActualLocation(e.target.value)}
                          disabled={!toFunctionalLocation}
                        >
                          <option value="">
                            {toFunctionalLocation
                              ? "Select location"
                              : "Select Actual Location 1 first"}
                          </option>
                          {masters.actualLocations.map((l) => (
                            <option key={l.id} value={l.code}>
                              {actualLocationLabel(l)}
                            </option>
                          ))}
                        </select>
                      </FormField>
                    </div>
                  ) : (
                    <>
                      <DetailFact
                        label="Actual Location 1"
                        value={
                          order.to_functional_location_name ??
                          order.to_functional_location ??
                          "—"
                        }
                      />
                      <DetailFact
                        label="Actual Location 2"
                        value={
                          order.to_actual_location_name ?? order.to_actual_location ?? "—"
                        }
                      />
                    </>
                  )
                ) : null}
              </dl>
            )}
          </div>
        </AdminPanel>

        <AdminPanel className="shrink-0 overflow-hidden p-0">
          <div
            className={cn(
              "flex flex-nowrap items-center gap-2 border-b border-border/60 py-3",
              transferTextPad,
            )}
          >
            <p className="shrink-0 text-sm font-medium text-foreground">
              Assets
              <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
                ({order.items.length})
              </span>
            </p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <AdminTableHeaderRow>
                  <AdminTableHeadCell className="h-9 px-4 py-2 !text-black">Asset</AdminTableHeadCell>
                  <AdminTableHeadCell className="h-9 px-4 py-2 !text-black">From CC</AdminTableHeadCell>
                  <AdminTableHeadCell className="h-9 px-4 py-2 !text-black">
                    From Loc 1
                  </AdminTableHeadCell>
                </AdminTableHeaderRow>
              </TableHeader>
              <TableBody>
                {order.items.length === 0 ? (
                  <AdminTableEmptyRow colSpan={3}>No Assets</AdminTableEmptyRow>
                ) : (
                  order.items.map((item) => (
                    <AdminTableBodyRow key={item.id} interactive={false}>
                      <AdminTableCell className="min-h-0 whitespace-normal px-4 py-2">
                        <span className="font-mono text-xs text-foreground">{item.asset_code}</span>
                        <p className="mt-0.5 text-sm text-foreground">{item.asset_name || "—"}</p>
                      </AdminTableCell>
                      <AdminTableCell className="px-4 py-2">
                        {formatCostCenterWithCode(
                          item.from_cost_center_code,
                          masters.costCenters,
                          order.from_cost_center_description,
                        )}
                      </AdminTableCell>
                      <AdminTableCell className="px-4 py-2">
                        {item.from_functional_location_name ??
                          item.from_functional_location ??
                          "—"}
                      </AdminTableCell>
                    </AdminTableBodyRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </AdminPanel>

        <TransferAuditLog
          events={order.audit}
          assetCodeById={assetCodeById}
          fillHeight
          className="min-h-[14rem]"
        />
      </div>

      <CapexAssigneePickerDialog
        open={pickerMode != null}
        onOpenChange={(open) => {
          if (!open) setPickerMode(null)
        }}
        assigneesUrl={
          pickerMode === "cc2_assign"
            ? panel?.next_assignee_role_id
              ? `/admin/transfer-orders/assignees?role_id=${panel.next_assignee_role_id}&order_id=${order.id}`
              : undefined
            : `/admin/transfer-orders/assignees?for_submit=true&order_id=${order.id}`
        }
        roleLabel={
          pickerMode === "cc2_assign"
            ? (panel?.next_step_role_name ?? "Next Approver")
            : "Approver"
        }
        confirmLabel={
          pickerMode === "submit"
            ? "Submit"
            : engineReceive
              ? "Receive & Assign Next"
              : "Receive & Assign CF"
        }
        busy={busy}
        onConfirm={async (userId) => {
          if (pickerMode === "submit") {
            setBusy(true)
            try {
              if (order.can_edit) {
                if (toAssetCustodianId == null) {
                  toast.error("Select the destination asset custodian.")
                  setBusy(false)
                  setPickerMode(null)
                  return
                }
                await patchJson(`/admin/transfer-orders/${order.id}`, {
                  to_cost_center_id: toCostCenterId ? Number(toCostCenterId) : undefined,
                  to_asset_custodian_id: toAssetCustodianId,
                  to_functional_location: null,
                  to_actual_location: null,
                })
              }
              const res = await postJson<TransferOrderDetail>(
                `/admin/transfer-orders/${order.id}/submit`,
                { assigned_to: userId },
              )
              applyOrder(res)
              toast.success("Transfer order submitted for approval.")
            } catch (e) {
              toast.error(e instanceof ApiError ? e.message : "Action failed")
            } finally {
              setBusy(false)
              setPickerMode(null)
            }
            return
          }
          if (pickerMode === "cc2_assign") {
            if (engineReceive) {
              await confirmReceiveViaEngine(userId)
              return
            }
            await run(
              () =>
                postJson(`/admin/transfer-orders/${order.id}/cc2/assign`, {
                  assigned_to: userId,
                  to_functional_location: toFunctionalLocation.trim(),
                  to_actual_location: toActualLocation.trim(),
                }),
              "Assets received. Cost center, locations, and custodian updated. Assigned to CF for confirmation.",
            )
          }
        }}
      />

      <CapexDecisionDialog
        open={decisionOpen}
        onOpenChange={setDecisionOpen}
        mode={decisionMode}
        busy={busy}
        title={
          decisionMode === "reject"
            ? "Reject"
            : stepKind === "confirm"
              ? "Confirm receive"
              : stepKind === "close"
                ? "Close transfer"
                : "Approve"
        }
        confirmLabel={decisionMode === "reject" ? "Reject" : decisionConfirmLabel}
        needsNextAssignee={Boolean(panel?.needs_next_assignee) && decisionMode === "approve"}
        nextAssigneeLevel={null}
        nextStepRoleName={panel?.next_step_role_name ?? null}
        assigneesUrl={
          panel?.next_assignee_role_id
            ? `/admin/transfer-orders/assignees?role_id=${panel.next_assignee_role_id}&order_id=${order.id}`
            : undefined
        }
        onConfirm={confirmDecision}
      />
      {confirmDialog}
    </AdminPage>
  )
}
