import * as React from "react"
import { FileText } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { RequiredFieldMark } from "@/components/assets/required-field-mark"
import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPanel,
  AdminPrimaryButton,
  AutoGrowTextarea,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, postJson } from "@/lib/api"
import type { CapexFormDetail, CapexFormWritePayload } from "@/lib/capex-types"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

import { CapexAssigneePickerDialog } from "./capex-assignee-picker-dialog"
import { CapexCostCenterSelect } from "./capex-cost-center-select"

const EMPTY: CapexFormWritePayload = {
  asset_name: "",
  equipment_tag_no: "",
  asset_specifications: "",
  party_name: "",
  department: "",
  installation_location: "",
  department_head: "",
  functioning_comment: "",
  installation_date: "",
  auc_code: "",
  useful_life: "",
  requires_engineering: false,
  cost_center_id: null,
}

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

export function CapexCreatePage() {
  const navigate = useNavigate()
  const [form, setForm] = React.useState<CapexFormWritePayload>(EMPTY)
  const [saving, setSaving] = React.useState(false)
  const [assignOpen, setAssignOpen] = React.useState(false)
  const canSubmit = hasPermission("capitalization.submit")
  const canSubmitWithEngineering = hasPermission("capitalization.submit_with_engineering")

  React.useEffect(() => {
    if (!hasPermission("capitalization.create")) {
      navigate("/dashboard/capitalization", { replace: true })
    }
  }, [navigate])

  const patch = (p: Partial<CapexFormWritePayload>) => setForm((f) => ({ ...f, ...p }))

  async function saveDraft() {
    if (!form.asset_name.trim()) {
      toast.error("Asset name is required.")
      return
    }
    setSaving(true)
    try {
      const payload = toPayload(form)
      if (!canSubmitWithEngineering) payload.requires_engineering = false
      const created = await postJson<CapexFormDetail>("/admin/capitalization-forms", {
        ...payload,
        submit: false,
      })
      toast.success("Draft saved.")
      navigate(`/dashboard/capitalization/${created.id}`, { replace: true })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Save failed.")
    } finally {
      setSaving(false)
    }
  }

  function requestSubmit() {
    if (!form.asset_name.trim()) {
      toast.error("Asset name is required.")
      return
    }
    if (!canSubmit) {
      toast.error("You do not have permission to submit.")
      return
    }
    if (form.requires_engineering && !canSubmitWithEngineering) {
      toast.error("You do not have permission to submit with engineering approval.")
      return
    }
    setAssignOpen(true)
  }

  async function submitWithAssignee(userId: number) {
    setSaving(true)
    try {
      const payload = toPayload(form)
      if (!canSubmitWithEngineering) payload.requires_engineering = false
      const created = await postJson<CapexFormDetail>("/admin/capitalization-forms", {
        ...payload,
        submit: true,
        assignee_user_id: userId,
      })
      setAssignOpen(false)
      toast.success(
        payload.requires_engineering
          ? "Form submitted with engineering approval."
          : "Form submitted for approval.",
      )
      navigate(`/dashboard/capitalization/${created.id}`, { replace: true })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Submit failed.")
    } finally {
      setSaving(false)
    }
  }

  if (!hasPermission("capitalization.create")) {
    return null
  }

  return (
    <AdminPage
      fullWidth
      dense
      // description="Fill asset details and submit for approval."
      className="w-full pb-6"
      actions={<AdminBackLink to="/dashboard/capitalization">Capitalization</AdminBackLink>}
    >
      <form
        className="space-y-[var(--app-grid-gap)]"
        onSubmit={(e) => {
          e.preventDefault()
          requestSubmit()
        }}
      >
        <AdminPanel
          title="Asset Capitalization Detail"
          // description="Request creation and capitalization of a new asset."
          headerActions={<FileText className="size-4 text-muted-foreground" aria-hidden />}
          contentClassName="px-5 py-5"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField id="asset_name" labelText="Asset Name" required>
              <AutoGrowTextarea
                id="asset_name"
                value={form.asset_name}
                minRows={1}
                className="min-h-9"
                onChange={(next) => patch({ asset_name: next })}
                autoFocus
              />
            </FormField>
            <FormField id="equipment_tag_no" labelText="User Equipment Tag No.">
              <AutoGrowTextarea
                id="equipment_tag_no"
                value={form.equipment_tag_no ?? ""}
                minRows={1}
                className="min-h-9"
                onChange={(next) => patch({ equipment_tag_no: next })}
              />
            </FormField>
            <FormField id="asset_specifications" labelText="Asset Specifications">
              <AutoGrowTextarea
                id="asset_specifications"
                value={form.asset_specifications ?? ""}
                minRows={1}
                className="min-h-9"
                onChange={(next) => patch({ asset_specifications: next })}
              />
            </FormField>
            <FormField id="party_name" labelText="Party Name">
              <AutoGrowTextarea
                id="party_name"
                value={form.party_name ?? ""}
                minRows={1}
                className="min-h-9"
                onChange={(next) => patch({ party_name: next })}
              />
            </FormField>
            <FormField id="department" labelText="Department">
              <AutoGrowTextarea
                id="department"
                value={form.department ?? ""}
                minRows={1}
                className="min-h-9"
                onChange={(next) => patch({ department: next })}
              />
            </FormField>
            <FormField id="cost_center_id" labelText="Cost Center">
              <CapexCostCenterSelect
                value={form.cost_center_id}
                onChange={(next) => patch({ cost_center_id: next })}
              />
            </FormField>
            <FormField id="installation_location" labelText="Location of Installation">
              <AutoGrowTextarea
                id="installation_location"
                value={form.installation_location ?? ""}
                minRows={1}
                className="min-h-9"
                onChange={(next) => patch({ installation_location: next })}
              />
            </FormField>
            <FormField id="department_head" labelText="Department Head Name">
              <AutoGrowTextarea
                id="department_head"
                value={form.department_head ?? ""}
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
                onChange={(e) => patch({ installation_date: e.target.value })}
              />
            </FormField>
            <FormField id="auc_code" labelText="AUC Code">
              <AutoGrowTextarea
                id="auc_code"
                value={form.auc_code ?? ""}
                minRows={1}
                className="min-h-9 font-mono"
                onChange={(next) => patch({ auc_code: next })}
              />
            </FormField>
            <FormField id="useful_life" labelText="Useful Life of Asset">
              <AutoGrowTextarea
                id="useful_life"
                value={form.useful_life ?? ""}
                minRows={1}
                className="min-h-9"
                onChange={(next) => patch({ useful_life: next })}
                placeholder="e.g. 5 Years"
              />
            </FormField>
            {canSubmitWithEngineering ? (
              <FormField id="requires_engineering" labelText="Submit with Engineering">
                <select
                  id="requires_engineering"
                  className={cn(adminSelectClass, "h-9")}
                  value={form.requires_engineering ? "yes" : "no"}
                  onChange={(e) => patch({ requires_engineering: e.target.value === "yes" })}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </FormField>
            ) : null}
            <FormField
              id="functioning_comment"
              labelText="Comment on the Functioning of the Asset"
              className="sm:col-span-2"
            >
              <AutoGrowTextarea
                id="functioning_comment"
                value={form.functioning_comment ?? ""}
                minRows={3}
                className="min-h-[80px]"
                onChange={(next) => patch({ functioning_comment: next })}
              />
            </FormField>
          </div>
        </AdminPanel>

        <div className="flex justify-end gap-2 border-t border-border/60 pt-4">
          <Button
            type="button"
            variant="outline"
            className="h-9 shadow-sm"
            disabled={saving}
            onClick={() => navigate("/dashboard/capitalization")}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 shadow-sm"
            disabled={saving}
            onClick={() => void saveDraft()}
          >
            {saving ? "Saving…" : "Save Draft"}
          </Button>
          {canSubmit ? (
            <AdminPrimaryButton type="submit" disabled={saving}>
              {form.requires_engineering && canSubmitWithEngineering
                ? "Submit with Engineering Approval"
                : "Submit for Approval"}
            </AdminPrimaryButton>
          ) : null}
        </div>
      </form>

      <CapexAssigneePickerDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        assigneesUrl={`/admin/capitalization-forms/assignees?requires_engineering=${form.requires_engineering ? "true" : "false"}${form.cost_center_id ? `&cost_center_id=${form.cost_center_id}` : ""}`}
        roleLabel="Approver"
        confirmLabel="Submit"
        busy={saving}
        onConfirm={submitWithAssignee}
      />
    </AdminPage>
  )
}
