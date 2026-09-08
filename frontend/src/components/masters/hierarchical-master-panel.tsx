import * as React from "react"
import { ListFilter, Pencil, Plus, Power, PowerOff, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import {
  AdminPrimaryButton,
  AdminTableCell,
  AdminTableEmptyRow,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import {
  AdminDataTable,
  AdminTableBodyRow,
  AdminTablePagination,
  LIST_PAGE_SIZE,
} from "@/components/layout/list-page-ui"
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
import { ApiError, deleteJson, getJson, patchJson, postJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import { useUrlPage } from "@/lib/use-url-tab"
import type { CostCenterMaster, FunctionalLocationMaster, PlantOption } from "@/lib/masters-types"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"
import { cn } from "@/lib/utils"

type HierarchyKind = "cost-center" | "profit-center" | "functional-location" | "actual-location"

function hierarchyNameLabel(kind: HierarchyKind): string {
  const labels: Record<HierarchyKind, string> = {
    "cost-center": "Cost center name *",
    "profit-center": "Profit center name *",
    "functional-location": "Functional location name *",
    "actual-location": "Actual location name *",
  }
  return labels[kind]
}

function hierarchyNameRequiredMessage(kind: HierarchyKind): string {
  const labels: Record<HierarchyKind, string> = {
    "cost-center": "Enter a cost center name.",
    "profit-center": "Enter a profit center name.",
    "functional-location": "Enter a functional location name.",
    "actual-location": "Enter an actual location name.",
  }
  return labels[kind]
}

function hierarchyDescriptionLabel(kind: HierarchyKind): string {
  if (kind === "functional-location" || kind === "actual-location") {
    return "Location description"
  }
  return "Description"
}

type ParentOption = { id: number; label: string }

type Row = {
  id: number
  code: string
  name?: string
  description: string
  is_active: boolean
  is_scrapyard?: boolean
  parent_label?: string | null
  plant_label?: string | null
}

type HierarchicalMasterPanelProps = {
  title: string
  kind: HierarchyKind
  plants: PlantOption[]
}

const listToolbarBtnClass = "h-9 shrink-0 gap-1.5 px-3"
const columnFilterControlClass = "h-8 w-full min-w-[6rem] text-xs"

function MasterHeaderLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xm font-bold uppercase tracking-wide text-black">
      {children}
    </span>
  )
}

const ENDPOINTS: Record<HierarchyKind, string> = {
  "cost-center": "/admin/asset-masters/cost-centers",
  "profit-center": "/admin/asset-masters/profit-centers",
  "functional-location": "/admin/asset-masters/functional-locations",
  "actual-location": "/admin/asset-masters/actual-locations",
}

export function HierarchicalMasterPanel({
  title,
  kind,
  plants,
}: HierarchicalMasterPanelProps) {
  const [rows, setRows] = React.useState<Row[]>([])
  const [parentOptions, setParentOptions] = React.useState<ParentOption[]>([])
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editRow, setEditRow] = React.useState<Row | null>(null)
  const [code, setCode] = React.useState("")
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [plantId, setPlantId] = React.useState("")
  const [parentId, setParentId] = React.useState("")
  const [isScrapyard, setIsScrapyard] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const canCreate = hasPermission("masters.create")
  const canUpdate = hasPermission("masters.update")
  const canDelete = hasPermission("masters.delete")
  const canDeactivate = hasPermission("masters.deactivate") || canUpdate
  const canReactivate = hasPermission("masters.reactivate") || canUpdate
  const showActions = canUpdate || canDelete || canDeactivate || canReactivate
  const base = ENDPOINTS[kind]
  const [page, setPage] = useUrlPage(`page_${kind}`)
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const [codeFilter, setCodeFilter] = React.useState("")
  const [nameFilter, setNameFilter] = React.useState("")
  const [plantFilter, setPlantFilter] = React.useState("")
  const [parentFilter, setParentFilter] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<"" | "active" | "inactive">("")
  const [scrapyardFilter, setScrapyardFilter] = React.useState<"" | "yes" | "no">("")
  const needsPlant = kind === "cost-center" || kind === "functional-location"
  const needsParent = kind === "profit-center" || kind === "actual-location"
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()

  async function load() {
    const data = await getJson<Record<string, unknown>[]>(`${base}?active_only=false`)
    setRows(
      data.map((r) => ({
        id: Number(r.id),
        code: String(r.code),
        name: r.name != null ? String(r.name) : undefined,
        description: String(r.description ?? ""),
        is_active: Boolean(r.is_active),
        is_scrapyard: Boolean(r.is_scrapyard),
        parent_label:
          kind === "profit-center"
            ? [r.cost_center_code, r.plant_code].filter(Boolean).join(" / ") || null
            : kind === "actual-location"
              ? [r.functional_location_code, r.plant_code].filter(Boolean).join(" / ") || null
              : null,
        plant_label:
          needsPlant || kind === "profit-center" || kind === "actual-location"
            ? [r.plant_code, r.plant_name].filter(Boolean).join(" — ") || null
            : null,
      })),
    )
  }

  React.useEffect(() => {
    void load().catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load"))
  }, [base])

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch((prev) => {
        if (prev === searchInput) return prev
        setPage(1)
        return searchInput
      })
    }, 300)
    return () => window.clearTimeout(t)
  }, [searchInput, setPage])

  React.useEffect(() => {
    setPage(1)
  }, [codeFilter, nameFilter, plantFilter, parentFilter, statusFilter, scrapyardFilter, setPage])

  React.useEffect(() => {
    if (!needsParent) return
    if (!plantId && kind === "profit-center") {
      setParentOptions([])
      return
    }
    if (!plantId && kind === "actual-location") {
      setParentOptions([])
      return
    }
    const url =
      kind === "profit-center"
        ? `/admin/asset-masters/cost-centers?plant_id=${plantId}&active_only=true`
        : `/admin/asset-masters/functional-locations?plant_id=${plantId}&active_only=true`
    const fetchParents = (): Promise<CostCenterMaster[] | FunctionalLocationMaster[]> =>
      kind === "actual-location"
        ? getJson<FunctionalLocationMaster[]>(url)
        : getJson<CostCenterMaster[]>(url)
    void fetchParents()
      .then((list) =>
        setParentOptions(
          list.map((p) => ({
            id: p.id,
            label: `${p.code} — ${p.name}`,
          })),
        ),
      )
      .catch(() => setParentOptions([]))
  }, [plantId, kind, needsParent])

  function openCreate() {
    setCode("")
    setName("")
    setDescription("")
    setPlantId("")
    setParentId("")
    setIsScrapyard(false)
    setCreateOpen(true)
  }

  function openEdit(row: Row) {
    setEditRow(row)
    setCode(row.code)
    setName(row.name ?? "")
    setDescription(row.description)
    setPlantId("")
    setParentId("")
    setIsScrapyard(Boolean(row.is_scrapyard))
  }

  function buildCreatePayload() {
    const payload = {
      code: code.trim(),
      name: name.trim(),
      description: description.trim() || undefined,
    }
    if (kind === "functional-location") {
      return { ...payload, plant_id: Number(plantId), is_scrapyard: isScrapyard }
    }
    if (kind === "cost-center") {
      return { ...payload, plant_id: Number(plantId), is_scrapyard: isScrapyard }
    }
    if (kind === "profit-center") {
      return { ...payload, cost_center_id: Number(parentId) }
    }
    return { ...payload, functional_location_id: Number(parentId) }
  }

  function buildUpdatePayload() {
    const payload: Record<string, unknown> = {
      code: code.trim(),
      name: name.trim(),
      description: description.trim(),
    }
    if (kind === "cost-center" || kind === "functional-location") {
      payload.is_scrapyard = isScrapyard
    }
    return payload
  }

  async function saveCreate() {
    if (!code.trim()) {
      toast.error("Code is required.")
      return
    }
    if (!name.trim()) {
      toast.error(hierarchyNameRequiredMessage(kind))
      return
    }
    if (needsPlant && !plantId) {
      toast.error("Select a plant.")
      return
    }
    if (needsParent && !plantId) {
      toast.error("Select a plant.")
      return
    }
    if (needsParent && !parentId) {
      toast.error(kind === "profit-center" ? "Select a cost center." : "Select a functional location.")
      return
    }
    setSaving(true)
    try {
      await postJson(base, buildCreatePayload())
      toast.success("Created.")
      setCreateOpen(false)
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Create failed")
    } finally {
      setSaving(false)
    }
  }

  async function saveEdit() {
    if (!editRow) return
    if (!code.trim()) {
      toast.error("Code is required.")
      return
    }
    if (!name.trim()) {
      toast.error(hierarchyNameRequiredMessage(kind))
      return
    }
    setSaving(true)
    try {
      await patchJson(`${base}/${editRow.id}`, buildUpdatePayload())
      toast.success("Saved.")
      setEditRow(null)
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  async function setRowActive(row: Row, isActive: boolean) {
    const ok = await confirmAsk({
      title: isActive ? `Reactivate ${title.toLowerCase()}?` : `Deactivate ${title.toLowerCase()}?`,
      description: isActive
        ? `Reactivate "${row.code}" so it can be selected again.`
        : `Deactivate "${row.code}"? It will stay in the list but cannot be selected for new assets.`,
      confirmLabel: isActive ? "Reactivate" : "Deactivate",
      destructive: !isActive,
    })
    if (!ok) return
    try {
      await postJson(`${base}/${row.id}/set-active`, { is_active: isActive })
      toast.success(isActive ? "Reactivated." : "Deactivated.")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Update failed")
    }
  }

  async function deleteRow(row: Row) {
    const ok = await confirmAsk({
      title: `Delete ${title.toLowerCase()}?`,
      description: `Delete "${row.code}"? Allowed only when no assets use this ${title.toLowerCase()} and it has no child records.`,
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteJson(`${base}/${row.id}`)
      toast.success("Deleted.")
      if (editRow?.id === row.id) setEditRow(null)
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Delete failed")
    }
  }

  const parentColumn =
    kind === "profit-center" ? "Cost center" : kind === "actual-location" ? "Functional location" : null
  const descriptionColumnLabel = hierarchyDescriptionLabel(kind)
  const showScrapyardCol = kind === "cost-center" || kind === "functional-location"
  const tableColSpan =
    (parentColumn ? 6 : 5) + (showScrapyardCol ? 1 : 0) + (showActions ? 1 : 0)

  const addButton = canCreate ? (
    <AdminPrimaryButton type="button" className="h-8 gap-1.5" onClick={openCreate}>
      <Plus className="size-3.5" />
      Add
    </AdminPrimaryButton>
  ) : null

  const filteredRows = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const codeQ = codeFilter.trim().toLowerCase()
    const nameQ = nameFilter.trim().toLowerCase()
    const plantQ = plantFilter.trim().toLowerCase()
    const parentQ = parentFilter.trim().toLowerCase()
    return rows.filter((row) => {
      if (q) {
        const blob = [row.code, row.name, row.description, row.plant_label, row.parent_label]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!blob.includes(q)) return false
      }
      if (codeQ && !row.code.toLowerCase().includes(codeQ)) return false
      if (nameQ && !(row.name ?? "").toLowerCase().includes(nameQ)) return false
      if (plantQ && !(row.plant_label ?? "").toLowerCase().includes(plantQ)) return false
      if (parentQ && !(row.parent_label ?? "").toLowerCase().includes(parentQ)) return false
      if (statusFilter === "active" && !row.is_active) return false
      if (statusFilter === "inactive" && row.is_active) return false
      if (scrapyardFilter === "yes" && !row.is_scrapyard) return false
      if (scrapyardFilter === "no" && row.is_scrapyard) return false
      return true
    })
  }, [rows, search, codeFilter, nameFilter, plantFilter, parentFilter, statusFilter, scrapyardFilter])

  const activeFilterCount =
    (codeFilter.trim() ? 1 : 0) +
    (nameFilter.trim() ? 1 : 0) +
    (plantFilter.trim() ? 1 : 0) +
    (parentFilter.trim() ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (scrapyardFilter ? 1 : 0)
  const hasQuery = Boolean(search.trim() || activeFilterCount)

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / LIST_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filteredRows.slice((safePage - 1) * LIST_PAGE_SIZE, safePage * LIST_PAGE_SIZE)

  function clearFilters() {
    setSearchInput("")
    setSearch("")
    setCodeFilter("")
    setNameFilter("")
    setPlantFilter("")
    setParentFilter("")
    setStatusFilter("")
    setScrapyardFilter("")
    setPage(1)
  }

  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages, setPage])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--app-grid-gap)]">
      <div className="app-list-toolbar shrink-0">
        <div className="relative min-w-[16rem] flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by code, name, or plant"
            className="w-full pl-9"
            aria-label={`Search ${title}`}
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
          className={cn(listToolbarBtnClass, filtersOpen && "border-primary/40 bg-primary/5")}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <ListFilter className="size-4" aria-hidden />
          <span className="inline-flex items-center gap-0.5">
            Filter
            {activeFilterCount > 0 ? (
              <span className="text-xs font-medium text-red-600">({activeFilterCount})</span>
            ) : null}
          </span>
        </Button>
        {hasQuery ? (
          <Button type="button" variant="outline" size="sm" className={listToolbarBtnClass} onClick={clearFilters}>
            Clear
          </Button>
        ) : null}
      </div>
      <AdminDataTable
        title={title}
        headerActions={addButton}
        className="min-h-0 flex-1"
        footer={
          <AdminTablePagination
            page={safePage}
            totalPages={totalPages}
            total={filteredRows.length}
            pageSize={LIST_PAGE_SIZE}
            itemLabel="records"
            onPageChange={setPage}
          />
        }
      >
        <Table className="app-table-head-sticky">
          <TableHeader>
            <AdminTableHeaderRow>
              <AdminTableHeadCell>
                <MasterHeaderLabel>Code</MasterHeaderLabel>
              </AdminTableHeadCell>

              <AdminTableHeadCell>
                <MasterHeaderLabel>Name</MasterHeaderLabel>
              </AdminTableHeadCell>

              <AdminTableHeadCell>
                <MasterHeaderLabel>{descriptionColumnLabel}</MasterHeaderLabel>
              </AdminTableHeadCell>

              <AdminTableHeadCell>
                <MasterHeaderLabel>Plant</MasterHeaderLabel>
              </AdminTableHeadCell>

              {parentColumn ? (
                <AdminTableHeadCell>
                  <MasterHeaderLabel>{parentColumn}</MasterHeaderLabel>
                </AdminTableHeadCell>
              ) : null}

              {showScrapyardCol ? (
                <AdminTableHeadCell>
                  <MasterHeaderLabel>Scrapyard</MasterHeaderLabel>
                </AdminTableHeadCell>
              ) : null}

              <AdminTableHeadCell>
                <MasterHeaderLabel>Status</MasterHeaderLabel>
              </AdminTableHeadCell>

              {showActions ? (
                <AdminTableHeadCell className="w-40">
                  <span aria-hidden="true">&nbsp;</span>
                </AdminTableHeadCell>
              ) : null}
            </AdminTableHeaderRow>
            {filtersOpen ? (
              <AdminTableHeaderRow className="border-b bg-muted/20 hover:bg-muted/20">
                <AdminTableHeadCell className="px-2 py-1.5">
                  <Input
                    value={codeFilter}
                    onChange={(e) => setCodeFilter(e.target.value)}
                    aria-label="Filter code"
                    placeholder="Code"
                    className={columnFilterControlClass}
                  />
                </AdminTableHeadCell>
                <AdminTableHeadCell className="px-2 py-1.5">
                  <Input
                    value={nameFilter}
                    onChange={(e) => setNameFilter(e.target.value)}
                    aria-label="Filter name"
                    placeholder="Name"
                    className={columnFilterControlClass}
                  />
                </AdminTableHeadCell>
                <AdminTableHeadCell className="px-2 py-1.5" />
                <AdminTableHeadCell className="px-2 py-1.5">
                  <Input
                    value={plantFilter}
                    onChange={(e) => setPlantFilter(e.target.value)}
                    aria-label="Filter plant"
                    placeholder="Plant"
                    className={columnFilterControlClass}
                  />
                </AdminTableHeadCell>
                {parentColumn ? (
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <Input
                      value={parentFilter}
                      onChange={(e) => setParentFilter(e.target.value)}
                      aria-label={`Filter ${parentColumn}`}
                      placeholder={parentColumn}
                      className={columnFilterControlClass}
                    />
                  </AdminTableHeadCell>
                ) : null}
                {showScrapyardCol ? (
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <select
                      className={cn(adminSelectClass, columnFilterControlClass)}
                      value={scrapyardFilter}
                      aria-label="Filter scrapyard"
                      onChange={(e) => setScrapyardFilter(e.target.value as "" | "yes" | "no")}
                    >
                      <option value="">All</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </AdminTableHeadCell>
                ) : null}
                <AdminTableHeadCell className="px-2 py-1.5">
                  <select
                    className={cn(adminSelectClass, columnFilterControlClass)}
                    value={statusFilter}
                    aria-label="Filter status"
                    onChange={(e) => setStatusFilter(e.target.value as "" | "active" | "inactive")}
                  >
                    <option value="">All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </AdminTableHeadCell>
                {showActions ? <AdminTableHeadCell className="px-2 py-1.5" /> : null}
              </AdminTableHeaderRow>
            ) : null}
          </TableHeader>
          <TableBody>
            {filteredRows.length === 0 ? (
              <AdminTableEmptyRow colSpan={tableColSpan}>
                {hasQuery ? "No records match your search or filters." : "No records yet."}
              </AdminTableEmptyRow>
            ) : (
              pageRows.map((row) => (
                <AdminTableBodyRow key={row.id} interactive={false}>
                  <AdminTableCell className="font-mono text-xs">{row.code}</AdminTableCell>
                  <AdminTableCell>{row.name ?? "—"}</AdminTableCell>
                  <AdminTableCell className="text-xs text-muted-foreground">
                    {row.description || "—"}
                  </AdminTableCell>
                  <AdminTableCell className="text-xs text-muted-foreground">
                    {row.plant_label ?? "—"}
                  </AdminTableCell>
                  {parentColumn ? (
                    <AdminTableCell className="text-xs text-muted-foreground">
                      {row.parent_label ?? "—"}
                    </AdminTableCell>
                  ) : null}
                  {showScrapyardCol ? (
                    <AdminTableCell className="text-xs">
                      {row.is_scrapyard ? "Yes" : "—"}
                    </AdminTableCell>
                  ) : null}
                  <AdminTableCell className="text-xs">{row.is_active ? "Active" : "Inactive"}</AdminTableCell>
                  {showActions ? (
                    <AdminTableCell>
                      <div className="flex items-center gap-0.5">
                        {canUpdate ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8"
                            onClick={() => openEdit(row)}
                          >
                            <Pencil className="size-3.5" />
                            <span className="sr-only">Edit</span>
                          </Button>
                        ) : null}
                        {row.is_active && canDeactivate ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8"
                            onClick={() => void setRowActive(row, false)}
                          >
                            <PowerOff className="size-3.5" />
                            <span className="sr-only">Deactivate</span>
                          </Button>
                        ) : null}
                        {!row.is_active && canReactivate ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8"
                            onClick={() => void setRowActive(row, true)}
                          >
                            <Power className="size-3.5" />
                            <span className="sr-only">Reactivate</span>
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 text-destructive hover:text-destructive"
                            onClick={() => void deleteRow(row)}
                          >
                            <Trash2 className="size-3.5" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        ) : null}
                      </div>
                    </AdminTableCell>
                  ) : null}
                </AdminTableBodyRow>
              ))
            )}
          </TableBody>
        </Table>
      </AdminDataTable>

      <HierarchyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={`Add ${title}`}
        kind={kind}
        plants={plants}
        parentOptions={parentOptions}
        code={code}
        setCode={setCode}
        name={name}
        setName={setName}
        description={description}
        setDescription={setDescription}
        plantId={plantId}
        setPlantId={setPlantId}
        parentId={parentId}
        setParentId={setParentId}
        isScrapyard={isScrapyard}
        setIsScrapyard={setIsScrapyard}
        saving={saving}
        onSave={() => void saveCreate()}
        isCreate
      />

      <HierarchyDialog
        open={editRow != null}
        onOpenChange={(o) => !o && setEditRow(null)}
        title={`Edit ${title}`}
        kind={kind}
        plants={plants}
        parentOptions={parentOptions}
        code={code}
        setCode={setCode}
        name={name}
        setName={setName}
        description={description}
        setDescription={setDescription}
        plantId={plantId}
        setPlantId={setPlantId}
        parentId={parentId}
        setParentId={setParentId}
        isScrapyard={isScrapyard}
        setIsScrapyard={setIsScrapyard}
        saving={saving}
        onSave={() => void saveEdit()}
        isCreate={false}
        parentHint={editRow?.parent_label}
        plantHint={editRow?.plant_label}
      />
      {confirmDialog}
    </div>
  )
}

function HierarchyDialog({
  open,
  onOpenChange,
  title,
  kind,
  plants,
  parentOptions,
  code,
  setCode,
  name,
  setName,
  description,
  setDescription,
  plantId,
  setPlantId,
  parentId,
  setParentId,
  isScrapyard,
  setIsScrapyard,
  saving,
  onSave,
  isCreate,
  parentHint,
  plantHint,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  kind: HierarchyKind
  plants: PlantOption[]
  parentOptions: ParentOption[]
  code: string
  setCode: (v: string) => void
  name: string
  setName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  plantId: string
  setPlantId: (v: string) => void
  parentId: string
  setParentId: (v: string) => void
  isScrapyard: boolean
  setIsScrapyard: (v: boolean) => void
  saving: boolean
  onSave: () => void
  isCreate: boolean
  parentHint?: string | null
  plantHint?: string | null
}) {
  const needsPlant = kind === "cost-center" || kind === "functional-location"
  const needsParentOnCreate = kind === "profit-center" || kind === "actual-location"
  const parentLabel = kind === "profit-center" ? "Cost center *" : "Functional location *"
  const nameFieldLabel = hierarchyNameLabel(kind)
  const descriptionFieldLabel = hierarchyDescriptionLabel(kind)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isCreate
              ? kind === "cost-center"
                ? "Select a plant, then enter code, name, and description."
                : kind === "profit-center"
                  ? "Select plant and cost center, then enter code, name, and description."
                  : kind === "functional-location"
                    ? "Select a plant, then enter code, name, and location description."
                    : "Select plant and functional location, then enter code, name, and location description."
              : "Update code, name, and description. Code is unique within its parent."}
          </DialogDescription>
        </DialogHeader>
        <div className="dialog-body space-y-3">
          {isCreate && needsPlant ? (
            <div className="space-y-1.5">
              <Label>Plant *</Label>
              <select
                className={adminSelectClass}
                value={plantId}
                onChange={(e) => {
                  setPlantId(e.target.value)
                  setParentId("")
                }}
              >
                <option value="">Select plant…</option>
                {plants.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {isCreate && needsParentOnCreate ? (
            <>
              {(kind === "profit-center" || kind === "actual-location") && (
                <div className="space-y-1.5">
                  <Label>Plant *</Label>
                  <select
                    className={adminSelectClass}
                    value={plantId}
                    onChange={(e) => {
                      setPlantId(e.target.value)
                      setParentId("")
                    }}
                  >
                    <option value="">Select plant…</option>
                    {plants.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.code} — {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>{parentLabel}</Label>
                <select
                  className={adminSelectClass}
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  disabled={!plantId}
                >
                  <option value="">
                    {plantId ? "Select parent…" : "Select plant first…"}
                  </option>
                  {parentOptions.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : null}
          {!isCreate && (plantHint || parentHint) ? (
            <p className="text-xs text-muted-foreground">
              {plantHint ? `Plant: ${plantHint}` : null}
              {plantHint && parentHint ? " · " : null}
              {parentHint ? parentHint : null}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label>Code *</Label>
            <Input className="h-9 font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{nameFieldLabel}</Label>
            <Input className="h-9" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{descriptionFieldLabel}</Label>
            <Input
              className="h-9"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={kind === "functional-location" || kind === "actual-location" ? "Optional details about this location" : "Optional details"}
            />
          </div>
          {kind === "cost-center" || kind === "functional-location" ? (
            <label className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
              <Checkbox
                checked={isScrapyard}
                onCheckedChange={(v) => setIsScrapyard(v === true)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Scrapyard</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {kind === "cost-center"
                    ? "Available as disposal destination cost center for this plant."
                    : "Available as Actual Location 1 when receiving a disposal into the scrapyard."}
                </span>
              </span>
            </label>
          ) : null}
        </div>
        <div className="dialog-footer-actions">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <AdminPrimaryButton type="button" disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : isCreate ? "Create" : "Save"}
          </AdminPrimaryButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}
