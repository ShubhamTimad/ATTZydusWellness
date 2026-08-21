import * as React from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminPrimaryButton,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import {
  AdminDataTable,
  AdminTableBodyRow,
  AdminTableEmptyRow,
} from "@/components/layout/list-page-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { hasPermission, isSuperuser } from "@/lib/permissions"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"

type OrgUnitPublic = {
  id: number
  name: string
  code: string
  type: string
  parent_id: number | null
  created_at: string
  updated_at: string
}

export function DepartmentsPage() {
  const [departments, setDepartments] = React.useState<OrgUnitPublic[] | null>(null)
  const [plants, setPlants] = React.useState<OrgUnitPublic[]>([])
  const [error, setError] = React.useState<string | null>(null)

  const [createOpen, setCreateOpen] = React.useState(false)
  const [createName, setCreateName] = React.useState("")
  const [createCode, setCreateCode] = React.useState("")
  const [createPlantId, setCreatePlantId] = React.useState("")
  const [creating, setCreating] = React.useState(false)

  const [editDept, setEditDept] = React.useState<OrgUnitPublic | null>(null)
  const [editName, setEditName] = React.useState("")
  const [editCode, setEditCode] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const canCreate = hasPermission("org_units.create") || isSuperuser()
  const canUpdate = hasPermission("org_units.update") || isSuperuser()
  const canDelete = hasPermission("org_units.delete") || isSuperuser()
  const actionColSpan = (canUpdate ? 1 : 0) + (canDelete ? 1 : 0)
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()

  const plantById = React.useMemo(() => {
    const map = new Map<number, OrgUnitPublic>()
    for (const p of plants) map.set(p.id, p)
    return map
  }, [plants])

  async function load() {
    setError(null)
    try {
      const [d, p] = await Promise.all([
        getJson<OrgUnitPublic[]>("/admin/org-units?type=DEPARTMENT"),
        getJson<OrgUnitPublic[]>("/admin/org-units?type=PLANT"),
      ])
      setDepartments(d)
      setPlants(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load departments")
      setDepartments([])
      setPlants([])
    }
  }

  React.useEffect(() => {
    void load()
  }, [])

  function openEdit(dept: OrgUnitPublic) {
    setEditDept(dept)
    setEditName(dept.name)
    setEditCode(dept.code)
  }

  function closeEdit() {
    setEditDept(null)
    setEditName("")
    setEditCode("")
  }

  async function createDepartment() {
    const name = createName.trim()
    const code = createCode.trim().toUpperCase()
    const parentId = Number(createPlantId)
    if (!createPlantId || !Number.isFinite(parentId) || parentId <= 0) {
      toast.error("Plant is required.")
      return
    }
    if (!code) {
      toast.error("Department code is required.")
      return
    }
    if (!name) {
      toast.error("Department name is required.")
      return
    }
    setCreating(true)
    toast.loading("Creating department…", { id: "create-department" })
    try {
      await postJson<OrgUnitPublic>("/admin/org-units", {
        name,
        code,
        type: "DEPARTMENT",
        parent_id: parentId,
      })
      toast.success("Department created", { id: "create-department" })
      setCreateOpen(false)
      setCreateName("")
      setCreateCode("")
      setCreatePlantId("")
      await load()
    } catch (e) {
      const message =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to create department"
      toast.error(message, { id: "create-department" })
      setError(message)
    } finally {
      setCreating(false)
    }
  }

  async function deleteDepartment(dept: OrgUnitPublic) {
    const ok = await confirmAsk({
      title: "Delete department?",
      description: `Delete department "${dept.code}"? Users assigned to it will lose the department link.`,
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    toast.loading("Deleting department…", { id: "delete-department" })
    try {
      await deleteJson(`/admin/org-units/${dept.id}`)
      toast.success("Department deleted", { id: "delete-department" })
      if (editDept?.id === dept.id) closeEdit()
      await load()
    } catch (e) {
      const message =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to delete department"
      toast.error(message, { id: "delete-department" })
    }
  }

  async function saveDepartment() {
    if (!editDept) return
    const name = editName.trim()
    const code = editCode.trim().toUpperCase()
    if (!code) {
      toast.error("Department code is required.")
      return
    }
    if (!name) {
      toast.error("Department name is required.")
      return
    }
    setSaving(true)
    toast.loading("Saving department…", { id: "save-department" })
    try {
      await patchJson<OrgUnitPublic>(`/admin/org-units/${editDept.id}`, { name, code })
      toast.success("Department updated", { id: "save-department" })
      closeEdit()
      await load()
    } catch (e) {
      const message =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to update department"
      toast.error(message, { id: "save-department" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminPage
      fullWidth
      // description="Departments belong to a plant and can be assigned when creating users."
      actions={
        canCreate ? (
          <AdminPrimaryButton type="button" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            Create department
          </AdminPrimaryButton>
        ) : undefined
      }
    >
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <AdminDataTable title="All departments">
        <Table className="app-table-head-sticky">
          <TableHeader>
            <AdminTableHeaderRow>
              <AdminTableHeadCell>Code</AdminTableHeadCell>
              <AdminTableHeadCell>Name</AdminTableHeadCell>
              <AdminTableHeadCell>Plant</AdminTableHeadCell>
              {actionColSpan > 0 ? (
                <AdminTableHeadCell className="w-[140px] text-right">Actions</AdminTableHeadCell>
              ) : null}
            </AdminTableHeaderRow>
          </TableHeader>
          <TableBody>
            {departments === null ? (
              <AdminTableEmptyRow colSpan={3 + actionColSpan}>Loading departments…</AdminTableEmptyRow>
            ) : departments.length === 0 ? (
              <AdminTableEmptyRow colSpan={3 + actionColSpan}>No departments found.</AdminTableEmptyRow>
            ) : (
              departments
                .slice()
                .sort((a, b) => a.code.localeCompare(b.code))
                .map((d) => {
                  const plant = d.parent_id != null ? plantById.get(d.parent_id) : undefined
                  return (
                    <AdminTableBodyRow key={d.id} interactive={false}>
                      <AdminTableCell className="font-mono text-sm font-medium">{d.code}</AdminTableCell>
                      <AdminTableCell className="font-medium">{d.name}</AdminTableCell>
                      <AdminTableCell className="text-muted-foreground">
                        {plant ? `${plant.code} — ${plant.name}` : "—"}
                      </AdminTableCell>
                      {actionColSpan > 0 ? (
                        <AdminTableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {canUpdate ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-8 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground"
                                onClick={() => openEdit(d)}
                              >
                                <Pencil className="size-3.5" aria-hidden />
                                Edit
                              </Button>
                            ) : null}
                            {canDelete ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-8 gap-1.5 px-2.5 text-muted-foreground hover:text-destructive"
                                onClick={() => void deleteDepartment(d)}
                              >
                                <Trash2 className="size-3.5" aria-hidden />
                                Delete
                              </Button>
                            ) : null}
                          </div>
                        </AdminTableCell>
                      ) : null}
                    </AdminTableBodyRow>
                  )
                })
            )}
          </TableBody>
        </Table>
      </AdminDataTable>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create department</DialogTitle>
            <DialogDescription>Select a plant, then enter a unique department code and name.</DialogDescription>
          </DialogHeader>
          <div className="dialog-body space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dept-plant-create">Plant *</Label>
              <select
                id="dept-plant-create"
                className={adminSelectClass}
                value={createPlantId}
                onChange={(e) => setCreatePlantId(e.target.value)}
              >
                <option value="">Select a plant…</option>
                {plants.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dept-code-create">Department code *</Label>
              <Input
                id="dept-code-create"
                value={createCode}
                onChange={(e) => setCreateCode(e.target.value.toUpperCase())}
                placeholder="e.g. FIN"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dept-name-create">Department name *</Label>
              <Input
                id="dept-name-create"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Finance"
                autoComplete="off"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <AdminPrimaryButton type="button" disabled={creating} onClick={() => void createDepartment()}>
                {creating ? "Creating…" : "Create department"}
              </AdminPrimaryButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editDept !== null} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit department</DialogTitle>
            <DialogDescription>Update department code and name. Plant cannot be changed here.</DialogDescription>
          </DialogHeader>
          <div className="dialog-body space-y-3">
            {editDept?.parent_id != null ? (
              <p className="text-xs text-muted-foreground">
                Plant:{" "}
                {plantById.get(editDept.parent_id)
                  ? `${plantById.get(editDept.parent_id)!.code} — ${plantById.get(editDept.parent_id)!.name}`
                  : "—"}
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="dept-code-edit">Department code *</Label>
              <Input
                id="dept-code-edit"
                value={editCode}
                onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dept-name-edit">Department name *</Label>
              <Input
                id="dept-name-edit"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={closeEdit}>
                Cancel
              </Button>
              <AdminPrimaryButton type="button" disabled={saving} onClick={() => void saveDepartment()}>
                {saving ? "Saving…" : "Save Changes"}
              </AdminPrimaryButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </AdminPage>
  )
}
