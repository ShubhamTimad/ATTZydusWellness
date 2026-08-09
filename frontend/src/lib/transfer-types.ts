import type {
  CapexApprovalPanel,
  CapexAssigneeListResponse,
  CapexAssigneeOption,
} from "@/lib/capex-types"

/** Transfer approval panel/assignee payloads match CapEx/disposal. */
export type TransferApprovalPanel = CapexApprovalPanel
export type TransferAssigneeOption = CapexAssigneeOption
export type TransferAssigneeListResponse = CapexAssigneeListResponse

export type TransferOrderStatus =
  | "draft"
  | "pending_approval"
  | "assigned_to_cf"
  | "rejected"
  | "in_rework"
  | "approved_by_cf"
  | "received_by_cc2"
  | "confirmed_by_cf"
  | "closed"
  | "cancelled"

/** Plant cost centers for transfer destination (not scoped to the viewer's CCs). */
export type TransferDestinationCostCenter = {
  id: number
  code: string
  name: string
  description: string
  plant_id: number
  is_active: boolean
}

export type TransferOrderListItem = {
  id: number
  order_number: string
  plant_name: string
  from_cost_center_code: string | null
  to_cost_center_code: string
  asset_count: number
  status: string
  assigned_to_name: string | null
  created_by_name: string | null
  created_at: string
  can_delete?: boolean
  can_archive?: boolean
  needs_my_action?: boolean
  my_action_label?: string | null
}

export type TransferOrderListResponse = {
  items: TransferOrderListItem[]
  total: number
  page: number
  page_size: number
  tab_counts?: Record<string, number>
}

export type TransferOrderItem = {
  id: number
  asset_id: number
  asset_code: string
  asset_name: string
  from_cost_center_code: string | null
  from_functional_location: string | null
  from_actual_location: string | null
}

export type TransferOrderAudit = {
  id: number
  action: string
  actor_name: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  created_at: string
}

export type TransferOrderDetail = {
  id: number
  order_number: string
  plant_id: number
  plant_name: string
  from_cost_center_id: number | null
  from_cost_center_code: string | null
  from_cost_center_description: string | null
  to_cost_center_id: number
  to_cost_center_code: string
  to_cost_center_description: string | null
  to_asset_custodian_id: number | null
  to_asset_custodian_name: string | null
  to_functional_location: string | null
  to_actual_location: string | null
  status: string
  remarks: string | null
  rejection_reason: string | null
  approval_request_id: number | null
  created_by: number | null
  created_by_name: string | null
  assigned_to: number | null
  assigned_to_name: string | null
  assigned_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
  items: TransferOrderItem[]
  audit: TransferOrderAudit[]
  approval_panel: TransferApprovalPanel | null
  can_submit: boolean
  can_cf_decide: boolean
  can_cf_reject: boolean
  can_cc2_assign: boolean
  can_cf_confirm: boolean
  can_cf_close: boolean
  can_edit: boolean
  can_resume?: boolean
  can_delete: boolean
  can_archive: boolean
  can_restart_transfer: boolean
}

export const TRANSFER_STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "needs_action", label: "Needs my action" },
] as const

/** Lifecycle status filter for the transfer list Status column (not inbox tabs). */
export const TRANSFER_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "approved_by_cf", label: "Approved — pending receive" },
  { value: "received_by_cc2", label: "Received" },
  { value: "confirmed_by_cf", label: "Confirmed by CF" },
  { value: "closed", label: "Closed" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
]

export function transferTabEmptyMessage(tab: string): string {
  if (tab === "needs_action") return "Nothing waiting on you right now."
  return "No transfer orders."
}
export function transferStatusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: "Draft",
    pending_approval: "Pending approval",
    assigned_to_cf: "Pending approval",
    rejected: "Rejected",
    in_rework: "Rejected", // legacy; normalized to rejected
    approved_by_cf: "Approved — pending receive",
    received_by_cc2: "Received",
    confirmed_by_cf: "Confirmed by CF",
    closed: "Closed",
    cancelled: "Cancelled",
  }
  return map[status] ?? status.replaceAll("_", " ")
}

export function transferStatusPillTone(
  status: string,
): "neutral" | "primary" | "success" | "warning" | "danger" {
  if (status === "closed") return "success"
  if (status === "rejected" || status === "in_rework" || status === "cancelled") return "danger"
  if (status === "draft") return "neutral"
  if (
    status === "pending_approval" ||
    status === "assigned_to_cf" ||
    status === "approved_by_cf" ||
    status === "received_by_cc2"
  ) {
    return "warning"
  }
  if (status === "confirmed_by_cf") return "primary"
  return "neutral"
}

export type TransferProgressStep = {
  key: string
  label: string
  status: string
  detail?: string | null
  approver_slots: []
}

function stepKindOf(s: { step_kind?: string }): string {
  return (s.step_kind || "approve").toLowerCase()
}

function progressLabelForStep(s: {
  step_kind?: string
  approver_role_name: string
  phase: string
}): string {
  const role = shortTransferRoleLabel(s.approver_role_name)
  if (s.phase === "rejected") return role
  if (s.phase === "completed") return `Approved by ${role}`
  return role
}

/**
 * Transfer process path: Draft → all workflow steps (approve/receive/confirm/close).
 * Labels come from step_kind + role names when the panel has workflow steps.
 */
export function buildTransferProgress(detail: TransferOrderDetail): {
  steps: TransferProgressStep[]
  currentStepKey: string
} {
  const status = detail.status
  const isRejected = status === "rejected" || status === "in_rework"
  const workflowSteps = currentTransferWorkflowSteps(detail)
  const hasKinds = workflowSteps.some((s) => stepKindOf(s) !== "approve")
  const currentApproval =
    workflowSteps.find((s) => s.phase === "current") ??
    (status === "pending_approval" ||
    status === "assigned_to_cf" ||
    status === "approved_by_cf" ||
    status === "received_by_cc2" ||
    status === "confirmed_by_cf"
      ? workflowSteps.find((s) => s.phase === "upcoming")
      : undefined)
  const rejectAtOrder = workflowSteps.find((s) => s.phase === "rejected")?.step_order

  const steps: TransferProgressStep[] = [
    {
      key: "draft",
      label: "Draft",
      status: status === "draft" ? "active" : "completed",
      approver_slots: [],
    },
  ]

  // When workflow includes receive/confirm/close kinds, drive the whole path from steps.
  if (hasKinds || detail.approval_request_id != null) {
    let insertedRejected = false
    let currentStepKey = "draft"
    if (status === "draft") currentStepKey = "draft"
    else if (status === "closed") currentStepKey = "closed"
    else if (isRejected) currentStepKey = "rejected"

    // CF reject returned to receiver: show rejector as done (X), active on receive again.
    const bounceRun = transferReturnedToReceiver(detail) ? transferBounceRejectRun(detail) : null
    const bounceSteps = bounceRun?.workflow_steps
    const bounceReject = bounceSteps?.find((s) => s.phase === "rejected")
    if (bounceSteps && bounceReject) {
      currentStepKey = "approved_by_cf"
      for (const s of bounceSteps) {
        if (Number(s.step_order) > Number(bounceReject.step_order)) continue
        const kind = stepKindOf(s)
        const key =
          kind === "close"
            ? "closed"
            : kind === "receive"
              ? "approved_by_cf"
              : kind === "confirm"
                ? "received_by_cc2"
                : `approved_by_${s.step_order}`
        const isReceive = kind === "receive"
        const isRejectStep = Number(s.step_order) === Number(bounceReject.step_order)
        const stepStatus = isReceive ? "active" : isRejectStep ? "rejected" : "completed"
        const role = shortTransferRoleLabel(s.approver_role_name)
        steps.push({
          key,
          label: isRejectStep
            ? `Rejected — ${role}`
            : isReceive
              ? role
              : progressLabelForStep({ ...s, phase: "completed" }),
          status: stepStatus,
          detail: s.assigned_user_name ?? null,
          approver_slots: [],
        })
      }
      return { steps, currentStepKey }
    }

    for (const s of workflowSteps) {
      const kind = stepKindOf(s)
      const key =
        kind === "close"
          ? "closed"
          : kind === "receive"
            ? "approved_by_cf"
            : kind === "confirm"
              ? "received_by_cc2"
              : `approved_by_${s.step_order}`

      if (isRejected) {
        if (s.phase === "upcoming") continue
        if (s.phase === "completed") {
          steps.push({
            key,
            label: progressLabelForStep({ ...s, phase: "completed" }),
            status: "completed",
            detail: s.assigned_user_name ?? null,
            approver_slots: [],
          })
          continue
        }
        if (s.phase === "rejected" || (rejectAtOrder != null && s.step_order === rejectAtOrder)) {
          if (!insertedRejected) {
            steps.push({
              key: "rejected",
              label: "Rejected",
              status: "rejected",
              approver_slots: [],
            })
            insertedRejected = true
          }
        }
        continue
      }

      let stepStatus: string = "upcoming"
      if (s.phase === "rejected") stepStatus = "rejected"
      else if (s.phase === "completed" || status === "closed") stepStatus = "completed"
      else if (s.phase === "current") {
        stepStatus = "active"
        currentStepKey = key
      } else if (
        currentApproval != null &&
        Number(s.step_order) === Number(currentApproval.step_order)
      ) {
        stepStatus = "active"
        currentStepKey = key
      }

      // Status-based fallback when phases lag (e.g. request still pending on receive).
      if (stepStatus === "upcoming") {
        if (kind === "receive" && status === "approved_by_cf") {
          stepStatus = "active"
          currentStepKey = key
        } else if (kind === "confirm" && status === "received_by_cc2") {
          stepStatus = "active"
          currentStepKey = key
        } else if (kind === "close" && status === "confirmed_by_cf") {
          stepStatus = "active"
          currentStepKey = key
        } else if (
          kind === "receive" &&
          (status === "received_by_cc2" || status === "confirmed_by_cf" || status === "closed")
        ) {
          stepStatus = "completed"
        } else if (
          kind === "confirm" &&
          (status === "confirmed_by_cf" || status === "closed")
        ) {
          stepStatus = "completed"
        } else if (kind === "close" && status === "closed") {
          stepStatus = "completed"
        }
      }

      steps.push({
        key,
        label: progressLabelForStep({
          ...s,
          phase:
            stepStatus === "completed"
              ? "completed"
              : stepStatus === "rejected"
                ? "rejected"
                : s.phase,
        }),
        status: stepStatus,
        detail: s.assigned_user_name ?? null,
        approver_slots: [],
      })
      if (stepStatus === "rejected") {
        const last = steps[steps.length - 1]!
        if (!last.label.startsWith("Rejected")) {
          last.label = `Rejected — ${last.label}`
        }
      }
    }

    if (isRejected && !insertedRejected) {
      steps.push({
        key: "rejected",
        label: "Rejected",
        status: "rejected",
        approver_slots: [],
      })
    }

    return { steps, currentStepKey }
  }

  // Legacy fallback: approve-only workflow + hard-coded post-approval phases.
  let insertedRejected = false
  for (const s of workflowSteps) {
    const role = shortTransferRoleLabel(s.approver_role_name)
    const key = `approved_by_${s.step_order}`
    const postApproval =
      status === "approved_by_cf" ||
      status === "received_by_cc2" ||
      status === "confirmed_by_cf" ||
      status === "closed"
    const isCurrentRole =
      !postApproval &&
      !isRejected &&
      currentApproval != null &&
      Number(s.step_order) === Number(currentApproval.step_order)

    if (postApproval || s.phase === "completed") {
      steps.push({
        key,
        label: `Approved by ${role}`,
        status: "completed",
        detail: s.assigned_user_name ?? null,
        approver_slots: [],
      })
      continue
    }

    if (isRejected) {
      if (s.phase === "upcoming") continue
      if (
        s.phase === "rejected" ||
        (rejectAtOrder != null && s.step_order === rejectAtOrder)
      ) {
        if (!insertedRejected) {
          steps.push({
            key: "rejected",
            label: "Rejected",
            status: "rejected",
            approver_slots: [],
          })
          insertedRejected = true
        }
      }
      continue
    }

    steps.push({
      key,
      label: role,
      status: isCurrentRole ? "active" : "upcoming",
      detail: s.assigned_user_name ?? null,
      approver_slots: [],
    })
  }

  if (isRejected) {
    if (!insertedRejected) {
      steps.push({
        key: "rejected",
        label: "Rejected",
        status: "rejected",
        approver_slots: [],
      })
    }
    return { steps, currentStepKey: "rejected" }
  }

  if (status === "cancelled") {
    return {
      steps: [
        { key: "draft", label: "Draft", status: "completed", approver_slots: [] },
        { key: "cancelled", label: "Cancelled", status: "rejected", approver_slots: [] },
      ],
      currentStepKey: "cancelled",
    }
  }

  const receiveStatus =
    status === "approved_by_cf"
      ? "active"
      : status === "received_by_cc2" || status === "confirmed_by_cf" || status === "closed"
        ? "completed"
        : "upcoming"
  const confirmStatus =
    status === "received_by_cc2"
      ? "active"
      : status === "confirmed_by_cf" || status === "closed"
        ? "completed"
        : "upcoming"
  const closeStatus =
    status === "confirmed_by_cf" ? "active" : status === "closed" ? "completed" : "upcoming"

  steps.push(
    {
      key: "approved_by_cf",
      label: "Destination receive",
      status: receiveStatus,
      detail:
        status === "approved_by_cf"
          ? (detail.to_asset_custodian_name ?? detail.assigned_to_name ?? null)
          : null,
      approver_slots: [],
    },
    {
      key: "received_by_cc2",
      label: confirmStatus === "completed" ? "Confirmed by CF" : "CF confirm",
      status: confirmStatus,
      detail: status === "received_by_cc2" ? (detail.assigned_to_name ?? null) : null,
      approver_slots: [],
    },
    {
      key: "closed",
      label: "Closed",
      status: status === "closed" ? "completed" : closeStatus === "active" ? "active" : "upcoming",
      approver_slots: [],
    },
  )

  let currentStepKey = "draft"
  if (status === "draft") currentStepKey = "draft"
  else if (status === "approved_by_cf") currentStepKey = "approved_by_cf"
  else if (status === "received_by_cc2") currentStepKey = "received_by_cc2"
  else if (status === "confirmed_by_cf" || status === "closed") currentStepKey = "closed"
  else if (currentApproval) currentStepKey = `approved_by_${currentApproval.step_order}`

  return { steps, currentStepKey }
}

function currentTransferWorkflowSteps(
  detail: TransferOrderDetail,
): NonNullable<TransferApprovalPanel["workflow_steps"]> {
  const panel = detail.approval_panel
  const currentRun =
    panel?.workflow_runs?.find((r) => r.is_current) ??
    (panel?.workflow_runs?.length ? panel.workflow_runs[panel.workflow_runs.length - 1] : null)
  if (currentRun?.workflow_steps?.length) return currentRun.workflow_steps
  if (panel?.workflow_steps?.length) return panel.workflow_steps
  return defaultTransferApprovalSteps()
}

/** Prior attempt that ended in CF reject (order returned to destination receive). */
function transferBounceRejectRun(
  detail: TransferOrderDetail,
): NonNullable<TransferApprovalPanel["workflow_runs"]>[number] | null {
  const runs = detail.approval_panel?.workflow_runs ?? []
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]
    if (run?.workflow_steps?.some((s) => s.phase === "rejected")) return run
  }
  return null
}

function transferReturnedToReceiver(detail: TransferOrderDetail): boolean {
  return (
    detail.status === "approved_by_cf" && Boolean((detail.rejection_reason || "").trim())
  )
}

function defaultTransferApprovalSteps(): NonNullable<TransferApprovalPanel["workflow_steps"]> {
  // No hardcoded role names — wait for the live workflow / preview from the API.
  return []
}

function shortTransferRoleLabel(roleName: string): string {
  return roleName.trim() || "Approver"
}
