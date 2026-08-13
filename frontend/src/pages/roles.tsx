import * as React from "react"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminPanel,
  AdminPrimaryButton,
  AdminRowAction,
  AdminRowActions,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminPanelClass,
} from "@/components/layout/admin-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { ApiError, deleteJson, getJson, patchJson, postJson } from "@/lib/api"
import { canListOrgUnitsForAssignments, hasPermission, isSuperuser } from "@/lib/permissions"
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

type RoleListItem = {
  id: number
  name: string
  description: string | null
  created_at: string
  org_unit_ids: number[]
}

type PermissionPublic = {
  id: number
  feature_id: number
  action: string
  code: string
  description: string | null
  created_at: string
}

type RoleDetail = {
  id: number
  name: string
  description: string | null
  created_at: string
  permissions: PermissionPublic[]
  org_units: OrgUnitPublic[]
}

type CatalogPermission = {
  id: number | null
  action: string
  code: string
  description: string | null
}

type CatalogTab = {
  key: string
  title: string
  actions: string[]
  permissions: CatalogPermission[]
}

type CatalogModule = {
  key: string
  title: string
  tabs: CatalogTab[]
}

type PermissionCatalog = {
  modules: CatalogModule[]
}

type PermissionCatalogSyncResult = {
  features_created: number
  permissions_created: number
  permission_codes_updated: number
}

/** Column order and header labels for standard CRUD actions. */
const ACTION_COLUMNS = ["view", "view_all", "create", "update", "delete"] as const
const ACTION_LABEL: Record<string, string> = {
  view: "View",
  view_all: "View all",
  create: "Create",
  update: "Edit",
  delete: "Delete",
  access: "Access",
  act: "Act",
  manage: "Manage",
  scan: "Scan",
  execute: "Execute",
  export: "Export",
  deactivate: "Deactivate",
  reactivate: "Reactivate",
}

function orderedActionColumns(actions: string[]): string[] {
  const uniq = new Set<string>(actions.map((a) => a.trim()).filter(Boolean))
  const out: string[] = []
  for (const a of ACTION_COLUMNS) {
    if (uniq.has(a)) out.push(a)
  }
  for (const a of ["access", "act", "manage", "scan", "execute", "export"]) {
    if (uniq.has(a)) out.push(a)
  }
  // Any other action types should still be shown (stable order).
  const rest = Array.from(uniq).filter((a) => !out.includes(a)).sort((a, b) => a.localeCompare(b))
  out.push(...rest)
  return out
}

function permissionIdsInTab(tab: CatalogTab): number[] {
  return tab.permissions.map((p) => p.id).filter((id): id is number => id != null)
}

function permissionIdsInModule(mod: CatalogModule): number[] {
  return mod.tabs.flatMap(permissionIdsInTab)
}

function permissionIdsInCatalog(catalog: PermissionCatalog): number[] {
  return catalog.modules.flatMap(permissionIdsInModule)
}

function selectionState(ids: number[], selected: Set<number>): boolean | "indeterminate" {
  if (ids.length === 0) return false
  let n = 0
  for (const id of ids) if (selected.has(id)) n += 1
  if (n === 0) return false
  if (n === ids.length) return true
  return "indeterminate"
}

export function RolesPage() {
  const [roles, setRoles] = React.useState<RoleListItem[] | null>(null)
  const [plants, setPlants] = React.useState<OrgUnitPublic[] | null>(null)
  const [catalog, setCatalog] = React.useState<PermissionCatalog | null>(null)

  const [selectedRoleId, setSelectedRoleId] = React.useState<number | null>(null)
  const [selectedRole, setSelectedRole] = React.useState<RoleDetail | null>(null)
  const [selectedPermissionIds, setSelectedPermissionIds] = React.useState<Set<number>>(
    () => new Set()
  )
  const [linkedOrgUnitIds, setLinkedOrgUnitIds] = React.useState<Set<number>>(() => new Set())

  const [error, setError] = React.useState<string | null>(null)

  const [createOpen, setCreateOpen] = React.useState(false)
  const [createName, setCreateName] = React.useState("")
  const [createDescription, setCreateDescription] = React.useState("")
  const [creating, setCreating] = React.useState(false)
  const [createOrgUnitIds, setCreateOrgUnitIds] = React.useState<Set<number>>(() => new Set())
  const [editOpen, setEditOpen] = React.useState(false)
  const [editName, setEditName] = React.useState("")
  const [editDescription, setEditDescription] = React.useState("")
  const [savingDetails, setSavingDetails] = React.useState(false)
  const [syncingCatalog, setSyncingCatalog] = React.useState(false)
  const [autoSyncAttempted, setAutoSyncAttempted] = React.useState(false)

  const canCreateRole = hasPermission("roles.create") || isSuperuser()
  const canDeleteRole = hasPermission("roles.delete") || isSuperuser()
  /** Same as ``GET /admin/org-units`` (plant pickers for roles vs. Plants admin module). */
  const canLoadPlantList = canListOrgUnitsForAssignments()
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()

  async function loadBase() {
    setError(null)
    try {
      const [r, cat] = await Promise.all([
        getJson<RoleListItem[]>("/admin/roles?skip=0&limit=200"),
        getJson<PermissionCatalog>("/admin/permissions/catalog"),
      ])
      setRoles(r)
      setCatalog(cat)
      if (canLoadPlantList) {
        try {
          const p = await getJson<OrgUnitPublic[]>("/admin/org-units?type=PLANT")
          setPlants(p)
        } catch {
          setPlants([])
        }
      } else {
        setPlants([])
      }
      if (selectedRoleId == null && r.length > 0) setSelectedRoleId(r[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load roles")
      setRoles([])
      setPlants([])
      setCatalog({ modules: [] })
    }
  }

  async function loadRole(roleId: number) {
    setError(null)
    try {
      const detail = await getJson<RoleDetail>(`/admin/roles/${roleId}`)
      setSelectedRole(detail)
      setSelectedPermissionIds(new Set(detail.permissions.map((x) => x.id)))
      setLinkedOrgUnitIds(new Set(detail.org_units.map((o) => o.id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load role")
      setSelectedRole(null)
      setSelectedPermissionIds(new Set())
      setLinkedOrgUnitIds(new Set())
    }
  }

  React.useEffect(() => {
    void loadBase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    if (selectedRoleId != null) void loadRole(selectedRoleId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoleId])

  const hasDirtyPermissions = React.useMemo(() => {
    if (!selectedRole) return false
    const original = new Set(selectedRole.permissions.map((p) => p.id))
    if (original.size !== selectedPermissionIds.size) return true
    for (const id of selectedPermissionIds) if (!original.has(id)) return true
    return false
  }, [selectedRole, selectedPermissionIds])

  const hasDirtyPlants = React.useMemo(() => {
    if (!canLoadPlantList || !selectedRole) return false
    const original = new Set(selectedRole.org_units.map((o) => o.id))
    if (original.size !== linkedOrgUnitIds.size) return true
    for (const id of linkedOrgUnitIds) if (!original.has(id)) return true
    return false
  }, [canLoadPlantList, selectedRole, linkedOrgUnitIds])

  const hasDirty = hasDirtyPermissions || hasDirtyPlants

  const canSaveRole = hasPermission("roles.update") || isSuperuser()
  const hasMissingCatalogPermissions = React.useMemo(() => {
    if (!catalog) return false
    return catalog.modules.some((mod) =>
      mod.tabs.some((tab) => tab.permissions.some((perm) => perm.id == null))
    )
  }, [catalog])

  const allCatalogPermissionIds = React.useMemo(
    () => (catalog ? permissionIdsInCatalog(catalog) : []),
    [catalog],
  )

  function togglePermissionIds(ids: number[], on: boolean) {
    if (!canSaveRole || ids.length === 0) return
    setSelectedPermissionIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  async function createRole() {
    const name = createName.trim()
    if (!name) {
      toast.error("Role name is required.")
      return
    }
    setCreating(true)
    toast.loading("Creating role…", { id: "create-role" })
    try {
      const created = await postJson<RoleDetail>("/admin/roles", {
        name,
        description: createDescription.trim() ? createDescription.trim() : null,
        permission_ids: [],
        org_unit_ids: Array.from(createOrgUnitIds.values()),
      })
      toast.success("Role created", { id: "create-role" })
      closeCreate()
      await loadBase()
      setSelectedRoleId(created.id)
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to create role"
      toast.error(message, { id: "create-role" })
      setError(message)
    } finally {
      setCreating(false)
    }
  }

  function openEdit() {
    if (!selectedRole) return
    setEditName(selectedRole.name)
    setEditDescription(selectedRole.description ?? "")
    setEditOpen(true)
  }

  function closeEdit() {
    setEditOpen(false)
    setEditName("")
    setEditDescription("")
  }

  async function saveRoleDetails() {
    if (!selectedRoleId) return
    const name = editName.trim()
    if (!name) {
      toast.error("Role name is required.")
      return
    }
    setSavingDetails(true)
    toast.loading("Saving role…", { id: "edit-role" })
    try {
      await patchJson<RoleDetail>(`/admin/roles/${selectedRoleId}`, {
        name,
        description: editDescription.trim() ? editDescription.trim() : null,
      })
      toast.success("Role updated", { id: "edit-role" })
      closeEdit()
      await loadBase()
      await loadRole(selectedRoleId)
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to update role"
      toast.error(message, { id: "edit-role" })
      setError(message)
    } finally {
      setSavingDetails(false)
    }
  }

  async function save() {
    if (!selectedRoleId) return
    const body: Record<string, unknown> = {}
    if (hasDirtyPermissions) body.permission_ids = Array.from(selectedPermissionIds.values())
    if (hasDirtyPlants) body.org_unit_ids = Array.from(linkedOrgUnitIds.values())
    if (Object.keys(body).length === 0) return
    toast.loading("Saving…", { id: "save-perms" })
    try {
      await patchJson<RoleDetail>(`/admin/roles/${selectedRoleId}`, body)
      toast.success("Saved", { id: "save-perms" })
      await loadRole(selectedRoleId)
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save"
      toast.error(message, { id: "save-perms" })
      setError(message)
    }
  }

  async function deleteRole() {
    if (!selectedRole) return
    const ok = await confirmAsk({
      title: "Delete role?",
      description: `Delete role "${selectedRole.name}"? This is only allowed when no users are assigned to this role.`,
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    toast.loading("Deleting role…", { id: "delete-role" })
    try {
      await deleteJson(`/admin/roles/${selectedRole.id}`)
      toast.success("Role deleted", { id: "delete-role" })
      closeEdit()
      setSelectedRole(null)
      setSelectedRoleId(null)
      setSelectedPermissionIds(new Set())
      setLinkedOrgUnitIds(new Set())
      await loadBase()
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to delete role"
      toast.error(message, { id: "delete-role" })
      setError(message)
    }
  }

  async function syncCatalog() {
    setSyncingCatalog(true)
    toast.loading("Syncing permissions…", { id: "sync-perms" })
    try {
      const result = await postJson<PermissionCatalogSyncResult>("/admin/permissions/sync", {})
      await loadBase()
      if (selectedRoleId != null) await loadRole(selectedRoleId)
      const changed =
        result.features_created + result.permissions_created + result.permission_codes_updated
      toast.success(changed > 0 ? "Permission catalog synced" : "Permission catalog already up to date", {
        id: "sync-perms",
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to sync permissions"
      toast.error(message, { id: "sync-perms" })
      setError(message)
    } finally {
      setSyncingCatalog(false)
    }
  }

  React.useEffect(() => {
    if (!canSaveRole || !hasMissingCatalogPermissions || syncingCatalog || autoSyncAttempted) return
    setAutoSyncAttempted(true)
    void syncCatalog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSaveRole, hasMissingCatalogPermissions, syncingCatalog, autoSyncAttempted])

  function closeCreate() {
    setCreateOpen(false)
    setCreateName("")
    setCreateDescription("")
    setCreateOrgUnitIds(new Set())
  }

  return (
    <AdminPage
      dense
      fullWidth
      viewportFill
      // description="Link roles to plants and assign permissions by module. No plants selected = global role."
      actions={
        canCreateRole || canSaveRole ? (
          <>
            {canCreateRole ? (
              <AdminPrimaryButton type="button" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" aria-hidden />
                Create role
              </AdminPrimaryButton>
            ) : null}
            {canSaveRole ? (
              <AdminPrimaryButton
                type="button"
                onClick={() => void save()}
                disabled={!selectedRoleId || !hasDirty}
                variant={hasDirty ? "default" : "outline"}
              >
                {hasDirty ? "Save changes" : "Save"}
              </AdminPrimaryButton>
            ) : null}
          </>
        ) : undefined
      }
    >
      {error ? (
        <Alert variant="destructive" className="shrink-0">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {hasMissingCatalogPermissions && canSaveRole ? (
        <Alert className="shrink-0">
          <AlertTitle>Missing permission rows</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>Some permissions exist in config but not in the database yet.</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={syncingCatalog}
              onClick={() => void syncCatalog()}
            >
              {syncingCatalog ? "Syncing…" : "Sync missing permissions"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)] lg:items-stretch">
        <AdminPanel
          title="Roles"
          description="Select a role to configure"
          className="flex max-h-[min(42dvh,22rem)] min-h-0 flex-col lg:max-h-none"
          contentClassName="min-h-0 flex-1 overflow-y-auto p-0"
        >
          <Table>
            <TableBody>
              {roles === null ? (
                <TableRow>
                  <TableCell className="px-5 py-10 text-center text-sm text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : roles.length === 0 ? (
                <TableRow>
                  <TableCell className="px-5 py-10 text-center text-sm text-muted-foreground">
                    No roles found.
                  </TableCell>
                </TableRow>
              ) : (
                roles.map((r) => {
                  const active = selectedRoleId === r.id
                  return (
                    <TableRow
                      key={r.id}
                      className={cn(
                        "cursor-pointer border-b border-border/40 transition-colors hover:bg-muted/15",
                        active && "bg-primary/10 hover:bg-primary/15",
                      )}
                      onClick={() => setSelectedRoleId(r.id)}
                      role="button"
                    >
                      <TableCell className="px-5 py-3.5">
                        <div className="text-sm font-semibold leading-snug text-foreground">{r.name}</div>
                        {r.description ? (
                          <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
                            {r.description}
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </AdminPanel>

        <AdminPanel
          title={selectedRole ? selectedRole.name : "Permissions"}
          description={
            hasDirty
              ? "Unsaved changes — click Save changes"
              : selectedRole?.description
                ? selectedRole.description
                : canSaveRole
                  ? "Assign plants and permissions for this role"
                  : "You need roles.update to save"
          }
          className="flex min-h-0 flex-col"
          contentClassName="min-h-0 flex-1 overflow-y-auto px-5 py-4"
          headerActions={
            selectedRole && (canSaveRole || canDeleteRole) ? (
              <AdminRowActions>
                {canSaveRole ? (
                  <AdminRowAction icon={Pencil} label="Edit" onClick={openEdit} />
                ) : null}
                {canDeleteRole ? (
                  <AdminRowAction
                    icon={Trash2}
                    label="Delete"
                    onClick={() => void deleteRole()}
                    className="text-destructive hover:text-destructive"
                  />
                ) : null}
              </AdminRowActions>
            ) : undefined
          }
        >
          <>
            {catalog === null ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
            ) : selectedRoleId == null ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Select a role.</div>
            ) : catalog.modules.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No catalog modules defined.
              </div>
            ) : (
              <div className="space-y-6">
                {!canSaveRole ? (
                  <p className="text-xs text-muted-foreground">
                    Read-only — you need <span className="font-medium">roles.update</span> to change this
                    role.
                  </p>
                ) : null}
                <div className="space-y-2">
                  <div className="text-sm font-semibold">Plants</div>
                  {canLoadPlantList ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        None selected = available at every plant. Otherwise limit to the plants below.
                      </p>
                      <div className={cn(adminPanelClass, "p-3 shadow-none")}>
                        {plants === null || plants.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No plants defined.</p>
                        ) : (
                          <div className="flex max-h-40 flex-col gap-2 overflow-y-auto pr-1">
                            {plants.map((pl) => {
                              const checked = linkedOrgUnitIds.has(pl.id)
                              return (
                                <label
                                  key={pl.id}
                                  className={cn(
                                    "flex items-center gap-2 text-sm",
                                    canSaveRole ? "cursor-pointer" : "cursor-not-allowed opacity-70",
                                  )}
                                >
                                  <Checkbox
                                    checked={checked}
                                    disabled={!canSaveRole}
                                    onCheckedChange={(v) => {
                                      if (!canSaveRole) return
                                      const next = new Set(linkedOrgUnitIds)
                                      if (v) next.add(pl.id)
                                      else next.delete(pl.id)
                                      setLinkedOrgUnitIds(next)
                                    }}
                                  />
                                  <span>
                                    {pl.code} — {pl.name}
                                  </span>
                                </label>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Plant linking needs <span className="font-medium">Plants View</span> or{" "}
                      <span className="font-medium">Roles Create/Edit</span>.
                    </p>
                  )}
                </div>

                {canSaveRole && allCatalogPermissionIds.length > 0 ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      Permissions · {selectedPermissionIds.size} selected
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => togglePermissionIds(allCatalogPermissionIds, true)}
                      >
                        Select all
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() => togglePermissionIds(allCatalogPermissionIds, false)}
                      >
                        Clear all
                      </Button>
                    </div>
                  </div>
                ) : null}

                {catalog.modules.map((mod) => {
                  const moduleActions = orderedActionColumns(
                    mod.tabs.flatMap((t) => (Array.isArray(t.actions) ? t.actions : [])),
                  )
                  const moduleIds = permissionIdsInModule(mod)
                  const moduleChecked = selectionState(moduleIds, selectedPermissionIds)
                  return (
                    <div key={mod.key} className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold">{mod.title}</div>
                        {canSaveRole && moduleIds.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <label
                              className={cn(
                                "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
                                "cursor-pointer",
                              )}
                            >
                              <Checkbox
                                checked={moduleChecked}
                                aria-label={`Select all in ${mod.title}`}
                                onCheckedChange={(v) =>
                                  togglePermissionIds(moduleIds, v === true)
                                }
                              />
                              Select all
                            </label>
                          </div>
                        ) : null}
                      </div>
                      <div className="overflow-x-auto rounded-lg border border-border/60">
                        <Table className="w-auto min-w-0">
                          <TableHeader>
                            <AdminTableHeaderRow>
                              <AdminTableHeadCell className="min-w-[10rem] px-4">Tab</AdminTableHeadCell>
                              {moduleActions.map((act) => (
                                <AdminTableHeadCell
                                  key={act}
                                  className="w-[4.75rem] min-w-[4.75rem] px-2 text-center"
                                >
                                  {ACTION_LABEL[act] ?? act}
                                </AdminTableHeadCell>
                              ))}
                            </AdminTableHeaderRow>
                          </TableHeader>
                          <TableBody>
                            {mod.tabs.map((tab) => {
                              const tabIds = permissionIdsInTab(tab)
                              const tabChecked = selectionState(tabIds, selectedPermissionIds)
                              return (
                              <TableRow
                                key={`${mod.key}.${tab.key}`}
                                className="border-b border-border/40"
                              >
                                <AdminTableCell className="px-4 font-medium text-muted-foreground">
                                  <div className="flex items-center gap-2">
                                    {canSaveRole && tabIds.length > 0 ? (
                                      <Checkbox
                                        checked={tabChecked}
                                        disabled={!canSaveRole}
                                        aria-label={`Select all permissions for ${tab.title}`}
                                        title={`Select all for ${tab.title}`}
                                        onCheckedChange={(v) =>
                                          togglePermissionIds(tabIds, v === true)
                                        }
                                      />
                                    ) : null}
                                    <span>{tab.title}</span>
                                  </div>
                                </AdminTableCell>
                                {moduleActions.map((act) => {
                                  const cell = tab.permissions.find((p) => p.action === act)
                                  if (!cell) {
                                    return (
                                      <TableCell
                                        key={act}
                                        className="w-[4.75rem] min-w-[4.75rem] px-2 text-center"
                                      >
                                        <span className="text-xs text-muted-foreground">—</span>
                                      </TableCell>
                                    )
                                  }
                                  const id = cell.id
                                  const checked = id != null && selectedPermissionIds.has(id)
                                  const disabled = id == null || !canSaveRole
                                  return (
                                    <TableCell
                                      key={act}
                                      className="w-[4.75rem] min-w-[4.75rem] px-2 text-center"
                                    >
                                      <div className="flex justify-center">
                                        <Checkbox
                                          checked={checked}
                                          disabled={disabled}
                                          title={
                                            id == null
                                              ? "Sync missing permissions to enable this cell"
                                              : `${cell.code}${cell.description ? ` — ${cell.description}` : ""}`
                                          }
                                          aria-label={cell.code}
                                          onCheckedChange={(v) => {
                                            if (id == null) return
                                            const next = new Set(selectedPermissionIds)
                                            if (v) next.add(id)
                                            else next.delete(id)
                                            setSelectedPermissionIds(next)
                                          }}
                                        />
                                      </div>
                                    </TableCell>
                                  )
                                })}
                              </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        </AdminPanel>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (open) setCreateOpen(true)
          else closeCreate()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create role</DialogTitle>
            <DialogDescription>
              Add a new role, optionally restrict it to specific plants, then assign permissions.
            </DialogDescription>
          </DialogHeader>
          <div className="dialog-body">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Name *</Label>
              <Input
                id="role-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Plant operator"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-desc">Description (optional)</Label>
              <Input
                id="role-desc"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="What this role is for"
              />
            </div>
            {canLoadPlantList ? (
              <div className="space-y-2">
                <Label>Plants (optional)</Label>
                <p className="text-xs text-muted-foreground">
                  Leave none selected so this role applies at every plant.
                </p>
                <ScrollArea className="h-[160px] rounded-md border p-2">
                  {plants === null || plants.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No plants yet. Create plants under Plants.</p>
                  ) : (
                    <div className="space-y-2">
                      {plants.map((pl) => {
                        const checked = createOrgUnitIds.has(pl.id)
                        return (
                          <label key={pl.id} className="flex cursor-pointer items-center gap-2 text-sm">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) => {
                                const next = new Set(createOrgUnitIds)
                                if (v) next.add(pl.id)
                                else next.delete(pl.id)
                                setCreateOrgUnitIds(next)
                              }}
                            />
                            <span>
                              {pl.code} — {pl.name}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </ScrollArea>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Plant checkboxes need <span className="font-medium">Plants View</span> or{" "}
                <span className="font-medium">Roles Create/Edit</span>.
              </p>
            )}
            <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={closeCreate}>
                Cancel
              </Button>
              <AdminPrimaryButton type="button" disabled={creating} onClick={() => void createRole()}>
                {creating ? "Creating…" : "Create role"}
              </AdminPrimaryButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit role</DialogTitle>
            <DialogDescription>Update the role name and description.</DialogDescription>
          </DialogHeader>
          <div className="dialog-body">
            <div className="space-y-1.5">
              <Label htmlFor="role-name-edit">Name *</Label>
              <Input
                id="role-name-edit"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="e.g. Plant operator"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="role-desc-edit">Description (optional)</Label>
              <Input
                id="role-desc-edit"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="What this role is for"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={closeEdit}>
                Cancel
              </Button>
              <AdminPrimaryButton
                type="button"
                disabled={savingDetails}
                onClick={() => void saveRoleDetails()}
              >
                {savingDetails ? "Saving…" : "Save changes"}
              </AdminPrimaryButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </AdminPage>
  )
}
