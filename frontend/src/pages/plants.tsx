import * as React from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminPrimaryButton,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
} from "@/components/layout/admin-ui"
import {
  AdminDataTable,
  type AdminListPage,
  AdminTableBodyRow,
  AdminTableEmptyRow,
  AdminTableLoadingRow,
  AdminTablePagination,
  LIST_PAGE_SIZE,
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
import { useUrlPage } from "@/lib/use-url-tab"
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

export function PlantsPage() {
  const [page, setPage] = useUrlPage()
  const [plants, setPlants] = React.useState<OrgUnitPublic[] | null>(null)
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [createOpen, setCreateOpen] = React.useState(false)
  const [createName, setCreateName] = React.useState("")
  const [createCode, setCreateCode] = React.useState("")
  const [creating, setCreating] = React.useState(false)

  const [editPlant, setEditPlant] = React.useState<OrgUnitPublic | null>(null)
  const [editName, setEditName] = React.useState("")
  const [editCode, setEditCode] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  const canCreate = hasPermission("org_units.create") || isSuperuser()
  const canUpdate = hasPermission("org_units.update") || isSuperuser()
  const canDelete = hasPermission("org_units.delete") || isSuperuser()
  const actionColSpan = (canUpdate ? 1 : 0) + (canDelete ? 1 : 0)
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()

  const load = React.useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const q = new URLSearchParams({
        type: "PLANT",
        page: String(page),
        page_size: String(LIST_PAGE_SIZE),
      })
      const p = await getJson<AdminListPage<OrgUnitPublic>>(`/admin/org-units/page?${q}`)
      setPlants(p.items)
      setTotal(p.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load plants")
      setPlants([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page])

  React.useEffect(() => {
    void load()
  }, [load])

  function openEdit(plant: OrgUnitPublic) {
    setEditPlant(plant)
    setEditName(plant.name)
    setEditCode(plant.code)
  }

  function closeEdit() {
    setEditPlant(null)
    setEditName("")
    setEditCode("")
  }

  async function createPlant() {
    const plantName = createName.trim()
    const plantCode = createCode.trim().toUpperCase()
    if (!plantName) {
      toast.error("Plant name is required.")
      return
    }
    if (!plantCode) {
      toast.error("Plant code is required.")
      return
    }
    setCreating(true)
    toast.loading("Creating plant…", { id: "create-plant-page" })
    try {
      await postJson<OrgUnitPublic>("/admin/org-units", {
        name: plantName,
        code: plantCode,
        type: "PLANT",
        parent_id: null,
      })
      toast.success("Plant created", { id: "create-plant-page" })
      setCreateOpen(false)
      setCreateName("")
      setCreateCode("")
      await load()
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to create plant"
      toast.error(message, { id: "create-plant-page" })
      setError(message)
    } finally {
      setCreating(false)
    }
  }

  async function deletePlant(plant: OrgUnitPublic) {
    const ok = await confirmAsk({
      title: "Delete plant?",
      description: `Delete plant "${plant.code}"? This is only allowed when no users are assigned to this plant.`,
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    toast.loading("Deleting plant…", { id: "delete-plant-page" })
    try {
      await deleteJson(`/admin/org-units/${plant.id}`)
      toast.success("Plant deleted", { id: "delete-plant-page" })
      if (editPlant?.id === plant.id) closeEdit()
      await load()
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to delete plant"
      toast.error(message, { id: "delete-plant-page" })
    }
  }

  async function savePlant() {
    if (!editPlant) return
    const plantName = editName.trim()
    const plantCode = editCode.trim().toUpperCase()
    if (!plantName) {
      toast.error("Plant name is required.")
      return
    }
    if (!plantCode) {
      toast.error("Plant code is required.")
      return
    }
    setSaving(true)
    toast.loading("Saving plant…", { id: "save-plant-page" })
    try {
      await patchJson<OrgUnitPublic>(`/admin/org-units/${editPlant.id}`, {
        name: plantName,
        code: plantCode,
      })
      toast.success("Plant updated", { id: "save-plant-page" })
      closeEdit()
      await load()
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to update plant"
      toast.error(message, { id: "save-plant-page" })
    } finally {
      setSaving(false)
    }
  }

  const createDialog = (
    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create plant</DialogTitle>
          <DialogDescription>Add a new plant with a unique plant code.</DialogDescription>
        </DialogHeader>
        <div className="dialog-body">
          <div className="space-y-1.5">
            <Label htmlFor="plant-code-create">Plant code *</Label>
            <Input
              id="plant-code-create"
              value={createCode}
              onChange={(e) => setCreateCode(e.target.value.toUpperCase())}
              placeholder="e.g. DEMO-01"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plant-name-create">Plant name *</Label>
            <Input
              id="plant-name-create"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="e.g. Demo Plant A"
              autoComplete="off"
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
            <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <AdminPrimaryButton type="button" disabled={creating} onClick={() => void createPlant()}>
              {creating ? "Creating…" : "Create plant"}
            </AdminPrimaryButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )

  const pageSize = LIST_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages, setPage])

  return (
    <AdminPage
      fullWidth
      viewportFill
      description=""
      actions={
        canCreate ? (
          <AdminPrimaryButton type="button" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            Create plant
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

      <AdminDataTable
        className="min-h-0 flex-1"
        title="All plants"
        footer={
          <AdminTablePagination
            page={Math.min(page, totalPages)}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            loading={loading || plants === null}
            itemLabel="plants"
            onPageChange={setPage}
          />
        }
      >
        <Table className="app-table-head-sticky">
          <TableHeader>
            <AdminTableHeaderRow>
              <AdminTableHeadCell>Code</AdminTableHeadCell>
              <AdminTableHeadCell>Name</AdminTableHeadCell>
              <AdminTableHeadCell className="w-[100px]">Type</AdminTableHeadCell>
              {actionColSpan > 0 ? (
                <AdminTableHeadCell className="w-[140px] text-right">Actions</AdminTableHeadCell>
              ) : null}
            </AdminTableHeaderRow>
          </TableHeader>
          <TableBody>
            {plants === null ? (
              <AdminTableLoadingRow colSpan={3 + actionColSpan} label="Loading plants" />
            ) : plants.length === 0 ? (
              <AdminTableEmptyRow colSpan={3 + actionColSpan}>No plants found.</AdminTableEmptyRow>
            ) : (
              plants.map((p) => (
                  <AdminTableBodyRow key={p.id} interactive={false}>
                    <AdminTableCell className="font-mono text-sm font-medium">{p.code}</AdminTableCell>
                    <AdminTableCell className="font-medium">{p.name}</AdminTableCell>
                    <AdminTableCell className="font-mono text-xs text-muted-foreground">{p.type}</AdminTableCell>
                    {actionColSpan > 0 ? (
                      <AdminTableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canUpdate ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground"
                              onClick={() => openEdit(p)}
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
                              onClick={() => void deletePlant(p)}
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                              Delete
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

      {createDialog}

      <Dialog open={editPlant !== null} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit plant</DialogTitle>
            <DialogDescription>Update plant code and name.</DialogDescription>
          </DialogHeader>
          <div className="dialog-body">
            <div className="space-y-1.5">
              <Label htmlFor="plant-code-edit">Plant code *</Label>
              <Input
                id="plant-code-edit"
                value={editCode}
                onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plant-name-edit">Plant name *</Label>
              <Input
                id="plant-name-edit"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={closeEdit}>
                Cancel
              </Button>
              <AdminPrimaryButton type="button" disabled={saving} onClick={() => void savePlant()}>
                {saving ? "Saving…" : "Save"}
              </AdminPrimaryButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </AdminPage>
  )
}
