import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { Plus, ScanLine, Search, SlidersHorizontal, Upload, X } from "lucide-react"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminDataTable,
  AdminTableBodyRow,
  AdminTableEmptyRow,
  AdminTablePagination,
  ListPageHeader,
} from "@/components/layout/list-page-ui"
import {
  AdminPrimaryButton,
  AdminPillBadge,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { AssetActionsMenu } from "@/components/assets/asset-actions-menu"
import { AssetRfidDialog } from "@/components/assets/asset-rfid-dialog"
import { ApiError, deleteJson, getJson, postJson } from "@/lib/api"
import {
  buildAssetListActionItems,
  countRfidTaggedSelected,
  countSubmittableSelected,
  selectedAssetsFromList,
} from "@/lib/asset-actions"
import type {
  AssetListResponse,
  AssetRfidAttachResult,
  SubmitForApprovalResult,
} from "@/lib/assets-types"
import { categoryLabel, plantLabel, useAssetMasterLookups } from "@/lib/use-asset-masters"
import { assetStatusLabel, assetStatusPillTone, canSubmitForApproval } from "@/lib/asset-lifecycle"
import { hasPermission } from "@/lib/permissions"
import type { ValidateAssetsResponse } from "@/lib/orders-types"
import { orderStatusLabel } from "@/lib/orders-types"
import { CreatePhysicalOrderDialog } from "@/pages/orders/create-order-dialog"
import { cn } from "@/lib/utils"

export type AssetListFilters = {
  plant_id: string
  category_id: string
  lifecycle_status: string
  approval_status: string
  sort_by: string
  sort_dir: string
}

const DEFAULT_FILTERS: AssetListFilters = {
  plant_id: "",
  category_id: "",
  lifecycle_status: "",
  approval_status: "",
  sort_by: "created_at",
  sort_dir: "desc",
}

function formatMasterLabel(code: string | null | undefined, description: string | null | undefined): string {
  const c = code?.trim()
  if (!c) return "—"
  const d = description?.trim()
  return d ? `${c} — ${d}` : c
}

function formatPlantLabel(row: { plant_code?: string | null; plant_name?: string | null }): string {
  const code = row.plant_code?.trim()
  const name = row.plant_name?.trim()
  if (code && name) return `${code} — ${name}`
  return name || code || "—"
}

function countActiveFilters(f: AssetListFilters): number {
  let n = 0
  if (f.plant_id) n += 1
  if (f.category_id) n += 1
  if (f.lifecycle_status) n += 1
  if (f.approval_status) n += 1
  return n
}

function buildQueryParams(
  page: number,
  search: string,
  filters: AssetListFilters,
): URLSearchParams {
  const q = new URLSearchParams({ page: String(page), page_size: "25" })
  if (search.trim()) q.set("search", search.trim())
  if (filters.plant_id) q.set("plant_id", filters.plant_id)
  if (filters.category_id) q.set("category_id", filters.category_id)
  if (filters.lifecycle_status) q.set("lifecycle_status", filters.lifecycle_status)
  if (filters.approval_status) q.set("approval_status", filters.approval_status)
  if (filters.sort_by) q.set("sort_by", filters.sort_by)
  if (filters.sort_dir) q.set("sort_dir", filters.sort_dir)
  return q
}

export function AssetsListPage() {
  const navigate = useNavigate()
  const [data, setData] = React.useState<AssetListResponse | null>(null)
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [filters, setFilters] = React.useState<AssetListFilters>(DEFAULT_FILTERS)
  const [draftFilters, setDraftFilters] = React.useState<AssetListFilters>(DEFAULT_FILTERS)
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [loading, setLoading] = React.useState(false)
  const [bulkActionBusy, setBulkActionBusy] = React.useState(false)
  const [orderValidateBusy, setOrderValidateBusy] = React.useState(false)
  const [activeConflictOpen, setActiveConflictOpen] = React.useState(false)
  const [plantMismatchOpen, setPlantMismatchOpen] = React.useState(false)
  const [ccMismatchOpen, setCcMismatchOpen] = React.useState(false)
  const [missingRfidOpen, setMissingRfidOpen] = React.useState(false)
  const [validationResult, setValidationResult] = React.useState<ValidateAssetsResponse | null>(null)
  const [createOrderOpen, setCreateOrderOpen] = React.useState(false)
  const [eligibleForOrder, setEligibleForOrder] = React.useState<number[]>([])
  const [resetVerificationAssetIds, setResetVerificationAssetIds] = React.useState<number[]>([])
  const [fyVerifiedOpen, setFyVerifiedOpen] = React.useState(false)
  const [rfidDialogOpen, setRfidDialogOpen] = React.useState(false)
  const [rfidDialogMode, setRfidDialogMode] = React.useState<"by-code" | "selected">("by-code")
  const [rfidAttachAssetId, setRfidAttachAssetId] = React.useState<number | null>(null)
  const [rfidAssetCode, setRfidAssetCode] = React.useState("")
  const [rfidValue, setRfidValue] = React.useState("")
  const [rfidTagColorId, setRfidTagColorId] = React.useState("")
  const [rfidSaving, setRfidSaving] = React.useState(false)

  const filterPlantId = draftFilters.plant_id ? Number(draftFilters.plant_id) : null
  const masters = useAssetMasterLookups(filterPlantId, null, null)

  const canCreate = hasPermission("asset.create")
  const canImport = hasPermission("asset.import")
  const canSubmitApproval = hasPermission("asset.create")
  const canDelete = hasPermission("asset.delete") || hasPermission("asset.manage")
  const canCreateOrder = hasPermission("order.create")
  const canAttachRfid = hasPermission("asset.update") || hasPermission("asset.manage")
  const activeFilterCount = countActiveFilters(filters)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const q = buildQueryParams(page, search, filters)
      const res = await getJson<AssetListResponse>(`/admin/assets?${q}`)
      setData(res)
    } finally {
      setLoading(false)
    }
  }, [page, search, filters])

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, 300)
    return () => window.clearTimeout(t)
  }, [searchInput])

  React.useEffect(() => {
    void load().catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load assets"))
  }, [load])

  function applyFilters() {
    setFilters(draftFilters)
    setPage(1)
    setFiltersOpen(false)
  }

  function clearFilters() {
    setDraftFilters(DEFAULT_FILTERS)
    setFilters(DEFAULT_FILTERS)
    setPage(1)
  }

  function toggleRow(id: number, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAll(on: boolean) {
    if (!data) return
    if (on) setSelected(new Set(data.items.map((i) => i.id)))
    else setSelected(new Set())
  }

  const items = data?.items ?? []
  const selectedRows = React.useMemo(
    () => selectedAssetsFromList(items, selected),
    [items, selected],
  )
  const submittableCount = React.useMemo(
    () => countSubmittableSelected(selectedRows, canSubmitApproval),
    [selectedRows, canSubmitApproval],
  )
  const rfidTaggedCount = React.useMemo(
    () => countRfidTaggedSelected(selectedRows),
    [selectedRows],
  )
  const listActions = React.useMemo(
    () =>
      buildAssetListActionItems({
        selectedCount: selected.size,
        submittableCount,
        rfidTaggedCount,
        canSubmitApproval,
        canDelete,
        canAttachRfid,
        canCreateOrder,
      }),
    [
      selected.size,
      submittableCount,
      rfidTaggedCount,
      canSubmitApproval,
      canDelete,
      canAttachRfid,
      canCreateOrder,
    ],
  )

  const attachRfidRow = selectedRows.length === 1 ? selectedRows[0] : null

  function openAttachRfidToolbarDialog() {
    setRfidDialogMode("by-code")
    setRfidAttachAssetId(null)
    setRfidAssetCode("")
    setRfidValue("")
    setRfidTagColorId("")
    setRfidDialogOpen(true)
  }

  function openAttachRfidFromSelection() {
    const row = attachRfidRow
    if (!row) return
    setRfidDialogMode("selected")
    setRfidAttachAssetId(row.id)
    setRfidAssetCode("")
    setRfidValue(row.rfid_code?.trim() ?? "")
    setRfidTagColorId(row.tag_color_id != null ? String(row.tag_color_id) : "")
    setRfidDialogOpen(true)
  }

  function rfidPayloadExtras() {
    return {
      tag_color_id: rfidTagColorId ? Number(rfidTagColorId) : null,
    }
  }

  async function saveAttachedRfid() {
    const rfid = rfidValue.trim()
    if (!rfid) {
      toast.error("Enter or scan an RFID code.")
      return
    }
    if (rfidDialogMode === "by-code") {
      const assetCode = rfidAssetCode.trim()
      if (!assetCode) {
        toast.error("Enter the asset code.")
        return
      }
      setRfidSaving(true)
      try {
        const res = await postJson<AssetRfidAttachResult>("/admin/assets/rfid/attach-by-code", {
          asset_code: assetCode,
          rfid_code: rfid,
          ...rfidPayloadExtras(),
        })
        toast.success(
          res.operation === "updated"
            ? `RFID updated on ${res.asset_code}.`
            : `RFID attached to ${res.asset_code}.`,
        )
        setRfidDialogOpen(false)
        await load()
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Failed to attach RFID.")
      } finally {
        setRfidSaving(false)
      }
      return
    }

    if (rfidAttachAssetId == null) return
    setRfidSaving(true)
    try {
      const res = await postJson<AssetRfidAttachResult>(
        `/admin/assets/${rfidAttachAssetId}/rfid/attach`,
        { rfid_code: rfid, ...rfidPayloadExtras() },
      )
      toast.success(
        res.operation === "updated"
          ? `RFID updated on ${res.asset_code}.`
          : `RFID attached to ${res.asset_code}.`,
      )
      setRfidDialogOpen(false)
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to attach RFID.")
    } finally {
      setRfidSaving(false)
    }
  }

  async function submitSelectedForApproval() {
    const ids = selectedRows
      .filter((row) => canSubmitForApproval(row.lifecycle_status, row.approval_status))
      .map((r) => r.id)
    if (ids.length === 0) {
      toast.error("No selected assets can be submitted for approval.")
      return
    }
    setBulkActionBusy(true)
    try {
      const res = await postJson<SubmitForApprovalResult>("/admin/assets/submit-for-approval", {
        asset_ids: ids,
      })
      if (res.submitted_count > 0) {
        toast.success(
          `${res.submitted_count} asset(s) submitted for approval.${res.activated_count > 0 ? ` ${res.activated_count} activated (no workflow).` : ""}`,
        )
      } else if (res.activated_count > 0) {
        toast.success(`${res.activated_count} asset(s) activated (no approval workflow configured).`)
      }
      if (res.errors.length > 0) {
        toast.error(res.errors.slice(0, 2).join(" "))
      }
      setSelected(new Set())
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Submit for approval failed.")
    } finally {
      setBulkActionBusy(false)
    }
  }

  async function deleteSelected() {
    const ids = selectedRows.map((r) => r.id)
    if (ids.length === 0) return
    if (!window.confirm(`Delete ${ids.length} selected asset(s)? This cannot be undone.`)) return
    setBulkActionBusy(true)
    try {
      const errors: string[] = []
      for (const id of ids) {
        try {
          await deleteJson(`/admin/assets/${id}`)
        } catch (e) {
          errors.push(e instanceof ApiError ? e.message : `Asset ${id}`)
        }
      }
      if (errors.length === 0) {
        toast.success(`Deleted ${ids.length} asset(s).`)
      } else if (errors.length < ids.length) {
        toast.warning(`Deleted ${ids.length - errors.length} of ${ids.length}. Some failed.`)
      } else {
        toast.error(errors[0] ?? "Delete failed.")
      }
      setSelected(new Set())
      await load()
    } finally {
      setBulkActionBusy(false)
    }
  }

  async function beginCreatePhysicalOrder() {
    const ids = [...selected]
    if (ids.length === 0) return
    setOrderValidateBusy(true)
    try {
      const res = await postJson<ValidateAssetsResponse>("/admin/physical-orders/validate-assets", {
        asset_ids: ids,
      })
      setValidationResult(res)
      if (res.active_order_conflicts.length > 0) {
        setActiveConflictOpen(true)
        return
      }
      if (res.missing_rfid.length > 0) {
        setMissingRfidOpen(true)
        return
      }
      if (res.plant_mismatch.length > 0) {
        setPlantMismatchOpen(true)
        return
      }
      if (res.cost_center_mismatch.length > 0) {
        setCcMismatchOpen(true)
        return
      }
      if (res.eligible_asset_ids.length === 0) {
        toast.error("No eligible assets selected.")
        return
      }
      const fyVerified = res.already_verified_in_fy.filter((a) =>
        res.eligible_asset_ids.includes(a.asset_id),
      )
      if (fyVerified.length > 0) {
        setFyVerifiedOpen(true)
        return
      }
      setResetVerificationAssetIds([])
      setEligibleForOrder(res.eligible_asset_ids)
      setCreateOrderOpen(true)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Validation failed.")
    } finally {
      setOrderValidateBusy(false)
    }
  }

  function proceedWithEligibleOnly(resetIds: number[] = []) {
    const eligible = validationResult?.eligible_asset_ids ?? []
    if (eligible.length === 0) {
      toast.error("No eligible assets.")
      return
    }
    setResetVerificationAssetIds(resetIds)
    setEligibleForOrder(eligible)
    setSelected(new Set(eligible))
    setActiveConflictOpen(false)
    setMissingRfidOpen(false)
    setPlantMismatchOpen(false)
    setCcMismatchOpen(false)
    setFyVerifiedOpen(false)
    setCreateOrderOpen(true)
  }

  function fyVerifiedEligibleIds(): number[] {
    const eligible = validationResult?.eligible_asset_ids ?? []
    const eligibleSet = new Set(eligible)
    return (validationResult?.already_verified_in_fy ?? [])
      .filter((a) => eligibleSet.has(a.asset_id))
      .map((a) => a.asset_id)
  }

  function handleListAction(actionId: string) {
    if (actionId === "attach-rfid") {
      openAttachRfidFromSelection()
      return
    }
    if (actionId === "create-physical-order") {
      void beginCreatePhysicalOrder()
      return
    }
    if (actionId === "submit-for-approval") {
      void submitSelectedForApproval()
      return
    }
    if (actionId === "open") {
      const id = selectedRows[0]?.id
      if (id != null) navigate(String(id))
      return
    }
    if (actionId === "delete") {
      void deleteSelected()
      return
    }
    if (actionId === "clear-selection") {
      setSelected(new Set())
    }
  }
  const total = data?.total ?? 0
  const pageSize = data?.page_size ?? 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const actionButtons = (
    <>
      {canImport ? (
        <Button variant="outline" size="sm" className="shrink-0" asChild>
          <Link to="/dashboard/assets/import">
            <Upload className="size-4" aria-hidden />
            Import
          </Link>
        </Button>
      ) : null}
      {canCreate ? (
        <AdminPrimaryButton type="button" className="shrink-0" asChild>
          <Link to="/dashboard/assets/new">
            <Plus className="size-4" aria-hidden />
            Create asset
          </Link>
        </AdminPrimaryButton>
      ) : null}
    </>
  )

  return (
    <AdminPage fullWidth dense className="flex min-h-0 flex-1 flex-col">
      <ListPageHeader
        className="shrink-0"
        title="Assets"
        description="Search, filter, and manage assets across plants. Select rows for bulk actions."
        actions={actionButtons}
      />

      <div className="flex shrink-0 flex-col gap-[var(--app-grid-gap)]">
        <div className="app-list-toolbar">
          <div className="relative min-w-[16rem] flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="asset-search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name, code, serial, or RFID…"
              className="w-full pl-9"
              aria-label="Search assets"
            />
            {searchInput ? (
              <button
                type="button"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
                onClick={() => setSearchInput("")}
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn("shrink-0", filtersOpen && "border-primary/40 bg-primary/5")}
            onClick={() => {
              setDraftFilters(filters)
              setFiltersOpen((o) => !o)
            }}
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            Filters
            {activeFilterCount > 0 ? (
              <Badge variant="secondary" className="h-5 min-w-5 rounded-full px-1.5 text-[10px]">
                {activeFilterCount}
              </Badge>
            ) : null}
          </Button>

          {selected.size === 0 && canAttachRfid ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={openAttachRfidToolbarDialog}
            >
              <ScanLine className="size-4" aria-hidden />
              Attach RFID
            </Button>
          ) : null}

          {selected.size > 0 ? (
            <AssetActionsMenu
              actions={listActions}
              selectedCount={selected.size}
              busy={bulkActionBusy || orderValidateBusy}
              onAction={handleListAction}
            />
          ) : null}
        </div>

        {filtersOpen ? (
          <div className="app-panel rounded-[var(--app-radius-surface)] bg-muted/15 p-[var(--app-card-padding)] shadow-none">
            <div className="app-grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <div className="app-form-field">
                <Label className="app-form-label text-muted-foreground">Plant</Label>
                <select
                  className={adminSelectClass}
                  value={draftFilters.plant_id}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, plant_id: e.target.value }))}
                >
                  <option value="">All plants</option>
                  {masters.plants.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {plantLabel(p)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="app-form-field">
                <Label className="app-form-label text-muted-foreground">Category</Label>
                <select
                  className={adminSelectClass}
                  value={draftFilters.category_id}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, category_id: e.target.value }))}
                >
                  <option value="">All categories</option>
                  {masters.categories.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {categoryLabel(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="app-form-field">
                <Label className="app-form-label text-muted-foreground">Lifecycle</Label>
                <select
                  className={adminSelectClass}
                  value={draftFilters.lifecycle_status}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, lifecycle_status: e.target.value }))}
                >
                  <option value="">All</option>
                  <option value="active">Active</option>
                  <option value="pending_approval">Pending approval</option>
                  <option value="inactive">Inactive</option>
                  <option value="draft">Draft</option>
                </select>
              </div>
              <div className="app-form-field">
                <Label className="app-form-label text-muted-foreground">Approval</Label>
                <select
                  className={adminSelectClass}
                  value={draftFilters.approval_status}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, approval_status: e.target.value }))}
                >
                  <option value="">All</option>
                  <option value="draft">Draft (not submitted)</option>
                  <option value="pending">Pending approval</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="not_required">Not required</option>
                </select>
              </div>
              <div className="app-form-field">
                <Label className="app-form-label text-muted-foreground">Sort by</Label>
                <select
                  className={adminSelectClass}
                  value={draftFilters.sort_by}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, sort_by: e.target.value }))}
                >
                  <option value="created_at">Created date</option>
                  <option value="asset_name">Asset name</option>
                  <option value="asset_code">Asset code</option>
                </select>
              </div>
              <div className="app-form-field">
                <Label className="app-form-label text-muted-foreground">Order</Label>
                <select
                  className={adminSelectClass}
                  value={draftFilters.sort_dir}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, sort_dir: e.target.value }))}
                >
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </div>
            </div>
            <div className="mt-[var(--app-grid-gap)] flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-[var(--app-grid-gap)]">
              <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                Clear all
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraftFilters(filters)
                  setFiltersOpen(false)
                }}
              >
                Cancel
              </Button>
              <AdminPrimaryButton type="button" onClick={applyFilters}>
                Apply filters
              </AdminPrimaryButton>
            </div>
          </div>
        ) : null}

        {activeFilterCount > 0 && !filtersOpen ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Active:</span>
            {filters.plant_id ? (
              <FilterChip
                label={`Plant: ${masters.plants.find((p) => String(p.id) === filters.plant_id)?.code ?? filters.plant_id}`}
                onRemove={() => {
                  setFilters((f) => ({ ...f, plant_id: "" }))
                  setPage(1)
                }}
              />
            ) : null}
            {filters.category_id ? (
              <FilterChip
                label={`Category: ${masters.categories.find((c) => String(c.id) === filters.category_id)?.code ?? filters.category_id}`}
                onRemove={() => {
                  setFilters((f) => ({ ...f, category_id: "" }))
                  setPage(1)
                }}
              />
            ) : null}
            {filters.lifecycle_status ? (
              <FilterChip
                label={`Lifecycle: ${filters.lifecycle_status.replace(/_/g, " ")}`}
                onRemove={() => {
                  setFilters((f) => ({ ...f, lifecycle_status: "" }))
                  setPage(1)
                }}
              />
            ) : null}
            {filters.approval_status ? (
              <FilterChip
                label={`Approval: ${filters.approval_status.replace(/_/g, " ")}`}
                onRemove={() => {
                  setFilters((f) => ({ ...f, approval_status: "" }))
                  setPage(1)
                }}
              />
            ) : null}
            <Button type="button" variant="link" className="h-auto px-1 text-xs" onClick={clearFilters}>
              Clear all
            </Button>
          </div>
        ) : null}
      </div>

      <AdminDataTable
        className="min-h-0 flex-1"
        footer={
          <AdminTablePagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            loading={loading}
            itemLabel="assets"
            onPageChange={setPage}
          />
        }
      >
        <Table className="app-table-head-sticky">
            <TableHeader>
              <AdminTableHeaderRow>
                <AdminTableHeadCell className="w-10 px-3">
                  <Checkbox
                    checked={items.length > 0 && selected.size === items.length}
                    onCheckedChange={(v) => toggleAll(Boolean(v))}
                    aria-label="Select all"
                  />
                </AdminTableHeadCell>
                <AdminTableHeadCell>Asset name</AdminTableHeadCell>
                <AdminTableHeadCell>RFID</AdminTableHeadCell>
                <AdminTableHeadCell>Status</AdminTableHeadCell>
                <AdminTableHeadCell>Category</AdminTableHeadCell>
                <AdminTableHeadCell>Plant</AdminTableHeadCell>
                <AdminTableHeadCell>Cost center</AdminTableHeadCell>
                <AdminTableHeadCell>Functional location</AdminTableHeadCell>
                <AdminTableHeadCell>Actual location</AdminTableHeadCell>
                <AdminTableHeadCell className="text-right">Inv.</AdminTableHeadCell>
                <AdminTableHeadCell className="text-right">Phys.</AdminTableHeadCell>
                <AdminTableHeadCell>Verified</AdminTableHeadCell>
              </AdminTableHeaderRow>
            </TableHeader>
            <TableBody>
              {loading && items.length === 0 ? (
                <AdminTableEmptyRow colSpan={13}>Loading assets…</AdminTableEmptyRow>
              ) : items.length === 0 ? (
                <AdminTableEmptyRow colSpan={13}>
                  No assets match your search or filters.
                </AdminTableEmptyRow>
              ) : (
                items.map((row) => (
                  <AdminTableBodyRow
                    key={row.id}
                    onClick={() => navigate(String(row.id))}
                  >
                    <AdminTableCell className="w-10 px-3">
                      <div
                        className="flex items-center"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        role="presentation"
                      >
                        <Checkbox
                          checked={selected.has(row.id)}
                          onCheckedChange={(v) => toggleRow(row.id, Boolean(v))}
                          aria-label={`Select ${row.asset_name}`}
                        />
                      </div>
                    </AdminTableCell>
                    <AdminTableCell>
                      <span className="font-medium text-foreground">{row.asset_name}</span>
                      <div className="font-mono text-[11px] text-muted-foreground">{row.asset_code}</div>
                    </AdminTableCell>
                    <AdminTableCell className="font-mono text-xs">
                      {row.rfid_code?.trim() ? (
                        <span className="text-foreground" title={row.rfid_code}>
                          {row.rfid_code}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not tagged</span>
                      )}
                    </AdminTableCell>
                    <AdminTableCell>
                      <AdminPillBadge tone={assetStatusPillTone(row.lifecycle_status, row.approval_status)}>
                        {assetStatusLabel(row.lifecycle_status, row.approval_status)}
                      </AdminPillBadge>
                    </AdminTableCell>
                    <AdminTableCell className="text-muted-foreground">{row.category_name ?? "—"}</AdminTableCell>
                    <AdminTableCell className="max-w-[11rem]">
                      <span className="block truncate" title={formatPlantLabel(row)}>
                        {formatPlantLabel(row)}
                      </span>
                    </AdminTableCell>
                    <AdminTableCell className="max-w-[11rem]">
                      <span
                        className="block truncate"
                        title={formatMasterLabel(row.cost_center, row.cost_center_description)}
                      >
                        {formatMasterLabel(row.cost_center, row.cost_center_description)}
                      </span>
                    </AdminTableCell>
                    <AdminTableCell className="max-w-[11rem]">
                      <span
                        className="block truncate"
                        title={formatMasterLabel(
                          row.functional_location,
                          row.functional_location_description,
                        )}
                      >
                        {formatMasterLabel(row.functional_location, row.functional_location_description)}
                      </span>
                    </AdminTableCell>
                    <AdminTableCell className="max-w-[11rem]">
                      <span
                        className="block truncate"
                        title={formatMasterLabel(row.actual_location, row.actual_location_description)}
                      >
                        {formatMasterLabel(row.actual_location, row.actual_location_description)}
                      </span>
                    </AdminTableCell>
                    <AdminTableCell className="px-3 py-2 text-right tabular-nums">{row.inventory_count ?? "—"}</AdminTableCell>
                    <AdminTableCell className="px-3 py-2 text-right tabular-nums">
                      {row.physical_count ?? 0}
                    </AdminTableCell>
                    <AdminTableCell className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                      {row.last_verification_date
                        ? new Date(row.last_verification_date).toLocaleDateString()
                        : "—"}
                    </AdminTableCell>
                  </AdminTableBodyRow>
                ))
              )}
            </TableBody>
          </Table>
      </AdminDataTable>

      <Dialog open={activeConflictOpen} onOpenChange={setActiveConflictOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Active order conflicts</DialogTitle>
            <DialogDescription>
              Following assets already belong to active orders. You can continue with eligible assets only.
            </DialogDescription>
          </DialogHeader>
          <div className="dialog-body max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pr-2">Asset</th>
                  <th className="py-1 pr-2">Order</th>
                  <th className="py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {validationResult?.active_order_conflicts.map((c) => (
                  <tr key={c.asset_id} className="border-b border-border/40">
                    <td className="py-1.5 pr-2">
                      <span className="font-mono text-xs">{c.asset_code}</span>
                      <span className="block text-muted-foreground">{c.asset_name}</span>
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-xs">{c.order_number}</td>
                    <td className="py-1.5">{orderStatusLabel(c.order_status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button type="button" variant="outline" onClick={() => setActiveConflictOpen(false)}>
              Cancel
            </Button>
            <AdminPrimaryButton type="button" onClick={() => proceedWithEligibleOnly()}>
              Continue with eligible
            </AdminPrimaryButton>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={missingRfidOpen} onOpenChange={setMissingRfidOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>RFID not attached</DialogTitle>
            <DialogDescription>
              Physical verification orders can only include assets that have an RFID code attached.
              Attach RFID on the asset detail page, or continue with RFID-tagged assets only.
            </DialogDescription>
          </DialogHeader>
          <ul className="dialog-body max-h-64 list-disc space-y-1 overflow-auto pl-5 text-sm">
            {validationResult?.missing_rfid.map((a) => (
              <li key={a.asset_id}>
                {a.asset_code} — {a.asset_name}
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button type="button" variant="outline" onClick={() => setMissingRfidOpen(false)}>
              Cancel
            </Button>
            <AdminPrimaryButton type="button" onClick={() => proceedWithEligibleOnly()}>
              Continue with RFID-tagged only
            </AdminPrimaryButton>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={plantMismatchOpen} onOpenChange={setPlantMismatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Plant mismatch</DialogTitle>
            <DialogDescription>
              Physical orders can only be created for assets belonging to the same plant.
            </DialogDescription>
          </DialogHeader>
          <ul className="dialog-body list-disc space-y-1 pl-5 text-sm">
            {validationResult?.plant_mismatch.map((a) => (
              <li key={a.asset_id}>
                {a.asset_code} — {a.asset_name}
                {a.plant_name ? ` (${a.plant_name})` : ""}
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => setPlantMismatchOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={ccMismatchOpen} onOpenChange={setCcMismatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cost center mismatch</DialogTitle>
            <DialogDescription>
              Physical orders can only be created for assets belonging to the same cost center.
            </DialogDescription>
          </DialogHeader>
          <ul className="dialog-body list-disc space-y-1 pl-5 text-sm">
            {validationResult?.cost_center_mismatch.map((a) => (
              <li key={a.asset_id}>
                {a.asset_code} — {a.asset_name}
                {a.cost_center_code ? ` (${a.cost_center_code})` : ""}
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => setCcMismatchOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={fyVerifiedOpen} onOpenChange={setFyVerifiedOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Already verified this financial year</DialogTitle>
            <DialogDescription>
              {validationResult?.financial_year_label ? (
                <>
                  The following assets were already physically verified in{" "}
                  <span className="font-medium text-foreground">{validationResult.financial_year_label}</span>
                  {validationResult.financial_year_start && validationResult.financial_year_end ? (
                    <>
                      {" "}
                      ({new Date(validationResult.financial_year_start).toLocaleDateString()} –{" "}
                      {new Date(validationResult.financial_year_end).toLocaleDateString()})
                    </>
                  ) : null}
                  . Do you want to run physical verification again? Choosing yes clears physical count and
                  verification date when the order is approved.
                </>
              ) : (
                "Some selected assets were already verified in the current financial year."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="dialog-body max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pr-2">Asset</th>
                  <th className="py-1">Last verified</th>
                </tr>
              </thead>
              <tbody>
                {validationResult?.already_verified_in_fy
                  .filter((a) => validationResult.eligible_asset_ids.includes(a.asset_id))
                  .map((a) => (
                    <tr key={a.asset_id} className="border-b border-border/40">
                      <td className="py-1.5 pr-2">
                        <span className="font-mono text-xs">{a.asset_code}</span>
                        <span className="block text-muted-foreground">{a.asset_name}</span>
                      </td>
                      <td className="py-1.5 text-xs tabular-nums text-muted-foreground">
                        {a.last_verification_date
                          ? new Date(a.last_verification_date).toLocaleDateString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button type="button" variant="outline" onClick={() => setFyVerifiedOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => proceedWithEligibleOnly([])}
            >
              No, keep verification
            </Button>
            <AdminPrimaryButton type="button" onClick={() => proceedWithEligibleOnly(fyVerifiedEligibleIds())}>
              Yes, verify again
            </AdminPrimaryButton>
          </div>
        </DialogContent>
      </Dialog>

      <AssetRfidDialog
        open={rfidDialogOpen}
        onOpenChange={setRfidDialogOpen}
        value={rfidValue}
        onChange={(v) => {
          setRfidValue(v)
          if (!v.trim()) setRfidTagColorId("")
        }}
        onSave={() => void saveAttachedRfid()}
        saving={rfidSaving}
        assetCode={rfidDialogMode === "by-code" ? rfidAssetCode : undefined}
        onAssetCodeChange={rfidDialogMode === "by-code" ? setRfidAssetCode : undefined}
        tagColorId={rfidTagColorId}
        onTagColorChange={setRfidTagColorId}
        tagColors={masters.tagColors}
      />

      <CreatePhysicalOrderDialog
        open={createOrderOpen}
        onOpenChange={setCreateOrderOpen}
        assetIds={eligibleForOrder}
        resetVerificationAssetIds={resetVerificationAssetIds}
        onCreated={(order) => {
          setSelected(new Set())
          navigate(`/dashboard/orders/${order.id}`)
        }}
      />
    </AdminPage>
  )
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Badge variant="outline" className="gap-1 rounded-md py-0.5 pr-1 pl-2 text-xs font-normal">
      {label}
      <button
        type="button"
        className="rounded p-0.5 hover:bg-muted"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </Badge>
  )
}
