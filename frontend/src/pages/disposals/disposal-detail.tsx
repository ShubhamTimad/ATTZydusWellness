import * as React from "react"
import { Package, PackageX, Search, Trash2 } from "lucide-react"
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
  adminSwitchRowClass,
  adminTextareaClass,
} from "@/components/layout/admin-ui"
import { AdminTableBodyRow } from "@/components/layout/list-page-ui"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { ApiError, deleteJson, getJson, patchJson, postJson } from "@/lib/api"
import type { AssetListItem, AssetListResponse } from "@/lib/assets-types"
import type { CostCenterMaster } from "@/lib/masters-types"
import {
  buildDisposalProgress,
  disposalStatusLabel,
  disposalStatusPillTone,
  type DisposalOrderDetail,
  type DisposalOrderItem,
} from "@/lib/disposal-types"
import { hasPermission, persistAuthFromMe } from "@/lib/permissions"
import {
  actualLocationLabel,
  costCenterLabel,
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

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
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

function itemsToEditAssets(items: DisposalOrderItem[]): DisposalOrderItem[] {
  return items.map((i) => ({ ...i }))
}

export function DisposalOrderDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
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
  const [functionalLocation, setFunctionalLocation] = React.useState("")
  const [actualLocation, setActualLocation] = React.useState("")
  const [editAssets, setEditAssets] = React.useState<DisposalOrderItem[]>([])
  const [editPlantId, setEditPlantId] = React.useState<number | null>(null)
  const [assetSearch, setAssetSearch] = React.useState("")
  const [filterCostCenter, setFilterCostCenter] = React.useState("")
  const [catalog, setCatalog] = React.useState<AssetListItem[]>([])
  const [catalogLoading, setCatalogLoading] = React.useState(false)
  const [assetPickerOpen, setAssetPickerOpen] = React.useState(false)

  const lookupPlantId = order?.can_edit ? editPlantId : (order?.plant_id ?? null)
  const masters = useAssetMasterLookups(lookupPlantId ?? null, null, functionalLocation || null)
  const [scrapyardCostCenters, setScrapyardCostCenters] = React.useState<CostCenterMaster[]>([])
  const scrapyardFunctionalLocations = React.useMemo(
    () =>
      masters.functionalLocations.filter(
        (fl) => Boolean(fl.is_scrapyard) && fl.is_active !== false,
      ),
    [masters.functionalLocations],
  )

  const applyOrder = React.useCallback((res: DisposalOrderDetail) => {
    setOrder(res)
    setRequiresEngineering(res.requires_engineering)
    setRemarks(res.remarks ?? "")
    setToCostCenterId(res.to_cost_center_id != null ? String(res.to_cost_center_id) : "")
    setFunctionalLocation(res.to_functional_location?.trim() || "")
    setActualLocation(res.to_actual_location?.trim() || "")
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
    await run(
      () =>
        patchJson(`/admin/disposal-orders/${order.id}`, {
          remarks: remarks.trim() || null,
          requires_engineering: requiresEngineering,
          asset_ids: editAssets.map((a) => a.asset_id),
          to_cost_center_id: Number(toCostCenterId),
        }),
      "Disposal order saved.",
    )
  }

  async function run(action: () => Promise<DisposalOrderDetail>, okMessage: string) {
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
    const taskId = order?.approval_panel?.my_pending_task_id
    if (!taskId) return
    const kind = (order?.approval_panel?.current_step_kind || "approve").toLowerCase()
    if (decisionMode === "approve" && kind === "receive") {
      if (!functionalLocation.trim() || !actualLocation.trim()) {
        toast.error("Select Actual Location 1 and 2 before receiving.")
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
        ...(decisionMode === "approve" && kind === "receive"
          ? {
              to_functional_location: functionalLocation.trim(),
              to_actual_location: actualLocation.trim(),
            }
          : {}),
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
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed.")
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

  const panel = order.approval_panel
  const canDecide = Boolean(panel?.my_pending_task_id) && hasPermission("approval.act")
  const stepKind = (panel?.current_step_kind || "approve").toLowerCase()
  const engineReceive = canDecide && stepKind === "receive"
  const engineClose = canDecide && stepKind === "close"
  const canEditEngineering = order.can_edit && hasPermission("disposal.submit_with_engineering")
  const progress = buildDisposalProgress(order)
  const receiveEditable = Boolean(order.can_receive) || engineReceive
  const decisionConfirmLabel =
    stepKind === "receive" ? "Receive & assign next" : stepKind === "close" ? "Close" : "Approve"

  return (
    <AdminPage
      fullWidth
      dense
      description=""
      className="w-full gap-3 pb-6"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AdminPillBadge
            tone={disposalStatusPillTone(order.status)}
            className="h-9 px-3.5 text-sm font-semibold"
          >
            {disposalStatusLabel(order.status)}
          </AdminPillBadge>
          {order.can_edit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={() => void saveEdits()}
            >
              {busy ? "Saving…" : "Save changes"}
            </Button>
          ) : null}
          {order.can_delete ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={async () => {
                const ok = await confirmAsk({
                  title: "Delete draft disposal?",
                  description:
                    "Permanently delete this draft disposal order and reactivate its assets?",
                  confirmLabel: "Delete",
                  destructive: true,
                })
                if (!ok) return
                setBusy(true)
                try {
                  await deleteJson(`/admin/disposal-orders/${order.id}`)
                  toast.success("Draft disposal order deleted. Assets reactivated.")
                  navigate("/dashboard/disposal-orders")
                } catch (e) {
                  toast.error(
                    e instanceof ApiError ? e.message : "Could not delete disposal order",
                  )
                } finally {
                  setBusy(false)
                }
              }}
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
              onClick={async () => {
                const ok = await confirmAsk({
                  title: "Archive disposal order?",
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
                setPickerMode("submit")
              }}
            >
              Submit for approval
            </AdminPrimaryButton>
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
                    if (!functionalLocation.trim() || !actualLocation.trim()) {
                      toast.error("Select Actual Location 1 and 2 first.")
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
                if (!functionalLocation.trim() || !actualLocation.trim()) {
                  toast.error("Select Actual Location 1 and 2 first.")
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
          <AdminBackLink to="/dashboard/disposal-orders">Disposal orders</AdminBackLink>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="shrink-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {order.order_number}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {order.plant_name}
            {order.from_cost_center_code ? ` · ${order.from_cost_center_code}` : null}
            {order.assigned_to_name
              ? ` · ${order.assigned_to_name}`
              : order.created_by_name
                ? ` · ${order.created_by_name}`
                : null}
          </p>
        </div>

        <AdminPanel className="shrink-0 overflow-hidden p-0">
          <div className="border-b border-border/60 bg-muted/15 px-4 py-2.5 sm:px-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Progress
            </p>
            <CapexProcessFlow steps={progress.steps} currentStepKey={progress.currentStepKey} />
          </div>
        </AdminPanel>

        {order.rejection_comment ? (
          <AdminPanel
            className="border-destructive/30 bg-destructive/5"
            contentClassName="px-4 py-3"
          >
            <p className="text-sm font-medium text-destructive">Rejection comment</p>
            <p className="mt-1 text-sm">{order.rejection_comment}</p>
          </AdminPanel>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2">
          <AdminPanel
            title="Disposal Details"
            description={
              order.can_edit
                ? "Update the approval route and remarks before submitting."
                : undefined
            }
            headerActions={<PackageX className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="flex-1 px-4 py-3"
            className="flex h-full flex-col"
          >
            {order.can_edit ? (
              <div className="grid grid-cols-1 gap-3">
                <FormField labelText="From cost center">
                  <p className="text-sm">
                    {derivedFromCc
                      ? `${derivedFromCc.code}${
                          derivedFromCc.description ? ` — ${derivedFromCc.description}` : ""
                        }`
                      : "—"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Updates from the assets you select (same plant).
                  </p>
                </FormField>

                <FormField id="to_scrapyard_cc" labelText="Scrapyard cost center" required>
                  <select
                    id="to_scrapyard_cc"
                    className={adminSelectClass}
                    value={toCostCenterId}
                    onChange={(e) => setToCostCenterId(e.target.value)}
                  >
                    <option value="">
                      {scrapyardCostCenters.length === 0
                        ? "No scrapyard cost centers for this plant"
                        : "Select scrapyard"}
                    </option>
                    {scrapyardCostCenters.map((cc) => (
                      <option key={cc.id} value={String(cc.id)}>
                        {costCenterLabel(cc)}
                        {cc.code ? ` (${cc.code})` : ""}
                      </option>
                    ))}
                  </select>
                </FormField>

                <label
                  htmlFor="requires_engineering"
                  className={cn(
                    adminSwitchRowClass,
                    canEditEngineering && "cursor-pointer transition-colors hover:bg-muted/35",
                    !canEditEngineering && "opacity-70",
                    requiresEngineering && "border-primary/40 bg-primary/5",
                  )}
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <span className="block text-sm font-medium text-foreground">
                      Engineering Approval
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Routes through the Engineering disposal workflow.
                    </span>
                  </div>
                  <Checkbox
                    id="requires_engineering"
                    checked={requiresEngineering}
                    disabled={!canEditEngineering}
                    onCheckedChange={(v) => setRequiresEngineering(v === true)}
                    className="size-5 border-foreground/35 shadow-sm"
                    aria-label="Engineering approval"
                  />
                </label>

                <FormField id="remarks" labelText="Remarks">
                  <textarea
                    id="remarks"
                    className={cn(adminTextareaClass, "min-h-[72px]")}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    rows={2}
                  />
                </FormField>
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <DetailFact
                  label="From cost center"
                  value={
                    order.from_cost_center_code
                      ? `${order.from_cost_center_code}${
                          order.from_cost_center_description
                            ? ` — ${order.from_cost_center_description}`
                            : ""
                        }`
                      : "—"
                  }
                />
                <DetailFact
                  label="Scrapyard cost center"
                  value={
                    order.to_cost_center_code
                      ? `${order.to_cost_center_code}${
                          order.to_cost_center_description
                            ? ` — ${order.to_cost_center_description}`
                            : ""
                        }`
                      : "—"
                  }
                />
                {order.to_functional_location || order.to_actual_location ? (
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
                      value={order.to_actual_location_name ?? order.to_actual_location ?? "—"}
                    />
                  </>
                ) : null}
                <DetailFact
                  label="Engineering"
                  value={requiresEngineering ? "Required" : "Not required"}
                />
                <DetailFact label="Remarks" value={order.remarks || "—"} />
                {order.assigned_at ? (
                  <DetailFact label="Assigned at" value={formatWhen(order.assigned_at)} />
                ) : null}
                {order.closed_at ? (
                  <DetailFact label="Closed at" value={formatWhen(order.closed_at)} />
                ) : null}
                {order.can_close ? (
                  <FormField id="remarks" labelText="Remarks" className="col-span-2 !gap-1">
                    <textarea
                      id="remarks"
                      className={cn(adminTextareaClass, "min-h-[72px]")}
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      rows={2}
                    />
                  </FormField>
                ) : null}
              </dl>
            )}
          </AdminPanel>

          <AdminPanel
            title={`Assets (${editAssets.length})`}
            description={
              order.can_edit
                ? "Selected assets on this order. Use Select other assets to add or change them."
                : undefined
            }
            headerActions={
              order.can_edit ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={busy || editAssets.length === 0}
                    onClick={clearEditAssets}
                  >
                    Clear all
                  </Button>
                  <Button
                    type="button"
                    variant={assetPickerOpen ? "secondary" : "outline"}
                    size="sm"
                    className="h-8"
                    disabled={busy}
                    onClick={() => setAssetPickerOpen((open) => !open)}
                  >
                    {assetPickerOpen ? "Hide asset list" : "Select other assets"}
                  </Button>
                </div>
              ) : (
                <Package className="size-4 text-muted-foreground" aria-hidden />
              )
            }
            contentClassName="flex min-h-0 flex-1 flex-col px-0 py-0"
            className="flex h-full flex-col overflow-hidden"
          >
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <AdminTableHeaderRow>
                    <AdminTableHeadCell className="h-9 px-4 py-2">Asset</AdminTableHeadCell>
                    <AdminTableHeadCell className="h-9 px-4 py-2">From CC</AdminTableHeadCell>
                    <AdminTableHeadCell className="h-9 px-4 py-2">From Loc 1</AdminTableHeadCell>
                    {order.can_edit ? (
                      <AdminTableHeadCell className="h-9 w-12 px-2 py-2">
                        <span className="sr-only">Remove</span>
                      </AdminTableHeadCell>
                    ) : null}
                  </AdminTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {editAssets.length === 0 ? (
                    <AdminTableEmptyRow colSpan={order.can_edit ? 4 : 3}>
                      {order.can_edit
                        ? "No assets selected — click Select other assets to choose."
                        : "No assets"}
                    </AdminTableEmptyRow>
                  ) : (
                    editAssets.map((item) => (
                      <AdminTableBodyRow key={item.asset_id} interactive={false}>
                        <AdminTableCell className="min-h-0 px-4 py-2">
                          <div className="font-medium leading-tight">{item.asset_code}</div>
                          <div className="text-xs leading-tight text-muted-foreground">
                            {item.asset_name || "—"}
                          </div>
                        </AdminTableCell>
                        <AdminTableCell className="min-h-0 px-4 py-2">
                          {item.from_cost_center_code ?? "—"}
                        </AdminTableCell>
                        <AdminTableCell className="min-h-0 px-4 py-2">
                          {item.from_functional_location_name ??
                            item.from_functional_location ??
                            "—"}
                        </AdminTableCell>
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
                    ))
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
                      <option value="">All cost centers (this plant)</option>
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
                        <AdminTableEmptyRow colSpan={3}>Loading assets…</AdminTableEmptyRow>
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
        </div>

        {receiveEditable ? (
          <AdminPanel
            title="Receive"
            description="Set scrapyard Actual Location 1 / 2, then assign Central Finance to close."
            contentClassName="px-4 py-3"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormField id="scrap_cc" labelText="Scrapyard cost center">
                <p className="text-sm">
                  {order.to_cost_center_code
                    ? `${order.to_cost_center_code}${
                        order.to_cost_center_description
                          ? ` — ${order.to_cost_center_description}`
                          : ""
                      }`
                    : "—"}
                </p>
              </FormField>
              <FormField id="scrap_loc1" labelText="Actual Location 1" required>
                <select
                  id="scrap_loc1"
                  className={adminSelectClass}
                  value={functionalLocation}
                  onChange={(e) => {
                    setFunctionalLocation(e.target.value)
                    setActualLocation("")
                  }}
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
              </FormField>
              <FormField id="scrap_loc2" labelText="Actual Location 2" required>
                <select
                  id="scrap_loc2"
                  className={adminSelectClass}
                  value={actualLocation}
                  disabled={!functionalLocation}
                  onChange={(e) => setActualLocation(e.target.value)}
                >
                  <option value="">
                    {functionalLocation ? "Select location" : "Select Actual Location 1 first"}
                  </option>
                  {masters.actualLocations.map((l) => (
                    <option key={l.id} value={l.code}>
                      {actualLocationLabel(l)}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          </AdminPanel>
        ) : null}

        <DisposalAuditLog events={order.audit} />
          </div>

      <CapexAssigneePickerDialog
        open={pickerMode != null}
        onOpenChange={(open) => {
          if (!open) setPickerMode(null)
        }}
        assigneesUrl={
          pickerMode === "receive"
            ? panel?.next_assignee_role_id
              ? `/admin/disposal-orders/assignees?role_id=${panel.next_assignee_role_id}&order_id=${order.id}`
              : undefined
            : `/admin/disposal-orders/assignees?requires_engineering=${requiresEngineering ? "true" : "false"}&order_id=${order.id}`
        }
        roleLabel={
          pickerMode === "receive"
            ? (panel?.next_step_role_name ?? "Next approver")
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
                  to_functional_location: functionalLocation.trim(),
                  to_actual_location: actualLocation.trim(),
                })
                toast.success("Assets received.")
                setPickerMode(null)
                await load()
              } catch (e) {
                toast.error(e instanceof ApiError ? e.message : "Action failed")
              } finally {
                setBusy(false)
              }
              return
            }
            await run(
              () =>
                postJson(`/admin/disposal-orders/${order.id}/receive`, {
                  assigned_to: userId,
                  functional_location: functionalLocation.trim(),
                  actual_location: actualLocation.trim(),
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
        assigneesUrl={
          panel?.next_assignee_role_id
            ? `/admin/disposal-orders/assignees?role_id=${panel.next_assignee_role_id}&order_id=${order.id}`
            : undefined
        }
        onConfirm={confirmDecision}
      />
      {confirmDialog}
    </AdminPage>
  )
}
