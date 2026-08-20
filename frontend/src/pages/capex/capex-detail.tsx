import * as React from "react"
import { FileText, Link2, Printer, Send } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"


import { AssetActionsMenu } from "@/components/assets/asset-actions-menu"
import { RequiredFieldMark } from "@/components/assets/required-field-mark"
import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPanel,
  AdminPillBadge,
  AdminPrimaryButton,
  AutoGrowTextarea,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, deleteJson, getJson, patchJson, postJson } from "@/lib/api"
import type { AssetActionItem } from "@/lib/asset-actions"
import {
  buildCapexProgress,
  capexCurrentStepKind,
  capexIsFirstApprovalStep,
  capexStatusLabel,
  capexStatusPillTone,
  isCapexEditable,
  type CapexAuditEvent,
  type CapexFormDetail,
  type CapexFormWritePayload,
} from "@/lib/capex-types"
import { hasPermission, persistAuthFromMe } from "@/lib/permissions"
import { cn } from "@/lib/utils"

import { CapexAssigneePickerDialog } from "./capex-assignee-picker-dialog"
import { CapexAuditLog } from "./capex-audit-log"
import { CapexCostCenterSelect } from "./capex-cost-center-select"
import { CapexDecisionDialog } from "./capex-decision-dialog"
import { printCapexForm } from "./capex-print-form"
import { CapexProcessFlow } from "./capex-process-flow"

function FormField({
  id,
  labelText,
  required,
  className,
  children,
}: {
  id?: string
  labelText: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("app-form-field", className)}>
      <Label htmlFor={id} className="app-form-label">
        {labelText}
        {required ? <RequiredFieldMark /> : null}
      </Label>
      {children}
    </div>
  )
}

function detailToForm(d: CapexFormDetail): CapexFormWritePayload {
  return {
    asset_name: d.asset_name,
    equipment_tag_no: d.equipment_tag_no ?? "",
    asset_specifications: d.asset_specifications ?? "",
    party_name: d.party_name ?? "",
    department: d.department ?? "",
    installation_location: d.installation_location ?? "",
    department_head: d.department_head ?? "",
    functioning_comment: d.functioning_comment ?? "",
    installation_date: d.installation_date ?? "",
    auc_code: d.auc_code ?? "",
    useful_life: d.useful_life ?? "",
    requires_engineering: d.requires_engineering,
    cost_center_id: d.cost_center_id,
  }
}

function toPayload(form: CapexFormWritePayload): CapexFormWritePayload {
  const clean = (v: string | null | undefined) => {
    const s = (v ?? "").trim()
    return s || null
  }
  return {
    asset_name: form.asset_name.trim(),
    equipment_tag_no: clean(form.equipment_tag_no),
    asset_specifications: clean(form.asset_specifications),
    party_name: clean(form.party_name),
    department: clean(form.department),
    installation_location: clean(form.installation_location),
    department_head: clean(form.department_head),
    functioning_comment: clean(form.functioning_comment),
    installation_date: clean(form.installation_date),
    auc_code: clean(form.auc_code),
    useful_life: clean(form.useful_life),
    requires_engineering: Boolean(form.requires_engineering),
    cost_center_id: form.cost_center_id ?? null,
  }
}

export function CapexDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const formId = Number(id)
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()
  const [detail, setDetail] = React.useState<CapexFormDetail | null>(null)
  const [form, setForm] = React.useState<CapexFormWritePayload | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [acting, setActing] = React.useState(false)
  const [submitAssignOpen, setSubmitAssignOpen] = React.useState(false)
  const [decisionOpen, setDecisionOpen] = React.useState(false)
  const [decisionMode, setDecisionMode] = React.useState<"approve" | "reject">("approve")
  const [reassignOpen, setReassignOpen] = React.useState(false)
  const [reassigning, setReassigning] = React.useState(false)
  const [auditEvents, setAuditEvents] = React.useState<CapexAuditEvent[] | null>(null)
  const [auditLoading, setAuditLoading] = React.useState(false)

  const loadAudit = React.useCallback(async () => {
    if (!Number.isFinite(formId)) return
    setAuditLoading(true)
    try {
      const rows = await getJson<CapexAuditEvent[]>(
        `/admin/capitalization-forms/${formId}/audit`,
      )
      setAuditEvents(rows)
    } catch {
      setAuditEvents([])
    } finally {
      setAuditLoading(false)
    }
  }, [formId])

  const load = React.useCallback(async () => {
    if (!Number.isFinite(formId)) return
    setLoading(true)
    try {
      try {
        const me = await getJson<{ id: number; is_superuser?: boolean; permissions?: string[] }>("/me")
        persistAuthFromMe(me)
      } catch {
        // ignore
      }
      const d = await getJson<CapexFormDetail>(`/admin/capitalization-forms/${formId}`)
      setDetail(d)
      setForm(detailToForm(d))
      void loadAudit()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to load form")
      navigate("/dashboard/capitalization", { replace: true })
    } finally {
      setLoading(false)
    }
  }, [formId, navigate, loadAudit])

  React.useEffect(() => {
    void load()
  }, [load])

  const editable = detail ? isCapexEditable(detail.status) && hasPermission("capitalization.update") : false
  const canSubmit =
    Boolean(detail && isCapexEditable(detail.status) && hasPermission("capitalization.submit"))
  const canApprovalAct = hasPermission("approval.act")
  const pendingTaskId = detail?.approval_panel?.my_pending_task_id ?? null
  const canActOnForm = Boolean(pendingTaskId && canApprovalAct)
  const needsNextAssignee = Boolean(detail?.approval_panel?.needs_next_assignee)
  const nextAssigneeRoleId = detail?.approval_panel?.next_assignee_role_id ?? null
  const nextStepRoleName = detail?.approval_panel?.next_step_role_name ?? "next approver"
  const stepKind = detail ? capexCurrentStepKind(detail) : "approve"
  const isCloseStep = stepKind === "close"
  const canReassign = Boolean(
    detail?.status === "pending_approval" &&
      detail.approval_panel?.pending_task_id &&
      detail.approval_panel?.current_assignee_role_id &&
      hasPermission("capitalization.reassign") &&
      capexIsFirstApprovalStep(detail),
  )
  const reassignRoleId = detail?.approval_panel?.current_assignee_role_id ?? null
  const reassignRoleName = detail?.approval_panel?.current_step_role_name ?? "Approver"
  // Unsaved edits win: submit patches the form before it submits.
  const pickerCostCenterId = form?.cost_center_id ?? detail?.cost_center_id ?? null
  const costCenterParam = pickerCostCenterId ? `&cost_center_id=${pickerCostCenterId}` : ""

  const toolbarActions = React.useMemo(() => {
    const actions: AssetActionItem[] = [
      {
        id: "print",
        label: "Print form",
        icon: Printer,
      },
    ]
    if (editable) {
      actions.push({
        id: "save",
        label: saving ? "Saving…" : "Save changes",
        icon: FileText,
        disabled: saving,
      })
    }
    if (canSubmit) {
      actions.push({
        id: "submit",
        label: "Submit for approval",
        icon: Send,
      })
    }
    return actions
  }, [editable, saving, canSubmit])

  function handleToolbarAction(actionId: string) {
    if (actionId === "print") {
      if (!detail) return
      void printCapexForm(detail).catch((e) => {
        toast.error(e instanceof Error ? e.message : "Unable to open print dialog.")
      })
      return
    }
    if (actionId === "save") {
      void save()
      return
    }
    if (actionId === "submit") {
      setSubmitAssignOpen(true)
      return
    }
  }

  const patch = (p: Partial<CapexFormWritePayload>) =>
    setForm((f) => (f ? { ...f, ...p } : f))

  async function save() {
    if (!form || !detail) return
    if (!form.asset_name.trim()) {
      toast.error("Asset name is required.")
      return
    }
    setSaving(true)
    try {
      const updated = await patchJson<CapexFormDetail>(
        `/admin/capitalization-forms/${detail.id}`,
        toPayload(form),
      )
      setDetail(updated)
      setForm(detailToForm(updated))
      toast.success("Form updated.")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Update failed.")
    } finally {
      setSaving(false)
    }
  }

  async function submitWithAssignee(userId: number) {
    if (!detail) return
    setSaving(true)
    try {
      if (editable && form) {
        await patchJson<CapexFormDetail>(
          `/admin/capitalization-forms/${detail.id}`,
          toPayload(form),
        )
      }
      const updated = await postJson<CapexFormDetail>(
        `/admin/capitalization-forms/${detail.id}/submit`,
        {
          assignee_user_id: userId,
          requires_engineering: form?.requires_engineering ?? detail.requires_engineering,
        },
      )
      setSubmitAssignOpen(false)
      setDetail(updated)
      setForm(detailToForm(updated))
      toast.success("Form submitted for approval.")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Submit failed.")
    } finally {
      setSaving(false)
    }
  }

  function openDecision(mode: "approve" | "reject") {
    setDecisionMode(mode)
    setDecisionOpen(true)
  }

  async function confirmDecision(payload: {
    comment: string | null
    nextAssignedUserId: number | null
  }) {
    if (!pendingTaskId) return
    setActing(true)
    try {
      await postJson(`/approvals/tasks/${pendingTaskId}/action`, {
        action: decisionMode,
        comment: payload.comment,
        ...(decisionMode === "approve" && payload.nextAssignedUserId != null
          ? { next_assigned_user_id: payload.nextAssignedUserId }
          : {}),
      })
      setDecisionOpen(false)
      toast.success(
        decisionMode === "reject" ? "Rejected." : isCloseStep ? "Closed." : "Approved.",
      )
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed.")
    } finally {
      setActing(false)
    }
  }

  async function reassignApprover(userId: number) {
    if (!detail) return
    setReassigning(true)
    try {
      const updated = await postJson<CapexFormDetail>(
        `/admin/capitalization-forms/${detail.id}/reassign`,
        { assignee_user_id: userId },
      )
      setReassignOpen(false)
      setDetail(updated)
      setForm(detailToForm(updated))
      toast.success("Approver reassigned.")
      await load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Reassign failed.")
    } finally {
      setReassigning(false)
    }
  }

  if (loading || !detail || !form) {
    return (
      <AdminPage
        fullWidth
        dense
        description="Loading capitalization form…"
        actions={<AdminBackLink to="/dashboard/capitalization">Capitalization</AdminBackLink>}
      >
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminPage>
    )
  }

  const readOnly = !editable
  const progress = buildCapexProgress(detail)

  return (
    <AdminPage
      fullWidth
      dense
      description={detail.form_number}
      className="w-full pb-6"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AdminPillBadge
            tone={capexStatusPillTone(detail.status)}
            className="h-9 px-3.5 text-sm font-semibold"
          >
            {capexStatusLabel(detail.status)}
          </AdminPillBadge>
          {detail.can_delete ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-9"
              disabled={saving || acting || reassigning}
              onClick={async () => {
                const ok = await confirmAsk({
                  title: "Delete draft form?",
                  description:
                    "Permanently delete this draft capitalization form? This cannot be undone.",
                  confirmLabel: "Delete",
                  destructive: true,
                })
                if (!ok) return
                setSaving(true)
                try {
                  await deleteJson(`/admin/capitalization-forms/${detail.id}`)
                  toast.success("Draft capitalization form deleted.")
                  navigate("/dashboard/capitalization")
                } catch (e) {
                  toast.error(
                    e instanceof ApiError ? e.message : "Could not delete capitalization form",
                  )
                } finally {
                  setSaving(false)
                }
              }}
            >
              Delete draft
            </Button>
          ) : null}
          {detail.can_archive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={saving || acting || reassigning}
              onClick={async () => {
                const ok = await confirmAsk({
                  title: "Archive capitalization form?",
                  description:
                    "Archive this capitalization form? It will be cancelled and kept in the audit trail.",
                  confirmLabel: "Archive",
                })
                if (!ok) return
                setSaving(true)
                try {
                  setDetail(
                    await postJson(`/admin/capitalization-forms/${detail.id}/archive`, {}),
                  )
                  toast.success("Capitalization form archived.")
                  navigate("/dashboard/capitalization")
                } catch (e) {
                  toast.error(
                    e instanceof ApiError ? e.message : "Could not archive capitalization form",
                  )
                } finally {
                  setSaving(false)
                }
              }}
            >
              Archive
            </Button>
          ) : null}
          {detail.can_unarchive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={saving || acting || reassigning}
              onClick={async () => {
                const ok = await confirmAsk({
                  title: "Unarchive capitalization form?",
                  description:
                    "Restore this capitalization form so you can edit and resubmit it.",
                  confirmLabel: "Unarchive",
                })
                if (!ok) return
                setSaving(true)
                try {
                  setDetail(
                    await postJson(`/admin/capitalization-forms/${detail.id}/unarchive`, {}),
                  )
                  toast.success("Capitalization form unarchived.")
                } catch (e) {
                  toast.error(
                    e instanceof ApiError ? e.message : "Could not unarchive capitalization form",
                  )
                } finally {
                  setSaving(false)
                }
              }}
            >
              Unarchive
            </Button>
          ) : null}
          {canReassign ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={saving || acting || reassigning}
              onClick={() => setReassignOpen(true)}
            >
              Reassign
            </Button>
          ) : null}
          {canActOnForm ? (
            <>
              {!isCloseStep ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  disabled={saving || acting || reassigning}
                  onClick={() => openDecision("reject")}
                >
                  Reject
                </Button>
              ) : null}
              <AdminPrimaryButton
                type="button"
                disabled={saving || acting || reassigning}
                onClick={() => openDecision("approve")}
              >
                {isCloseStep ? "Close" : "Approve"}
              </AdminPrimaryButton>
            </>
          ) : null}
          {toolbarActions.length > 0 ? (
            <AssetActionsMenu
              actions={toolbarActions}
              busy={saving || acting || reassigning}
              onAction={handleToolbarAction}
              className="h-9"
            />
          ) : null}
          <AdminBackLink to="/dashboard/capitalization">Capitalization</AdminBackLink>
        </div>
      }
    >
      <div className="space-y-[var(--app-grid-gap)]">
        <AdminPanel className="shrink-0 overflow-hidden p-0">
          <div className="border-b border-border/60 bg-muted/15 px-4 py-3 sm:px-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-black">
              Progress
            </p>
            <CapexProcessFlow steps={progress.steps} currentStepKey={progress.currentStepKey} />
          </div>
        </AdminPanel>

        <AdminPanel
          title="Asset capitalization details"
          description="Request creation and capitalization of a new asset."
          headerActions={<FileText className="size-4 text-muted-foreground" aria-hidden />}
          contentClassName="px-5 py-5"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField id="asset_name" labelText="Name of the Asset" required={!readOnly}>
              <AutoGrowTextarea
                id="asset_name"
                value={form.asset_name}
                disabled={readOnly}
                minRows={1}
                className="min-h-9"
                onChange={(next) => patch({ asset_name: next })}
              />
            </FormField>
            <FormField id="equipment_tag_no" labelText="User Equipment Tag No.">
              <AutoGrowTextarea
                id="equipment_tag_no"
                value={form.equipment_tag_no ?? ""}
                disabled={readOnly}
                minRows={1}
                className="min-h-9"
                onChange={(next) => patch({ equipment_tag_no: next })}
              />
            </FormField>
            <FormField id="asset_specifications" labelText="Asset Specifications">
              <AutoGrowTextarea
                id="asset_specifications"
                value={form.asset_specifications ?? ""}
                disabled={readOnly}
                minRows={1}
                className="min-h-9"
                onChange={(next) => patch({ asset_specifications: next })}
              />
            </FormField>
            <FormField id="party_name" labelText="Name of the Party">
              <AutoGrowTextarea
                id="party_name"
                value={form.party_name ?? ""}
                disabled={readOnly}
                minRows={1}
                className="min-h-9"
                onChange={(next) => patch({ party_name: next })}
              />
            </FormField>
            <FormField id="department" labelText="Department">
              <AutoGrowTextarea
                id="department"
                value={form.department ?? ""}
                disabled={readOnly}
                minRows={1}
                className="min-h-9"
                onChange={(next) => patch({ department: next })}
              />
            </FormField>
            <FormField id="cost_center_id" labelText="Cost Center">
              <CapexCostCenterSelect
                value={form.cost_center_id}
                disabled={readOnly}
                fallbackLabel={
                  detail.cost_center_code
                    ? `${detail.cost_center_code} — ${detail.cost_center_name ?? ""}`.trim()
                    : null
                }
                onChange={(next) => patch({ cost_center_id: next })}
              />
            </FormField>
            <FormField id="installation_location" labelText="Location of Installation">
              <AutoGrowTextarea
                id="installation_location"
                value={form.installation_location ?? ""}
                disabled={readOnly}
                minRows={1}
                className="min-h-9"
                onChange={(next) => patch({ installation_location: next })}
              />
            </FormField>
            <FormField id="department_head" labelText="Name of the Department Head">
              <AutoGrowTextarea
                id="department_head"
                value={form.department_head ?? ""}
                disabled={readOnly}
                minRows={1}
                className="min-h-9"
                onChange={(next) => patch({ department_head: next })}
              />
            </FormField>
            <FormField id="installation_date" labelText="Date of Installation">
              <Input
                id="installation_date"
                type="date"
                value={form.installation_date ?? ""}
                disabled={readOnly}
                onChange={(e) => patch({ installation_date: e.target.value })}
              />
            </FormField>
            <FormField id="auc_code" labelText="AUC code">
              <AutoGrowTextarea
                id="auc_code"
                value={form.auc_code ?? ""}
                disabled={readOnly}
                minRows={1}
                className="min-h-9 font-mono"
                onChange={(next) => patch({ auc_code: next })}
              />
            </FormField>
            <FormField id="useful_life" labelText="Useful life of Assets">
              <AutoGrowTextarea
                id="useful_life"
                value={form.useful_life ?? ""}
                disabled={readOnly}
                minRows={1}
                className="min-h-9"
                onChange={(next) => patch({ useful_life: next })}
              />
            </FormField>
            {hasPermission("capitalization.submit_with_engineering") || form.requires_engineering ? (
              <FormField id="requires_engineering" labelText="Submit with Engineering">
                <select
                  id="requires_engineering"
                  className={cn(adminSelectClass, "h-9")}
                  value={form.requires_engineering ? "yes" : "no"}
                  disabled={
                    readOnly || !hasPermission("capitalization.submit_with_engineering")
                  }
                  onChange={(e) => patch({ requires_engineering: e.target.value === "yes" })}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </FormField>
            ) : null}
            <FormField
              id="functioning_comment"
              labelText="Comment on the functioning of the Asset"
              className="sm:col-span-2"
            >
              <AutoGrowTextarea
                id="functioning_comment"
                value={form.functioning_comment ?? ""}
                disabled={readOnly}
                minRows={3}
                className="min-h-[80px]"
                onChange={(next) => patch({ functioning_comment: next })}
              />
            </FormField>
          </div>
        </AdminPanel>

        {detail.asset_id ? (
          <AdminPanel
            title="Linked asset"
            description="This form has been used to create an asset."
            headerActions={<Link2 className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="px-5 py-5"
          >
            <p className="text-sm">
              Linked to asset{" "}
              <Link
                className="font-medium text-primary hover:underline"
                to={`/dashboard/assets/${detail.asset_id}`}
              >
                {detail.asset_code ?? `#${detail.asset_id}`}
              </Link>
            </p>
          </AdminPanel>
        ) : null}

        <CapexAuditLog events={auditEvents} loading={auditLoading} />
      </div>

      <CapexAssigneePickerDialog
        open={submitAssignOpen}
        onOpenChange={setSubmitAssignOpen}
        assigneesUrl={`/admin/capitalization-forms/assignees?requires_engineering=${(form?.requires_engineering ?? detail?.requires_engineering) ? "true" : "false"}${costCenterParam}`}
        roleLabel="Approver"
        confirmLabel="Submit"
        busy={saving}
        onConfirm={submitWithAssignee}
      />

      <CapexDecisionDialog
        open={decisionOpen}
        onOpenChange={setDecisionOpen}
        mode={decisionMode}
        busy={acting}
        title={
          decisionMode === "reject" ? "Reject" : isCloseStep ? "Close" : "Approve"
        }
        confirmLabel={
          decisionMode === "reject" ? "Reject" : isCloseStep ? "Close" : "Approve"
        }
        needsNextAssignee={needsNextAssignee}
        nextAssigneeLevel={null}
        nextStepRoleName={nextStepRoleName}
        assigneesUrl={
          nextAssigneeRoleId
            ? `/admin/capitalization-forms/assignees?role_id=${nextAssigneeRoleId}${costCenterParam}`
            : undefined
        }
        onConfirm={confirmDecision}
      />

      <CapexAssigneePickerDialog
        open={reassignOpen}
        onOpenChange={setReassignOpen}
        assigneesUrl={
          reassignRoleId
            ? `/admin/capitalization-forms/assignees?role_id=${reassignRoleId}${costCenterParam}`
            : undefined
        }
        roleLabel={reassignRoleName}
        confirmLabel="Reassign"
        busy={reassigning}
        onConfirm={reassignApprover}
      />
      {confirmDialog}
    </AdminPage>
  )
}
