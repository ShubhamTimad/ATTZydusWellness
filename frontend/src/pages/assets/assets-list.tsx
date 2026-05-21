import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { Plus, Search, SlidersHorizontal, Upload, X } from "lucide-react"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminPanel,
  AdminPrimaryButton,
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
import { ApiError, getJson, postJson } from "@/lib/api"
import type { AssetCategory, AssetDetail, AssetListResponse } from "@/lib/assets-types"
import { canListOrgUnitsForAssignments } from "@/lib/permissions"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type PlantOption = { id: number; name: string; code: string }

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
  const [categories, setCategories] = React.useState<AssetCategory[]>([])
  const [plants, setPlants] = React.useState<PlantOption[]>([])
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [filters, setFilters] = React.useState<AssetListFilters>(DEFAULT_FILTERS)
  const [draftFilters, setDraftFilters] = React.useState<AssetListFilters>(DEFAULT_FILTERS)
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [createOpen, setCreateOpen] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [loading, setLoading] = React.useState(false)

  const [form, setForm] = React.useState({
    asset_name: "",
    asset_code: "",
    rfid_code: "",
    serial_no: "",
    asset_category_id: "",
    plant_id: "",
    functional_location: "",
    actual_location: "",
    cost_center: "",
  })

  const canCreate = hasPermission("asset.create")
  const canImport = hasPermission("asset.import")
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

  React.useEffect(() => {
    void getJson<AssetCategory[]>("/admin/assets/categories")
      .then(setCategories)
      .catch(() => setCategories([]))
    if (canListOrgUnitsForAssignments()) {
      void getJson<PlantOption[]>("/admin/org-units?type=PLANT")
        .then(setPlants)
        .catch(() => setPlants([]))
    }
  }, [])

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

  async function createAsset() {
    if (!form.asset_name.trim() || !form.asset_code.trim()) {
      toast.error("Asset name and code are required.")
      return
    }
    setCreating(true)
    try {
      const created = await postJson<AssetDetail>("/admin/assets", {
        asset_name: form.asset_name.trim(),
        asset_code: form.asset_code.trim(),
        rfid_code: form.rfid_code.trim() || null,
        serial_no: form.serial_no.trim() || null,
        asset_category_id: form.asset_category_id ? Number(form.asset_category_id) : null,
        location: {
          plant_id: form.plant_id ? Number(form.plant_id) : null,
          functional_location: form.functional_location.trim() || null,
          actual_location: form.actual_location.trim() || null,
        },
        financial: { cost_center: form.cost_center.trim() || null },
      })
      toast.success("Asset created.")
      setCreateOpen(false)
      navigate(String(created.id))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Create failed.")
    } finally {
      setCreating(false)
    }
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageSize = data?.page_size ?? 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const actionButtons = (
    <>
      {canImport ? (
        <Button variant="outline" size="sm" className="h-9 shrink-0 px-3" asChild>
          <Link to="/dashboard/assets/import">
            <Upload className="size-4" aria-hidden />
            Import
          </Link>
        </Button>
      ) : null}
      {canCreate ? (
        <AdminPrimaryButton type="button" className="h-9 shrink-0 px-3" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden />
          Create asset
        </AdminPrimaryButton>
      ) : null}
    </>
  )

  return (
    <AdminPage fullWidth dense className="flex h-[calc(100vh-4rem)] min-h-0 flex-col gap-2">
      <div className="flex shrink-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
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
              className="h-9 w-full pl-9 text-sm shadow-sm"
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
            className={cn(
              "h-9 shrink-0 gap-1.5 px-3 shadow-sm",
              filtersOpen && "border-primary/40 bg-primary/5",
            )}
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

          {actionButtons}

          {selected.size > 0 ? (
            <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          ) : null}
        </div>

        {filtersOpen ? (
          <div className="rounded-lg border border-border/70 bg-muted/10 p-3 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Plant</Label>
                <select
                  className={cn(adminSelectClass, "h-9 text-sm")}
                  value={draftFilters.plant_id}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, plant_id: e.target.value }))}
                >
                  <option value="">All plants</option>
                  {plants.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Category</Label>
                <select
                  className={cn(adminSelectClass, "h-9 text-sm")}
                  value={draftFilters.category_id}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, category_id: e.target.value }))}
                >
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Lifecycle</Label>
                <select
                  className={cn(adminSelectClass, "h-9 text-sm")}
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
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Approval</Label>
                <select
                  className={cn(adminSelectClass, "h-9 text-sm")}
                  value={draftFilters.approval_status}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, approval_status: e.target.value }))}
                >
                  <option value="">All</option>
                  <option value="approved">Approved</option>
                  <option value="pending">Pending</option>
                  <option value="rejected">Rejected</option>
                  <option value="not_required">Not required</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Sort by</Label>
                <select
                  className={cn(adminSelectClass, "h-9 text-sm")}
                  value={draftFilters.sort_by}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, sort_by: e.target.value }))}
                >
                  <option value="created_at">Created date</option>
                  <option value="asset_name">Asset name</option>
                  <option value="asset_code">Asset code</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Order</Label>
                <select
                  className={cn(adminSelectClass, "h-9 text-sm")}
                  value={draftFilters.sort_dir}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, sort_dir: e.target.value }))}
                >
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border/50 pt-3">
              <Button type="button" variant="ghost" size="sm" className="h-8" onClick={clearFilters}>
                Clear all
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => {
                  setDraftFilters(filters)
                  setFiltersOpen(false)
                }}
              >
                Cancel
              </Button>
              <AdminPrimaryButton type="button" className="h-8" onClick={applyFilters}>
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
                label={`Plant: ${plants.find((p) => String(p.id) === filters.plant_id)?.name ?? filters.plant_id}`}
                onRemove={() => {
                  setFilters((f) => ({ ...f, plant_id: "" }))
                  setPage(1)
                }}
              />
            ) : null}
            {filters.category_id ? (
              <FilterChip
                label={`Category: ${categories.find((c) => String(c.id) === filters.category_id)?.name ?? filters.category_id}`}
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

      <AdminPanel className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg">
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-[1] bg-card shadow-sm">
              <AdminTableHeaderRow>
                <AdminTableHeadCell className="h-9 w-9 px-2">
                  <Checkbox
                    checked={items.length > 0 && selected.size === items.length}
                    onCheckedChange={(v) => toggleAll(Boolean(v))}
                    aria-label="Select all"
                  />
                </AdminTableHeadCell>
                <AdminTableHeadCell className="h-9 px-3">Asset name</AdminTableHeadCell>
                <AdminTableHeadCell className="h-9 px-3">Category</AdminTableHeadCell>
                <AdminTableHeadCell className="h-9 px-3">Plant</AdminTableHeadCell>
                <AdminTableHeadCell className="h-9 px-3">Functional loc.</AdminTableHeadCell>
                <AdminTableHeadCell className="h-9 px-3">Actual loc.</AdminTableHeadCell>
                <AdminTableHeadCell className="h-9 px-3">Cost center</AdminTableHeadCell>
                <AdminTableHeadCell className="h-9 px-3 text-right">Inv.</AdminTableHeadCell>
                <AdminTableHeadCell className="h-9 px-3 text-right">Phys.</AdminTableHeadCell>
                <AdminTableHeadCell className="h-9 px-3">Verified</AdminTableHeadCell>
              </AdminTableHeaderRow>
            </TableHeader>
            <TableBody>
              {loading && items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    Loading assets…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No assets match your search or filters.
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-border/40 hover:bg-muted/25"
                    onClick={() => navigate(String(row.id))}
                  >
                    <AdminTableCell className="px-2 py-2">
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
                    <AdminTableCell className="px-3 py-2">
                      <span className="font-medium text-foreground">{row.asset_name}</span>
                      <div className="font-mono text-[11px] text-muted-foreground">{row.asset_code}</div>
                    </AdminTableCell>
                    <AdminTableCell className="px-3 py-2 text-muted-foreground">{row.category_name ?? "—"}</AdminTableCell>
                    <AdminTableCell className="px-3 py-2">{row.plant_name ?? "—"}</AdminTableCell>
                    <AdminTableCell className="max-w-[12rem] truncate px-3 py-2">{row.functional_location ?? "—"}</AdminTableCell>
                    <AdminTableCell className="max-w-[12rem] truncate px-3 py-2">{row.actual_location ?? "—"}</AdminTableCell>
                    <AdminTableCell className="px-3 py-2">{row.cost_center ?? "—"}</AdminTableCell>
                    <AdminTableCell className="px-3 py-2 text-right tabular-nums">{row.inventory_count ?? "—"}</AdminTableCell>
                    <AdminTableCell className="px-3 py-2 text-right tabular-nums">{row.physical_count ?? "—"}</AdminTableCell>
                    <AdminTableCell className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                      {row.last_verification_date ?? "—"}
                    </AdminTableCell>
                  </tr>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex shrink-0 items-center justify-between border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
          <span>
            {loading ? "Loading…" : `${total} assets · page ${page} of ${totalPages}`}
          </span>
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </AdminPanel>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create asset</DialogTitle>
            <DialogDescription>Manual creation. Approval workflow applies when configured.</DialogDescription>
          </DialogHeader>
          <div className="dialog-body grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Asset name *</Label>
              <Input value={form.asset_name} onChange={(e) => setForm((f) => ({ ...f, asset_name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Asset code *</Label>
              <Input value={form.asset_code} onChange={(e) => setForm((f) => ({ ...f, asset_code: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>RFID</Label>
              <Input value={form.rfid_code} onChange={(e) => setForm((f) => ({ ...f, rfid_code: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <select
                className={adminSelectClass}
                value={form.asset_category_id}
                onChange={(e) => setForm((f) => ({ ...f, asset_category_id: e.target.value }))}
              >
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Plant</Label>
              <select
                className={adminSelectClass}
                value={form.plant_id}
                onChange={(e) => setForm((f) => ({ ...f, plant_id: e.target.value }))}
              >
                <option value="">—</option>
                {plants.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 border-t border-border/60 pt-3 sm:col-span-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <AdminPrimaryButton type="button" disabled={creating} onClick={() => void createAsset()}>
                {creating ? "Creating…" : "Create"}
              </AdminPrimaryButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
