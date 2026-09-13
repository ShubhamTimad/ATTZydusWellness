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
import type { PlantOption } from "@/lib/masters-types"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"
import { cn } from "@/lib/utils"

type Row = {
  id: number
  code: string
  description: string
  name?: string
  color_hex?: string | null
  is_active: boolean
  plant_name?: string | null
  location_type?: string
}

type MasterCrudPanelProps = {
  title: string
  listUrl: string
  kind: "simple" | "category" | "location" | "tag-color" | "code-name"
  plants?: PlantOption[]
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

export function MasterCrudPanel({
  title,
  listUrl,
  kind,
  plants = [],
}: MasterCrudPanelProps) {
  const [rows, setRows] = React.useState<Row[]>([])
  const [createOpen, setCreateOpen] = React.useState(false)
  const [editRow, setEditRow] = React.useState<Row | null>(null)
  const [code, setCode] = React.useState("")
  const [desc, setDesc] = React.useState("")
  const [name, setName] = React.useState("")
  const [colorHex, setColorHex] = React.useState("")
  const [plantId, setPlantId] = React.useState("")
  const [locationType, setLocationType] = React.useState("both")
  const [saving, setSaving] = React.useState(false)

  const canCreate = hasPermission("masters.create")
  const canUpdate = hasPermission("masters.update")
  const canDelete = hasPermission("masters.delete")
  const canDeactivate = hasPermission("masters.deactivate") || canUpdate
  const canReactivate = hasPermission("masters.reactivate") || canUpdate
  const showActions = canUpdate || canDelete || canDeactivate || canReactivate
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()

  const listBase = listUrl.replace(/\?.*$/, "").replace(/\/$/, "")
  const [page, setPage] = useUrlPage(`page_${listBase.split("/").pop() ?? "master"}`)
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const [codeFilter, setCodeFilter] = React.useState("")
  const [nameFilter, setNameFilter] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<"" | "active" | "inactive">("")

  async function load() {
    const data = await getJson<Row[]>(`${listBase}?active_only=false`)
    setRows(
      data.map((r: Record<string, unknown>) => ({
        id: Number(r.id),
        code: String(r.code),
        name: r.name != null ? String(r.name) : undefined,
        description: String(r.description ?? r.name ?? ""),
        color_hex: r.color_hex != null ? String(r.color_hex) : null,
        is_active: Boolean(r.is_active),
        plant_name: r.plant_name != null ? String(r.plant_name) : null,
        location_type: r.location_type != null ? String(r.location_type) : undefined,
      })),
    )
  }

  React.useEffect(() => {
    void load().catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load"))
  }, [listBase])

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
  }, [codeFilter, nameFilter, statusFilter, setPage])

  function openCreate() {
    setCode("")
    setDesc("")
    setName("")
    setColorHex("")
    setPlantId("")
    setLocationType("both")
    setCreateOpen(true)
  }

  function openEdit(row: Row) {
    setEditRow(row)
    setCode(row.code)
    if (kind === "category") {
      setName(row.name ?? "")
      setDesc(row.description)
    } else if (kind === "tag-color" || kind === "code-name") {
      setName(row.name ?? row.description)
      setColorHex(row.color_hex ?? "")
      setDesc("")
    } else {
      setDesc(row.description)
      setName("")
    }
    setPlantId("")
    setLocationType(row.location_type ?? "both")
  }

  function buildPayload() {
    if (kind === "category") {
      return { code: code.trim(), name: name.trim(), description: desc.trim() || null }
    }
    if (kind === "tag-color") {
      return {
        code: code.trim(),
        name: name.trim(),
        color_hex: colorHex.trim() || null,
      }
    }
    if (kind === "code-name") {
      return { code: code.trim(), name: name.trim() }
    }
    if (kind === "location") {
      return {
        code: code.trim(),
        description: desc.trim(),
        plant_id: plantId ? Number(plantId) : null,
        location_type: locationType,
      }
    }
    return { code: code.trim(), description: desc.trim() }
  }

  function validateForm(): string | null {
    if (!code.trim()) return "Code is required."
    if (kind === "category" || kind === "tag-color" || kind === "code-name") {
      if (!name.trim()) return "Name is required."
    } else if (!desc.trim()) {
      return "Description is required."
    }
    if (kind === "location" && !plantId) return "Select a plant."
    return null
  }

  async function saveCreate() {
    const err = validateForm()
    if (err) {
      toast.error(err)
      return
    }
    setSaving(true)
    try {
      await postJson(listBase, buildPayload())
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
    const err = validateForm()
    if (err) {
      toast.error(err)
      return
    }
    setSaving(true)
    const patchUrl = `${listBase}/${editRow.id}`
    try {
      await patchJson(patchUrl, buildPayload())
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
    const label =
      kind === "category" || kind === "tag-color" || kind === "code-name"
        ? row.name ?? row.code
        : row.code
    const ok = await confirmAsk({
      title: isActive ? `Reactivate ${title.toLowerCase()}?` : `Deactivate ${title.toLowerCase()}?`,
      description: isActive
        ? `Reactivate "${label}" so it can be selected again.`
        : `Deactivate "${label}"? It will stay in the list but cannot be selected for new assets.`,
      confirmLabel: isActive ? "Reactivate" : "Deactivate",
      destructive: !isActive,
    })
    if (!ok) return
    try {
      await postJson(`${listBase}/${row.id}/set-active`, { is_active: isActive })
      toast.success(isActive ? "Reactivated." : "Deactivated.")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Update failed")
    }
  }

  async function deleteRow(row: Row) {
    const label = kind === "category" || kind === "tag-color" || kind === "code-name" ? row.name ?? row.code : row.code
    const ok = await confirmAsk({
      title: `Delete ${title.toLowerCase()}?`,
      description: `Delete "${label}"? Allowed only when no assets use this ${title.toLowerCase()}.`,
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteJson(`${listBase}/${row.id}`)
      toast.success("Deleted.")
      if (editRow?.id === row.id) setEditRow(null)
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Delete failed")
    }
  }

  const addButton = canCreate ? (
    <AdminPrimaryButton type="button" onClick={openCreate}>
      <Plus className="size-3.5" />
      Add
    </AdminPrimaryButton>
  ) : null

  const nameColumnLabel =
    kind === "category" || kind === "tag-color" || kind === "code-name" ? "Name" : "Description"

  const filteredRows = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const codeQ = codeFilter.trim().toLowerCase()
    const nameQ = nameFilter.trim().toLowerCase()
    return rows.filter((row) => {
      if (q) {
        const statusWord = row.is_active ? "active" : "inactive"
        const blob = [
          row.code,
          row.name,
          row.description,
          row.color_hex,
          row.plant_name,
          row.location_type,
          statusWord,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!blob.includes(q)) return false
      }
      if (codeQ && !row.code.toLowerCase().includes(codeQ)) return false
      const label = (row.name ?? row.description).toLowerCase()
      if (nameQ && !label.includes(nameQ)) return false
      if (statusFilter === "active" && !row.is_active) return false
      if (statusFilter === "inactive" && row.is_active) return false
      return true
    })
  }, [rows, search, codeFilter, nameFilter, statusFilter])

  const activeFilterCount =
    (codeFilter.trim() ? 1 : 0) + (nameFilter.trim() ? 1 : 0) + (statusFilter ? 1 : 0)
  const hasQuery = Boolean(search.trim() || activeFilterCount)

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / LIST_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filteredRows.slice((safePage - 1) * LIST_PAGE_SIZE, safePage * LIST_PAGE_SIZE)

  function clearFilters() {
    setSearchInput("")
    setSearch("")
    setCodeFilter("")
    setNameFilter("")
    setStatusFilter("")
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
          placeholder="Search by code or name"
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
              <MasterHeaderLabel>{nameColumnLabel}</MasterHeaderLabel>
            </AdminTableHeadCell>

            {kind === "tag-color" ? (
              <AdminTableHeadCell>
                <MasterHeaderLabel>Color</MasterHeaderLabel>
              </AdminTableHeadCell>
            ) : null}

            {kind === "location" ? (
              <AdminTableHeadCell>
                <MasterHeaderLabel>Plant</MasterHeaderLabel>
              </AdminTableHeadCell>
            ) : null}

            {kind === "location" ? (
              <AdminTableHeadCell>
                <MasterHeaderLabel>Type</MasterHeaderLabel>
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
                  aria-label={`Filter ${nameColumnLabel}`}
                  placeholder={nameColumnLabel}
                  className={columnFilterControlClass}
                />
              </AdminTableHeadCell>
              {kind === "tag-color" ? <AdminTableHeadCell className="px-2 py-1.5">{null}</AdminTableHeadCell> : null}
              {kind === "location" ? <AdminTableHeadCell className="px-2 py-1.5">{null}</AdminTableHeadCell> : null}
              {kind === "location" ? <AdminTableHeadCell className="px-2 py-1.5">{null}</AdminTableHeadCell> : null}
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
              {showActions ? <AdminTableHeadCell className="px-2 py-1.5">{null}</AdminTableHeadCell> : null}
            </AdminTableHeaderRow>
          ) : null}
        </TableHeader>
        <TableBody>
          {filteredRows.length === 0 ? (
            <AdminTableEmptyRow
              colSpan={
                (kind === "tag-color" ? 4 : kind === "location" ? 5 : kind === "code-name" ? 3 : 3) + (showActions ? 1 : 0)
              }
            >
              {hasQuery ? "No records match your search or filters." : "No records yet."}
            </AdminTableEmptyRow>
          ) : (
            pageRows.map((row) => (
              <AdminTableBodyRow key={row.id} interactive={false}>
                <AdminTableCell className="font-mono text-xs">{row.code}</AdminTableCell>
                <AdminTableCell>
                  {kind === "category" || kind === "tag-color" || kind === "code-name"
                    ? row.name ?? row.description
                    : row.description}
                </AdminTableCell>
                {kind === "tag-color" ? (
                  <AdminTableCell>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block size-4 rounded-full border border-border/60"
                        style={{ backgroundColor: row.color_hex ?? "#94a3b8" }}
                        aria-hidden
                      />
                      <span className="font-mono text-xs text-muted-foreground">
                        {row.color_hex ?? "—"}
                      </span>
                    </span>
                  </AdminTableCell>
                ) : null}
                {kind === "location" ? <AdminTableCell>{row.plant_name ?? "—"}</AdminTableCell> : null}
                {kind === "location" ? (
                  <AdminTableCell className="capitalize">{row.location_type ?? "—"}</AdminTableCell>
                ) : null}
                <AdminTableCell>{row.is_active ? "Active" : "Inactive"}</AdminTableCell>
                {showActions ? (
                  <AdminTableCell>
                    <div className="flex items-center gap-0.5">
                      {canUpdate ? (
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => openEdit(row)}>
                          <Pencil className="size-3.5" />
                          <span className="sr-only">Edit</span>
                        </Button>
                      ) : null}
                      {row.is_active && canDeactivate ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
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
                          size="icon-sm"
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
                          size="icon-sm"
                          className="text-destructive hover:text-destructive"
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add {title}</DialogTitle>
            <DialogDescription>Code must be unique.</DialogDescription>
          </DialogHeader>
          <MasterForm
            kind={kind}
            code={code}
            setCode={setCode}
            desc={desc}
            setDesc={setDesc}
            name={name}
            setName={setName}
            colorHex={colorHex}
            setColorHex={setColorHex}
            plantId={plantId}
            setPlantId={setPlantId}
            locationType={locationType}
            setLocationType={setLocationType}
            plants={plants}
          />
          <div className="dialog-footer-actions">
            <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <AdminPrimaryButton type="button" disabled={saving} onClick={() => void saveCreate()}>
              {saving ? "Saving…" : "Create"}
            </AdminPrimaryButton>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editRow != null} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {title}</DialogTitle>
          </DialogHeader>
          <MasterForm
            kind={kind}
            code={code}
            setCode={setCode}
            desc={desc}
            setDesc={setDesc}
            name={name}
            setName={setName}
            colorHex={colorHex}
            setColorHex={setColorHex}
            plantId={plantId}
            setPlantId={setPlantId}
            locationType={locationType}
            setLocationType={setLocationType}
            plants={plants}
          />
          <div className="dialog-footer-actions">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditRow(null)}>
              Cancel
            </Button>
            <AdminPrimaryButton type="button" disabled={saving} onClick={() => void saveEdit()}>
              {saving ? "Saving…" : "Save"}
            </AdminPrimaryButton>
          </div>
        </DialogContent>
      </Dialog>
    </AdminDataTable>
    {confirmDialog}
    </div>
  )
}

function MasterForm({
  kind,
  code,
  setCode,
  desc,
  setDesc,
  name,
  setName,
  colorHex,
  setColorHex,
  plantId,
  setPlantId,
  locationType,
  setLocationType,
  plants,
}: {
  kind: MasterCrudPanelProps["kind"]
  code: string
  setCode: (v: string) => void
  desc: string
  setDesc: (v: string) => void
  name: string
  setName: (v: string) => void
  colorHex: string
  setColorHex: (v: string) => void
  plantId: string
  setPlantId: (v: string) => void
  locationType: string
  setLocationType: (v: string) => void
  plants: PlantOption[]
}) {
  return (
    <div className="dialog-body app-form-stack">
      <div className="app-form-field">
        <Label className="app-form-label">Code *</Label>
        <Input className="font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      {kind === "category" ? (
        <>
          <div className="app-form-field">
            <Label className="app-form-label">Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="app-form-field">
            <Label className="app-form-label">Description</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
        </>
      ) : kind === "tag-color" ? (
        <>
          <div className="app-form-field">
            <Label className="app-form-label">Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="app-form-field">
            <Label className="app-form-label">Color hex</Label>
            <Input
              value={colorHex}
              onChange={(e) => setColorHex(e.target.value)}
              placeholder="#E1242A"
              className="font-mono"
            />
          </div>
        </>
      ) : kind === "code-name" ? (
        <div className="app-form-field">
          <Label className="app-form-label">Name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      ) : (
        <div className="app-form-field">
          <Label className="app-form-label">Description *</Label>
          <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
      )}
      {kind === "location" ? (
        <>
          <div className="app-form-field">
            <Label className="app-form-label">Plant *</Label>
            <select
              className={adminSelectClass}
              value={plantId}
              onChange={(e) => setPlantId(e.target.value)}
            >
              <option value="">Select plant…</option>
              {plants.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="app-form-field">
            <Label className="app-form-label">Location type</Label>
            <select
              className={adminSelectClass}
              value={locationType}
              onChange={(e) => setLocationType(e.target.value)}
            >
              <option value="both">Both</option>
              <option value="functional">Functional</option>
              <option value="actual">Actual</option>
            </select>
          </div>
        </>
      ) : null}
    </div>
  )
}
