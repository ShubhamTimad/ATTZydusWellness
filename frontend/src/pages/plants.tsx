import * as React from "react"
import { Pencil, Plus } from "lucide-react"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminPanel,
  AdminPrimaryButton,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
} from "@/components/layout/admin-ui"
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
import { ApiError, getJson, patchJson, postJson } from "@/lib/api"
import { hasPermission, isSuperuser } from "@/lib/permissions"

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
  const [plants, setPlants] = React.useState<OrgUnitPublic[] | null>(null)
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

  async function load() {
    setError(null)
    try {
      const p = await getJson<OrgUnitPublic[]>("/admin/org-units?type=PLANT")
      setPlants(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load plants")
      setPlants([])
    }
  }

  React.useEffect(() => {
    void load()
  }, [])

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

  return (
    <AdminPage
      description="Manage plants (org units of type PLANT). Codes must be unique."
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

      <AdminPanel title="All plants" description="Sorted by plant code">
        <Table>
          <TableHeader>
            <AdminTableHeaderRow>
              <AdminTableHeadCell>Code</AdminTableHeadCell>
              <AdminTableHeadCell>Name</AdminTableHeadCell>
              <AdminTableHeadCell className="w-[100px]">Type</AdminTableHeadCell>
              {canUpdate ? (
                <AdminTableHeadCell className="w-[100px] text-right">Actions</AdminTableHeadCell>
              ) : null}
            </AdminTableHeaderRow>
          </TableHeader>
          <TableBody>
            {plants === null ? (
              <tr>
                <td
                  colSpan={canUpdate ? 4 : 3}
                  className="px-5 py-12 text-center text-sm text-muted-foreground"
                >
                  Loading…
                </td>
              </tr>
            ) : plants.length === 0 ? (
              <tr>
                <td
                  colSpan={canUpdate ? 4 : 3}
                  className="px-5 py-12 text-center text-sm text-muted-foreground"
                >
                  No plants found.
                </td>
              </tr>
            ) : (
              plants
                .slice()
                .sort((a, b) => a.code.localeCompare(b.code))
                .map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-border/40 transition-colors last:border-0 hover:bg-muted/15"
                  >
                    <AdminTableCell className="font-mono text-sm font-medium">{p.code}</AdminTableCell>
                    <AdminTableCell className="font-medium">{p.name}</AdminTableCell>
                    <AdminTableCell className="font-mono text-xs text-muted-foreground">{p.type}</AdminTableCell>
                    {canUpdate ? (
                      <AdminTableCell className="text-right">
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
                      </AdminTableCell>
                    ) : null}
                  </tr>
                ))
            )}
          </TableBody>
        </Table>
      </AdminPanel>

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
                {saving ? "Saving…" : "Save changes"}
              </AdminPrimaryButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}
