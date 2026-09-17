import * as React from "react"
import { Package, Search } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { RequiredFieldMark } from "@/components/assets/required-field-mark"
import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPanel,
  AdminPrimaryButton,
  AdminTableCell,
  AdminTableEmptyRow,
  AdminTableLoadingRow,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { AdminTableBodyRow } from "@/components/layout/list-page-ui"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { ApiError, getJson, postJson } from "@/lib/api"
import { invalidateTransferLists } from "@/lib/query-client"
import { listReturnTo } from "@/lib/use-url-tab"
import type { AssetListItem, AssetListResponse } from "@/lib/assets-types"
import { isAssetPendingTransfer } from "@/lib/asset-lifecycle"
import type { ActualLocationMaster } from "@/lib/masters-types"
import {
  TRANSFER_IN_PROGRESS_MESSAGE,
  type TransferAssigneeListResponse,
  type TransferAssigneeOption,
  type TransferDestinationCostCenter,
  type TransferOrderDetail,
} from "@/lib/transfer-types"
import {
  actualLocationLabel,
  formatCostCenterWithCode,
  functionalLocationLabel,
  masterDisplayName,
  plantLabel,
  useAssetMasterLookups,
} from "@/lib/use-asset-masters"
import {
  asAssetListItem,
  clearAssetMasterSelection,
  writeAssetMasterSelection,
} from "@/lib/asset-master-selection"
import { currentUserId, isSuperuser, persistAuthFromMe } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { CapexAssigneePickerDialog } from "@/pages/capex/capex-assignee-picker-dialog"

type DraftAsset = Pick<
  AssetListItem,
  | "id"
  | "asset_code"
  | "asset_name"
  | "plant_id"
  | "plant_name"
  | "cost_center"
  | "cost_center_description"
  | "functional_location"
  | "functional_location_description"
  | "actual_location"
  | "actual_location_description"
  | "asset_custodian_id"
  | "approval_status"
  | "lifecycle_status"
> & { dest_custodian_id?: number | null }

function isCustodianOf(asset: { asset_custodian_id?: number | null }, userId: number | null): boolean {
  if (isSuperuser()) return true
  if (userId == null) return false
  return asset.asset_custodian_id === userId
}

function isApprovedForTransfer(asset: {
  approval_status?: string | null
  lifecycle_status?: string | null
}): boolean {
  const approval = (asset.approval_status ?? "").trim().toLowerCase()
  const lifecycle = (asset.lifecycle_status ?? "").trim().toLowerCase()
  if (lifecycle && lifecycle !== "active") return false
  return approval === "approved" || approval === "not_required"
}

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

function toDraftAsset(a: AssetListItem): DraftAsset {
  return {
    id: a.id,
    asset_code: a.asset_code,
    asset_name: a.asset_name,
    plant_id: a.plant_id,
    plant_name: a.plant_name,
    cost_center: a.cost_center,
    cost_center_description: a.cost_center_description,
    functional_location: a.functional_location,
    functional_location_description: a.functional_location_description,
    actual_location: a.actual_location,
    actual_location_description: a.actual_location_description,
    asset_custodian_id: a.asset_custodian_id ?? null,
    approval_status: a.approval_status,
    lifecycle_status: a.lifecycle_status,
    dest_custodian_id: null,
  }
}

export function TransferOrderCreatePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const presetAssetIds = React.useMemo(() => {
    const raw = searchParams.get("asset_ids")?.trim() ?? ""
    return [
      ...new Set(
        raw
          .split(/[\s,]+/)
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    ]
  }, [searchParams])
  const fromAssets = presetAssetIds.length > 0
  const [handoffReady, setHandoffReady] = React.useState(false)

  const [plantId, setPlantId] = React.useState<number | null>(() => {
    const raw = searchParams.get("plant_id")
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  })
  const [toCostCenterId, setToCostCenterId] = React.useState("")
  const [custodianOptions, setCustodianOptions] = React.useState<TransferAssigneeOption[]>([])
  const [custodiansLoading, setCustodiansLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [assets, setAssets] = React.useState<DraftAsset[]>([])
  const [assetSearch, setAssetSearch] = React.useState("")
  const [fromCostCenterCode, setFromCostCenterCode] = React.useState("")
  const [fromFunctionalLocation, setFromFunctionalLocation] = React.useState("")
  const [catalogItems, setCatalogItems] = React.useState<AssetListItem[]>([])
  const [catalogLoading, setCatalogLoading] = React.useState(false)
  const [viewerId, setViewerId] = React.useState<number | null>(() => currentUserId())
  const [plantCostCenters, setPlantCostCenters] = React.useState<TransferDestinationCostCenter[]>([])
  const [plantActualLocations, setPlantActualLocations] = React.useState<ActualLocationMaster[]>([])

  const masters = useAssetMasterLookups(plantId)
  const selectedIds = React.useMemo(() => new Set(assets.map((a) => a.id)), [assets])
  const showAssetFilters = !fromAssets

  // From-CC filter: only CCs the user can access (org scope) — same set they can transfer from.
  const fromCostCenterOptions = masters.costCenters

  React.useEffect(() => {
    if (!fromCostCenterCode) return
    if (!fromCostCenterOptions.some((cc) => cc.code === fromCostCenterCode)) {
      setFromCostCenterCode("")
    }
  }, [fromCostCenterCode, fromCostCenterOptions])

  // Default plant when only one exists.
  React.useEffect(() => {
    if (fromAssets || plantId != null) return
    if (masters.plants.length === 1) {
      setPlantId(masters.plants[0]!.id)
    }
  }, [fromAssets, plantId, masters.plants])

  // Destination CCs: all on plant (not limited to the creator's assigned CCs).
  React.useEffect(() => {
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
  }, [plantId])

  React.useEffect(() => {
    if (plantId == null) {
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
  }, [plantId])

  const sourceCostCenterCodes = React.useMemo(() => {
    const codes = new Set<string>()
    for (const a of assets) {
      const code = a.cost_center?.trim()
      if (code) codes.add(code)
    }
    return codes
  }, [assets])

  const destinationCostCenters = React.useMemo(
    () => plantCostCenters.filter((cc) => !sourceCostCenterCodes.has(cc.code)),
    [plantCostCenters, sourceCostCenterCodes],
  )

  // Clear destination if it matches a selected asset's current cost center.
  React.useEffect(() => {
    if (!toCostCenterId) return
    const selected = plantCostCenters.find((cc) => String(cc.id) === toCostCenterId)
    if (selected && sourceCostCenterCodes.has(selected.code)) {
      setToCostCenterId("")
    }
  }, [toCostCenterId, sourceCostCenterCodes, plantCostCenters])

  React.useEffect(() => {
    if (!toCostCenterId) {
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
          setAssets((prev) =>
            prev.map((a) =>
              a.dest_custodian_id == null ? { ...a, dest_custodian_id: only } : a,
            ),
          )
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
  }, [toCostCenterId])

  React.useEffect(() => {
    let cancelled = false
    void getJson<{ id: number; is_superuser?: boolean; permissions?: string[] }>("/me")
      .then((me) => {
        if (cancelled) return
        persistAuthFromMe(me)
        setViewerId(typeof me.id === "number" ? me.id : null)
      })
      .catch(() => {
        /* keep cached id */
      })
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    if (!fromAssets) return
    const idSet = new Set(presetAssetIds)
    try {
      const raw = sessionStorage.getItem("transfer-order-draft-assets")
      if (raw) {
        const parsed = JSON.parse(raw) as DraftAsset[]
        const selectedParsed = parsed.filter((a) => idSet.has(a.id))
        const hasInProgress = selectedParsed.some((a) =>
          isAssetPendingTransfer(a.lifecycle_status ?? ""),
        )
        if (hasInProgress && (viewerId != null || isSuperuser())) {
          toast.error(TRANSFER_IN_PROGRESS_MESSAGE)
        }
        const custodied = selectedParsed.filter(
          (a) => isCustodianOf(a, viewerId) && isApprovedForTransfer(a),
        )
        if (custodied.length > 0) {
          const primaryCc = custodied.find((a) => a.cost_center?.trim())?.cost_center?.trim()
          const rows = primaryCc
            ? custodied.filter((a) => (a.cost_center ?? "").trim() === primaryCc)
            : custodied
          setAssets(rows)
          setHandoffReady(true)
          const plants = [
            ...new Set(rows.map((a) => a.plant_id).filter((id): id is number => id != null)),
          ]
          if (plants.length === 1) setPlantId(plants[0] ?? null)
          if (!hasInProgress && rows.length < selectedParsed.length) {
            toast.error(
              "Some selected assets were removed — only approved assets you custodiate from the same cost center can be transferred together.",
            )
          }
          return
        }
      }
    } catch {
      /* ignore */
    }
    if (viewerId == null && !isSuperuser()) return
    setAssets([])
    setHandoffReady(true)
  }, [fromAssets, presetAssetIds, plantId, viewerId])

  const assetsRef = React.useRef(assets)
  assetsRef.current = assets
  const catalogRef = React.useRef(catalogItems)
  catalogRef.current = catalogItems
  React.useEffect(() => {
    if (!fromAssets) return
    return () => {
      const rows = assetsRef.current
      window.setTimeout(() => {
        const path = window.location.pathname
        if (path.includes("/transfer-orders/new")) return
        if (path === "/dashboard/assets") {
          if (rows.length === 0) return
          writeAssetMasterSelection(
            rows.map((row) => {
              const catalog = catalogRef.current.find((item) => item.id === row.id)
              return asAssetListItem({
                ...(catalog ?? {}),
                ...row,
                rfid_code: catalog?.rfid_code ?? null,
              })
            }),
          )
          return
        }
        clearAssetMasterSelection()
      }, 0)
    }
  }, [fromAssets])

  React.useEffect(() => {
    if (!fromAssets || !handoffReady) return
    writeAssetMasterSelection(
      assets.map((row) => {
        const catalog = catalogItems.find((item) => item.id === row.id)
        return asAssetListItem({
          ...(catalog ?? {}),
          ...row,
          rfid_code: catalog?.rfid_code ?? null,
        })
      }),
    )
  }, [assets, catalogItems, fromAssets, handoffReady])

  // Browseable catalog when creating a transfer outside Asset Master.
  React.useEffect(() => {
    if (fromAssets || plantId == null) {
      setCatalogItems([])
      setCatalogLoading(false)
      return
    }
    let cancelled = false
    setCatalogLoading(true)
    const t = window.setTimeout(() => {
      const params = new URLSearchParams({
        page: "1",
        page_size: "100",
        plant_id: String(plantId),
        lifecycle_status: "active",
        sort_by: "asset_code",
        sort_dir: "asc",
      })
      const q = assetSearch.trim()
      const cc = fromCostCenterCode.trim()
      const fl = fromFunctionalLocation.trim()
      if (q) params.set("search", q)
      // Exact code filters — apply client-side so dropdown codes always match list values.
      void getJson<AssetListResponse>(`/admin/assets?${params}`)
        .then((res) => {
          if (cancelled) return
          let rows = res.items.filter(
            (a) => isCustodianOf(a, viewerId) && isApprovedForTransfer(a),
          )
          if (cc) rows = rows.filter((a) => (a.cost_center ?? "").trim() === cc)
          if (fl) rows = rows.filter((a) => (a.functional_location ?? "").trim() === fl)
          setCatalogItems(rows)
        })
        .catch(() => {
          if (!cancelled) setCatalogItems([])
        })
        .finally(() => {
          if (!cancelled) setCatalogLoading(false)
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [assetSearch, fromCostCenterCode, fromFunctionalLocation, plantId, fromAssets, viewerId])

  function toggleAsset(row: AssetListItem) {
    if (fromAssets) return
    if (selectedIds.has(row.id)) {
      removeAsset(row.id)
      return
    }
    if (!isCustodianOf(row, viewerId)) {
      toast.error("Only the asset custodian can add this asset to a transfer.")
      return
    }
    if (isAssetPendingTransfer(row.lifecycle_status)) {
      toast.error(TRANSFER_IN_PROGRESS_MESSAGE)
      return
    }
    if (!isApprovedForTransfer(row)) {
      toast.error("Only approved assets can be added to a transfer order.")
      return
    }
    if (row.plant_id == null) {
      toast.error("Asset has no plant.")
      return
    }
    if (plantId != null && row.plant_id !== plantId) {
      toast.error("All assets must belong to the same plant.")
      return
    }
    const rowCc = row.cost_center?.trim()
    if (!rowCc) {
      toast.error("Asset has no cost center.")
      return
    }
    const existingCc = assets.find((a) => a.cost_center?.trim())?.cost_center?.trim()
    if (existingCc && rowCc !== existingCc) {
      toast.error(
        "All assets on a transfer must share the same cost center. Create a separate transfer for another cost center.",
      )
      return
    }
    setPlantId(row.plant_id)
    setAssets((prev) => {
      const draft = toDraftAsset(row)
      if (custodianOptions.length === 1) {
        draft.dest_custodian_id = custodianOptions[0]!.id
      }
      return [...prev, draft]
    })
  }

  function removeAsset(id: number) {
    if (fromAssets) return
    setAssets((prev) => prev.filter((a) => a.id !== id))
  }

  function setDestCustodian(assetId: number, destCustodianId: number | null) {
    setAssets((prev) =>
      prev.map((row) => (row.id === assetId ? { ...row, dest_custodian_id: destCustodianId } : row)),
    )
  }

  const destCustodianPlaceholder = !toCostCenterId
    ? "Select cost center first"
    : custodiansLoading
      ? "Loading…"
      : custodianOptions.length === 0
        ? "No custodians assigned"
        : "Select Custodian"

  function destCustodianSelect(assetId: number, destCustodianId: number | null | undefined) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <select
          className={adminSelectClass}
          value={destCustodianId != null ? String(destCustodianId) : ""}
          disabled={!toCostCenterId || custodiansLoading || custodianOptions.length === 0}
          onChange={(e) =>
            setDestCustodian(assetId, e.target.value ? Number(e.target.value) : null)
          }
          aria-label="Destination custodian"
        >
          <option value="">{destCustodianPlaceholder}</option>
          {custodianOptions.map((u) => (
            <option key={u.id} value={String(u.id)}>
              {u.full_name}
            </option>
          ))}
        </select>
      </div>
    )
  }

  const designatedCostCenterField = (
    <FormField id="to_cc" labelText="Destination Cost Center" required>
      <select
        id="to_cc"
        className={adminSelectClass}
        value={toCostCenterId}
        disabled={plantId == null || destinationCostCenters.length === 0}
        onChange={(e) => {
          setToCostCenterId(e.target.value)
          setAssets((prev) => prev.map((a) => ({ ...a, dest_custodian_id: null })))
        }}
      >
        <option value="">
          {plantId == null
            ? "Select a plant first"
            : destinationCostCenters.length === 0
              ? "No other cost centers on this plant"
              : "Select cost center"}
        </option>
        {destinationCostCenters.map((cc) => (
          <option key={cc.id} value={String(cc.id)}>
            {formatCostCenterWithCode(cc.code, [cc], cc.name)}
          </option>
        ))}
      </select>
    </FormField>
  )

  async function create(submit: boolean, assignedTo?: number) {
    const assetIds = assets.map((a) => a.id)
    if (assetIds.length === 0) {
      toast.error("Add at least one asset.")
      return
    }
    if (!isSuperuser() && assets.some((a) => !isCustodianOf(a, viewerId))) {
      toast.error("Only the asset custodian can create a transfer for these assets.")
      return
    }
    if (assets.some((a) => isAssetPendingTransfer(a.lifecycle_status))) {
      toast.error(TRANSFER_IN_PROGRESS_MESSAGE)
      return
    }
    if (assets.some((a) => !isApprovedForTransfer(a))) {
      toast.error("Only approved assets can be included on a transfer order.")
      return
    }
    if (sourceCostCenterCodes.size !== 1) {
      toast.error(
        "All assets on a transfer must share the same cost center. Create a separate transfer for each source cost center.",
      )
      return
    }
    if (!toCostCenterId) {
      toast.error("Select destination cost center.")
      return
    }
    const destCc = plantCostCenters.find((cc) => String(cc.id) === toCostCenterId)
    if (destCc && sourceCostCenterCodes.has(destCc.code)) {
      toast.error("Destination cost center must be different from the assets' current cost center.")
      return
    }
    if (assets.some((a) => a.dest_custodian_id == null)) {
      toast.error("Select a destination asset custodian for every asset.")
      return
    }
    if (submit && assignedTo == null) {
      setPickerOpen(true)
      return
    }
    setBusy(true)
    try {
      const order = await postJson<TransferOrderDetail>("/admin/transfer-orders", {
        asset_ids: assetIds,
        to_cost_center_id: Number(toCostCenterId),
        to_asset_custodian_id: assets[0]!.dest_custodian_id,
        item_custodians: assets.map((a) => ({
          asset_id: a.id,
          to_asset_custodian_id: a.dest_custodian_id as number,
        })),
        to_functional_location: null,
        to_actual_location: null,
        remarks: null,
        assigned_to: assignedTo ?? null,
        submit,
      })
      try {
        sessionStorage.removeItem("transfer-order-draft-assets")
      } catch {
        /* ignore */
      }
      void invalidateTransferLists()
      navigate(`/dashboard/transfer-orders/${order.id}`, {
        replace: true,
        state: fromAssets ? { fromAssets: true } : undefined,
      })
      toast.success(
        submit
          ? `Transfer ${order.order_number} submitted for approval.`
          : `${order.order_number} saved in draft.`,
      )
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to create transfer order.")
    } finally {
      setBusy(false)
    }
  }

  const plantName =
    plantId != null
      ? (() => {
          const p = masters.plants.find((row) => row.id === plantId)
          return p ? plantLabel(p) : (assets[0]?.plant_name ?? String(plantId))
        })()
      : ""

  function persistAssetMasterSelection() {
    if (!fromAssets) return
    writeAssetMasterSelection(
      assets.map((row) => {
        const catalog = catalogItems.find((item) => item.id === row.id)
        return asAssetListItem({
          ...(catalog ?? {}),
          ...row,
          rfid_code: catalog?.rfid_code ?? null,
        })
      }),
      {},
    )
  }

  function loc1Display(code: string | null | undefined, description?: string | null): string {
    const c = (code ?? "").trim()
    if (!c) return "—"
    const fl = masters.functionalLocations.find((l) => (l.code ?? "").trim() === c)
    if (fl) return functionalLocationLabel(fl)
    return description?.trim() || c
  }

  function loc2Display(code: string | null | undefined, description?: string | null): string {
    const c = (code ?? "").trim()
    if (!c) return "—"
    const al = plantActualLocations.find((l) => (l.code ?? "").trim() === c)
    if (al) return actualLocationLabel(al)
    return description?.trim() || c
  }

  return (
    <AdminPage
      fullWidth
      dense
      description=""
      className="w-full pb-6"
      actions={
        <AdminBackLink
          to={listReturnTo(fromAssets ? "/dashboard/assets" : "/dashboard/transfer-orders")}
          onClick={persistAssetMasterSelection}
        />
      }
    >
      <form
        className="space-y-[var(--app-grid-gap)]"
        onSubmit={(e) => {
          e.preventDefault()
          void create(true)
        }}
      >
        <AdminPanel
            title="Asset List"
            // description={
            //   fromAssets
            //     ? "Assets where you are the asset custodian (from Asset Master)."
            //     : "Filter and select approved assets you custodiate. One transfer moves assets from a single cost center to one destination."
            // }
            headerActions={<Package className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="px-5 py-5"
          >
            {showAssetFilters ? (
              <div className="mb-4 space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField id="plant" labelText="Plant" required>
                    <select
                      id="plant"
                      className={adminSelectClass}
                      value={plantId != null ? String(plantId) : ""}
                      onChange={(e) => {
                        const next = e.target.value ? Number(e.target.value) : null
                        setPlantId(next)
                        setFromCostCenterCode("")
                        setFromFunctionalLocation("")
                        setToCostCenterId("")
                        setCustodianOptions([])
                        setAssets([])
                        setAssetSearch("")
                        setCatalogItems([])
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

                  {designatedCostCenterField}

                  <FormField id="from_cc" labelText="Cost center">
                    <select
                      id="from_cc"
                      className={adminSelectClass}
                      value={fromCostCenterCode}
                      disabled={plantId == null || fromCostCenterOptions.length === 0}
                      onChange={(e) => setFromCostCenterCode(e.target.value)}
                    >
                      <option value="">All</option>
                      {fromCostCenterOptions.map((cc) => (
                        <option key={cc.id} value={cc.code}>
                          {masterDisplayName(cc.name, cc.code)}
                          {cc.code ? ` (${cc.code})` : ""}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  <FormField id="from_fl" labelText="Location 1">
                    <select
                      id="from_fl"
                      className={adminSelectClass}
                      value={fromFunctionalLocation}
                      disabled={plantId == null}
                      onChange={(e) => setFromFunctionalLocation(e.target.value)}
                    >
                      <option value="">All</option>
                      {masters.functionalLocations.map((fl) => (
                        <option key={fl.id} value={fl.code}>
                          {functionalLocationLabel(fl)}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  <FormField id="asset_search" labelText="Search">
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                      />
                      <Input
                        id="asset_search"
                        value={assetSearch}
                        onChange={(e) => setAssetSearch(e.target.value)}
                        disabled={plantId == null}
                        placeholder={
                          plantId == null ? "Select a plant first" : "Asset code or name…"
                        }
                        className="pl-9"
                        autoComplete="off"
                      />
                    </div>
                  </FormField>
                </div>
              </div>
            ) : (
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField id="plant" labelText="Plant" required>
                  <Input readOnly disabled className="bg-muted/40" value={plantName || "—"} />
                </FormField>
                {designatedCostCenterField}
              </div>
            )}

            <div className="-mx-5 -mb-5 max-h-[28rem] overflow-auto">
              <Table>
                <TableHeader>
                  <AdminTableHeaderRow>
                    {showAssetFilters ? (
                      <AdminTableHeadCell className="w-10">
                        <span className="sr-only">Select</span>
                      </AdminTableHeadCell>
                    ) : null}
                    <AdminTableHeadCell>Asset</AdminTableHeadCell>
                    <AdminTableHeadCell>Source Cost Center</AdminTableHeadCell>
                    <AdminTableHeadCell>From Actual Location 1</AdminTableHeadCell>
                    <AdminTableHeadCell>From Actual Location 2</AdminTableHeadCell>
                    <AdminTableHeadCell>Asset Custodian</AdminTableHeadCell>
                  </AdminTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {showAssetFilters ? (
                    plantId == null ? (
                      <AdminTableEmptyRow colSpan={6}>Select a plant to list assets.</AdminTableEmptyRow>
                    ) : catalogLoading ? (
                      <AdminTableLoadingRow colSpan={6} label="Loading assets" />
                    ) : catalogItems.length === 0 ? (
                      <AdminTableEmptyRow colSpan={6}>
                        No approved custodiated assets match these filters.
                      </AdminTableEmptyRow>
                    ) : (
                      catalogItems.map((a) => {
                        const checked = selectedIds.has(a.id)
                        const selected = assets.find((row) => row.id === a.id)
                        return (
                          <AdminTableBodyRow
                            key={a.id}
                            className={cn(checked && "bg-primary/5")}
                            onClick={() => toggleAsset(a)}
                          >
                            <AdminTableCell className="align-middle">
                              <div
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => e.stopPropagation()}
                              >
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={() => toggleAsset(a)}
                                  aria-label={`Select ${a.asset_code}`}
                                />
                              </div>
                            </AdminTableCell>
                            <AdminTableCell>
                              <div className="font-medium">{a.asset_name || "—"}</div>
                              <div className="text-xs text-muted-foreground">{a.asset_code}</div>
                            </AdminTableCell>
                            <AdminTableCell>
                              {formatCostCenterWithCode(
                                a.cost_center,
                                masters.costCenters,
                                a.cost_center_description,
                              )}
                            </AdminTableCell>
                            <AdminTableCell>
                              {loc1Display(
                                a.functional_location,
                                a.functional_location_description,
                              )}
                            </AdminTableCell>
                            <AdminTableCell>
                              {loc2Display(a.actual_location, a.actual_location_description)}
                            </AdminTableCell>
                            <AdminTableCell className="min-w-[12rem]">
                              {checked
                                ? destCustodianSelect(a.id, selected?.dest_custodian_id)
                                : "—"}
                            </AdminTableCell>
                          </AdminTableBodyRow>
                        )
                      })
                    )
                  ) : assets.length === 0 ? (
                    <AdminTableEmptyRow colSpan={5}>No Assets selected</AdminTableEmptyRow>
                  ) : (
                    <>
                      {assets.map((a) => (
                        <AdminTableBodyRow key={a.id} interactive={false}>
                          <AdminTableCell>
                            <div className="font-medium">{a.asset_name || "—"}</div>
                            <div className="text-xs text-muted-foreground">{a.asset_code}</div>
                          </AdminTableCell>
                          <AdminTableCell>
                            {formatCostCenterWithCode(
                              a.cost_center,
                              masters.costCenters,
                              a.cost_center_description,
                            )}
                          </AdminTableCell>
                          <AdminTableCell>
                            {loc1Display(
                              a.functional_location,
                              a.functional_location_description,
                            )}
                          </AdminTableCell>
                          <AdminTableCell>
                            {loc2Display(a.actual_location, a.actual_location_description)}
                          </AdminTableCell>
                          <AdminTableCell className="min-w-[12rem]">
                            {destCustodianSelect(a.id, a.dest_custodian_id)}
                          </AdminTableCell>
                        </AdminTableBodyRow>
                      ))}
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          </AdminPanel>

        <div className="flex justify-end gap-2 border-t border-border/60 pt-4">
          <Button
            type="button"
            variant="outline"
            className="h-9 shadow-sm"
            disabled={busy}
            onClick={() => {
              persistAssetMasterSelection()
              navigate(listReturnTo(fromAssets ? "/dashboard/assets" : "/dashboard/transfer-orders"))
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 shadow-sm"
            disabled={busy}
            onClick={() => void create(false)}
          >
            {busy ? "Saving…" : "Save Draft"}
          </Button>
          <AdminPrimaryButton type="submit" disabled={busy}>
            Submit for Approval
          </AdminPrimaryButton>
        </div>
      </form>

      <CapexAssigneePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        assigneesUrl="/admin/transfer-orders/assignees?for_submit=true"
        excludeUserId={viewerId}
        roleLabel="Approver"
        confirmLabel="Submit"
        busy={busy}
        onConfirm={async (userId) => {
          setPickerOpen(false)
          await create(true, userId)
        }}
      />
    </AdminPage>
  )
}
