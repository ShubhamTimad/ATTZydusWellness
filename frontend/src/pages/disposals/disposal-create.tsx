import * as React from "react"
import { Package, PackageX, Search } from "lucide-react"
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
  adminSwitchRowClass,
  adminTextareaClass,
} from "@/components/layout/admin-ui"
import { AdminTableBodyRow } from "@/components/layout/list-page-ui"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { ApiError, getJson, postJson } from "@/lib/api"
import type { AssetListItem, AssetListResponse } from "@/lib/assets-types"
import type { DisposalOrderDetail } from "@/lib/disposal-types"
import type { CostCenterMaster } from "@/lib/masters-types"
import { hasPermission } from "@/lib/permissions"
import { plantLabel, useAssetMasterLookups } from "@/lib/use-asset-masters"
import { cn } from "@/lib/utils"
import { CapexAssigneePickerDialog } from "@/pages/capex/capex-assignee-picker-dialog"

/** Backend rule: only active assets with approval approved/not_required can be disposed. */
function isDisposable(asset: {
  approval_status?: string | null
  lifecycle_status?: string | null
}): boolean {
  const lifecycle = (asset.lifecycle_status ?? "").trim().toLowerCase()
  if (lifecycle && lifecycle !== "active") return false
  const approval = (asset.approval_status ?? "").trim().toLowerCase()
  return approval === "approved" || approval === "not_required"
}

function FormField({
  id,
  labelText,
  required,
  children,
}: {
  id?: string
  labelText: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="app-form-field">
      <Label htmlFor={id} className="app-form-label">
        {labelText}
        {required ? <RequiredFieldMark /> : null}
      </Label>
      {children}
    </div>
  )
}

export function DisposalOrderCreatePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [plantId, setPlantId] = React.useState<number | null>(() => {
    const n = Number(searchParams.get("plant_id"))
    return Number.isFinite(n) && n > 0 ? n : null
  })
  const [selected, setSelected] = React.useState<AssetListItem[]>([])
  const [assetSearch, setAssetSearch] = React.useState("")
  const [catalog, setCatalog] = React.useState<AssetListItem[]>([])
  const [catalogLoading, setCatalogLoading] = React.useState(false)
  const [browseMore, setBrowseMore] = React.useState(false)
  const [requiresEngineering, setRequiresEngineering] = React.useState(false)
  const [remarks, setRemarks] = React.useState("")
  const [toCostCenterId, setToCostCenterId] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [pickerOpen, setPickerOpen] = React.useState(false)

  const masters = useAssetMasterLookups(plantId)
  const [scrapyardCostCenters, setScrapyardCostCenters] = React.useState<CostCenterMaster[]>([])
  const selectedIds = React.useMemo(() => new Set(selected.map((a) => a.id)), [selected])
  const canSubmitWithEngineering = hasPermission("disposal.submit_with_engineering")

  const presetAssetIds = React.useMemo(() => {
    const raw = searchParams.get("asset_ids")?.trim() ?? ""
    return new Set(
      raw
        .split(/[\s,]+/)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0),
    )
  }, [searchParams])
  const fromAssets = presetAssetIds.size > 0
  const showCatalog = !fromAssets || browseMore
  const presetApplied = React.useRef(false)

  // Assets handed over from Asset Master (sessionStorage + query params).
  React.useEffect(() => {
    if (!fromAssets || presetApplied.current) return
    const idSet = presetAssetIds
    try {
      const raw = sessionStorage.getItem("disposal-order-draft-assets")
      if (raw) {
        const parsed = JSON.parse(raw) as AssetListItem[]
        const rows = parsed.filter((a) => idSet.has(a.id) && isDisposable(a))
        if (rows.length > 0) {
          presetApplied.current = true
          setSelected(rows)
          const plants = [
            ...new Set(rows.map((a) => a.plant_id).filter((id): id is number => id != null)),
          ]
          if (plants.length === 1) setPlantId(plants[0] ?? null)
          if (rows.length < parsed.filter((a) => idSet.has(a.id)).length) {
            toast.error("Some assets were skipped — only active, approved assets can be disposed.")
          }
          return
        }
      }
    } catch {
      /* ignore */
    }
    // No draft payload — open catalog so preset ids can still be resolved.
    setBrowseMore(true)
  }, [fromAssets, presetAssetIds])

  // Default plant when the user only has one.
  React.useEffect(() => {
    if (plantId != null || masters.plants.length !== 1) return
    setPlantId(masters.plants[0]!.id)
  }, [plantId, masters.plants])

  React.useEffect(() => {
    if (plantId == null) {
      setScrapyardCostCenters([])
      return
    }
    void getJson<CostCenterMaster[]>(
      `/admin/asset-masters/cost-centers?plant_id=${plantId}&active_only=true&scrapyard_only=true`,
    )
      .then(setScrapyardCostCenters)
      .catch(() => setScrapyardCostCenters([]))
  }, [plantId])

  React.useEffect(() => {
    if (toCostCenterId || scrapyardCostCenters.length !== 1) return
    setToCostCenterId(String(scrapyardCostCenters[0]!.id))
  }, [scrapyardCostCenters, toCostCenterId])

  React.useEffect(() => {
    if (!showCatalog || plantId == null) {
      setCatalog([])
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
      if (q) params.set("search", q)
      void getJson<AssetListResponse>(`/admin/assets?${params}`)
        .then((res) => {
          if (cancelled) return
          setCatalog(res.items.filter(isDisposable))
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
      window.clearTimeout(t)
    }
  }, [plantId, assetSearch, showCatalog])

  // Fallback preselect from catalog when sessionStorage was empty.
  React.useEffect(() => {
    if (presetApplied.current || presetAssetIds.size === 0 || catalog.length === 0) return
    const rows = catalog.filter((a) => presetAssetIds.has(a.id))
    if (rows.length === 0) return
    presetApplied.current = true
    setSelected(rows)
    if (rows.length < presetAssetIds.size) {
      toast.error("Some assets were skipped — only active, approved assets can be disposed.")
    }
  }, [catalog, presetAssetIds])

  function toggleAsset(row: AssetListItem) {
    if (selectedIds.has(row.id)) {
      setSelected((prev) => prev.filter((a) => a.id !== row.id))
      return
    }
    if (!isDisposable(row)) {
      toast.error("Only active, approved assets can be disposed.")
      return
    }
    setSelected((prev) => [...prev, row])
  }

  async function create(submit: boolean, assigneeUserId?: number) {
    if (selected.length === 0) {
      toast.error("Add at least one Asset.")
      return
    }
    if (submit && !toCostCenterId) {
      toast.error("Select a Scrapyard Cost Center.")
      return
    }
    if (submit && assigneeUserId == null) {
      setPickerOpen(true)
      return
    }
    setBusy(true)
    try {
      const order = await postJson<DisposalOrderDetail>("/admin/disposal-orders", {
        asset_ids: selected.map((a) => a.id),
        remarks: remarks.trim() || null,
        requires_engineering: requiresEngineering,
        to_cost_center_id: toCostCenterId ? Number(toCostCenterId) : null,
        assignee_user_id: assigneeUserId ?? null,
        submit,
      })
      toast.success(
        submit
          ? `Disposal ${order.order_number} Submitted For Approval.`
          : `Draft ${order.order_number} saved.`,
      )
      try {
        sessionStorage.removeItem("disposal-order-draft-assets")
      } catch {
        /* ignore */
      }
      navigate(`/dashboard/disposal-orders/${order.id}`, { replace: true })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to create Disposal Order.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminPage
      fullWidth
      dense
      description=""
      className="w-full pb-6"
      actions={<AdminBackLink to="/dashboard/disposal-orders">Disposal Order</AdminBackLink>}
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
            title={`1. Select Asset `}
            // description="Active, approved assets from a single plant. Their current cost center becomes the order's From CC."
            headerActions={<Package className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="px-5 py-5"
          >
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField id="plant" labelText="Plant" required>
                <select
                  id="plant"
                  className={adminSelectClass}
                  value={plantId != null ? String(plantId) : ""}
                  disabled={fromAssets}
                  onChange={(e) => {
                    setPlantId(e.target.value ? Number(e.target.value) : null)
                    setSelected([])
                    setAssetSearch("")
                    setBrowseMore(false)
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

              {showCatalog ? (
                <FormField id="asset_search" labelText="Search">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      id="asset_search"
                      value={assetSearch}
                      disabled={plantId == null}
                      onChange={(e) => setAssetSearch(e.target.value)}
                      placeholder={plantId == null ? "Select a plant first" : "Asset code or name…"}
                      className="pl-9"
                      autoComplete="off"
                    />
                  </div>
                </FormField>
              ) : (
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-full shadow-sm sm:w-auto"
                    onClick={() => setBrowseMore(true)}
                  >
                    Select Other Assets
                  </Button>
                </div>
              )}
            </div>

            <div className="-mx-5 -mb-5 max-h-[28rem] overflow-auto">
              <Table>
                <TableHeader>
                  <AdminTableHeaderRow>
                    <AdminTableHeadCell className="w-10">
                      <span className="sr-only">Select</span>
                    </AdminTableHeadCell>
                    <AdminTableHeadCell>Asset</AdminTableHeadCell>
                    <AdminTableHeadCell>Cost center</AdminTableHeadCell>
                    <AdminTableHeadCell>Actual Location 1</AdminTableHeadCell>
                  </AdminTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {!showCatalog ? (
                    selected.length === 0 ? (
                      <AdminTableEmptyRow colSpan={4}>No Assets selected</AdminTableEmptyRow>
                    ) : (
                      selected.map((a) => (
                        <AdminTableBodyRow
                          key={a.id}
                          className="bg-primary/5"
                          onClick={() => toggleAsset(a)}
                        >
                          <AdminTableCell className="align-middle">
                            <div
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                            >
                              <Checkbox
                                checked
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
                          <AdminTableCell>{a.cost_center ?? "—"}</AdminTableCell>
                          <AdminTableCell>
                            {a.functional_location_description?.trim() ||
                              a.functional_location ||
                              "—"}
                          </AdminTableCell>
                        </AdminTableBodyRow>
                      ))
                    )
                  ) : plantId == null ? (
                    <AdminTableEmptyRow colSpan={4}>
                      Select a plant to list assets.
                    </AdminTableEmptyRow>
                  ) : catalogLoading ? (
                    <AdminTableEmptyRow colSpan={4}>Loading assets…</AdminTableEmptyRow>
                  ) : catalog.length === 0 ? (
                    <AdminTableEmptyRow colSpan={4}>
                      No active, approved assets match this search.
                    </AdminTableEmptyRow>
                  ) : (
                    catalog.map((a) => {
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
                          <AdminTableCell>{a.cost_center ?? "—"}</AdminTableCell>
                          <AdminTableCell>
                            {a.functional_location_description?.trim() ||
                              a.functional_location ||
                              "—"}
                          </AdminTableCell>
                        </AdminTableBodyRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </AdminPanel>

          <AdminPanel
            title="2. Disposal Detail"
            // description="Pick the scrapyard destination, approval route, and notes for approvers."
            headerActions={<PackageX className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="px-5 py-5"
          >
            <div className="grid grid-cols-1 gap-4">
              <FormField id="scrapyard_cc" labelText="Scrapyard Cost Center" required>
                <select
                  id="scrapyard_cc"
                  className={adminSelectClass}
                  value={toCostCenterId}
                  disabled={plantId == null}
                  onChange={(e) => setToCostCenterId(e.target.value)}
                >
                  <option value="">
                    {plantId == null
                      ? "Select plant first"
                      : scrapyardCostCenters.length === 0
                        ? "No scrapyard cost centers for this plant"
                        : "Select scrapyard"}
                  </option>
                  {scrapyardCostCenters.map((cc) => (
                    <option key={cc.id} value={String(cc.id)}>
                      {cc.code} — {cc.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {/* Mark cost centers as scrapyard under Asset Masters → Cost centers. */}
                </p>
              </FormField>
              {canSubmitWithEngineering ? (
                <label
                  htmlFor="requires_engineering"
                  className={cn(
                    adminSwitchRowClass,
                    "cursor-pointer transition-colors hover:bg-muted/35",
                    requiresEngineering && "border-primary/40 bg-primary/5",
                  )}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <span className="block text-sm font-medium text-foreground">
                      Submit with Engineering Approval
                    </span>
                    {/* <span className="block text-xs text-muted-foreground">
                      Routes the order Th Engineering.
                    </span> */}
                  </div>
                  <Checkbox
                    id="requires_engineering"
                    checked={requiresEngineering}
                    onCheckedChange={(v) => setRequiresEngineering(v === true)}
                    className="size-5 border-foreground/35 shadow-sm"
                    aria-label="Submit with Engineering Approval"
                  />
                </label>
              ) : null}

              <FormField id="remarks" labelText="Remark">
                <textarea
                  id="remarks"
                  className={cn(adminTextareaClass, "min-h-[96px]")}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Reason for Disposal"
                  rows={4}
                />
              </FormField>
            </div>
          </AdminPanel>
        </div>

        <div className="flex justify-end gap-2 border-t border-border/60 pt-4">
          <Button
            type="button"
            variant="outline"
            className="h-9 shadow-sm"
            disabled={busy}
            onClick={() => navigate("/dashboard/disposal-orders")}
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
        assigneesUrl={`/admin/disposal-orders/assignees?requires_engineering=${requiresEngineering ? "true" : "false"}`}
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
