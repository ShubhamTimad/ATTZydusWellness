import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Pencil, Plus, Trash2, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  AdminTableLoadingRow,
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
  approver_role_ids?: number[]
  required_approvals: number
  step_kind?: string
  /** null / omit = all users in role; source | destination = filter by order CC */
  org_scope?: string | null
}

const STEP_KINDS: { value: string; label: string }[] = [
  { value: "assign", label: "Assign (executor)" },
  { value: "approve", label: "Approve" },
  { value: "receive", label: "Receive" },
  { value: "confirm", label: "Confirm" },
  { value: "close", label: "Close" },
]

const ORG_SCOPES: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "source", label: "Source Cost Center" },
  { value: "destination", label: "Destination Cost Center" },
]

function stepKindLabel(kind: string | undefined): string {
  const k = (kind || "approve").toLowerCase()
  return STEP_KINDS.find((x) => x.value === k)?.label ?? k
}

function orgScopeLabel(scope: string | null | undefined): string {
  const v = (scope || "").trim().toLowerCase()
  return ORG_SCOPES.find((x) => x.value === v)?.label ?? "All"
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
  { value: "disposal_order", label: "Asset disposal (no Engineering)" },
  { value: "disposal_order_engineering", label: "Asset disposal (with Engineering)" },
  { value: "transfer_order", label: "Asset transfer" },
  { value: "physical_order_closure", label: "Physical order (assign → approve/close)" },
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

function stepRoleIds(step: { approver_role_id: number; approver_role_ids?: number[] }): number[] {
  const ids = (step.approver_role_ids ?? []).filter((id) => id > 0)
  if (ids.length > 0) return ids
  return step.approver_role_id ? [step.approver_role_id] : []
}

function roleNames(roles: RoleListItem[], roleIds: number[]): string {
  if (roleIds.length === 0) return "—"
  return roleIds.map((id) => roles.find((x) => x.id === id)?.name ?? `Role #${id}`).join(", ")
}

function RoleChipPicker({
  roles,
  values,
  onChange,
}: {
  roles: RoleListItem[]
  values: string[]
  onChange: (next: string[]) => void
}) {
  const selected = new Set(values)
  const chosen = roles.filter((role) => selected.has(String(role.id)))
  const remaining = roles.filter((role) => !selected.has(String(role.id)))

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5">
      {chosen.map((role) => (
        <span
          key={role.id}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-muted/40 pl-2 pr-1 text-xs font-medium"
        >
          {role.name}
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
            aria-label={`Remove ${role.name}`}
            onClick={() => onChange(values.filter((id) => id !== String(role.id)))}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
            <Plus className="size-3" aria-hidden />
            Role
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-64 w-52 overflow-y-auto">
          {remaining.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No more roles.</div>
          ) : (
            remaining.map((role) => (
              <DropdownMenuItem
                key={role.id}
                onSelect={() => onChange([...values, String(role.id)])}
              >
                {role.name}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function stepsSummary(wf: WorkflowDetail, roles: RoleListItem[]): string {
  const sorted = [...(wf.steps ?? [])].sort((a, b) => a.step_order - b.step_order)
  if (sorted.length === 0) return "—"
  return sorted
    .map((s) => {
      const kind = (s.step_kind || "approve").toLowerCase()
      const suffix = kind !== "approve" ? ` (${kind})` : ""
      return `L${s.step_order} ${roleNames(roles, stepRoleIds(s))}${suffix}`
    })
    .join(" → ")
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
  const [newRoleIds, setNewRoleIds] = React.useState<string[]>([])
  const [newRequired, setNewRequired] = React.useState("1")
  const [newStepKind, setNewStepKind] = React.useState("approve")
  const [newOrgScope, setNewOrgScope] = React.useState("")

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
    const roleIds = newRoleIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    const req = Number(newRequired)
    if (!canEditSteps) {
      toast.error("Deactivate the workflow to add levels.")
      return
    }
    if (roleIds.length === 0) {
      toast.error("Select at least one approver role.")
      return
    }
    setAddingStep(true)
    try {
      await postJson(`/admin/approval-workflows/${wid}/steps`, {
        step_order: nextStepOrder,
        approver_role_ids: roleIds,
        required_approvals: req >= 1 ? req : 1,
        step_kind: newStepKind || "approve",
        org_scope: newOrgScope || null,
      })
      toast.success("Level added.")
      setNewRoleIds([])
      setNewRequired("1")
      setNewStepKind("approve")
      setNewOrgScope("")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not add level.")
    } finally {
      setAddingStep(false)
    }
  }

  async function onSaveStep(
    step: StepRow,
    roleIds: string[],
    required: string,
    kind: string,
    orgScope: string,
  ) {
    if (!canEditSteps) return
    const ids = roleIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    if (ids.length === 0) {
      toast.error("Select at least one approver role.")
      return
    }
    const wid = Number(selectedId)
    setStepSavingId(step.id)
    try {
      await patchJson(`/admin/approval-workflows/${wid}/steps/${step.id}`, {
        approver_role_ids: ids,
        required_approvals: Math.max(1, Number(required) || 1),
        step_kind: kind || "approve",
        org_scope: orgScope || null,
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
              <Table className="min-w-[56rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Level</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead className="w-52">Kind</TableHead>
                    <TableHead className="w-52">Org scope</TableHead>
                    <TableHead className="w-24">Required</TableHead>
                    {canEditSteps ? <TableHead className="w-36 text-right">Actions</TableHead> : null}
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
                        onSave={(roleIds, req, kind, orgScope) =>
                          void onSaveStep(s, roleIds, req, kind, orgScope)
                        }
                        onDelete={() => void onDeleteStep(s.id)}
                      />
                    ))}
                  {(selectedWf.steps ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={canEditSteps ? 6 : 5}
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
                <div className="min-w-[220px] flex-1 space-y-1.5">
                  <Label>Approver roles</Label>
                  <RoleChipPicker roles={roles} values={newRoleIds} onChange={setNewRoleIds} />
                </div>
                <div className="w-52 shrink-0 space-y-1.5">
                  <Label>Kind</Label>
                  <select
                    className={adminSelectClass}
                    value={newStepKind}
                    onChange={(e) => setNewStepKind(e.target.value)}
                  >
                    {STEP_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-52 shrink-0 space-y-1.5">
                  <Label>Org scope</Label>
                  <select
                    className={adminSelectClass}
                    value={newOrgScope}
                    onChange={(e) => setNewOrgScope(e.target.value)}
                  >
                    {ORG_SCOPES.map((k) => (
                      <option key={k.value || "all"} value={k.value}>
                        {k.label}
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
              <AdminTableLoadingRow colSpan={5} label="Loading workflows" />
            ) : sortedWorkflows.length === 0 ? (
              <AdminTableEmptyRow colSpan={5}>
                No workflows yet. Click Create workflow.
              </AdminTableEmptyRow>
            ) : (
              sortedWorkflows.map((w) => (
                <AdminTableBodyRow key={w.id} interactive={false}>
                  <AdminTableCell className="font-medium">{w.name}</AdminTableCell>
                  <AdminTableCell className="text-sm text-muted-foreground">
                    <span title={w.entity_type}>{entityTypeLabel(w.entity_type)}</span>
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
  onSave: (roleIds: string[], required: string, kind: string, orgScope: string) => void
  onDelete: () => void
}) {
  const [roleIds, setRoleIds] = React.useState(stepRoleIds(step).map(String))
  const [required, setRequired] = React.useState(String(step.required_approvals))
  const [kind, setKind] = React.useState(step.step_kind || "approve")
  const [orgScope, setOrgScope] = React.useState(step.org_scope || "")

  React.useEffect(() => {
    setRoleIds(stepRoleIds(step).map(String))
    setRequired(String(step.required_approvals))
    setKind(step.step_kind || "approve")
    setOrgScope(step.org_scope || "")
  }, [step.id, step.approver_role_id, step.approver_role_ids, step.required_approvals, step.step_kind, step.org_scope])

  if (!canEdit) {
    return (
      <TableRow>
        <TableCell>{step.step_order}</TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {stepRoleIds(step).map((id) => (
              <span
                key={id}
                className="inline-flex h-7 items-center rounded-md border border-border bg-muted/40 px-2 text-xs font-medium"
              >
                {roles.find((r) => r.id === id)?.name ?? `Role #${id}`}
              </span>
            ))}
          </div>
        </TableCell>
        <TableCell className="w-52 whitespace-nowrap">{stepKindLabel(step.step_kind)}</TableCell>
        <TableCell className="w-52 whitespace-nowrap">{orgScopeLabel(step.org_scope)}</TableCell>
        <TableCell>{step.required_approvals}</TableCell>
      </TableRow>
    )
  }

  return (
    <TableRow>
      <TableCell>{step.step_order}</TableCell>
      <TableCell className="min-w-[16rem] align-middle">
        <RoleChipPicker roles={roles} values={roleIds} onChange={setRoleIds} />
      </TableCell>
      <TableCell className="w-52">
        <select
          className={cn(adminSelectClass, "h-9 min-w-52")}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {STEP_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </TableCell>
      <TableCell className="w-52">
        <select
          className={cn(adminSelectClass, "h-9 min-w-52")}
          value={orgScope}
          onChange={(e) => setOrgScope(e.target.value)}
        >
          {ORG_SCOPES.map((k) => (
            <option key={k.value || "all"} value={k.value}>
              {k.label}
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={() => onSave(roleIds, required, kind, orgScope)}
        >
          {saving ? "…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDelete}>
          Delete
        </Button>
      </TableCell>
    </TableRow>
  )
}
