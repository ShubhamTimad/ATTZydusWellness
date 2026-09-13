import * as React from "react"
import { Search, Trash2 } from "lucide-react"
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
  AdminTableLoadingRow,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
  adminTextareaClass,
} from "@/components/layout/admin-ui"
import { AdminTableBodyRow } from "@/components/layout/list-page-ui"
import { releaseAssetMasterSelectionUnlessReturn } from "@/lib/asset-master-selection"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { ApiError, getJson, patchJson, postJson } from "@/lib/api"
import { invalidateDisposalLists } from "@/lib/query-client"
import { formatAppDateTime as formatWhen } from "@/lib/dates"
import type { AssetListItem, AssetListResponse } from "@/lib/assets-types"
import type { ActualLocationMaster, CostCenterMaster } from "@/lib/masters-types"
import {
  buildDisposalProgress,
  disposalStatusLabel,
  disposalStatusPillTone,
  type DisposalAssigneeListResponse,
  type DisposalAssigneeOption,
  type DisposalOrderDetail,
  type DisposalOrderItem,
} from "@/lib/disposal-types"
import { hasPermission, persistAuthFromMe } from "@/lib/permissions"
import {
  actualLocationLabel,
  costCenterLabel,
  formatCostCenterWithCode,
  functionalLocationLabel,
  plantLabel,
  useAssetMasterLookups,
} from "@/lib/use-asset-masters"
import { cn } from "@/lib/utils"
import { CapexAssigneePickerDialog } from "@/pages/capex/capex-assignee-picker-dialog"
import { CapexDecisionDialog } from "@/pages/capex/capex-decision-dialog"
import { CapexProcessFlow } from "@/pages/capex/capex-process-flow"
import { DisposalAuditLog } from "@/pages/disposals/disposal-audit-log"

type PickerMode = "submit" | "receive" | null

/** Backend rule: only active assets with approval approved/not_required can be disposed. */
function isApprovedForDisposal(asset: { approval_status?: string | null }): boolean {
  const approval = (asset.approval_status ?? "").trim().toLowerCase()
  return approval === "approved" || approval === "not_required"
}

/**
 * Assets already on this disposal stay pending_disposal until save restores removals.
 * Keep them selectable so rework can remove and re-add without waiting for save.
 */
function isSelectableOnThisOrder(
  asset: {
    id: number
    approval_status?: string | null
    lifecycle_status?: string | null
  },
  reservedAssetIds: Set<number>,
): boolean {
  if (!isApprovedForDisposal(asset)) return false
  const lifecycle = (asset.lifecycle_status ?? "").trim().toLowerCase()
  if (reservedAssetIds.has(asset.id)) {
    return !lifecycle || lifecycle === "active" || lifecycle === "pending_disposal"
  }
  return !lifecycle || lifecycle === "active"
}

function FormField({
  id,
  labelText,
  required,
  children,
  className,
}: {
  id?: string
  labelText: string
  required?: boolean
  children: React.ReactNode
  className?: string
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

function SummaryField({
  label,
  value,
  required,
}: {
  label: string
  value: React.ReactNode
  required?: boolean
}) {
  return (
    <div className="flex h-full min-w-[10.5rem] flex-col rounded-md bg-muted/35 px-3 py-2">
      <p className="min-h-[2.25rem] text-[10px] font-bold uppercase leading-tight tracking-[0.06em] !text-black">
        {label}
        {required ? <RequiredFieldMark /> : null}
      </p>
      <div className="mt-1 min-w-0 text-sm font-medium leading-snug !text-black">{value}</div>
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
  const [editPlantId, setEditPlantId] = React.useState<number | null>(null)
  const [assetSearch, setAssetSearch] = React.useState("")
  const [filterCostCenter, setFilterCostCenter] = React.useState("")
  const [catalog, setCatalog] = React.useState<AssetListItem[]>([])
  const [catalogLoading, setCatalogLoading] = React.useState(false)
  const [assetPickerOpen, setAssetPickerOpen] = React.useState(false)

  const lookupPlantId = order?.can_edit ? editPlantId : (order?.plant_id ?? null)
  const masters = useAssetMasterLookups(lookupPlantId ?? null)
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
    setEditPlantId(res.plant_id)
    setFilterCostCenter("")
    setAssetPickerOpen(false)
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
      navigate("/dashboard/disposal-orders", { replace: true })
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

  const selectedIds = React.useMemo(() => new Set(editAssets.map((a) => a.asset_id)), [editAssets])

  const reservedAssetIds = React.useMemo(
    () => new Set((order?.items ?? []).map((i) => i.asset_id)),
    [order?.items],
  )

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

  React.useEffect(() => {
    if (!order?.can_edit || !assetPickerOpen || editPlantId == null) {
      if (!assetPickerOpen) setCatalog([])
      return
    }
    let cancelled = false
    setCatalogLoading(true)
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams({
        page: "1",
        page_size: "100",
        plant_id: String(editPlantId),
        sort_by: "asset_code",
        sort_dir: "asc",
      })
      const q = assetSearch.trim()
      if (q) params.set("search", q)
      void getJson<AssetListResponse>(`/admin/assets?${params}`)
        .then((res) => {
          if (!cancelled) {
            setCatalog(res.items.filter((a) => isSelectableOnThisOrder(a, reservedAssetIds)))
          }
        })
        .catch(() => {
          if (!cancelled) setCatalog([])
        })
        .finally(() => {
          if (!cancelled) setCatalogLoading(false)
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [order?.can_edit, assetPickerOpen, editPlantId, assetSearch, reservedAssetIds])

  const filteredCatalog = React.useMemo(() => {
    const cc = filterCostCenter.trim()
    if (!cc) return catalog
    return catalog.filter((a) => (a.cost_center ?? "").trim() === cc)
  }, [catalog, filterCostCenter])

  function toggleCatalogAsset(a: AssetListItem) {
    if (selectedIds.has(a.id)) {
      setEditAssets((prev) => prev.filter((x) => x.asset_id !== a.id))
      return
    }
    if (!isSelectableOnThisOrder(a, reservedAssetIds)) {
      toast.error("Only active, approved assets can be disposed.")
      return
    }
    setEditAssets((prev) => [
      ...prev,
      {
        id: -a.id,
        asset_id: a.id,
        asset_code: a.asset_code,
        asset_name: a.asset_name ?? "",
        from_cost_center_code: a.cost_center ?? null,
        from_functional_location: a.functional_location ?? null,
        from_actual_location: a.actual_location ?? null,
        from_functional_location_name: a.functional_location_description ?? null,
        from_actual_location_name: a.actual_location_description ?? null,
      },
    ])
    setItemCustodians((prev) => ({
      ...prev,
      [a.id]: custodianOptions.length === 1 ? custodianOptions[0]!.id : null,
    }))
  }

  function removeEditAsset(assetId: number) {
    setEditAssets((prev) => prev.filter((a) => a.asset_id !== assetId))
  }

  function clearEditAssets() {
    setEditAssets([])
  }

  async function saveEdits() {
    if (!order) return
    if (editAssets.length === 0) {
      toast.error("Keep at least one asset on the disposal order.")
      return
    }
    if (!toCostCenterId) {
      toast.error("Select a scrapyard cost center.")
      return
    }
    const missing = assetsMissingCustodian()
    if (missing.length > 0) {
      warnMissingCustodian(missing)
      return
    }
    if (!remarks.trim()) {
      toast.error("Enter the disposal reason.")
      return
    }
    await run(
      () =>
        patchJson(`/admin/disposal-orders/${order.id}`, {
          remarks: remarks.trim() || null,
          requires_engineering: requiresEngineering,
          asset_ids: editAssets.map((a) => a.asset_id),
          to_cost_center_id: Number(toCostCenterId),
          ...custodianPayload(),
        }),
      "Disposal order saved.",
    )
  }

  /** Asset codes with no scrapyard custodian picked yet. */
  function assetsMissingCustodian(): string[] {
    return editAssets
      .filter((a) => itemCustodians[a.asset_id] == null)
      .map((a) => a.asset_code || String(a.asset_id))
  }

  function warnMissingCustodian(missing: string[]) {
    toast.error(`Select a custodian for ${missing.join(", ")}.`)
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

  function warnMissingLocations(missing: string[]) {
    toast.error(`Select Actual Location 1 and 2 for ${missing.join(", ")} before receiving.`)
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
        ? "Locations saved. You can receive this disposal now."
        : `Locations saved. ${pending} asset${pending === 1 ? "" : "s"} still need Actual Location 1 and 2.`,
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
          ? "Rejected."
          : kind === "receive"
            ? "Assets received."
            : kind === "close"
              ? "Disposal order closed."
              : "Approved."
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
    stepKind === "receive" ? "Receive & assign next" : stepKind === "close" ? "Close" : "Approve"

  const savedAssetIds = (order.items ?? []).map((i) => i.asset_id).slice().sort((a, b) => a - b)
  const editAssetIds = editAssets.map((a) => a.asset_id).slice().sort((a, b) => a - b)
  // Compared in edit-row order so reordering assets alone does not look like a custodian change.
  const savedCustodianIds = JSON.stringify(
    editAssets.map(
      (a) =>
        (order.items ?? []).find((i) => i.asset_id === a.asset_id)?.to_asset_custodian_id ?? null,
    ),
  )
  const isDirty =
    order.can_edit &&
    (requiresEngineering !== order.requires_engineering ||
      (remarks.trim() || "") !== (order.remarks ?? "").trim() ||
      (toCostCenterId || "") !==
        (order.to_cost_center_id != null ? String(order.to_cost_center_id) : "") ||
      savedCustodianIds !== JSON.stringify(editAssets.map((a) => itemCustodians[a.asset_id] ?? null)) ||
      JSON.stringify(editAssetIds) !== JSON.stringify(savedAssetIds))

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
                  navigate("/dashboard/disposal-orders")
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
                if (!toCostCenterId) {
                  toast.error("Select a scrapyard cost center and save before submitting.")
                  return
                }
                if (order.to_cost_center_id !== Number(toCostCenterId)) {
                  toast.error("Save the scrapyard cost center before submitting.")
                  return
                }
                const missing = assetsMissingCustodian()
                if (missing.length > 0) {
                  warnMissingCustodian(missing)
                  return
                }
                if (isDirty) {
                  toast.error("Save your changes before submitting.")
                  return
                }
                if (!remarks.trim()) {
                  toast.error("Enter the disposal reason.")
                  return
                }
                setPickerMode("submit")
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
              disabled={busy}
              onClick={() => void saveReceiveLocations()}
            >
              Save
            </Button>
          ) : null}
          {canDecide ? (
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
                {engineReceive ? "Receive & assign next" : engineClose ? "Close" : "Approve"}
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
                  "Disposal order approved. Assets marked disposed.",
                )
              }
            >
              Approve
            </AdminPrimaryButton>
          ) : null}
          <AdminBackLink to={backToAssets ? "/dashboard/assets" : "/dashboard/disposal-orders"}>
            {backToAssets ? "Asset Master" : "Disposal Orders"}
          </AdminBackLink>
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
          <div className={cn("space-y-3 py-3", disposalTextPad)}>
            <h3 className="text-sm font-bold text-black">Disposal Summary</h3>
            <div className="flex gap-2 overflow-x-auto pb-0.5">
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
              <SummaryField label="Assigned To" value={order.assigned_to_name || "—"} />
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

            {order.can_edit || order.can_close ? (
              <SummaryField
                label={order.can_close && !order.can_edit ? "Remarks" : "Disposal Reason"}
                required={order.can_edit}
                value={
                  <textarea
                    id="remarks"
                    className={cn(adminTextareaClass, "min-h-[72px] !text-black")}
                    placeholder={
                      order.can_close && !order.can_edit
                        ? "Remarks"
                        : "Enter the disposal reason"
                    }
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    rows={2}
                  />
                }
              />
            ) : (
              <SummaryField
                label="Disposal Reason"
                value={
                  <span className="whitespace-pre-wrap font-medium !text-black">
                    {order.remarks || "—"}
                  </span>
                }
              />
            )}
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
              <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
                ({editAssets.length})
              </span>
            </p>
            {order.can_edit ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={busy || editAssets.length === 0}
                  onClick={clearEditAssets}
                >
                  Clear All
                </Button>
              </div>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <Table className="w-max min-w-full">
              <TableHeader>
                <AdminTableHeaderRow>
                  <AdminTableHeadCell className="min-w-[12rem] !font-bold !text-black">
                    Asset Name
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
                  {order.can_edit ? (
                    <AdminTableHeadCell className="w-12 px-2">
                      <span className="sr-only">Remove</span>
                    </AdminTableHeadCell>
                  ) : null}
                </AdminTableHeaderRow>
              </TableHeader>
              <TableBody>
                  {editAssets.length === 0 ? (
                    <AdminTableEmptyRow
                      colSpan={5 + (showLocations ? 2 : 0) + (order.can_edit ? 1 : 0)}
                    >
                      {order.can_edit ? "No Assets selected." : "No Assets"}
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
                        <AdminTableCell className="min-h-0 min-w-0 truncate px-4 py-2 text-sm !text-black">
                          {item.asset_name || "—"}
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
                        {order.can_edit ? (
                          <AdminTableCell className="min-h-0 px-2 py-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                              disabled={busy}
                              aria-label={`Remove ${item.asset_code}`}
                              onClick={() => removeEditAsset(item.asset_id)}
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                            </Button>
                          </AdminTableCell>
                        ) : null}
                      </AdminTableBodyRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {order.can_edit && assetPickerOpen ? (
              <div className="space-y-3 border-t border-border/60 px-4 py-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <FormField id="edit_plant" labelText="Plant" required>
                    <select
                      id="edit_plant"
                      className={adminSelectClass}
                      value={editPlantId != null ? String(editPlantId) : ""}
                      disabled={busy}
                      onChange={(e) => {
                        const next = e.target.value ? Number(e.target.value) : null
                        setEditPlantId(next)
                        setEditAssets([])
                        setFilterCostCenter("")
                        setAssetSearch("")
                        setToCostCenterId("")
                      }}
                    >
                      <option value="">Select plant</option>
                      {masters.plants.map((p) => (
                        <option key={p.id} value={String(p.id)}>
                          {plantLabel(p)}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField id="filter_cc" labelText="Filter by cost center">
                    <select
                      id="filter_cc"
                      className={adminSelectClass}
                      value={filterCostCenter}
                      disabled={busy || editPlantId == null}
                      onChange={(e) => setFilterCostCenter(e.target.value)}
                    >
                      <option value="">All</option>
                      {masters.costCenters.map((cc) => (
                        <option key={cc.id} value={cc.code}>
                          {costCenterLabel(cc)}
                          {cc.code ? ` (${cc.code})` : ""}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField id="asset_search_edit" labelText="Search assets">
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                      />
                      <Input
                        id="asset_search_edit"
                        value={assetSearch}
                        disabled={editPlantId == null}
                        onChange={(e) => setAssetSearch(e.target.value)}
                        placeholder={
                          editPlantId == null ? "Select a plant first" : "Asset code or name…"
                        }
                        className="pl-9"
                        autoComplete="off"
                      />
                    </div>
                  </FormField>
                </div>
                <div className="-mx-4 max-h-64 overflow-auto border-t border-border/40">
                  <Table>
                    <TableHeader>
                      <AdminTableHeaderRow>
                        <AdminTableHeadCell className="h-9 w-10 px-3 py-2">
                          <span className="sr-only">Select</span>
                        </AdminTableHeadCell>
                        <AdminTableHeadCell className="h-9 px-3 py-2">Asset</AdminTableHeadCell>
                        <AdminTableHeadCell className="h-9 px-3 py-2">Cost center</AdminTableHeadCell>
                      </AdminTableHeaderRow>
                    </TableHeader>
                    <TableBody>
                      {editPlantId == null ? (
                        <AdminTableEmptyRow colSpan={3}>
                          Select a plant to list assets.
                        </AdminTableEmptyRow>
                      ) : catalogLoading ? (
                        <AdminTableLoadingRow colSpan={3} label="Loading assets" />
                      ) : filteredCatalog.length === 0 ? (
                        <AdminTableEmptyRow colSpan={3}>
                          No active, approved assets match this filter.
                        </AdminTableEmptyRow>
                      ) : (
                        filteredCatalog.map((a) => {
                          const checked = selectedIds.has(a.id)
                          return (
                            <AdminTableBodyRow key={a.id} interactive={false}>
                              <AdminTableCell className="min-h-0 px-3 py-1.5">
                                <Checkbox
                                  checked={checked}
                                  disabled={busy}
                                  aria-label={`Select ${a.asset_code}`}
                                  onCheckedChange={() => toggleCatalogAsset(a)}
                                />
                              </AdminTableCell>
                              <AdminTableCell className="min-h-0 px-3 py-1.5">
                                <div className="font-medium leading-tight">{a.asset_code}</div>
                                <div className="text-xs leading-tight text-muted-foreground">
                                  {a.asset_name || "—"}
                                </div>
                              </AdminTableCell>
                              <AdminTableCell className="min-h-0 px-3 py-1.5">
                                {a.cost_center ?? "—"}
                              </AdminTableCell>
                            </AdminTableBodyRow>
                          )
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}
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
        confirmLabel={
          pickerMode === "receive"
            ? engineReceive
              ? "Receive & assign next"
              : "Receive & assign CF"
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
                toast.success("Assets received.")
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
              "Assets received. Assigned to Central Finance for final approval.",
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
              ? "Close disposal"
              : stepKind === "receive"
                ? "Receive assets"
                : "Approve"
        }
        confirmLabel={decisionMode === "reject" ? "Reject" : decisionConfirmLabel}
        needsNextAssignee={Boolean(panel?.needs_next_assignee) && decisionMode === "approve"}
        nextAssigneeLevel={null}
        nextStepRoleName={panel?.next_step_role_name ?? null}
        assigneesUrl={nextAssigneesUrl}
        onConfirm={confirmDecision}
      />
      {confirmDialog}
    </AdminPage>
  )
}
