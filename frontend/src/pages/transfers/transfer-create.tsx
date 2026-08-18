import * as React from "react"
import { ArrowRightLeft, Package, Search, X } from "lucide-react"
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
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { AdminTableBodyRow } from "@/components/layout/list-page-ui"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { ApiError, getJson, postJson } from "@/lib/api"
import type { AssetListItem, AssetListResponse } from "@/lib/assets-types"
import type {
  TransferAssigneeListResponse,
  TransferAssigneeOption,
  TransferDestinationCostCenter,
  TransferOrderDetail,
} from "@/lib/transfer-types"
import {
  formatCostCenterWithCode,
  functionalLocationLabel,
  masterDisplayName,
  plantLabel,
  useAssetMasterLookups,
} from "@/lib/use-asset-masters"
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
  | "asset_custodian_id"
  | "approval_status"
  | "lifecycle_status"
>

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
    asset_custodian_id: a.asset_custodian_id ?? null,
    approval_status: a.approval_status,
    lifecycle_status: a.lifecycle_status,
  }
}

function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase()
  return (name.trim().slice(0, 2) || "?").toUpperCase()
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

  const [plantId, setPlantId] = React.useState<number | null>(() => {
    const raw = searchParams.get("plant_id")
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  })
  const [toCostCenterId, setToCostCenterId] = React.useState("")
  const [ccQuery, setCcQuery] = React.useState("")
  const [ccOpen, setCcOpen] = React.useState(false)
  const [custodianOptions, setCustodianOptions] = React.useState<TransferAssigneeOption[]>([])
  const [custodiansLoading, setCustodiansLoading] = React.useState(false)
  const [custodianFilter, setCustodianFilter] = React.useState("")
  const [toAssetCustodianId, setToAssetCustodianId] = React.useState<number | null>(null)
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

  const filteredCostCenters = React.useMemo(() => {
    const q = ccQuery.trim().toLowerCase()
    if (!q) return destinationCostCenters
    return destinationCostCenters.filter((cc) => {
      const label = `${cc.code} ${cc.name ?? ""} ${cc.description ?? ""}`.toLowerCase()
      return label.includes(q)
    })
  }, [destinationCostCenters, ccQuery])

  const selectedCostCenter = React.useMemo(
    () => destinationCostCenters.find((cc) => String(cc.id) === toCostCenterId) ?? null,
    [destinationCostCenters, toCostCenterId],
  )

  // Clear destination if it matches a selected asset's current cost center.
  React.useEffect(() => {
    if (!toCostCenterId) return
    const selected = plantCostCenters.find((cc) => String(cc.id) === toCostCenterId)
    if (selected && sourceCostCenterCodes.has(selected.code)) {
      setToCostCenterId("")
      setCcQuery("")
      setToAssetCustodianId(null)
    }
  }, [toCostCenterId, sourceCostCenterCodes, plantCostCenters])

  const visibleCustodians = React.useMemo(() => {
    const q = custodianFilter.trim().toLowerCase()
    if (!q) return custodianOptions
    return custodianOptions.filter((u) => {
      const hay = `${u.full_name} ${u.email ?? ""}`.toLowerCase()
      return hay.includes(q)
    })
  }, [custodianOptions, custodianFilter])

  React.useEffect(() => {
    if (!toCostCenterId) {
      setCustodianOptions([])
      setCustodianFilter("")
      setToAssetCustodianId(null)
      return
    }
    let cancelled = false
    setCustodiansLoading(true)
    setCustodianFilter("")
    setToAssetCustodianId(null)
    void getJson<TransferAssigneeListResponse>(
      `/admin/transfer-orders/cost-center-users?cost_center_id=${toCostCenterId}`,
    )
      .then((res) => {
        if (cancelled) return
        setCustodianOptions(res.items)
        if (res.items.length === 1) setToAssetCustodianId(res.items[0]!.id)
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
        const custodied = parsed.filter(
          (a) => idSet.has(a.id) && isCustodianOf(a, viewerId) && isApprovedForTransfer(a),
        )
        if (custodied.length > 0) {
          const primaryCc = custodied.find((a) => a.cost_center?.trim())?.cost_center?.trim()
          const rows = primaryCc
            ? custodied.filter((a) => (a.cost_center ?? "").trim() === primaryCc)
            : custodied
          setAssets(rows)
          const plants = [
            ...new Set(rows.map((a) => a.plant_id).filter((id): id is number => id != null)),
          ]
          if (plants.length === 1) setPlantId(plants[0] ?? null)
          if (rows.length < parsed.filter((a) => idSet.has(a.id)).length) {
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
    setAssets([])
  }, [fromAssets, presetAssetIds, plantId, viewerId])

  // Browseable catalog of custodiated assets for the plant (+ filters).
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
    if (selectedIds.has(row.id)) {
      removeAsset(row.id)
      return
    }
    if (!isCustodianOf(row, viewerId)) {
      toast.error("Only the asset custodian can add this asset to a transfer.")
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
    setAssets((prev) => [...prev, toDraftAsset(row)])
  }

  function removeAsset(id: number) {
    setAssets((prev) => {
      const next = prev.filter((a) => a.id !== id)
      if (next.length === 0) {
        setToCostCenterId("")
        setCcQuery("")
        setCcOpen(false)
        setToAssetCustodianId(null)
        setCustodianOptions([])
      }
      return next
    })
  }

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
    if (toAssetCustodianId == null) {
      toast.error("Select the destination asset custodian.")
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
        to_asset_custodian_id: toAssetCustodianId,
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
      toast.success(
        submit
          ? `Transfer ${order.order_number} submitted for approval.`
          : `Draft ${order.order_number} saved.`,
      )
      navigate(`/dashboard/transfer-orders/${order.id}`, { replace: true })
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

  return (
    <AdminPage
      fullWidth
      dense
      description=""
      className="w-full pb-6"
      actions={<AdminBackLink to="/dashboard/transfer-orders">Transfer orders</AdminBackLink>}
    >
      <form
        className="space-y-[var(--app-grid-gap)]"
        onSubmit={(e) => {
          e.preventDefault()
          void create(true)
        }}
      >
        <div className="grid gap-[var(--app-grid-gap)] lg:grid-cols-2">
          <AdminPanel
            title={`1. Select assets (${assets.length})`}
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
                        setCcQuery("")
                        setCcOpen(false)
                        setToAssetCustodianId(null)
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
              <div className="mb-4">
                <FormField id="plant" labelText="Plant">
                  <Input readOnly disabled className="bg-muted/40" value={plantName || "—"} />
                </FormField>
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
                    <AdminTableHeadCell>From CC</AdminTableHeadCell>
                    <AdminTableHeadCell>From Loc 1</AdminTableHeadCell>
                  </AdminTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {showAssetFilters ? (
                    plantId == null ? (
                      <AdminTableEmptyRow colSpan={4}>Select a plant to list assets.</AdminTableEmptyRow>
                    ) : catalogLoading ? (
                      <AdminTableEmptyRow colSpan={4}>Loading assets…</AdminTableEmptyRow>
                    ) : catalogItems.length === 0 ? (
                      <AdminTableEmptyRow colSpan={4}>
                        No approved custodiated assets match these filters.
                      </AdminTableEmptyRow>
                    ) : (
                      catalogItems.map((a) => {
                        const checked = selectedIds.has(a.id)
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
                              <div className="font-medium">{a.asset_code}</div>
                              <div className="text-xs text-muted-foreground">
                                {a.asset_name || "—"}
                              </div>
                            </AdminTableCell>
                            <AdminTableCell>
                              {formatCostCenterWithCode(
                                a.cost_center,
                                masters.costCenters,
                                a.cost_center_description,
                              )}
                            </AdminTableCell>
                            <AdminTableCell>
                              {a.functional_location_description?.trim() ||
                                a.functional_location ||
                                "—"}
                            </AdminTableCell>
                          </AdminTableBodyRow>
                        )
                      })
                    )
                  ) : assets.length === 0 ? (
                    <AdminTableEmptyRow colSpan={3}>No assets selected</AdminTableEmptyRow>
                  ) : (
                    assets.map((a) => (
                      <AdminTableBodyRow key={a.id} interactive={false}>
                        <AdminTableCell>
                          <div className="font-medium">{a.asset_code}</div>
                          <div className="text-xs text-muted-foreground">{a.asset_name || "—"}</div>
                        </AdminTableCell>
                        <AdminTableCell>
                          {formatCostCenterWithCode(
                            a.cost_center,
                            masters.costCenters,
                            a.cost_center_description,
                          )}
                        </AdminTableCell>
                        <AdminTableCell>
                          {a.functional_location_description?.trim() ||
                            a.functional_location ||
                            "—"}
                        </AdminTableCell>
                      </AdminTableBodyRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </AdminPanel>

          <AdminPanel
            title="2. Transfer destination"
            // description={
            //   assets.length === 0
            //     ? "Select assets first, then choose destination cost center and asset custodian."
            //     : "Choose a different destination cost center and the asset custodian who will own the assets after receive. Locations are set when that custodian receives the assets."
            // }
            headerActions={<ArrowRightLeft className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="px-5 py-5"
          >
            {assets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add at least one asset on the left to continue with destination details.
              </p>
            ) : destinationCostCenters.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No other cost centers are available on this plant. Destination must differ from the
                assets&apos; current cost center.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                <FormField id="to_cc" labelText="Destination cost center" required>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      id="to_cc"
                      value={
                        ccOpen
                          ? ccQuery
                          : selectedCostCenter
                            ? `${masterDisplayName(selectedCostCenter.name, selectedCostCenter.code)}${selectedCostCenter.code ? ` (${selectedCostCenter.code})` : ""}`
                            : ccQuery
                      }
                      placeholder="Search cost center code or name…"
                      className={cn("pl-9", toCostCenterId && !ccOpen ? "pr-9" : undefined)}
                      onFocus={() => {
                        setCcOpen(true)
                        setCcQuery("")
                      }}
                      onChange={(e) => {
                        setCcOpen(true)
                        setCcQuery(e.target.value)
                        if (toCostCenterId) setToCostCenterId("")
                      }}
                      onBlur={() => {
                        window.setTimeout(() => setCcOpen(false), 150)
                      }}
                    />
                    {toCostCenterId && !ccOpen ? (
                      <button
                        type="button"
                        className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label="Clear cost center"
                        onClick={() => {
                          setToCostCenterId("")
                          setCcQuery("")
                        }}
                      >
                        <X className="size-4" />
                      </button>
                    ) : null}
                    {ccOpen ? (
                      <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border/70 bg-background shadow-md">
                        {filteredCostCenters.length === 0 ? (
                          <li className="px-3 py-2 text-sm text-muted-foreground">
                            No other cost centers match. Destination cannot be the same as From CC.
                          </li>
                        ) : (
                          filteredCostCenters.map((cc) => (
                            <li key={cc.id}>
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/50",
                                  String(cc.id) === toCostCenterId && "bg-primary/5",
                                )}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setToCostCenterId(String(cc.id))
                                  setCcQuery("")
                                  setCcOpen(false)
                                }}
                              >
                                <span>
                                  <span className="font-medium">{masterDisplayName(cc.name, cc.code)}</span>
                                  {cc.code ? (
                                    <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                                      {cc.code}
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    ) : null}
                  </div>
                </FormField>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="app-form-label !mb-0">
                      Asset custodian
                      <RequiredFieldMark />
                    </Label>
                    {toCostCenterId && custodianOptions.length > 3 ? (
                      <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
                        <Search
                          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                          aria-hidden
                        />
                        <Input
                          value={custodianFilter}
                          onChange={(e) => setCustodianFilter(e.target.value)}
                          placeholder="Search custodian…"
                          className="h-8 pl-8 text-xs"
                        />
                      </div>
                    ) : null}
                  </div>

                  {!toCostCenterId ? (
                    <p className="text-sm text-muted-foreground">
                      Select a destination cost center to choose the asset custodian.
                    </p>
                  ) : custodiansLoading ? (
                    <p className="text-sm text-muted-foreground">Loading custodians…</p>
                  ) : custodianOptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No asset custodians are assigned to this cost center. Add them under Asset
                      masters → CC custodians.
                    </p>
                  ) : visibleCustodians.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No custodians match your search.</p>
                  ) : (
                    <ul className="max-h-56 overflow-auto rounded-lg border border-border/70 bg-background">
                      {visibleCustodians.map((u) => {
                        const selected = toAssetCustodianId === u.id
                        return (
                          <li key={u.id}>
                            <button
                              type="button"
                              className={cn(
                                "flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50",
                                selected && "bg-primary/5",
                              )}
                              onClick={() => setToAssetCustodianId(u.id)}
                            >
                              <span
                                className={cn(
                                  "flex size-4 shrink-0 items-center justify-center rounded-full border",
                                  selected
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-muted-foreground/40",
                                )}
                                aria-hidden
                              >
                                {selected ? (
                                  <span className="size-1.5 rounded-full bg-current" />
                                ) : null}
                              </span>
                              <Avatar className="size-8 shrink-0">
                                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                                  {userInitials(u.full_name)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">{u.full_name}</div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {u.email ?? "No email"}
                                </div>
                              </div>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </AdminPanel>
        </div>

        <div className="flex justify-end gap-2 border-t border-border/60 pt-4">
          <Button
            type="button"
            variant="outline"
            className="h-9 shadow-sm"
            disabled={busy}
            onClick={() => navigate("/dashboard/transfer-orders")}
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
            {busy ? "Saving…" : "Save draft"}
          </Button>
          <AdminPrimaryButton type="submit" disabled={busy}>
            Submit for approval
          </AdminPrimaryButton>
        </div>
      </form>

      <CapexAssigneePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        assigneesUrl="/admin/transfer-orders/assignees?for_submit=true"
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
