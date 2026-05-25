import * as React from "react"
import { Pencil, Plus } from "lucide-react"
import { toast } from "sonner"

import {
  AdminPanel,
  AdminPrimaryButton,
  AdminTableCell,
  AdminTableEmptyRow,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
} from "@/components/layout/admin-ui"
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
import { ApiError, getJson, patchJson, postJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import type { PlantOption } from "@/lib/masters-types"

type Row = {
  id: number
  code: string
  description: string
  name?: string
  is_active: boolean
  plant_name?: string | null
  location_type?: string
}

type MasterCrudPanelProps = {
  title: string
  listUrl: string
  kind: "simple" | "category" | "location"
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
  const [plantId, setPlantId] = React.useState("")
  const [locationType, setLocationType] = React.useState("both")
  const [saving, setSaving] = React.useState(false)

  const canCreate = hasPermission("masters.create")
  const canUpdate = hasPermission("masters.update")

  async function load() {
    const data = await getJson<Row[]>(listUrl)
    setRows(
      data.map((r: Record<string, unknown>) => ({
        id: Number(r.id),
        code: String(r.code),
        name: r.name != null ? String(r.name) : undefined,
        description: String(r.description ?? ""),
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
    const patchUrl =
      kind === "category"
        ? `${base}/${editRow.id}`
        : kind === "location"
          ? `${base}/${editRow.id}`
          : `${base}/${editRow.id}`
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

  const addButton = canCreate ? (
    <AdminPrimaryButton type="button" onClick={openCreate}>
      <Plus className="size-3.5" />
      Add
    </AdminPrimaryButton>
  ) : null

  return (
    <AdminPanel title={title} headerActions={addButton}>
      <Table className="app-table-head-sticky">
        <TableHeader>
          <AdminTableHeaderRow>
            <AdminTableHeadCell>Code</AdminTableHeadCell>
            <AdminTableHeadCell>{kind === "category" ? "Name" : "Description"}</AdminTableHeadCell>
            {kind === "location" ? <AdminTableHeadCell>Plant</AdminTableHeadCell> : null}
            {kind === "location" ? <AdminTableHeadCell>Type</AdminTableHeadCell> : null}
            <AdminTableHeadCell>Status</AdminTableHeadCell>
            {canUpdate ? <AdminTableHeadCell className="w-20"> </AdminTableHeadCell> : null}
          </AdminTableHeaderRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <AdminTableEmptyRow colSpan={6}>No records yet.</AdminTableEmptyRow>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-b border-border/60 transition-colors hover:bg-muted/40">
                <AdminTableCell className="font-mono text-xs">{row.code}</AdminTableCell>
                <AdminTableCell>{kind === "category" ? row.name ?? "—" : row.description}</AdminTableCell>
                {kind === "location" ? (
                  <AdminTableCell className="text-muted-foreground">{row.plant_name ?? "All plants"}</AdminTableCell>
                ) : null}
                {kind === "location" ? (
                  <AdminTableCell className="capitalize text-xs">{row.location_type ?? "—"}</AdminTableCell>
                ) : null}
                <AdminTableCell className="text-xs">{row.is_active ? "Active" : "Inactive"}</AdminTableCell>
                {canUpdate ? (
                  <AdminTableCell>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => openEdit(row)}>
                      <Pencil className="size-3.5" />
                    </Button>
                  </AdminTableCell>
                ) : null}
              </tr>
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
    </AdminPanel>
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
      ) : (
        <div className="app-form-field">
          <Label className="app-form-label">Description *</Label>
          <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
      )}
      {kind === "location" ? (
        <>
          <div className="app-form-field">
            <Label className="app-form-label">Plant (optional)</Label>
            <select className={adminSelectClass} value={plantId} onChange={(e) => setPlantId(e.target.value)}>
              <option value="">All plants</option>
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
              <option value="both">Functional & actual</option>
              <option value="functional">Functional only</option>
              <option value="actual">Actual only</option>
            </select>
          </div>
        </>
      ) : null}
    </div>
  )
}
