import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Pencil, Plus, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminDataTable,
  AdminTableBodyRow,
  AdminTableEmptyRow,
} from "@/components/layout/list-page-ui"
import {
  AdminPanel,
  AdminPrimaryButton,
  AdminStatusBadge,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { ApiError, deleteJson, getJson, patchJson, postJson } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"

type RoleListItem = { id: number; name: string }

type StepRow = {
  id: number
  workflow_id: number
  step_order: number
  approver_role_id: number
  required_approvals: number
}

type WorkflowDetail = {
  id: number
  name: string
  entity_type: string
  is_active: boolean
  created_by: number | null
  created_at: string
  steps: StepRow[]
}

/** Known entity types the app resolves for approval workflows. */
const WORKFLOW_ENTITY_TYPES: { value: string; label: string }[] = [
  { value: "user_creation", label: "User creation" },
  { value: "asset_creation", label: "Asset creation" },
  { value: "asset_import", label: "Asset import" },
  { value: "capitalization_request", label: "Capitalization (no Engineering)" },
  { value: "capitalization_request_engineering", label: "Capitalization (with Engineering)" },
  { value: "physical_order_creation", label: "Physical order creation" },
  { value: "physical_order_closure", label: "Physical order closure" },
]

const KNOWN_ENTITY_TYPE_VALUES = new Set(WORKFLOW_ENTITY_TYPES.map((e) => e.value))

function entityTypeLabel(code: string): string {
  return WORKFLOW_ENTITY_TYPES.find((e) => e.value === code)?.label ?? code
}

function EntityTypeSelect({
  id,
  value,
  onChange,
  disabled,
  allowUnknown,
}: {
  id?: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  /** Keep current value selectable when it is not in the known list. */
  allowUnknown?: boolean
}) {
  const unknown = allowUnknown && value && !KNOWN_ENTITY_TYPE_VALUES.has(value)
  return (
    <select
      id={id}
      className={adminSelectClass}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {unknown ? (
        <option value={value} disabled>
          {value} (custom)
        </option>
      ) : null}
      {WORKFLOW_ENTITY_TYPES.map((e) => (
        <option key={e.value} value={e.value}>
          {e.label}
        </option>
      ))}
    </select>
  )
}

function roleName(roles: RoleListItem[], roleId: number): string {
  return roles.find((x) => x.id === roleId)?.name ?? `Role #${roleId}`
}

function stepsSummary(wf: WorkflowDetail, roles: RoleListItem[]): string {
  const sorted = [...(wf.steps ?? [])].sort((a, b) => a.step_order - b.step_order)
  if (sorted.length === 0) return "—"
  return sorted.map((s) => `L${s.step_order} ${roleName(roles, s.approver_role_id)}`).join(" → ")
}

export function WorkflowAssignmentPage() {
  const [workflows, setWorkflows] = React.useState<WorkflowDetail[]>([])
  const [roles, setRoles] = React.useState<RoleListItem[]>([])

  const [view, setView] = React.useState<"list" | "edit">("list")
  const [selectedId, setSelectedId] = React.useState<string>("")
  const [createOpen, setCreateOpen] = React.useState(false)
  const [newWorkflowName, setNewWorkflowName] = React.useState("")
  const [newEntityType, setNewEntityType] = React.useState("user_creation")
  const [editName, setEditName] = React.useState("")
  const [editEntityType, setEditEntityType] = React.useState("")
  const [newRoleId, setNewRoleId] = React.useState("")
  const [newRequired, setNewRequired] = React.useState("1")

  const [loading, setLoading] = React.useState(true)
  const [creatingWf, setCreatingWf] = React.useState(false)
  const [savingWf, setSavingWf] = React.useState(false)
  const [addingStep, setAddingStep] = React.useState(false)
  const [activating, setActivating] = React.useState(false)
  const [deactivating, setDeactivating] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [stepSavingId, setStepSavingId] = React.useState<number | null>(null)
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [w, r] = await Promise.all([
        getJson<WorkflowDetail[]>("/admin/approval-workflows"),
        getJson<RoleListItem[]>("/admin/roles?skip=0&limit=200"),
      ])
      setWorkflows(w)
      setRoles(r)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to load.")
      setWorkflows([])
      setRoles([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const sortedWorkflows = React.useMemo(
    () => [...workflows].sort((a, b) => a.name.localeCompare(b.name)),
    [workflows],
  )

  const selectedWf = React.useMemo(() => {
    const id = Number(selectedId)
    if (!Number.isFinite(id) || id < 1) return null
    return workflows.find((w) => w.id === id) ?? null
  }, [workflows, selectedId])

  const canEditSteps = selectedWf !== null && !selectedWf.is_active

  React.useEffect(() => {
    if (selectedWf) {
      setEditName(selectedWf.name)
      setEditEntityType(selectedWf.entity_type)
    }
  }, [selectedWf?.id, selectedWf?.name, selectedWf?.entity_type])

  const nextStepOrder = React.useMemo(() => {
    const steps = selectedWf?.steps ?? []
    if (steps.length === 0) return 1
    return Math.max(...steps.map((s) => s.step_order)) + 1
  }, [selectedWf])

  function openWorkflow(id: number) {
    setSelectedId(String(id))
    setView("edit")
  }

  function backToList() {
    setView("list")
    setSelectedId("")
  }

  async function onCreateWorkflow() {
    const name = newWorkflowName.trim()
    if (!name) {
      toast.error("Workflow name is required.")
      return
    }
    setCreatingWf(true)
    try {
      const created = await postJson<WorkflowDetail>("/admin/approval-workflows", {
        name,
        entity_type: newEntityType.trim() || "user_creation",
        is_active: false,
      })
      toast.success("Workflow created.")
      setCreateOpen(false)
      setNewWorkflowName("")
      setNewEntityType("user_creation")
      await load()
      openWorkflow(created.id)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not create workflow.")
    } finally {
      setCreatingWf(false)
    }
  }

  async function onSaveWorkflow() {
    const wid = Number(selectedId)
    if (!Number.isFinite(wid) || wid < 1) return
    setSavingWf(true)
    try {
      const body: Record<string, string> = { name: editName.trim() }
      if (!selectedWf?.is_active) body.entity_type = editEntityType.trim()
      await patchJson<WorkflowDetail>(`/admin/approval-workflows/${wid}`, body)
      toast.success("Saved.")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save.")
    } finally {
      setSavingWf(false)
    }
  }

  async function onDeactivate() {
    const wid = Number(selectedId)
    if (!Number.isFinite(wid) || wid < 1) return
    setDeactivating(true)
    try {
      await patchJson<WorkflowDetail>(`/admin/approval-workflows/${wid}/deactivate`, {})
      toast.success("Deactivated — you can edit levels.")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not deactivate.")
    } finally {
      setDeactivating(false)
    }
  }

  async function onAddStep() {
    const wid = Number(selectedId)
    const rid = Number(newRoleId)
    const req = Number(newRequired)
    if (!canEditSteps) {
      toast.error("Deactivate the workflow to add levels.")
      return
    }
    if (!Number.isFinite(rid) || rid < 1) {
      toast.error("Select an approver role.")
      return
    }
    setAddingStep(true)
    try {
      await postJson(`/admin/approval-workflows/${wid}/steps`, {
        step_order: nextStepOrder,
        approver_role_id: rid,
        required_approvals: req >= 1 ? req : 1,
      })
      toast.success("Level added.")
      setNewRoleId("")
      setNewRequired("1")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not add level.")
    } finally {
      setAddingStep(false)
    }
  }

  async function onSaveStep(step: StepRow, roleId: string, required: string) {
    if (!canEditSteps) return
    const wid = Number(selectedId)
    setStepSavingId(step.id)
    try {
      await patchJson(`/admin/approval-workflows/${wid}/steps/${step.id}`, {
        approver_role_id: Number(roleId),
        required_approvals: Math.max(1, Number(required) || 1),
      })
      toast.success("Level saved.")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save level.")
    } finally {
      setStepSavingId(null)
    }
  }

  async function onDeleteStep(stepId: number) {
    if (!canEditSteps) return
    const wid = Number(selectedId)
    try {
      await deleteJson(`/admin/approval-workflows/${wid}/steps/${stepId}`)
      toast.success("Level removed.")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete level.")
    }
  }

  async function onActivate() {
    const wid = Number(selectedId)
    if (!selectedWf?.steps?.length) {
      toast.error("Add at least one level first.")
      return
    }
    setActivating(true)
    try {
      await patchJson<WorkflowDetail>(`/admin/approval-workflows/${wid}/activate`, {})
      toast.success("Workflow activated.")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not activate.")
    } finally {
      setActivating(false)
    }
  }

  async function onDeleteWorkflow(wf: WorkflowDetail) {
    if (wf.is_active) {
      toast.error("Deactivate the workflow before deleting it.")
      return
    }
    const ok = await confirmAsk({
      title: "Delete workflow?",
      description: `Delete workflow “${wf.name}”? This cannot be undone. Workflows with approval history cannot be deleted.`,
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    setDeleting(true)
    try {
      await deleteJson(`/admin/approval-workflows/${wf.id}`)
      toast.success("Workflow deleted.")
      if (selectedId === String(wf.id)) backToList()
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not delete workflow.")
    } finally {
      setDeleting(false)
    }
  }

  if (view === "edit" && selectedWf) {
    return (
      <>
      <AdminPage dense fullWidth viewportFill className="gap-4">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={backToList}>
            ← Back to workflows
          </Button>
          {!selectedWf.is_active ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={deleting}
              onClick={() => void onDeleteWorkflow(selectedWf)}
            >
              <Trash2 className="size-3.5" aria-hidden />
              {deleting ? "Deleting…" : "Delete workflow"}
            </Button>
          ) : null}
        </div>

        <AdminPanel
          title={selectedWf.name}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          contentClassName="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5"
        >
            <div className="flex flex-wrap items-center gap-2">
              <AdminStatusBadge active={selectedWf.is_active} />
              {selectedWf.is_active ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={deactivating}
                  onClick={() => void onDeactivate()}
                >
                  {deactivating ? "…" : "Deactivate to edit levels"}
                </Button>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 max-w-2xl">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} disabled={loading} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-wf-type">Entity type</Label>
                <EntityTypeSelect
                  id="edit-wf-type"
                  value={editEntityType}
                  onChange={setEditEntityType}
                  disabled={loading || selectedWf.is_active}
                  allowUnknown
                />
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={savingWf || loading}
              onClick={() => void onSaveWorkflow()}
            >
              {savingWf ? "Saving…" : "Save"}
            </Button>

            <Separator />

            <p className="text-sm font-medium">Approval levels</p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Level</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="w-28">Required</TableHead>
                    {canEditSteps ? <TableHead className="w-32 text-right">Actions</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...(selectedWf.steps ?? [])]
                    .sort((a, b) => a.step_order - b.step_order)
                    .map((s) => (
                      <StepEditRow
                        key={s.id}
                        step={s}
                        roles={roles}
                        canEdit={canEditSteps}
                        saving={stepSavingId === s.id}
                        onSave={(roleId, req) => void onSaveStep(s, roleId, req)}
                        onDelete={() => void onDeleteStep(s.id)}
                      />
                    ))}
                  {(selectedWf.steps ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={canEditSteps ? 4 : 3}
                        className="text-sm text-muted-foreground"
                      >
                        No levels yet.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>

            {canEditSteps ? (
              <div className="flex flex-wrap gap-2 items-end rounded-md border p-3">
                <div className="min-w-[160px] flex-1 space-y-1.5">
                  <Label>Approver role</Label>
                  <select
                    className={adminSelectClass}
                    value={newRoleId}
                    onChange={(e) => setNewRoleId(e.target.value)}
                  >
                    <option value="">Role…</option>
                    {roles.map((r) => (
                      <option key={r.id} value={String(r.id)}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-24 space-y-1.5">
                  <Label>Required</Label>
                  <Input
                    type="number"
                    min={1}
                    value={newRequired}
                    onChange={(e) => setNewRequired(e.target.value)}
                  />
                </div>
                <Button type="button" size="sm" disabled={addingStep} onClick={() => void onAddStep()}>
                  {addingStep ? "…" : `Add level ${nextStepOrder}`}
                </Button>
              </div>
            ) : null}

            <AdminPrimaryButton
              type="button"
              disabled={activating || selectedWf.is_active || !(selectedWf.steps?.length)}
              onClick={() => void onActivate()}
            >
              {activating ? "Activating…" : selectedWf.is_active ? "Active" : "Activate workflow"}
            </AdminPrimaryButton>
        </AdminPanel>
      </AdminPage>
      {confirmDialog}
      </>
    )
  }

  return (
    <>
    <AdminPage
      dense
      fullWidth
      viewportFill
      description="Define approval levels per entity type. Create, edit, activate, or delete draft workflows."
      actions={
        <AdminPrimaryButton type="button" onClick={() => setCreateOpen(true)} disabled={loading}>
          <Plus className="size-4" aria-hidden />
          Create workflow
        </AdminPrimaryButton>
      }
    >
      <AdminDataTable className="min-h-0 flex-1">
        <Table className="app-table-head-sticky">
          <TableHeader>
            <AdminTableHeaderRow>
              <AdminTableHeadCell>Name</AdminTableHeadCell>
              <AdminTableHeadCell>Entity type</AdminTableHeadCell>
              <AdminTableHeadCell>Status</AdminTableHeadCell>
              <AdminTableHeadCell>Levels</AdminTableHeadCell>
              <AdminTableHeadCell className="w-[160px] text-right">Actions</AdminTableHeadCell>
            </AdminTableHeaderRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <AdminTableEmptyRow colSpan={5}>Loading workflows…</AdminTableEmptyRow>
            ) : sortedWorkflows.length === 0 ? (
              <AdminTableEmptyRow colSpan={5}>
                No workflows yet. Click Create workflow.
              </AdminTableEmptyRow>
            ) : (
              sortedWorkflows.map((w) => (
                <AdminTableBodyRow key={w.id} interactive={false}>
                  <AdminTableCell className="font-medium">{w.name}</AdminTableCell>
                  <AdminTableCell className="text-sm text-muted-foreground" title={w.entity_type}>
                    {entityTypeLabel(w.entity_type)}
                  </AdminTableCell>
                  <AdminTableCell>
                    {w.is_active ? (
                      <AdminStatusBadge active={w.is_active} />
                    ) : (
                      <span className="inline-flex rounded-md border border-border/80 bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                        Draft
                      </span>
                    )}
                  </AdminTableCell>
                  <AdminTableCell className="max-w-md truncate text-xs text-muted-foreground">
                    {stepsSummary(w, roles)}
                  </AdminTableCell>
                  <AdminTableCell className="text-right">
                    <div className="flex justify-end gap-0.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
                        aria-label={`Edit ${w.name}`}
                        onClick={() => openWorkflow(w.id)}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                        <span className="hidden sm:inline">Edit</span>
                      </Button>
                      {!w.is_active ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-destructive"
                          disabled={deleting}
                          aria-label={`Delete ${w.name}`}
                          onClick={() => void onDeleteWorkflow(w)}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                          <span className="hidden sm:inline">Delete</span>
                        </Button>
                      ) : null}
                    </div>
                  </AdminTableCell>
                </AdminTableBodyRow>
              ))
            )}
          </TableBody>
        </Table>
      </AdminDataTable>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create workflow</DialogTitle>
            <DialogDescription>Creates a draft workflow you can configure next.</DialogDescription>
          </DialogHeader>
          <div className="dialog-body max-h-[min(70vh,28rem)] space-y-3 overflow-y-auto">
            <div className="space-y-1.5">
              <Label htmlFor="create-wf-name">Name</Label>
              <Input
                id="create-wf-name"
                value={newWorkflowName}
                onChange={(e) => setNewWorkflowName(e.target.value)}
                placeholder="User creation approval"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-wf-type">Entity type</Label>
              <EntityTypeSelect
                id="create-wf-type"
                value={newEntityType}
                onChange={setNewEntityType}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={creatingWf} onClick={() => void onCreateWorkflow()}>
                {creatingWf ? "Creating…" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminPage>
    {confirmDialog}
    </>
  )
}

function StepEditRow({
  step,
  roles,
  canEdit,
  saving,
  onSave,
  onDelete,
}: {
  step: StepRow
  roles: RoleListItem[]
  canEdit: boolean
  saving: boolean
  onSave: (roleId: string, required: string) => void
  onDelete: () => void
}) {
  const [roleId, setRoleId] = React.useState(String(step.approver_role_id))
  const [required, setRequired] = React.useState(String(step.required_approvals))

  React.useEffect(() => {
    setRoleId(String(step.approver_role_id))
    setRequired(String(step.required_approvals))
  }, [step.id, step.approver_role_id, step.required_approvals])

  if (!canEdit) {
    return (
      <TableRow>
        <TableCell>{step.step_order}</TableCell>
        <TableCell>{roleName(roles, step.approver_role_id)}</TableCell>
        <TableCell>{step.required_approvals}</TableCell>
      </TableRow>
    )
  }

  return (
    <TableRow>
      <TableCell>{step.step_order}</TableCell>
      <TableCell>
        <select
          className={cn(adminSelectClass, "h-9")}
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
        >
          {roles.map((r) => (
            <option key={r.id} value={String(r.id)}>
              {r.name}
            </option>
          ))}
        </select>
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={1}
          className="h-8"
          value={required}
          onChange={(e) => setRequired(e.target.value)}
        />
      </TableCell>
      <TableCell className="text-right space-x-1">
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => onSave(roleId, required)}>
          {saving ? "…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDelete}>
          Delete
        </Button>
      </TableCell>
    </TableRow>
  )
}
