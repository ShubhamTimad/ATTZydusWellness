import * as React from "react"
import { Package, PackageX } from "lucide-react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { ApprovalWorkflowTimeline } from "@/components/approval-workflow-timeline"
import { RequiredFieldMark } from "@/components/assets/required-field-mark"
import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPanel,
  AdminPillBadge,
  AdminPrimaryButton,
  AdminTableCell,
  AdminTableEmptyRow,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
  adminSwitchRowClass,
  adminTextareaClass,
} from "@/components/layout/admin-ui"
import { AdminTableBodyRow } from "@/components/layout/list-page-ui"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { ApiError, getJson, patchJson, postJson } from "@/lib/api"
import {
  buildDisposalProgress,
  disposalStatusLabel,
  disposalStatusPillTone,
  withDisposalPostApprovalTimelineSteps,
  type DisposalOrderDetail,
} from "@/lib/disposal-types"
import { hasPermission, persistAuthFromMe } from "@/lib/permissions"
import {
  actualLocationLabel,
  costCenterLabel,
  functionalLocationLabel,
  useAssetMasterLookups,
} from "@/lib/use-asset-masters"
import { cn } from "@/lib/utils"
import { CapexAssigneePickerDialog } from "@/pages/capex/capex-assignee-picker-dialog"
import { CapexDecisionDialog } from "@/pages/capex/capex-decision-dialog"
import { CapexProcessFlow } from "@/pages/capex/capex-process-flow"
import { DisposalAuditLog } from "@/pages/disposals/disposal-audit-log"

type PickerMode = "submit" | "receive" | null

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function FormField({
  id,
  labelText,
  required,
  children,
}: {
  id?: string
  labelText: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="app-form-field">
      <Label htmlFor={id} className="app-form-label">
        {labelText}
        {required ? <RequiredFieldMark /> : null}
      </Label>
      {children}
    </div>
  )
}

export function DisposalOrderDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const orderId = Number(id)
  const [order, setOrder] = React.useState<DisposalOrderDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [viewerUserId, setViewerUserId] = React.useState<number | null>(null)
  const [pickerMode, setPickerMode] = React.useState<PickerMode>(null)
  const [decisionOpen, setDecisionOpen] = React.useState(false)
  const [decisionMode, setDecisionMode] = React.useState<"approve" | "reject">("approve")
  const [requiresEngineering, setRequiresEngineering] = React.useState(false)
  const [remarks, setRemarks] = React.useState("")
  const [costCenterId, setCostCenterId] = React.useState("")
  const [functionalLocation, setFunctionalLocation] = React.useState("")
  const [actualLocation, setActualLocation] = React.useState("")

  const masters = useAssetMasterLookups(order?.plant_id ?? null, null, functionalLocation || null)

  const applyOrder = React.useCallback((res: DisposalOrderDetail) => {
    setOrder(res)
    setRequiresEngineering(res.requires_engineering)
    setRemarks(res.remarks ?? "")
  }, [])

  const load = React.useCallback(async () => {
    if (!Number.isFinite(orderId)) return
    setLoading(true)
    try {
      try {
        const me = await getJson<{ id: number; is_superuser?: boolean; permissions?: string[] }>(
          "/me",
        )
        persistAuthFromMe(me)
        setViewerUserId(typeof me.id === "number" ? me.id : null)
      } catch {
        /* keep cached permissions */
      }
      applyOrder(await getJson<DisposalOrderDetail>(`/admin/disposal-orders/${orderId}`))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to load disposal order")
      navigate("/dashboard/disposal-orders", { replace: true })
    } finally {
      setLoading(false)
    }
  }, [orderId, navigate, applyOrder])

  React.useEffect(() => {
    void load()
  }, [load])

  async function run(action: () => Promise<DisposalOrderDetail>, okMessage: string) {
    setBusy(true)
    try {
      applyOrder(await action())
      toast.success(okMessage)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed")
    } finally {
      setBusy(false)
      setPickerMode(null)
    }
  }

  async function confirmDecision(payload: {
    comment: string | null
    nextAssignedUserId: number | null
  }) {
    const taskId = order?.approval_panel?.my_pending_task_id
    if (!taskId) return
    setBusy(true)
    try {
      await postJson(`/approvals/tasks/${taskId}/action`, {
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
      setBusy(false)
    }
  }

  if (loading || !order) {
    return (
      <AdminPage fullWidth dense description="" className="w-full pb-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminPage>
    )
  }

  const panel = order.approval_panel
  const canDecide = Boolean(panel?.my_pending_task_id) && hasPermission("approval.act")
  const canEditEngineering = order.can_edit && hasPermission("disposal.submit_with_engineering")
  const progress = buildDisposalProgress(order)

  return (
    <AdminPage
      fullWidth
      dense
      description=""
      className="w-full pb-6"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AdminPillBadge
            tone={disposalStatusPillTone(order.status)}
            className="h-9 px-3.5 text-sm font-semibold"
          >
            {disposalStatusLabel(order.status)}
          </AdminPillBadge>
          {order.can_edit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    patchJson(`/admin/disposal-orders/${order.id}`, {
                      remarks: remarks.trim() || null,
                      requires_engineering: requiresEngineering,
                    }),
                  "Disposal order saved.",
                )
              }
            >
              {busy ? "Saving…" : "Save changes"}
            </Button>
          ) : null}
          {order.can_edit && order.status === "draft" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm("Archive this draft disposal order and reactivate its assets?")) return
                setBusy(true)
                try {
                  applyOrder(
                    await postJson(`/admin/disposal-orders/${order.id}/archive`, {}),
                  )
                  toast.success("Draft disposal archived. Assets reactivated.")
                  navigate("/dashboard/disposal-orders")
                } catch (e) {
                  toast.error(
                    e instanceof ApiError ? e.message : "Could not archive draft disposal order",
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              Archive draft
            </Button>
          ) : null}
          {order.can_submit ? (
            <AdminPrimaryButton type="button" disabled={busy} onClick={() => setPickerMode("submit")}>
              Submit for approval
            </AdminPrimaryButton>
          ) : null}
          {canDecide ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                disabled={busy}
                onClick={() => {
                  setDecisionMode("reject")
                  setDecisionOpen(true)
                }}
              >
                Reject
              </Button>
              <AdminPrimaryButton
                type="button"
                disabled={busy}
                onClick={() => {
                  setDecisionMode("approve")
                  setDecisionOpen(true)
                }}
              >
                Approve
              </AdminPrimaryButton>
            </>
          ) : null}
          {order.can_receive ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => {
                if (!costCenterId || !functionalLocation.trim() || !actualLocation.trim()) {
                  toast.error("Select cost center, Actual Location 1 and Actual Location 2 first.")
                  return
                }
                setPickerMode("receive")
              }}
            >
              Receive
            </AdminPrimaryButton>
          ) : null}
          {order.can_close ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    postJson(`/admin/disposal-orders/${order.id}/close`, {
                      remarks: remarks.trim() || null,
                    }),
                  "Disposal order approved. Assets marked disposed.",
                )
              }
            >
              Approve
            </AdminPrimaryButton>
          ) : null}
          <AdminBackLink to="/dashboard/disposal-orders">Disposal orders</AdminBackLink>
        </div>
      }
    >
      <div className="space-y-[var(--app-grid-gap)]">
        <div className="shrink-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {order.order_number}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.plant_name}
            {order.from_cost_center_code ? ` · ${order.from_cost_center_code}` : null}
            {order.assigned_to_name
              ? ` · ${order.assigned_to_name}`
              : order.created_by_name
                ? ` · ${order.created_by_name}`
                : null}
          </p>
        </div>

        <AdminPanel className="shrink-0 overflow-hidden p-0">
          <div className="border-b border-border/60 bg-muted/15 px-4 py-3 sm:px-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Progress
            </p>
            <CapexProcessFlow steps={progress.steps} currentStepKey={progress.currentStepKey} />
          </div>
        </AdminPanel>

        {order.rejection_comment ? (
          <AdminPanel
            className="border-destructive/30 bg-destructive/5"
            contentClassName="px-5 py-4"
          >
            <p className="text-sm font-medium text-destructive">Rejection comment</p>
            <p className="mt-1 text-sm">{order.rejection_comment}</p>
          </AdminPanel>
        ) : null}

        <div className="grid gap-[var(--app-grid-gap)] lg:grid-cols-2">
          <AdminPanel
            title="Disposal details"
            description={
              order.can_edit
                ? "Update the approval route and remarks before submitting."
                : "Approval route and notes for this disposal order."
            }
            headerActions={<PackageX className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="px-5 py-5"
          >
            <div className="grid grid-cols-1 gap-4">
              <FormField labelText="From cost center">
                <p className="text-sm">
                  {order.from_cost_center_code ?? "—"}
                  {order.from_cost_center_description
                    ? ` — ${order.from_cost_center_description}`
                    : ""}
                </p>
              </FormField>

              <div className={adminSwitchRowClass}>
                <div className="space-y-1">
                  <Label htmlFor="requires_engineering" className="text-sm font-medium">
                    Engineering Approval
                  </Label>
                  {/* <p className="text-xs text-muted-foreground">
                    Routes the order through the disposal workflow that includes Engineering.
                  </p> */}
                </div>
                <Checkbox
                  id="requires_engineering"
                  checked={requiresEngineering}
                  disabled={!canEditEngineering}
                  onCheckedChange={(v) => setRequiresEngineering(v === true)}
                />
              </div>

              <FormField id="remarks" labelText="Remarks">
                {order.can_edit || order.can_close ? (
                  <textarea
                    id="remarks"
                    className={cn(adminTextareaClass, "min-h-[88px]")}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    rows={3}
                  />
                ) : (
                  <p className="text-sm">{order.remarks || "—"}</p>
                )}
              </FormField>

              {order.assigned_at || order.closed_at ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField labelText="Assigned at">
                    <p className="text-sm">{formatWhen(order.assigned_at)}</p>
                  </FormField>
                  <FormField labelText="Closed at">
                    <p className="text-sm">{formatWhen(order.closed_at)}</p>
                  </FormField>
                </div>
              ) : null}
            </div>
          </AdminPanel>

          <AdminPanel
            title={`Assets (${order.items.length})`}
            description="Assets included on this disposal order."
            headerActions={<Package className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="px-5 py-5"
          >
            <div className="-mx-5 -mb-5 overflow-x-auto">
              <Table>
                <TableHeader>
                  <AdminTableHeaderRow>
                    <AdminTableHeadCell>Asset</AdminTableHeadCell>
                    <AdminTableHeadCell>From CC</AdminTableHeadCell>
                    <AdminTableHeadCell>From Loc 1</AdminTableHeadCell>
                  </AdminTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {order.items.length === 0 ? (
                    <AdminTableEmptyRow colSpan={3}>No assets</AdminTableEmptyRow>
                  ) : (
                    order.items.map((item) => (
                      <AdminTableBodyRow key={item.id} interactive={false}>
                        <AdminTableCell>
                          <div className="font-medium">{item.asset_code}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.asset_name || "—"}
                          </div>
                        </AdminTableCell>
                        <AdminTableCell>{item.from_cost_center_code ?? "—"}</AdminTableCell>
                        <AdminTableCell>{item.from_functional_location ?? "—"}</AdminTableCell>
                      </AdminTableBodyRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </AdminPanel>
        </div>

        {order.can_receive ? (
          <AdminPanel
            title="Receive"
            description="Set the cost center and Actual Location 1 / 2, then choose the Central Finance user who will approve and close this order."
            contentClassName="px-5 py-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField id="scrap_cc" labelText="Cost center" required>
                <select
                  id="scrap_cc"
                  className={adminSelectClass}
                  value={costCenterId}
                  onChange={(e) => setCostCenterId(e.target.value)}
                >
                  <option value="">Select cost center</option>
                  {masters.costCenters.map((cc) => (
                    <option key={cc.id} value={String(cc.id)}>
                      {costCenterLabel(cc)}
                      {cc.code ? ` (${cc.code})` : ""}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="scrap_loc1" labelText="Actual Location 1" required>
                <select
                  id="scrap_loc1"
                  className={adminSelectClass}
                  value={functionalLocation}
                  onChange={(e) => {
                    setFunctionalLocation(e.target.value)
                    setActualLocation("")
                  }}
                >
                  <option value="">Select location</option>
                  {masters.functionalLocations.map((l) => (
                    <option key={l.id} value={l.code}>
                      {functionalLocationLabel(l)}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="scrap_loc2" labelText="Actual Location 2" required>
                <select
                  id="scrap_loc2"
                  className={adminSelectClass}
                  value={actualLocation}
                  disabled={!functionalLocation}
                  onChange={(e) => setActualLocation(e.target.value)}
                >
                  <option value="">
                    {functionalLocation ? "Select location" : "Select Actual Location 1 first"}
                  </option>
                  {masters.actualLocations.map((l) => (
                    <option key={l.id} value={l.code}>
                      {actualLocationLabel(l)}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          </AdminPanel>
        ) : null}

        {panel && (panel.workflow_runs?.length ?? 0) > 0 ? (
          <ApprovalWorkflowTimeline
            steps={withDisposalPostApprovalTimelineSteps(panel.workflow_steps, order)}
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
              const steps = run.is_current
                ? withDisposalPostApprovalTimelineSteps(run.workflow_steps, order)
                : withDisposalPostApprovalTimelineSteps(run.workflow_steps, {
                    ...order,
                    // Prior attempts never reached post-approval execution.
                    status:
                      order.status === "rejected" || order.status === "in_rework"
                        ? order.status
                        : "pending_approval",
                  })
              return { label, steps }
            })}
          />
        ) : panel && panel.workflow_steps.length > 0 ? (
          <ApprovalWorkflowTimeline
            steps={withDisposalPostApprovalTimelineSteps(panel.workflow_steps, order)}
            viewerUserId={viewerUserId}
            formatWhen={formatWhen}
            compact
          />
        ) : null}

        <DisposalAuditLog events={order.audit} />
      </div>

      <CapexAssigneePickerDialog
        open={pickerMode != null}
        onOpenChange={(open) => {
          if (!open) setPickerMode(null)
        }}
        assigneesUrl={
          pickerMode === "receive"
            ? "/admin/disposal-orders/assignees?level=central_finance"
            : `/admin/disposal-orders/assignees?requires_engineering=${requiresEngineering ? "true" : "false"}`
        }
        roleLabel={pickerMode === "receive" ? "Central Finance" : "Approver"}
        confirmLabel={pickerMode === "receive" ? "Receive & assign CF" : "Submit"}
        busy={busy}
        onConfirm={async (userId) => {
          if (pickerMode === "receive") {
            await run(
              () =>
                postJson(`/admin/disposal-orders/${order.id}/receive`, {
                  assigned_to: userId,
                  cost_center_id: Number(costCenterId),
                  functional_location: functionalLocation.trim(),
                  actual_location: actualLocation.trim(),
                  remarks: remarks.trim() || null,
                }),
              "Assets received. Assigned to Central Finance for final approval.",
            )
            return
          }
          await run(
            () =>
              postJson(`/admin/disposal-orders/${order.id}/submit`, {
                assignee_user_id: userId,
                requires_engineering: requiresEngineering,
              }),
            "Disposal order submitted for approval.",
          )
        }}
      />

      <CapexDecisionDialog
        open={decisionOpen}
        onOpenChange={setDecisionOpen}
        mode={decisionMode}
        busy={busy}
        needsNextAssignee={Boolean(panel?.needs_next_assignee)}
        nextAssigneeLevel={panel?.next_assignee_level ?? null}
        nextStepRoleName={panel?.next_step_role_name ?? null}
        assigneesUrl={
          panel?.next_assignee_level
            ? `/admin/disposal-orders/assignees?level=${encodeURIComponent(panel.next_assignee_level)}`
            : undefined
        }
        onConfirm={confirmDecision}
      />
    </AdminPage>
  )
}
