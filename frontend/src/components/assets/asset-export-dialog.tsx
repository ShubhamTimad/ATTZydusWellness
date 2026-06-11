import * as React from "react"
import { Download } from "lucide-react"
import { toast } from "sonner"

import { AdminPrimaryButton } from "@/components/layout/admin-ui"
import { adminSelectClass } from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { downloadFile } from "@/lib/api"
import {
  ASSET_EXPORT_DEFAULT_FIELDS,
  ASSET_EXPORT_FIELD_GROUPS,
  ASSET_EXPORT_FIELD_LABELS,
} from "@/lib/asset-master-fields"
import type { AssetListTab, AssetFySubTab } from "@/pages/assets/assets-list"
import { categoryLabel, plantLabel, useAssetMasterLookups } from "@/lib/use-asset-masters"

export type AssetExportFilterState = {
  plant_id: string
  category_id: string
  cost_center: string
  functional_location: string
  actual_location: string
  fy_start_year: string
}

type AssetExportDialogBaseProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type AssetExportListProps = AssetExportDialogBaseProps & {
  variant?: "list"
  listTab: AssetListTab
  fySubTab: AssetFySubTab
  initialPlantId: string
  initialCategoryId: string
  initialFyStartYear: string
  scanFrom: string
  scanTo: string
  selectedAssetIds: number[]
  fyYearOptions: { start_year: number; label: string }[]
  currentFyStartYear: number | null
}

type AssetRegisterReportProps = AssetExportDialogBaseProps & {
  variant: "register"
}

export type AssetExportDialogProps = AssetExportListProps | AssetRegisterReportProps

export function buildAssetExportPath(
  fields: string[],
  opts: {
    filters: AssetExportFilterState
    listTab: AssetListTab
    fySubTab: AssetFySubTab
    scanFrom: string
    scanTo: string
    selectedOnly: boolean
    selectedAssetIds: number[]
  },
): string {
  const q = new URLSearchParams()
  for (const field of fields) {
    q.append("fields", field)
  }
  if (opts.filters.plant_id) q.set("plant_id", opts.filters.plant_id)
  if (opts.filters.category_id) q.set("category_id", opts.filters.category_id)
  if (opts.filters.cost_center) q.set("cost_center", opts.filters.cost_center)
  if (opts.filters.functional_location) q.set("functional_location", opts.filters.functional_location)
  if (opts.filters.actual_location) q.set("actual_location", opts.filters.actual_location)
  if (opts.listTab === "fy") {
    q.set("fy_verification", opts.fySubTab)
    if (opts.filters.fy_start_year) q.set("fy_start_year", opts.filters.fy_start_year)
    if (opts.scanFrom) q.set("fy_scan_from", opts.scanFrom)
    if (opts.scanTo) q.set("fy_scan_to", opts.scanTo)
  }
  if (opts.selectedOnly) {
    for (const id of opts.selectedAssetIds) {
      q.append("asset_ids", String(id))
    }
  }
  return `/admin/assets/export?${q.toString()}`
}

function masterOptionLabel(_code: string, name?: string | null): string {
  const n = name?.trim()
  if (n) return n
  return _code.trim()
}

const EMPTY_FILTERS: AssetExportFilterState = {
  plant_id: "",
  category_id: "",
  cost_center: "",
  functional_location: "",
  actual_location: "",
  fy_start_year: "",
}

export function AssetExportDialog(props: AssetExportDialogProps) {
  const isRegister = props.variant === "register"
  const listTab = isRegister ? "all" : props.listTab
  const fySubTab = isRegister ? "verified" : props.fySubTab
  const initialPlantId = isRegister ? "" : props.initialPlantId
  const initialCategoryId = isRegister ? "" : props.initialCategoryId
  const initialFyStartYear = isRegister ? "" : props.initialFyStartYear
  const scanFrom = isRegister ? "" : props.scanFrom
  const scanTo = isRegister ? "" : props.scanTo
  const selectedAssetIds = isRegister ? [] : props.selectedAssetIds
  const fyYearOptions = isRegister ? [] : props.fyYearOptions
  const currentFyStartYear = isRegister ? null : props.currentFyStartYear

  const [exportFilters, setExportFilters] = React.useState<AssetExportFilterState>(EMPTY_FILTERS)
  const [selectedFields, setSelectedFields] = React.useState<Set<string>>(
    () => new Set(ASSET_EXPORT_DEFAULT_FIELDS),
  )
  const [selectedOnly, setSelectedOnly] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const plantId = exportFilters.plant_id ? Number(exportFilters.plant_id) : null
  const masters = useAssetMasterLookups(
    plantId,
    exportFilters.cost_center || null,
    exportFilters.functional_location || null,
  )

  React.useEffect(() => {
    if (!props.open) return
    setExportFilters({
      plant_id: initialPlantId,
      category_id: initialCategoryId,
      cost_center: "",
      functional_location: "",
      actual_location: "",
      fy_start_year: initialFyStartYear,
    })
    setSelectedFields(new Set(ASSET_EXPORT_DEFAULT_FIELDS))
    setSelectedOnly(!isRegister && selectedAssetIds.length > 0)
  }, [
    props.open,
    initialPlantId,
    initialCategoryId,
    initialFyStartYear,
    selectedAssetIds.length,
    isRegister,
  ])

  const allFieldKeys = React.useMemo(
    () => ASSET_EXPORT_FIELD_GROUPS.flatMap((g) => g.keys),
    [],
  )

  function toggleField(key: string, on: boolean) {
    setSelectedFields((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  async function runExport() {
    if (selectedFields.size === 0) {
      toast.error("Select at least one field to export.")
      return
    }
    if (selectedOnly && selectedAssetIds.length === 0) {
      toast.error("No assets selected on the list.")
      return
    }
    setBusy(true)
    try {
      const path = buildAssetExportPath([...selectedFields], {
        filters: exportFilters,
        listTab,
        fySubTab,
        scanFrom,
        scanTo,
        selectedOnly,
        selectedAssetIds,
      })
      await downloadFile(path, isRegister ? "asset-register.xlsx" : "assets-export.xlsx")
      toast.success(isRegister ? "Report downloaded." : "Export downloaded.")
      props.onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : isRegister ? "Report failed." : "Export failed.")
    } finally {
      setBusy(false)
    }
  }

  const isFyTab = !isRegister && listTab === "fy"

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,720px)] max-w-lg flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isRegister ? "Asset register report" : "Export assets"}</DialogTitle>
          <DialogDescription>
            {isRegister
              ? "Set filters and choose columns, then download the Excel report."
              : "Filter by plant and location masters, then choose columns for the Excel file."}
          </DialogDescription>
        </DialogHeader>

        <div className="dialog-body min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Plant</Label>
              <select
                className={adminSelectClass}
                value={exportFilters.plant_id}
                onChange={(e) => {
                  const plant_id = e.target.value
                  setExportFilters((f) => ({
                    ...f,
                    plant_id,
                    cost_center: "",
                    functional_location: "",
                    actual_location: "",
                  }))
                }}
              >
                <option value="">All plants</option>
                {masters.plants.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {plantLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <select
                className={adminSelectClass}
                value={exportFilters.category_id}
                onChange={(e) => setExportFilters((f) => ({ ...f, category_id: e.target.value }))}
              >
                <option value="">All categories</option>
                {masters.categories.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Cost center</Label>
              <select
                className={adminSelectClass}
                value={exportFilters.cost_center}
                disabled={!plantId}
                onChange={(e) => setExportFilters((f) => ({ ...f, cost_center: e.target.value }))}
              >
                <option value="">{plantId ? "All cost centers" : "Select plant first"}</option>
                {masters.costCenters.map((cc) => (
                  <option key={cc.id} value={cc.code}>
                    {masterOptionLabel(cc.code, cc.name)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Functional location</Label>
              <select
                className={adminSelectClass}
                value={exportFilters.functional_location}
                disabled={!plantId}
                onChange={(e) =>
                  setExportFilters((f) => ({
                    ...f,
                    functional_location: e.target.value,
                    actual_location: "",
                  }))
                }
              >
                <option value="">{plantId ? "All functional locations" : "Select plant first"}</option>
                {masters.functionalLocations.map((fl) => (
                  <option key={fl.id} value={fl.code}>
                    {masterOptionLabel(fl.code, fl.name)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Actual location</Label>
              <select
                className={adminSelectClass}
                value={exportFilters.actual_location}
                disabled={!plantId || !exportFilters.functional_location}
                onChange={(e) => setExportFilters((f) => ({ ...f, actual_location: e.target.value }))}
              >
                <option value="">
                  {!plantId
                    ? "Select plant first"
                    : !exportFilters.functional_location
                      ? "Select functional location first"
                      : "All actual locations"}
                </option>
                {masters.actualLocations.map((al) => (
                  <option key={al.id} value={al.code}>
                    {masterOptionLabel(al.code, al.name)}
                  </option>
                ))}
              </select>
            </div>
            {isFyTab ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Financial year</Label>
                <select
                  className={adminSelectClass}
                  value={exportFilters.fy_start_year || String(currentFyStartYear ?? "")}
                  onChange={(e) =>
                    setExportFilters((f) => ({ ...f, fy_start_year: e.target.value }))
                  }
                >
                  {fyYearOptions.map((o) => (
                    <option key={o.start_year} value={String(o.start_year)}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  FY tab filter: {fySubTab === "verified" ? "Verified only" : "Pending only"}
                </p>
              </div>
            ) : null}
          </div>

          {!isRegister && selectedAssetIds.length > 0 ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={selectedOnly}
                onCheckedChange={(v) => setSelectedOnly(Boolean(v))}
              />
              Export selected rows only ({selectedAssetIds.length})
            </label>
          ) : null}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>{isRegister ? "Columns to include" : "Columns to export"}</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSelectedFields(new Set(allFieldKeys))}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSelectedFields(new Set())}
                >
                  Clear
                </Button>
              </div>
            </div>
            {ASSET_EXPORT_FIELD_GROUPS.map((group) => (
              <div
                key={group.label}
                className="rounded-md border border-border/60 bg-muted/15 p-3"
              >
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.keys.map((key) => (
                    <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedFields.has(key)}
                        onCheckedChange={(v) => toggleField(key, Boolean(v))}
                      />
                      <span className="truncate">{ASSET_EXPORT_FIELD_LABELS[key] ?? key}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="dialog-footer-actions shrink-0">
          <Button type="button" variant="outline" disabled={busy} onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <AdminPrimaryButton type="button" disabled={busy} onClick={() => void runExport()}>
            <Download className="size-4" aria-hidden />
            {busy
              ? isRegister
                ? "Generating…"
                : "Exporting…"
              : isRegister
                ? "Get report"
                : "Download Excel"}
          </AdminPrimaryButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}
