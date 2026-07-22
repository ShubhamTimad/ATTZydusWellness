import * as React from "react"
import { FileText, Link2, Printer } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { ApprovalWorkflowTimeline } from "@/components/approval-workflow-timeline"
import { RequiredFieldMark } from "@/components/assets/required-field-mark"
import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPanel,
  AdminPillBadge,
  AdminPrimaryButton,
  adminSwitchRowClass,
  adminTextareaClass,
} from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, getJson, patchJson, postJson } from "@/lib/api"
import {
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
import { CapexDecisionDialog } from "./capex-decision-dialog"
import { CapexPrintPreviewDialog } from "./capex-print-form"

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
  }
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

export function CapexDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const formId = Number(id)
  const [detail, setDetail] = React.useState<CapexFormDetail | null>(null)
  const [form, setForm] = React.useState<CapexFormWritePayload | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [acting, setActing] = React.useState(false)
  const [viewerUserId, setViewerUserId] = React.useState<number | null>(null)
  const [submitAssignOpen, setSubmitAssignOpen] = React.useState(false)
  const [decisionOpen, setDecisionOpen] = React.useState(false)
  const [decisionMode, setDecisionMode] = React.useState<"approve" | "reject">("approve")
  const [reassignOpen, setReassignOpen] = React.useState(false)
  const [reassigning, setReassigning] = React.useState(false)
  const [auditEvents, setAuditEvents] = React.useState<CapexAuditEvent[] | null>(null)
  const [auditLoading, setAuditLoading] = React.useState(false)
  const [printOpen, setPrintOpen] = React.useState(false)

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
        setViewerUserId(typeof me.id === "number" ? me.id : null)
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
  const nextAssigneeLevel = detail?.approval_panel?.next_assignee_level ?? "central_finance"
  const nextStepRoleName = detail?.approval_panel?.next_step_role_name ?? "next approver"
  const canReassign = Boolean(
    detail?.status === "pending_approval" &&
      detail.approval_panel?.pending_task_id &&
      detail.approval_panel?.current_assignee_level &&
      hasPermission("capitalization.reassign"),
  )
  const reassignLevel = detail?.approval_panel?.current_assignee_level ?? "hod"
  const reassignRoleName = detail?.approval_panel?.current_step_role_name ?? "Approver"

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
      toast.success(decisionMode === "approve" ? "Approved." : "Rejected.")
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
        description="Loading capitalization form…"
        actions={<AdminBackLink to="/dashboard/capitalization">Capitalization</AdminBackLink>}
      >
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminPage>
    )
  }

  const readOnly = !editable
  const panel = detail.approval_panel

  return (
    <AdminPage
      description={detail.form_number}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AdminPillBadge tone={capexStatusPillTone(detail.status)}>
            {capexStatusLabel(detail.status)}
          </AdminPillBadge>
          <Button
            type="button"
            variant="outline"
            className="h-9 shadow-sm"
            disabled={saving || acting || reassigning}
            onClick={() => setPrintOpen(true)}
          >
            <Printer className="mr-1.5 size-4" aria-hidden />
            Print form
          </Button>
          {canReassign ? (
            <Button
              type="button"
              variant="outline"
              className="h-9 shadow-sm"
              disabled={reassigning || acting || saving}
              onClick={() => setReassignOpen(true)}
            >
              Reassign
            </Button>
          ) : null}
          {editable ? (
            <Button
              type="button"
              variant="outline"
              className="h-9 shadow-sm"
              disabled={saving || acting}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          ) : null}
          {canSubmit ? (
            <AdminPrimaryButton
              type="button"
              disabled={saving || acting}
              onClick={() => setSubmitAssignOpen(true)}
            >
              Submit for approval
            </AdminPrimaryButton>
          ) : null}
          {canActOnForm ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="h-9 shadow-sm"
                disabled={acting}
                onClick={() => openDecision("reject")}
              >
                Reject
              </Button>
              <AdminPrimaryButton type="button" disabled={acting} onClick={() => openDecision("approve")}>
                Approve
              </AdminPrimaryButton>
            </>
          ) : null}
          <AdminBackLink to="/dashboard/capitalization">Capitalization</AdminBackLink>
        </div>
      }
    >
      <div className="space-y-[var(--app-grid-gap)]">
        <AdminPanel
          title="Asset capitalization details"
          description="Request creation and capitalization of a new asset."
          headerActions={<FileText className="size-4 text-muted-foreground" aria-hidden />}
          contentClassName="px-5 py-5"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField id="asset_name" labelText="Name of the Asset" required={!readOnly}>
              <Input
                id="asset_name"
                value={form.asset_name}
                disabled={readOnly}
                onChange={(e) => patch({ asset_name: e.target.value })}
              />
            </FormField>
            <FormField id="equipment_tag_no" labelText="User Equipment Tag No.">
              <Input
                id="equipment_tag_no"
                value={form.equipment_tag_no ?? ""}
                disabled={readOnly}
                onChange={(e) => patch({ equipment_tag_no: e.target.value })}
              />
            </FormField>
            <FormField id="asset_specifications" labelText="Asset Specifications">
              <Input
                id="asset_specifications"
                value={form.asset_specifications ?? ""}
                disabled={readOnly}
                onChange={(e) => patch({ asset_specifications: e.target.value })}
              />
            </FormField>
            <FormField id="party_name" labelText="Name of the party">
              <Input
                id="party_name"
                value={form.party_name ?? ""}
                disabled={readOnly}
                onChange={(e) => patch({ party_name: e.target.value })}
              />
            </FormField>
            <FormField id="department" labelText="Department">
              <Input
                id="department"
                value={form.department ?? ""}
                disabled={readOnly}
                onChange={(e) => patch({ department: e.target.value })}
              />
            </FormField>
            <FormField id="installation_location" labelText="Location of Installation">
              <Input
                id="installation_location"
                value={form.installation_location ?? ""}
                disabled={readOnly}
                onChange={(e) => patch({ installation_location: e.target.value })}
              />
            </FormField>
            <FormField id="department_head" labelText="Name of the Department Head">
              <Input
                id="department_head"
                value={form.department_head ?? ""}
                disabled={readOnly}
                onChange={(e) => patch({ department_head: e.target.value })}
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
              <Input
                id="auc_code"
                value={form.auc_code ?? ""}
                disabled={readOnly}
                onChange={(e) => patch({ auc_code: e.target.value })}
                className="font-mono"
              />
            </FormField>
            <FormField id="useful_life" labelText="Useful life of assets">
              <Input
                id="useful_life"
                value={form.useful_life ?? ""}
                disabled={readOnly}
                onChange={(e) => patch({ useful_life: e.target.value })}
              />
            </FormField>
            <FormField
              id="functioning_comment"
              labelText="Comment on the functioning of the Asset"
              className="sm:col-span-2"
            >
              <textarea
                id="functioning_comment"
                className={cn(adminTextareaClass, "min-h-[80px]")}
                value={form.functioning_comment ?? ""}
                disabled={readOnly}
                onChange={(e) => patch({ functioning_comment: e.target.value })}
                rows={3}
              />
            </FormField>
            <div className={cn(adminSwitchRowClass, "sm:col-span-2")}>
              <div className="space-y-1">
                <Label htmlFor="requires_engineering" className="text-sm font-medium">
                  Engineering department review required
                </Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, Engineering must approve after HOD before Central Finance.
                </p>
              </div>
              <Checkbox
                id="requires_engineering"
                checked={form.requires_engineering}
                disabled={readOnly}
                onCheckedChange={(v) => patch({ requires_engineering: v === true })}
              />
            </div>
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

        {panel && (panel.workflow_runs?.length ?? 0) > 0 ? (
          <ApprovalWorkflowTimeline
            steps={panel.workflow_steps}
            viewerUserId={viewerUserId}
            formatWhen={formatWhen}
            compact
            compactRuns={panel.workflow_runs!.map((run) => {
              const statusLabel =
                run.request_status === "rejected" || run.request_status === "in_rework"
                  ? "Rejected"
                  : run.request_status === "pending"
                    ? "In progress"
                    : run.request_status === "approved"
                      ? "Approved"
                      : run.request_status
              const label =
                (panel.workflow_runs?.length ?? 0) > 1
                  ? `Attempt ${run.attempt}${run.is_current ? " (current)" : ""} · ${statusLabel}`
                  : undefined
              return { label, steps: run.workflow_steps }
            })}
          />
        ) : panel && panel.workflow_steps.length > 0 ? (
          <ApprovalWorkflowTimeline
            steps={panel.workflow_steps}
            viewerUserId={viewerUserId}
            formatWhen={formatWhen}
            compact
          />
        ) : null}

        <CapexAuditLog events={auditEvents} loading={auditLoading} />
      </div>

      <CapexAssigneePickerDialog
        open={submitAssignOpen}
        onOpenChange={setSubmitAssignOpen}
        level="hod"
        roleLabel="Department HOD"
        confirmLabel="Submit"
        busy={saving}
        onConfirm={submitWithAssignee}
      />

      <CapexDecisionDialog
        open={decisionOpen}
        onOpenChange={setDecisionOpen}
        mode={decisionMode}
        busy={acting}
        needsNextAssignee={needsNextAssignee}
        nextAssigneeLevel={nextAssigneeLevel}
        nextStepRoleName={nextStepRoleName}
        onConfirm={confirmDecision}
      />

      <CapexAssigneePickerDialog
        open={reassignOpen}
        onOpenChange={setReassignOpen}
        level={reassignLevel}
        roleLabel={reassignRoleName}
        confirmLabel="Reassign"
        busy={reassigning}
        onConfirm={reassignApprover}
      />

      <CapexPrintPreviewDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        detail={detail}
      />
    </AdminPage>
  )
}
