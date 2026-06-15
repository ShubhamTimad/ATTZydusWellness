import * as React from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
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
import type { PlantOption } from "@/lib/masters-types"

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
  const showActions = canUpdate || canDelete

  async function load() {
    const data = await getJson<Row[]>(listUrl)
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
  }, [listUrl])

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

  async function saveCreate() {
    setSaving(true)
    try {
      await postJson(listUrl.replace(/\?.*$/, ""), buildPayload())
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
    setSaving(true)
    const base = listUrl.replace(/\?.*$/, "").replace(/\/$/, "")
    const patchUrl = `${base}/${editRow.id}`
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

  async function deleteRow(row: Row) {
    const label = kind === "category" || kind === "tag-color" || kind === "code-name" ? row.name ?? row.code : row.code
    if (
      !window.confirm(
        `Delete "${label}"? Allowed only when no assets use this ${title.toLowerCase()}.`,
      )
    ) {
      return
    }
    const base = listUrl.replace(/\?.*$/, "").replace(/\/$/, "")
    try {
      await deleteJson(`${base}/${row.id}`)
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

  return (
    <AdminDataTable title={title} headerActions={addButton}>
      <Table className="app-table-head-sticky">
        <TableHeader>
          <AdminTableHeaderRow>
            <AdminTableHeadCell>Code</AdminTableHeadCell>
            <AdminTableHeadCell>{nameColumnLabel}</AdminTableHeadCell>
            {kind === "tag-color" ? <AdminTableHeadCell>Color</AdminTableHeadCell> : null}
            {kind === "location" ? <AdminTableHeadCell>Plant</AdminTableHeadCell> : null}
            {kind === "location" ? <AdminTableHeadCell>Type</AdminTableHeadCell> : null}
            <AdminTableHeadCell>Status</AdminTableHeadCell>
            {showActions ? <AdminTableHeadCell className="w-24"> </AdminTableHeadCell> : null}
          </AdminTableHeaderRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <AdminTableEmptyRow
              colSpan={
                (kind === "tag-color" ? 4 : kind === "location" ? 5 : kind === "code-name" ? 3 : 3) + (showActions ? 1 : 0)
              }
            >
              No records yet.
            </AdminTableEmptyRow>
          ) : (
            rows.map((row) => (
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
