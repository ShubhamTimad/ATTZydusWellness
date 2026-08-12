import * as React from "react"
import { Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react"
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
import type { CostCenterMaster, FunctionalLocationMaster, PlantOption } from "@/lib/masters-types"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"

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

  return (
    <>
      <AdminDataTable title={title} headerActions={addButton} className="min-h-0 flex-1">
        <Table className="app-table-head-sticky">
          <TableHeader>
            <AdminTableHeaderRow>
              <AdminTableHeadCell>Code</AdminTableHeadCell>
              <AdminTableHeadCell>Name</AdminTableHeadCell>
              <AdminTableHeadCell>{descriptionColumnLabel}</AdminTableHeadCell>
              <AdminTableHeadCell>Plant</AdminTableHeadCell>
              {parentColumn ? <AdminTableHeadCell>{parentColumn}</AdminTableHeadCell> : null}
              {showScrapyardCol ? <AdminTableHeadCell>Scrapyard</AdminTableHeadCell> : null}
              <AdminTableHeadCell>Status</AdminTableHeadCell>
              {showActions ? <AdminTableHeadCell className="w-40"> </AdminTableHeadCell> : null}
            </AdminTableHeaderRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <AdminTableEmptyRow colSpan={tableColSpan}>
                No records yet.
              </AdminTableEmptyRow>
            ) : (
              rows.map((row) => (
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
    </>
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
