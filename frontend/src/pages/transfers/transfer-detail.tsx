import * as React from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"


import { AdminPage } from "@/components/layout/admin-page"
import { PageLoader } from "@/components/ui/page-loader"
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
import { releaseAssetMasterSelectionUnlessReturn } from "@/lib/asset-master-selection"
import { Button } from "@/components/ui/button"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { ApiError, getJson, patchJson, postJson } from "@/lib/api"
import { invalidateTransferLists } from "@/lib/query-client"
import { approvedSentToMessage } from "@/lib/disposal-types"
import { formatAppDateTime as formatDt } from "@/lib/dates"
import type { ActualLocationMaster } from "@/lib/masters-types"
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
import { listReturnTo } from "@/lib/use-url-tab"
import {
  actualLocationLabel,
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

function SummaryField({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="min-w-0 rounded-md bg-muted/35 px-2.5 py-1.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.06em] !text-black">{label}</p>
      <div className="mt-0.5 min-w-0 text-sm font-medium leading-snug !text-black">{value}</div>
    </div>
  )
}

const transferTextPad = "px-[var(--app-card-padding)]"
const tableSelectClass = cn(
  adminSelectClass,
  "min-w-0 focus-visible:ring-inset",
)
const tableSelectCellClass = "min-w-0 overflow-hidden whitespace-normal px-4 py-2"

export function TransferOrderDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const backToAssets = Boolean((useLocation().state as { fromAssets?: boolean } | null)?.fromAssets)
  React.useEffect(() => {
    if (!backToAssets) return
    return () => releaseAssetMasterSelectionUnlessReturn()
  }, [backToAssets])
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
  const [itemCustodians, setItemCustodians] = React.useState<Record<number, number | null>>({})
  const [custodianOptions, setCustodianOptions] = React.useState<TransferAssigneeOption[]>([])
  const [custodiansLoading, setCustodiansLoading] = React.useState(false)
  const [itemLoc1, setItemLoc1] = React.useState<Record<number, string>>({})
  const [itemLoc2, setItemLoc2] = React.useState<Record<number, string>>({})
  const [plantActualLocations, setPlantActualLocations] = React.useState<ActualLocationMaster[]>([])
  const [plantCostCenters, setPlantCostCenters] = React.useState<TransferDestinationCostCenter[]>([])

  const masters = useAssetMasterLookups(order?.plant_id ?? null)

  const draftEditable = Boolean(order?.can_edit)
  const panel = order?.approval_panel
  const stepKind = (panel?.current_step_kind || "approve").toLowerCase()
  // Prefer the viewer's task; for receive, fall back to the pending receive task when
  // this viewer is the assigned receiver (can_cc2_assign) after a CF reject return.
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
        (order.items.some((i) => i.to_functional_location || i.to_actual_location) ||
          order.to_functional_location ||
          order.to_actual_location ||
          ["received_by_cc2", "confirmed_by_cf", "closed"].includes(order.status)),
    )

  const applyOrder = React.useCallback((res: TransferOrderDetail) => {
    setOrder(res)
    setToCostCenterId(String(res.to_cost_center_id))
    const custodians: Record<number, number | null> = {}
    for (const item of res.items) {
      custodians[item.asset_id] =
        item.to_asset_custodian_id ?? res.to_asset_custodian_id ?? null
    }
    setItemCustodians(custodians)
    // A reload must not discard locations the receiver picked but has not saved yet.
    const mergeLocations =
      (pick: (item: TransferOrderDetail["items"][number]) => string | null | undefined, orderLevel: string | null) =>
      (prev: Record<number, string>) =>
        Object.fromEntries(
          res.items.map((item) => [
            item.asset_id,
            pick(item) ?? prev[item.asset_id] ?? orderLevel ?? "",
          ]),
        )
    setItemLoc1(mergeLocations((i) => i.to_functional_location, res.to_functional_location))
    setItemLoc2(mergeLocations((i) => i.to_actual_location, res.to_actual_location))
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
      navigate(listReturnTo("/dashboard/transfer-orders"))
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
    const plantId = order?.plant_id
    if (!receiveEditable || plantId == null) {
      setPlantActualLocations([])
      return
    }
    let cancelled = false
    void getJson<ActualLocationMaster[]>(
      `/admin/asset-masters/actual-locations?plant_id=${plantId}&active_only=false`,
    )
      .then((rows) => {
        if (!cancelled) setPlantActualLocations(rows)
      })
      .catch(() => {
        if (!cancelled) setPlantActualLocations([])
      })
    return () => {
      cancelled = true
    }
  }, [order?.plant_id, receiveEditable])

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
        if (res.items.length === 1) {
          const only = res.items[0]!.id
          setItemCustodians((prev) => {
            const next = { ...prev }
            for (const key of Object.keys(next)) {
              const id = Number(key)
              if (next[id] == null) next[id] = only
            }
            return next
          })
        }
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
      void invalidateTransferLists()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed")
    } finally {
      setBusy(false)
      setPickerMode(null)
    }
  }

  /** Asset codes still missing Actual Location 1 or 2 — named in the error so the row is obvious. */
  function assetsMissingLocations(): string[] {
    return (order?.items ?? [])
      .filter(
        (item) =>
          !(itemLoc1[item.asset_id] ?? "").trim() || !(itemLoc2[item.asset_id] ?? "").trim(),
      )
      .map((item) => item.asset_code || String(item.asset_id))
  }

  function warnMissingLocations(_missing: string[]) {
    toast.error(
      "Select Actual Location 1 and 2 before receiving the asset.",
    )
  }

  function receiveLocationPayload() {
    const items = (order?.items ?? []).map((item) => ({
      asset_id: item.asset_id,
      to_functional_location: (itemLoc1[item.asset_id] ?? "").trim(),
      to_actual_location: (itemLoc2[item.asset_id] ?? "").trim(),
    }))
    return {
      item_locations: items,
      to_functional_location: items[0]?.to_functional_location ?? "",
      to_actual_location: items[0]?.to_actual_location ?? "",
    }
  }

  /** Park the locations picked so far; the rest can be filled in on a later visit. */
  async function saveReceiveLocations() {
    if (!order) return
    const pending = order.items.filter(
      (item) =>
        !(itemLoc1[item.asset_id] ?? "").trim() || !(itemLoc2[item.asset_id] ?? "").trim(),
    ).length
    await run(
      () =>
        postJson<TransferOrderDetail>(`/admin/transfer-orders/${order.id}/receive-locations`, {
          item_locations: order.items.map((item) => ({
            asset_id: item.asset_id,
            to_functional_location: (itemLoc1[item.asset_id] ?? "").trim() || null,
            to_actual_location: (itemLoc2[item.asset_id] ?? "").trim() || null,
          })),
        }),
      pending === 0
        ? "Actual Location saved successfully."
        : "Actual Location 1 and 2 are required.",
    )
  }

  async function confirmDecision(payload: {
    comment: string | null
    nextAssignedUserId: number | null
  }) {
    const taskId = myTaskId
    if (!taskId) return
    const kind = (order?.approval_panel?.current_step_kind || "approve").toLowerCase()
    const nextRoleName = order?.approval_panel?.next_step_role_name
    setBusy(true)
    try {
      await postJson(`/approvals/tasks/${taskId}/action`, {
        action: decisionMode,
        comment: payload.comment,
        ...(decisionMode === "approve" && payload.nextAssignedUserId != null
          ? { next_assigned_user_id: payload.nextAssignedUserId }
          : {}),
        ...(decisionMode === "approve" && kind === "receive" ? receiveLocationPayload() : {}),
      })
      setDecisionOpen(false)
      const ok =
        decisionMode === "reject"
          ? kind === "confirm"
            ? "Rejected — returned to the receiver on this same order."
            : "Transfer Order rejected."
          : kind === "receive"
            ? "Assets received and assigned to Central Finance for confirmation."
            : kind === "confirm"
              ? "Transfer receipt confirmed successfully."
              : kind === "close"
                ? "Transfer Order closed successfully."
                : approvedSentToMessage("Transfer Order", nextRoleName)
      toast.success(ok)
      void invalidateTransferLists()
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
    const missing = assetsMissingLocations()
    if (missing.length) {
      warnMissingLocations(missing)
      return
    }
    setBusy(true)
    try {
      await postJson(`/approvals/tasks/${taskId}/action`, {
        action: "approve",
        next_assigned_user_id: nextUserId,
        ...receiveLocationPayload(),
      })
      toast.success("Assets received and assigned to Central Finance for confirmation.")
      void invalidateTransferLists()
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
      setItemCustodians(
        Object.fromEntries((order?.items ?? []).map((item) => [item.asset_id, null])),
      )
    }
  }, [draftEditable, toCostCenterId, sourceCostCenterCodes, plantCostCenters])

  const isDirty = Boolean(
    order &&
      draftEditable &&
      ((toCostCenterId || "") !== String(order.to_cost_center_id ?? "") ||
        order.items.some(
          (item) =>
            (itemCustodians[item.asset_id] ?? null) !==
            (item.to_asset_custodian_id ?? order.to_asset_custodian_id ?? null),
        )),
  )

  const locationsDirty = Boolean(
    order?.items.some(
      (item) =>
        (itemLoc1[item.asset_id] ?? "") !== (item.to_functional_location ?? order.to_functional_location ?? "") ||
        (itemLoc2[item.asset_id] ?? "") !== (item.to_actual_location ?? order.to_actual_location ?? ""),
    ),
  )

  async function saveDraftChanges() {
    if (!order || !isDirty) return
    if (!toCostCenterId) {
      toast.error("Destination Cost Center is required.")
      return
    }
    const destCc = plantCostCenters.find((cc) => String(cc.id) === toCostCenterId)
    if (destCc && sourceCostCenterCodes.has(destCc.code)) {
      toast.error("Destination cost center must be different from the assets' current cost center.")
      return
    }
    if (order.items.some((item) => itemCustodians[item.asset_id] == null)) {
      toast.error("Destination Asset Custodian is mandatory.")
      return
    }
    const firstCustodian = itemCustodians[order.items[0]!.asset_id]
    await run(
      () =>
        patchJson(`/admin/transfer-orders/${order.id}`, {
          to_cost_center_id: Number(toCostCenterId),
          to_asset_custodian_id: firstCustodian,
          item_custodians: order.items.map((item) => ({
            asset_id: item.asset_id,
            to_asset_custodian_id: itemCustodians[item.asset_id] as number,
          })),
          to_functional_location: null,
          to_actual_location: null,
        }),
      "Transfer details saved successfully.",
    )
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
      void invalidateTransferLists()
      navigate(listReturnTo("/dashboard/transfer-orders"))
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
      void invalidateTransferLists()
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
      toast.success("Transfer Order restarted. Please update details and submit for approval.")
      void invalidateTransferLists()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not restart transfer")
    } finally {
      setBusy(false)
    }
  }

  if (loading || !order) {
    return (
      <AdminPage fullWidth viewportFill>
        {loading ? <PageLoader label="Loading transfer" /> : <p className="text-sm text-muted-foreground">Transfer not found.</p>}
      </AdminPage>
    )
  }

  const selectedCc = plantCostCenters.find((cc) => String(cc.id) === toCostCenterId)

  // The server resolves the next workflow step from the order, so the picker still fills
  // when the panel has not worked out next_assignee_role_id.
  const nextAssigneesUrl = `/admin/transfer-orders/assignees?for_next=true&order_id=${order.id}${
    panel?.next_assignee_role_id ? `&role_id=${panel.next_assignee_role_id}` : ""
  }`

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
            {transferStatusLabel(order.status, order.approval_panel?.current_step_role_name)}
          </AdminPillBadge>
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
                    "Transfer Order restarted. Please update details and submit for approval.",
                  )
                  void invalidateTransferLists()
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
              disabled={!isDirty || busy}
              onClick={() => void saveDraftChanges()}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          ) : null}
          {order.can_submit ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => {
                if (order.items.some((item) => itemCustodians[item.asset_id] == null)) {
                  toast.error("Destination Asset Custodian is mandatory.")
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
          {receiveEditable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={!locationsDirty || busy}
              onClick={() => void saveReceiveLocations()}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          ) : null}
          {engineReceive ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => {
                const missing = assetsMissingLocations()
                if (missing.length) {
                  warnMissingLocations(missing)
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
                const missing = assetsMissingLocations()
                if (missing.length) {
                  warnMissingLocations(missing)
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
                  "Transfer receipt confirmed successfully.",
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
                  "Transfer Order closed successfully.",
                )
              }
            >
              Close
            </AdminPrimaryButton>
          ) : null}
          <AdminBackLink to={listReturnTo(backToAssets ? "/dashboard/assets" : "/dashboard/transfer-orders")} />
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <div className="shrink-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {order.order_number}
          </h1>
          {/* <p className="mt-1 text-sm text-muted-foreground">
            {order.plant_name}
            {order.from_cost_center_code || order.to_cost_center_code
              ? ` · ${order.from_cost_center_code ?? "—"} → ${order.to_cost_center_code ?? "—"}`
              : null}
            {order.assigned_to_name
              ? ` · ${order.assigned_to_name}`
              : order.created_by_name
                ? ` · ${order.created_by_name}`
                : null}
          </p> */}
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
            <h3 className="text-sm font-semibold text-foreground">Transfer Summary</h3>
            <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
              <SummaryField label="Asset Count" value={order.items.length} />
              <SummaryField
                label="Source Cost Center"
                value={formatCostCenterWithCode(
                  order.from_cost_center_code,
                  masters.costCenters,
                  order.from_cost_center_description,
                )}
              />
              <SummaryField
                label="Destination Cost Center"
                value={
                  draftEditable ? (
                    <select
                      id="to_cc"
                      className={cn(adminSelectClass, "text-black")}
                      value={toCostCenterId}
                      onChange={(e) => {
                        setToCostCenterId(e.target.value)
                        setItemCustodians(
                          Object.fromEntries(order.items.map((item) => [item.asset_id, null])),
                        )
                      }}
                    >
                      <option value="">Select cost center</option>
                      {destinationCostCenters.map((cc) => (
                        <option key={cc.id} value={String(cc.id)}>
                          {formatCostCenterWithCode(cc.code, [cc], cc.name)}
                        </option>
                      ))}
                    </select>
                  ) : selectedCc ? (
                    formatCostCenterWithCode(selectedCc.code, [selectedCc], selectedCc.name)
                  ) : (
                    formatCostCenterWithCode(
                      order.to_cost_center_code,
                      masters.costCenters,
                      order.to_cost_center_description,
                    )
                  )
                }
              />
              <SummaryField label="Created On" value={formatDt(order.created_at)} />
            </div>
            {(order.status === "rejected" || order.status === "in_rework") &&
            (order.rejection_reason || "").trim() ? (
              <div className="min-w-0 overflow-hidden rounded-lg border border-red-200 bg-red-50/70 px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-red-700">
                  Rejected Reason
                </p>
                <p className="mt-1 whitespace-pre-wrap break-all text-sm leading-relaxed text-red-700">
                  {order.rejection_reason}
                </p>
              </div>
            ) : null}
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
              Asset List
            </p>
          </div>
          <div className="overflow-x-auto pb-4">
            <Table className="w-max min-w-full">
              <TableHeader>
                <AdminTableHeaderRow>
                  <AdminTableHeadCell className="min-w-[12rem] !text-black">
                    Asset Name
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="min-w-[8rem] !text-black">
                    Asset Number
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="min-w-[11rem] !text-black">
                    Source Cost Center
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="min-w-[12rem] !text-black">
                    From Actual Location 1
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="min-w-[12rem] !text-black">
                    From Actual Location 2
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="min-w-[10rem] !text-black">
                    Asset Custodian
                  </AdminTableHeadCell>
                  {showLocations ? (
                    <>
                      <AdminTableHeadCell className="min-w-[12rem] !text-black">
                        Actual Location 1
                      </AdminTableHeadCell>
                      <AdminTableHeadCell className="min-w-[12rem] !text-black">
                        Actual Location 2
                      </AdminTableHeadCell>
                    </>
                  ) : null}
                </AdminTableHeaderRow>
              </TableHeader>
              <TableBody>
                {order.items.length === 0 ? (
                  <AdminTableEmptyRow
                    colSpan={6 + (showLocations ? 2 : 0)}
                  >
                    No Assets
                  </AdminTableEmptyRow>
                ) : (
                  order.items.map((item) => {
                    const loc1 = itemLoc1[item.asset_id] ?? ""
                    const loc2 = itemLoc2[item.asset_id] ?? ""
                    const loc2Options = plantActualLocations.filter(
                      (l) => l.functional_location_code === loc1,
                    )
                    return (
                    <AdminTableBodyRow key={item.id} interactive={false}>
                      <AdminTableCell className="min-w-0 truncate px-4 py-2">
                        {item.asset_name || "—"}
                      </AdminTableCell>
                      <AdminTableCell className="min-w-0 truncate px-4 py-2">
                        {item.asset_code || "—"}
                      </AdminTableCell>
                      <AdminTableCell className="min-w-0 truncate px-4 py-2">
                        {formatCostCenterWithCode(
                          item.from_cost_center_code,
                          masters.costCenters,
                          order.from_cost_center_description,
                        )}
                      </AdminTableCell>
                      <AdminTableCell className="min-w-0 truncate px-4 py-2">
                        {item.from_functional_location_name ??
                          item.from_functional_location ??
                          "—"}
                      </AdminTableCell>
                      <AdminTableCell className="min-w-0 truncate px-4 py-2">
                        {item.from_actual_location_name ?? item.from_actual_location ?? "—"}
                      </AdminTableCell>
                      <AdminTableCell className={tableSelectCellClass}>
                        {draftEditable ? (
                          <select
                            className={tableSelectClass}
                            value={
                              itemCustodians[item.asset_id] != null
                                ? String(itemCustodians[item.asset_id])
                                : ""
                            }
                            disabled={
                              !toCostCenterId ||
                              custodiansLoading ||
                              custodianOptions.length === 0
                            }
                            onChange={(e) => {
                              const id = e.target.value ? Number(e.target.value) : null
                              setItemCustodians((prev) => ({
                                ...prev,
                                [item.asset_id]: id,
                              }))
                            }}
                            aria-label={`Custodian for ${item.asset_code}`}
                          >
                            <option value="">
                              {!toCostCenterId
                                ? "Select cost center first"
                                : custodiansLoading
                                  ? "Loading…"
                                  : custodianOptions.length === 0
                                    ? "No custodians assigned"
                                    : "Select Custodian"}
                            </option>
                            {custodianOptions.map((u) => (
                              <option key={u.id} value={String(u.id)}>
                                {u.full_name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          item.to_asset_custodian_name ??
                            (itemCustodians[item.asset_id] != null
                              ? (custodianOptions.find((u) => u.id === itemCustodians[item.asset_id])
                                  ?.full_name ?? "—")
                              : (order.to_asset_custodian_name ?? "—"))
                        )}
                      </AdminTableCell>
                      {showLocations ? (
                        receiveEditable ? (
                          <>
                            <AdminTableCell className={tableSelectCellClass}>
                              <select
                                className={tableSelectClass}
                                value={loc1}
                                onChange={(e) => {
                                  const next = e.target.value
                                  setItemLoc1((prev) => ({ ...prev, [item.asset_id]: next }))
                                  setItemLoc2((prev) => ({ ...prev, [item.asset_id]: "" }))
                                }}
                                aria-label={`Actual Location 1 for ${item.asset_code}`}
                              >
                                <option value="">Select location</option>
                                {masters.functionalLocations.map((l) => (
                                  <option key={l.id} value={l.code}>
                                    {functionalLocationLabel(l)}
                                  </option>
                                ))}
                              </select>
                            </AdminTableCell>
                            <AdminTableCell className={tableSelectCellClass}>
                              <select
                                className={tableSelectClass}
                                value={loc2}
                                disabled={!loc1}
                                onChange={(e) =>
                                  setItemLoc2((prev) => ({
                                    ...prev,
                                    [item.asset_id]: e.target.value,
                                  }))
                                }
                                aria-label={`Actual Location 2 for ${item.asset_code}`}
                              >
                                <option value="">
                                  {loc1 ? "Select location" : "Select Actual Location 1 first"}
                                </option>
                                {loc2Options.map((l) => (
                                  <option key={l.id} value={l.code}>
                                    {actualLocationLabel(l)}
                                  </option>
                                ))}
                              </select>
                            </AdminTableCell>
                          </>
                        ) : (
                          <>
                            <AdminTableCell className="min-w-0 truncate px-4 py-2">
                              {item.to_functional_location_name ??
                                item.to_functional_location ??
                                "—"}
                            </AdminTableCell>
                            <AdminTableCell className="min-w-0 truncate px-4 py-2">
                              {item.to_actual_location_name ?? item.to_actual_location ?? "—"}
                            </AdminTableCell>
                          </>
                        )
                      ) : null}
                    </AdminTableBodyRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </AdminPanel>

        <TransferAuditLog events={order.audit} assetCodeById={assetCodeById} fillHeight />
      </div>

      <CapexAssigneePickerDialog
        open={pickerMode != null}
        onOpenChange={(open) => {
          if (!open) setPickerMode(null)
        }}
        assigneesUrl={
          pickerMode === "cc2_assign"
            ? nextAssigneesUrl
            : `/admin/transfer-orders/assignees?for_submit=true&order_id=${order.id}`
        }
        excludeUserId={order.created_by}
        roleLabel={
          pickerMode === "cc2_assign"
            ? (panel?.next_step_role_name ?? "Next Approver")
            : "Approver"
        }
        title={pickerMode === "submit" ? "Submit for Approval" : "Receive Assets"}
        confirmLabel={
          pickerMode === "submit"
            ? "Submit"
            : engineReceive
              ? "Receive"
              : "Receive"
        }
        busy={busy}
        onConfirm={async (userId) => {
          if (pickerMode === "submit") {
            setBusy(true)
            try {
              if (order.can_edit) {
                if (order.items.some((item) => itemCustodians[item.asset_id] == null)) {
                  toast.error("Destination Asset Custodian is mandatory.")
                  setBusy(false)
                  setPickerMode(null)
                  return
                }
                await patchJson(`/admin/transfer-orders/${order.id}`, {
                  to_cost_center_id: toCostCenterId ? Number(toCostCenterId) : undefined,
                  to_asset_custodian_id: itemCustodians[order.items[0]!.asset_id],
                  item_custodians: order.items.map((item) => ({
                    asset_id: item.asset_id,
                    to_asset_custodian_id: itemCustodians[item.asset_id] as number,
                  })),
                  to_functional_location: null,
                  to_actual_location: null,
                })
              }
              const res = await postJson<TransferOrderDetail>(
                `/admin/transfer-orders/${order.id}/submit`,
                { assigned_to: userId },
              )
              applyOrder(res)
              toast.success("Transfer Order submitted for approval successfully.")
              void invalidateTransferLists()
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
                  ...receiveLocationPayload(),
                }),
              "Assets received and assigned to Central Finance for confirmation.",
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
              ? "Confirm Receive"
              : stepKind === "close"
                ? "Close Transfer"
                : "Approve"
        }
        confirmLabel={decisionMode === "reject" ? "Reject" : decisionConfirmLabel}
        needsNextAssignee={Boolean(panel?.needs_next_assignee) && decisionMode === "approve"}
        nextAssigneeLevel={null}
        nextStepRoleName={panel?.next_step_role_name ?? null}
        assigneesUrl={nextAssigneesUrl}
        selectUserMessage="Select a user to approve the Transfer Order."
        onConfirm={confirmDecision}
      />
      {confirmDialog}
    </AdminPage>
  )
}
