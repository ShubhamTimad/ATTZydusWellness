import * as React from "react"
import { Pencil, Plus } from "lucide-react"
import { toast } from "sonner"

import {
  AdminPanel,
  AdminPrimaryButton,
  AdminTableCell,
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
import type { PlantChildMaster, PlantOption } from "@/lib/masters-types"

type HierarchyKind = "cost-center" | "profit-center" | "functional-location" | "actual-location"

type ParentOption = { id: number; label: string }

type Row = {
  id: number
  code: string
  description: string
  is_active: boolean
  parent_label?: string | null
  plant_label?: string | null
}

type HierarchicalMasterPanelProps = {
  title: string
  kind: HierarchyKind
  plants: PlantOption[]
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
  const [desc, setDesc] = React.useState("")
  const [plantId, setPlantId] = React.useState("")
  const [parentId, setParentId] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const canCreate = hasPermission("masters.create")
  const canUpdate = hasPermission("masters.update")
  const base = ENDPOINTS[kind]
  const needsPlant = kind === "cost-center" || kind === "functional-location"
  const needsParent = kind === "profit-center" || kind === "actual-location"

  async function load() {
    const data = await getJson<Record<string, unknown>[]>(`${base}?active_only=false`)
    setRows(
      data.map((r) => ({
        id: Number(r.id),
        code: String(r.code),
        description: String(r.description ?? ""),
        is_active: Boolean(r.is_active),
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
    void getJson<PlantChildMaster[]>(url)
      .then((list) =>
        setParentOptions(
          list.map((p) => ({
            id: p.id,
            label: `${p.code} — ${p.description}`,
          })),
        ),
      )
      .catch(() => setParentOptions([]))
  }, [plantId, kind, needsParent])

  function openCreate() {
    setCode("")
    setDesc("")
    setPlantId("")
    setParentId("")
    setCreateOpen(true)
  }

  function openEdit(row: Row) {
    setEditRow(row)
    setCode(row.code)
    setDesc(row.description)
    setPlantId("")
    setParentId("")
  }

  function buildCreatePayload() {
    if (kind === "cost-center" || kind === "functional-location") {
      return { code: code.trim(), description: desc.trim(), plant_id: Number(plantId) }
    }
    if (kind === "profit-center") {
      return { code: code.trim(), description: desc.trim(), cost_center_id: Number(parentId) }
    }
    return { code: code.trim(), description: desc.trim(), functional_location_id: Number(parentId) }
  }

  function buildUpdatePayload() {
    return { code: code.trim(), description: desc.trim() }
  }

  async function saveCreate() {
    if (needsPlant && !plantId) {
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

  const parentColumn =
    kind === "profit-center" ? "Cost center" : kind === "actual-location" ? "Functional location" : null

  const addButton = canCreate ? (
    <AdminPrimaryButton type="button" className="h-8 gap-1.5" onClick={openCreate}>
      <Plus className="size-3.5" />
      Add
    </AdminPrimaryButton>
  ) : null

  return (
    <AdminPanel title={title} headerActions={addButton}>
      <Table>
        <TableHeader>
          <AdminTableHeaderRow>
            <AdminTableHeadCell>Code</AdminTableHeadCell>
            <AdminTableHeadCell>Description</AdminTableHeadCell>
            <AdminTableHeadCell>Plant</AdminTableHeadCell>
            {parentColumn ? <AdminTableHeadCell>{parentColumn}</AdminTableHeadCell> : null}
            <AdminTableHeadCell>Status</AdminTableHeadCell>
            {canUpdate ? <AdminTableHeadCell className="w-20"> </AdminTableHeadCell> : null}
          </AdminTableHeaderRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                No records yet.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-b border-border/40">
                <AdminTableCell className="font-mono text-xs">{row.code}</AdminTableCell>
                <AdminTableCell>{row.description}</AdminTableCell>
                <AdminTableCell className="text-muted-foreground text-xs">
                  {row.plant_label ?? "—"}
                </AdminTableCell>
                {parentColumn ? (
                  <AdminTableCell className="text-muted-foreground text-xs">
                    {row.parent_label ?? "—"}
                  </AdminTableCell>
                ) : null}
                <AdminTableCell className="text-xs">{row.is_active ? "Active" : "Inactive"}</AdminTableCell>
                {canUpdate ? (
                  <AdminTableCell>
                    <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => openEdit(row)}>
                      <Pencil className="size-3.5" />
                    </Button>
                  </AdminTableCell>
                ) : null}
              </tr>
            ))
          )}
        </TableBody>
      </Table>

      <HierarchyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={`Add ${title}`}
        kind={kind}
        plants={plants}
        parentOptions={parentOptions}
        code={code}
        setCode={setCode}
        desc={desc}
        setDesc={setDesc}
        plantId={plantId}
        setPlantId={setPlantId}
        parentId={parentId}
        setParentId={setParentId}
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
        desc={desc}
        setDesc={setDesc}
        plantId={plantId}
        setPlantId={setPlantId}
        parentId={parentId}
        setParentId={setParentId}
        saving={saving}
        onSave={() => void saveEdit()}
        isCreate={false}
        parentHint={editRow?.parent_label}
        plantHint={editRow?.plant_label}
      />
    </AdminPanel>
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
  desc,
  setDesc,
  plantId,
  setPlantId,
  parentId,
  setParentId,
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
  desc: string
  setDesc: (v: string) => void
  plantId: string
  setPlantId: (v: string) => void
  parentId: string
  setParentId: (v: string) => void
  saving: boolean
  onSave: () => void
  isCreate: boolean
  parentHint?: string | null
  plantHint?: string | null
}) {
  const needsPlant = kind === "cost-center" || kind === "functional-location"
  const needsParentOnCreate = kind === "profit-center" || kind === "actual-location"
  const parentLabel = kind === "profit-center" ? "Cost center *" : "Functional location *"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isCreate
              ? "Select the parent in the hierarchy, then enter code and description."
              : "Code is unique within its parent."}
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
            <Label>Description *</Label>
            <Input className="h-9" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
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
