import * as React from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"


import { RequiredFieldMark } from "@/components/assets/required-field-mark"
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
  adminTextareaClass,
} from "@/components/layout/admin-ui"
import { AdminTableBodyRow } from "@/components/layout/list-page-ui"
import { releaseAssetMasterSelectionUnlessReturn } from "@/lib/asset-master-selection"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { ApiError, getJson, patchJson, postJson } from "@/lib/api"
import { invalidateDisposalLists } from "@/lib/query-client"
import { formatAppDateTime as formatWhen } from "@/lib/dates"
import type { ActualLocationMaster, CostCenterMaster } from "@/lib/masters-types"
import {
  approvedSentToMessage,
  buildDisposalProgress,
  disposalStatusLabel,
  disposalStatusPillTone,
  type DisposalAssigneeListResponse,
  type DisposalAssigneeOption,
  type DisposalOrderDetail,
  type DisposalOrderItem,
} from "@/lib/disposal-types"
import { listReturnTo } from "@/lib/use-url-tab"
import { hasPermission, persistAuthFromMe } from "@/lib/permissions"
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
import { DisposalAuditLog } from "@/pages/disposals/disposal-audit-log"

type PickerMode = "submit" | "receive" | null

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

const disposalTextPad = "px-[var(--app-card-padding)]"

const tableSelectClass = cn(adminSelectClass, "min-w-0 focus-visible:ring-inset")
const tableSelectCellClass = "min-w-0 overflow-hidden whitespace-normal px-4 py-2"

function itemsToEditAssets(items: DisposalOrderItem[]): DisposalOrderItem[] {
  return items.map((i) => ({ ...i }))
}

export function DisposalOrderDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const backToAssets = Boolean((useLocation().state as { fromAssets?: boolean } | null)?.fromAssets)
  React.useEffect(() => {
    if (!backToAssets) return
    return () => releaseAssetMasterSelectionUnlessReturn()
  }, [backToAssets])
  const orderId = Number(id)
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()
  const [order, setOrder] = React.useState<DisposalOrderDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [pickerMode, setPickerMode] = React.useState<PickerMode>(null)
  const [decisionOpen, setDecisionOpen] = React.useState(false)
  const [decisionMode, setDecisionMode] = React.useState<"approve" | "reject">("approve")
  const [requiresEngineering, setRequiresEngineering] = React.useState(false)
  const [remarks, setRemarks] = React.useState("")
  const [toCostCenterId, setToCostCenterId] = React.useState("")
  const [itemCustodians, setItemCustodians] = React.useState<Record<number, number | null>>({})
  const [custodianOptions, setCustodianOptions] = React.useState<DisposalAssigneeOption[]>([])
  const [custodiansLoading, setCustodiansLoading] = React.useState(false)
  const [itemLoc1, setItemLoc1] = React.useState<Record<number, string>>({})
  const [itemLoc2, setItemLoc2] = React.useState<Record<number, string>>({})
  const [plantActualLocations, setPlantActualLocations] = React.useState<ActualLocationMaster[]>([])
  const [editAssets, setEditAssets] = React.useState<DisposalOrderItem[]>([])

  const lookupPlantId = order?.plant_id ?? null
  const masters = useAssetMasterLookups(lookupPlantId)
  const [scrapyardCostCenters, setScrapyardCostCenters] = React.useState<CostCenterMaster[]>([])
  const scrapyardFunctionalLocations = React.useMemo(
    () =>
      masters.functionalLocations.filter(
        (fl) => Boolean(fl.is_scrapyard) && fl.is_active !== false,
      ),
    [masters.functionalLocations],
  )

  const panel = order?.approval_panel
  const stepKind = (panel?.current_step_kind || "approve").toLowerCase()
  const canDecide = Boolean(panel?.my_pending_task_id) && hasPermission("approval.act")
  const engineReceive = canDecide && stepKind === "receive"
  const engineClose = canDecide && stepKind === "close"
  const receiveEditable = Boolean(order?.can_receive) || engineReceive
  const showLocations =
    receiveEditable ||
    Boolean(
      order &&
        (order.items.some((i) => i.to_functional_location || i.to_actual_location) ||
          ["pending_cf_close", "closed"].includes(order.status)),
    )

  const applyOrder = React.useCallback((res: DisposalOrderDetail) => {
    setOrder(res)
    setRequiresEngineering(res.requires_engineering)
    setRemarks(res.remarks ?? "")
    setToCostCenterId(res.to_cost_center_id != null ? String(res.to_cost_center_id) : "")
    setItemCustodians(
      Object.fromEntries(
        res.items.map((i) => [i.asset_id, i.to_asset_custodian_id ?? res.receiver_user_id ?? null]),
      ),
    )
    // A reload must not discard locations the receiver picked but has not saved yet.
    const mergeLocations =
      (
        pick: (item: DisposalOrderItem) => string | null | undefined,
        orderLevel: string | null | undefined,
      ) =>
      (prev: Record<number, string>) =>
        Object.fromEntries(
          res.items.map((item) => [
            item.asset_id,
            pick(item) ?? prev[item.asset_id] ?? orderLevel ?? "",
          ]),
        )
    setItemLoc1(mergeLocations((i) => i.to_functional_location, res.to_functional_location))
    setItemLoc2(mergeLocations((i) => i.to_actual_location, res.to_actual_location))
    setEditAssets(itemsToEditAssets(res.items))
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
      } catch {
        /* keep cached permissions */
      }
      applyOrder(await getJson<DisposalOrderDetail>(`/admin/disposal-orders/${orderId}`))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to load disposal order")
      navigate(listReturnTo("/dashboard/disposal-orders"), { replace: true })
    } finally {
      setLoading(false)
    }
  }, [orderId, navigate, applyOrder])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    if (lookupPlantId == null) {
      setScrapyardCostCenters([])
      return
    }
    void getJson<CostCenterMaster[]>(
      `/admin/asset-masters/cost-centers?plant_id=${lookupPlantId}&active_only=true&scrapyard_only=true`,
    )
      .then(setScrapyardCostCenters)
      .catch(() => setScrapyardCostCenters([]))
  }, [lookupPlantId])

  React.useEffect(() => {
    if (!order?.can_edit || toCostCenterId || scrapyardCostCenters.length !== 1) return
    setToCostCenterId(String(scrapyardCostCenters[0]!.id))
  }, [order?.can_edit, scrapyardCostCenters, toCostCenterId])

  // Every scrapyard Actual Location 2 in the plant; each row narrows them by its own Location 1.
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
    if (!toCostCenterId || !order?.can_edit) {
      setCustodianOptions([])
      return
    }
    let cancelled = false
    setCustodiansLoading(true)
    void getJson<DisposalAssigneeListResponse>(
      `/admin/disposal-orders/cost-center-users?cost_center_id=${toCostCenterId}`,
    )
      .then((res) => {
        if (cancelled) return
        setCustodianOptions(res.items)
        // Drop picks the new yard does not employ; a yard with one custodian needs no picking.
        const valid = new Set(res.items.map((u) => u.id))
        const sole = res.items.length === 1 ? res.items[0]!.id : null
        setItemCustodians((prev) =>
          Object.fromEntries(
            Object.entries(prev).map(([assetId, current]) => [
              Number(assetId),
              current != null && valid.has(current) ? current : sole,
            ]),
          ),
        )
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
  }, [toCostCenterId, order?.can_edit])

  const derivedFromCc = React.useMemo(() => {
    const codes = [
      ...new Set(
        editAssets
          .map((a) => (a.from_cost_center_code ?? "").trim())
          .filter(Boolean),
      ),
    ]
    if (codes.length === 1) {
      const cc = masters.costCenters.find((c) => c.code === codes[0])
      return {
        code: codes[0],
        description: cc?.description ?? null,
      }
    }
    if (codes.length === 0) return null
    return {
      code: "Multiple",
      description: "Selected assets are from more than one cost center",
    }
  }, [editAssets, masters.costCenters])

  async function saveEdits(opts?: { quiet?: boolean }): Promise<boolean> {
    if (!order) return false
    if (editAssets.length === 0) {
      toast.error("At least one asset is required in the Disposal Order.")
      return false
    }
    if (!toCostCenterId) {
      toast.error("Scrapyard Cost Center is required.")
      return false
    }
    const missing = assetsMissingCustodian()
    if (missing.length > 0) {
      warnMissingCustodian(missing)
      return false
    }
    if (!remarks.trim()) {
      toast.error("Disposal Reason is required.")
      return false
    }
    setBusy(true)
    try {
      applyOrder(
        await patchJson(`/admin/disposal-orders/${order.id}`, {
          remarks: remarks.trim() || null,
          requires_engineering: requiresEngineering,
          asset_ids: editAssets.map((a) => a.asset_id),
          to_cost_center_id: Number(toCostCenterId),
          ...custodianPayload(),
        }),
      )
      if (!opts?.quiet) toast.success("Disposal Order saved successfully.")
      void invalidateDisposalLists()
      return true
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed")
      return false
    } finally {
      setBusy(false)
    }
  }

  /** Asset codes with no scrapyard custodian picked yet. */
  function assetsMissingCustodian(): string[] {
    return editAssets
      .filter((a) => itemCustodians[a.asset_id] == null)
      .map((a) => a.asset_code || String(a.asset_id))
  }

  function warnMissingCustodian(_missing: string[]) {
    toast.error("Asset Custodian is required.")
  }

  /** receiver_user_id mirrors the first asset so the workflow keeps one order-level receiver. */
  function custodianPayload() {
    return {
      receiver_user_id: itemCustodians[editAssets[0]?.asset_id ?? -1] ?? null,
      item_custodians: editAssets
        .filter((a) => itemCustodians[a.asset_id] != null)
        .map((a) => ({
          asset_id: a.asset_id,
          to_asset_custodian_id: itemCustodians[a.asset_id] as number,
        })),
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
    toast.error("Select Actual Location 1 and 2 before receiving the asset.")
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
    const pending = assetsMissingLocations().length
    await run(
      () =>
        postJson<DisposalOrderDetail>(`/admin/disposal-orders/${order.id}/receive-locations`, {
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

  async function run(action: () => Promise<DisposalOrderDetail>, okMessage: string) {
    setBusy(true)
    try {
      applyOrder(await action())
      toast.success(okMessage)
      void invalidateDisposalLists()
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
    const taskId = order?.approval_panel?.my_pending_task_id
    if (!taskId) return
    const kind = (order?.approval_panel?.current_step_kind || "approve").toLowerCase()
    const nextRoleName = order?.approval_panel?.next_step_role_name
    if (decisionMode === "approve" && kind === "receive") {
      const missing = assetsMissingLocations()
      if (missing.length > 0) {
        warnMissingLocations(missing)
        return
      }
    }
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
          ? "Disposal Order rejected."
          : kind === "receive"
            ? "Disposal Order approved and sent to Central Finance successfully."
            : kind === "close"
              ? "Disposal Order closed successfully."
              : approvedSentToMessage("Disposal Order", nextRoleName)
      toast.success(ok)
      void invalidateDisposalLists()
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed.")
    } finally {
      setBusy(false)
    }
  }

  if (loading || !order) {
    return (
      <AdminPage fullWidth viewportFill>
        {loading ? <PageLoader label="Loading disposal" /> : <p className="text-sm text-muted-foreground">Disposal not found.</p>}
      </AdminPage>
    )
  }

  const canEditEngineering = order.can_edit && hasPermission("disposal.submit_with_engineering")
  const progress = buildDisposalProgress(order)
  // Legacy workflows leave next_assignee_role_id null, so let the backend resolve the next
  // step from the order itself and pass the role only as a hint.
  const nextAssigneesUrl = `/admin/disposal-orders/assignees?order_id=${order.id}&for_next=true${
    panel?.next_assignee_role_id ? `&role_id=${panel.next_assignee_role_id}` : ""
  }`
  const decisionConfirmLabel =
    stepKind === "receive" ? "Receive" : stepKind === "close" ? "Close" : "Approve"

  const savedAssetIds = (order.items ?? []).map((i) => i.asset_id).slice().sort((a, b) => a - b)
  const editAssetIds = editAssets.map((a) => a.asset_id).slice().sort((a, b) => a - b)
  const savedCustodianIds = JSON.stringify(
    editAssets.map((a) => {
      const item = (order.items ?? []).find((i) => i.asset_id === a.asset_id)
      return item?.to_asset_custodian_id ?? order.receiver_user_id ?? null
    }),
  )
  const isDirty =
    order.can_edit &&
    (requiresEngineering !== order.requires_engineering ||
      (remarks.trim() || "") !== (order.remarks ?? "").trim() ||
      (toCostCenterId || "") !==
        (order.to_cost_center_id != null ? String(order.to_cost_center_id) : "") ||
      savedCustodianIds !== JSON.stringify(editAssets.map((a) => itemCustodians[a.asset_id] ?? null)) ||
      JSON.stringify(editAssetIds) !== JSON.stringify(savedAssetIds))
  const locationsDirty = (order.items ?? []).some(
    (item) =>
      (itemLoc1[item.asset_id] ?? "") !== (item.to_functional_location ?? order.to_functional_location ?? "") ||
      (itemLoc2[item.asset_id] ?? "") !== (item.to_actual_location ?? order.to_actual_location ?? ""),
  )

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
            tone={disposalStatusPillTone(order.status)}
            className="h-9 px-3.5 text-sm font-semibold"
          >
            {disposalStatusLabel(order.status, order.approval_panel?.current_step_role_name)}
          </AdminPillBadge>
          {order.can_edit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={!isDirty || busy}
              onClick={() => void saveEdits()}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          ) : null}
          {order.can_archive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={async () => {
                const ok = await confirmAsk({
                  title: "Archive Disposal Order?",
                  description:
                    "Archive this disposal order and reactivate its assets? The order stays for audit history.",
                  confirmLabel: "Archive",
                })
                if (!ok) return
                setBusy(true)
                try {
                  applyOrder(
                    await postJson(`/admin/disposal-orders/${order.id}/archive`, {}),
                  )
                  toast.success("Disposal order archived. Assets reactivated.")
                  void invalidateDisposalLists()
                  navigate(listReturnTo("/dashboard/disposal-orders"))
                } catch (e) {
                  toast.error(
                    e instanceof ApiError ? e.message : "Could not archive disposal order",
                  )
                } finally {
                  setBusy(false)
                }
              }}
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
              onClick={async () => {
                const ok = await confirmAsk({
                  title: "Unarchive disposal order?",
                  description:
                    "Restore this disposal order and lock its assets again so you can continue.",
                  confirmLabel: "Unarchive",
                })
                if (!ok) return
                setBusy(true)
                try {
                  applyOrder(
                    await postJson(`/admin/disposal-orders/${order.id}/unarchive`, {}),
                  )
                  toast.success("Disposal order unarchived.")
                  void invalidateDisposalLists()
                } catch (e) {
                  toast.error(
                    e instanceof ApiError ? e.message : "Could not unarchive disposal order",
                  )
                } finally {
                  setBusy(false)
                }
              }}
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
                    await postJson(`/admin/disposal-orders/${order.id}/resume`, {}),
                  )
                  toast.success("Disposal restarted as draft. Update details, then submit for approval.")
                  void invalidateDisposalLists()
                } catch (e) {
                  toast.error(
                    e instanceof ApiError ? e.message : "Could not restart disposal order",
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              Restart
            </AdminPrimaryButton>
          ) : null}
          {order.can_submit ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  if (!toCostCenterId) {
                    toast.error("Scrapyard Cost Center is required.")
                    return
                  }
                  const missing = assetsMissingCustodian()
                  if (missing.length > 0) {
                    warnMissingCustodian(missing)
                    return
                  }
                  if (!remarks.trim()) {
                    toast.error("Disposal Reason is required.")
                    return
                  }
                  if (isDirty) {
                    const saved = await saveEdits({ quiet: true })
                    if (!saved) return
                  }
                  setPickerMode("submit")
                })()
              }}
            >
              Submit for Approval
            </AdminPrimaryButton>
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
              Save
            </Button>
          ) : null}
          {canDecide ? (
            <>
              {!engineClose ? (
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
              ) : null}
              <AdminPrimaryButton
                type="button"
                disabled={busy}
                onClick={() => {
                  if (engineReceive) {
                    const missing = assetsMissingLocations()
                    if (missing.length > 0) {
                      warnMissingLocations(missing)
                      return
                    }
                    if (panel?.needs_next_assignee) {
                      setPickerMode("receive")
                      return
                    }
                  }
                  setDecisionMode("approve")
                  setDecisionOpen(true)
                }}
              >
                {engineReceive ? "Receive" : engineClose ? "Close" : "Approve"}
              </AdminPrimaryButton>
            </>
          ) : null}
          {order.can_receive && !canDecide ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => {
                const missing = assetsMissingLocations()
                if (missing.length > 0) {
                  warnMissingLocations(missing)
                  return
                }
                setPickerMode("receive")
              }}
            >
              Receive
            </AdminPrimaryButton>
          ) : null}
          {order.can_close && !canDecide ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    postJson(`/admin/disposal-orders/${order.id}/close`, {
                      remarks: remarks.trim() || null,
                    }),
                  "Disposal Order approved successfully.",
                )
              }
            >
              Approve
            </AdminPrimaryButton>
          ) : null}
          <AdminBackLink to={listReturnTo(backToAssets ? "/dashboard/assets" : "/dashboard/disposal-orders")} />
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
          <div className={cn("border-b border-border/60 bg-muted/15 py-3", disposalTextPad)}>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-black">
              Progress
            </p>
            <CapexProcessFlow steps={progress.steps} currentStepKey={progress.currentStepKey} />
          </div>
        </AdminPanel>

        <AdminPanel className="shrink-0 overflow-hidden p-0">
          <div className={cn("space-y-2 py-3", disposalTextPad)}>
            <h3 className="text-sm font-semibold text-foreground">Disposal Summary</h3>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
              <SummaryField label="Asset Count" value={editAssets.length} />
              <SummaryField
                label="Source Cost Center"
                value={
                  derivedFromCc?.code === "Multiple"
                    ? "Multiple"
                    : formatCostCenterWithCode(
                        derivedFromCc?.code ?? order.from_cost_center_code,
                        masters.costCenters,
                        order.from_cost_center_description ?? derivedFromCc?.description,
                      )
                }
              />
              <SummaryField
                label="Scrapyard Cost Center"
                value={
                  order.can_edit ? (
                    <select
                      id="to_scrapyard_cc"
                      className={adminSelectClass}
                      value={toCostCenterId}
                      onChange={(e) => {
                        setToCostCenterId(e.target.value)
                        setItemCustodians({})
                      }}
                    >
                      <option value="">
                        {scrapyardCostCenters.length === 0
                          ? "No scrapyard cost centers"
                          : "Select scrapyard"}
                      </option>
                      {scrapyardCostCenters.map((cc) => (
                        <option key={cc.id} value={String(cc.id)}>
                          {formatCostCenterWithCode(cc.code, [cc], cc.name)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    formatCostCenterWithCode(
                      order.to_cost_center_code,
                      masters.costCenters,
                      order.to_cost_center_description,
                    )
                  )
                }
              />
              <SummaryField label="Created On" value={formatWhen(order.created_at)} />
              <SummaryField
                label="Engineering Approval Required"
                value={
                  order.can_edit ? (
                    <Switch
                      id="requires_engineering"
                      checked={requiresEngineering}
                      disabled={!canEditEngineering}
                      onCheckedChange={(v) => setRequiresEngineering(v === true)}
                      aria-label="Engineering Approval Required"
                    />
                  ) : requiresEngineering ? (
                    "Yes"
                  ) : (
                    "No"
                  )
                }
              />
            </div>
            <div className="min-w-0 rounded-md bg-muted/35 px-2.5 py-1.5">
              <p className="text-xs font-bold uppercase tracking-[0.06em] text-black">
                {order.can_close && !order.can_edit ? "Remarks" : "Disposal Reason"}
                {order.can_edit ? <RequiredFieldMark /> : null}
              </p>
              {order.can_edit || order.can_close ? (
                <textarea
                  id="remarks"
                  className={cn(adminTextareaClass, "mt-1.5 min-h-[72px] !text-black")}
                  placeholder={
                    order.can_close && !order.can_edit
                      ? "Remarks"
                      : "Enter the disposal reason"
                  }
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={2}
                />
              ) : (
                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm font-normal leading-snug text-black">
                  {order.remarks || "—"}
                </p>
              )}
            </div>
            {(order.status === "rejected" || order.status === "in_rework") &&
            (order.rejection_comment || "").trim() ? (
              <div className="min-w-0 overflow-hidden rounded-lg border border-red-200 bg-red-50/70 px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-red-700">
                  Rejected Reason
                </p>
                <p className="mt-1 whitespace-pre-wrap break-all text-sm leading-relaxed text-red-700">
                  {order.rejection_comment}
                </p>
              </div>
            ) : null}
          </div>
        </AdminPanel>

        <AdminPanel className="shrink-0 overflow-hidden p-0">
          <div
            className={cn(
              "flex flex-nowrap items-center justify-between gap-2 border-b border-border/60 py-3",
              disposalTextPad,
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
                  <AdminTableHeadCell className="min-w-[12rem] !font-bold !text-black">
                    Asset Name
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="min-w-[8rem] !font-bold !text-black">
                    Asset Code
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="min-w-[11rem] !font-bold !text-black">
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
                  {editAssets.length === 0 ? (
                    <AdminTableEmptyRow colSpan={6 + (showLocations ? 2 : 0)}>
                      No Assets
                    </AdminTableEmptyRow>
                  ) : (
                    editAssets.map((item) => {
                      const loc1 = itemLoc1[item.asset_id] ?? ""
                      const loc2 = itemLoc2[item.asset_id] ?? ""
                      const loc2Options = plantActualLocations.filter(
                        (l) => l.functional_location_code === loc1,
                      )
                      return (
                      <AdminTableBodyRow key={item.asset_id} interactive={false}>
                        <AdminTableCell className="min-w-0 truncate px-4 py-2 !text-black">
                          {item.asset_name || "—"}
                        </AdminTableCell>
                        <AdminTableCell className="min-w-0 truncate px-4 py-2 !text-black">
                          {item.asset_code || "—"}
                        </AdminTableCell>
                        <AdminTableCell className="min-w-0 truncate px-4 py-2 !text-black">
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
                          {order.can_edit ? (
                            <select
                              className={tableSelectClass}
                              value={
                                itemCustodians[item.asset_id] != null
                                  ? String(itemCustodians[item.asset_id])
                                  : ""
                              }
                              disabled={
                                busy ||
                                !toCostCenterId ||
                                custodiansLoading ||
                                custodianOptions.length === 0
                              }
                              onChange={(e) =>
                                setItemCustodians((prev) => ({
                                  ...prev,
                                  [item.asset_id]: e.target.value ? Number(e.target.value) : null,
                                }))
                              }
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
                            (item.to_asset_custodian_name ?? order.receiver_name ?? "—")
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
                                  <option value="">
                                    {scrapyardFunctionalLocations.length === 0
                                      ? "No scrapyard locations for this plant"
                                      : "Select location"}
                                  </option>
                                  {scrapyardFunctionalLocations.map((l) => (
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
                              <AdminTableCell className="min-h-0 min-w-0 truncate px-4 py-2">
                                {item.to_functional_location_name ??
                                  item.to_functional_location ??
                                  "—"}
                              </AdminTableCell>
                              <AdminTableCell className="min-h-0 min-w-0 truncate px-4 py-2">
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

        <DisposalAuditLog events={order.audit} fillHeight />
          </div>

      <CapexAssigneePickerDialog
        open={pickerMode != null}
        onOpenChange={(open) => {
          if (!open) setPickerMode(null)
        }}
        assigneesUrl={
          pickerMode === "receive"
            ? nextAssigneesUrl
            : `/admin/disposal-orders/assignees?requires_engineering=${requiresEngineering ? "true" : "false"}&order_id=${order.id}`
        }
        roleLabel={
          pickerMode === "receive"
            ? (panel?.next_step_role_name ?? "Next Approver")
            : "Approver"
        }
        title={pickerMode === "receive" ? "Receive Assets" : "Submit for Approval"}
        confirmLabel={
          pickerMode === "receive"
            ? engineReceive
              ? "Receive"
              : "Receive"
            : "Submit"
        }
        busy={busy}
        onConfirm={async (userId) => {
          if (pickerMode === "receive") {
            if (engineReceive) {
              const taskId = panel?.my_pending_task_id
              if (!taskId) return
              setBusy(true)
              try {
                await postJson(`/approvals/tasks/${taskId}/action`, {
                  action: "approve",
                  next_assigned_user_id: userId,
                  ...receiveLocationPayload(),
                })
                toast.success("Disposal Order approved and sent to Central Finance successfully.")
                void invalidateDisposalLists()
                setPickerMode(null)
                await load()
              } catch (e) {
                toast.error(e instanceof ApiError ? e.message : "Action failed")
              } finally {
                setBusy(false)
              }
              return
            }
            const locations = receiveLocationPayload()
            await run(
              () =>
                postJson(`/admin/disposal-orders/${order.id}/receive`, {
                  assigned_to: userId,
                  functional_location: locations.to_functional_location,
                  actual_location: locations.to_actual_location,
                  item_locations: locations.item_locations,
                  remarks: remarks.trim() || null,
                }),
              "Disposal Order approved and sent to Central Finance successfully.",
            )
            return
          }
          await run(
            () =>
              postJson(`/admin/disposal-orders/${order.id}/submit`, {
                assignee_user_id: userId,
                requires_engineering: requiresEngineering,
              }),
            "Disposal order submitted for approval.",
          )
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
            : stepKind === "close"
              ? "Close Disposal"
              : stepKind === "receive"
                ? "Receive Assets"
                : "Approve"
        }
        confirmLabel={decisionMode === "reject" ? "Reject" : decisionConfirmLabel}
        needsNextAssignee={Boolean(panel?.needs_next_assignee) && decisionMode === "approve"}
        nextAssigneeLevel={null}
        nextStepRoleName={panel?.next_step_role_name ?? null}
        assigneesUrl={nextAssigneesUrl}
        selectUserMessage="Select a user to approve the Disposal Order."
        onConfirm={confirmDecision}
      />
      {confirmDialog}
    </AdminPage>
  )
}
