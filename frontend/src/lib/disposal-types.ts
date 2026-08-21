import type {
  CapexApprovalPanel,
  CapexAssigneeListResponse,
  CapexAssigneeOption,
} from "@/lib/capex-types"

/** Disposal approval panel/assignee payloads are field-identical to CapEx. */
export type DisposalApprovalPanel = CapexApprovalPanel
export type DisposalAssigneeOption = CapexAssigneeOption
export type DisposalAssigneeListResponse = CapexAssigneeListResponse

export type DisposalOrderListItem = {
  id: number
  order_number: string
  plant_name: string
  from_cost_center_code: string | null
  asset_count: number
  status: string
  requires_engineering: boolean
  assigned_to_name: string | null
  created_by_name: string | null
  created_at: string
  needs_my_action?: boolean
  my_action_label?: string | null
  can_delete?: boolean
  can_archive?: boolean
  can_unarchive?: boolean
}

export type DisposalOrderListResponse = {
  items: DisposalOrderListItem[]
  total: number
  page: number
  page_size: number
  tab_counts?: Record<string, number>
}

export type DisposalOrderItem = {
  id: number
  asset_id: number
  asset_code: string
  asset_name: string
  from_cost_center_code: string | null
  from_functional_location: string | null
  from_actual_location: string | null
  from_functional_location_name?: string | null
  from_actual_location_name?: string | null
}

export type DisposalOrderAudit = {
  id: number
  action: string
  actor_name: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  created_at: string
}

export type DisposalOrderDetail = {
  id: number
  order_number: string
  plant_id: number
  plant_name: string
  from_cost_center_id: number | null
  from_cost_center_code: string | null
  from_cost_center_description: string | null
  to_cost_center_id: number | null
  to_cost_center_code: string | null
  to_cost_center_description: string | null
  /** Scrapyard Actual Location 1 after receive. */
  to_functional_location?: string | null
  /** Scrapyard Actual Location 2 after receive. */
  to_actual_location?: string | null
  to_functional_location_name?: string | null
  to_actual_location_name?: string | null
  requires_engineering: boolean
  status: string
  remarks: string | null
  rejection_comment: string | null
  approval_request_id: number | null
  created_by: number | null
  created_by_name: string | null
  assigned_to: number | null
  assigned_to_name: string | null
  assigned_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
  items: DisposalOrderItem[]
  audit: DisposalOrderAudit[]
  approval_panel: DisposalApprovalPanel | null
  can_submit: boolean
  can_edit: boolean
  can_resume?: boolean
  can_receive: boolean
  can_close: boolean
  can_delete: boolean
  can_archive: boolean
  can_unarchive?: boolean
}

/** Primary list tabs (must match _TAB_STATUSES UI keys in backend). */
export const DISPOSAL_STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "needs_action", label: "Pending Action" },
] as const

/** Lifecycle status filter for the disposal list Status column (not inbox tabs). */
export const DISPOSAL_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "pending_approval", label: "Pending Approval" },
  { value: "pending_receipt", label: "Pending Receive" },
  { value: "pending_cf_close", label: "Pending CF approval" },
  { value: "closed", label: "Closed" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Archived" },
]

export function disposalTabEmptyMessage(tab: string): string {
  if (tab === "needs_action") return "No Pending Action Available"
  return "No Disposal Orders."
}

export function disposalStatusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: "Draft",
    pending_approval: "Pending Approval",
    rejected: "Rejected",
    in_rework: "Rejected",
    pending_receipt: "Pending Receive",
    pending_cf_close: "Pending CF approval",
    closed: "Closed",
    cancelled: "Archived",
  }
  return map[status] ?? status.replaceAll("_", " ")
}

export function disposalStatusPillTone(
  status: string,
): "neutral" | "primary" | "success" | "warning" | "danger" | "info" {
  if (status === "closed") return "success"
  if (status === "rejected" || status === "in_rework") return "danger"
  if (status === "cancelled") return "neutral"
  if (status === "draft") return "neutral"
  if (status === "pending_approval" || status === "pending_receipt") return "warning"
  if (status === "pending_cf_close") return "primary"
  return "info"
}

export type DisposalProgressStep = {
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
  const kind = stepKindOf(s)
  const role = shortDisposalRoleLabel(s.approver_role_name)
  if (kind === "close") {
    return s.phase === "completed" ? "Closed" : "Close"
  }
  if (kind === "receive") {
    return s.phase === "completed" ? `Received by ${role}` : role
  }
  if (kind === "confirm") {
    return s.phase === "completed" ? `Confirmed by ${role}` : role
  }
  if (s.phase === "completed") return `Approved by ${role}`
  return role
}

/**
 * Disposal process path.
 * When the workflow includes receive/confirm/close kinds, the ladder is driven only
 * from those steps (no synthetic CC Received / CF trailers).
 * Legacy approve-only workflows append post-approval trailers only after approval ends.
 */
export function buildDisposalProgress(detail: DisposalOrderDetail): {
  steps: DisposalProgressStep[]
  currentStepKey: string
} {
  const status = detail.status
  const isRejected = status === "rejected" || status === "in_rework"
  const postApproval =
    status === "pending_receipt" || status === "pending_cf_close" || status === "closed"
  const workflowSteps = currentDisposalWorkflowSteps(detail)
  const hasOperationalKinds = workflowSteps.some((s) => stepKindOf(s) !== "approve")
  const currentApproval =
    workflowSteps.find((s) => s.phase === "current") ??
    (status === "pending_approval" || postApproval
      ? workflowSteps.find((s) => s.phase === "upcoming")
      : undefined)
  const rejectAtOrder = workflowSteps.find((s) => s.phase === "rejected")?.step_order

  const steps: DisposalProgressStep[] = [
    {
      key: "draft",
      label: "Draft",
      status: status === "draft" ? "active" : "completed",
      approver_slots: [],
    },
  ]

  if (status === "cancelled") {
    return {
      steps: [
        { key: "draft", label: "Draft", status: "completed", approver_slots: [] },
        { key: "cancelled", label: "Archived", status: "rejected", approver_slots: [] },
      ],
      currentStepKey: "cancelled",
    }
  }

  // Operational workflow: drive the whole path from configured step kinds + phase.
  if (hasOperationalKinds) {
    let insertedRejected = false
    let currentStepKey = "draft"
    if (status === "draft") currentStepKey = "draft"
    else if (status === "closed") currentStepKey = "closed"
    else if (isRejected) currentStepKey = "rejected"

    // CF/post-receive reject returned to receiver: show rejector as done (X),
    // then active/red on the receive step that must act again.
    const bounceRun = disposalReturnedToReceiver(detail) ? disposalBounceRejectRun(detail) : null
    const bounceSteps = bounceRun?.workflow_steps
    const bounceReject = bounceSteps?.find((s) => s.phase === "rejected")
    if (bounceSteps && bounceReject) {
      currentStepKey = "pending_receipt"
      for (const s of bounceSteps) {
        if (Number(s.step_order) > Number(bounceReject.step_order)) continue
        const kind = stepKindOf(s)
        const key =
          kind === "close"
            ? "closed"
            : kind === "receive"
              ? "pending_receipt"
              : kind === "confirm"
                ? "pending_cf_close"
                : `approved_by_${s.step_order}`
        const isReceive = kind === "receive"
        const isRejectStep = Number(s.step_order) === Number(bounceReject.step_order)
        const stepStatus = isReceive ? "active" : isRejectStep ? "rejected" : "completed"
        const role = shortDisposalRoleLabel(s.approver_role_name)
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
            ? "pending_receipt"
            : kind === "confirm"
              ? "pending_cf_close"
              : `approved_by_${s.step_order}`

      if (isRejected) {
        // Stop at rejection — do not paint later not-started steps.
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

      // Complete only by this step's phase / order — never by shared role name.
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

      if (stepStatus === "upcoming") {
        if (kind === "receive" && status === "pending_receipt") {
          stepStatus = "active"
          currentStepKey = key
        } else if (kind === "confirm" && status === "pending_cf_close") {
          const earlierIncomplete = workflowSteps.some(
            (x) =>
              Number(x.step_order) < Number(s.step_order) &&
              x.phase !== "completed" &&
              x.phase !== "rejected",
          )
          if (!earlierIncomplete) {
            stepStatus = "active"
            currentStepKey = key
          }
        } else if (kind === "close" && status === "pending_cf_close") {
          // Don't light Close while an earlier CF approve (or other) step is still open.
          const earlierIncomplete = workflowSteps.some(
            (x) =>
              Number(x.step_order) < Number(s.step_order) &&
              x.phase !== "completed" &&
              x.phase !== "rejected",
          )
          if (!earlierIncomplete) {
            stepStatus = "active"
            currentStepKey = key
          }
        } else if (
          kind === "receive" &&
          (status === "pending_cf_close" || status === "closed")
        ) {
          stepStatus = "completed"
        } else if (
          (kind === "confirm" || kind === "close") &&
          status === "closed"
        ) {
          stepStatus = "completed"
        }
      }

      steps.push({
        key,
        label:
          stepStatus === "rejected"
            ? `Rejected — ${shortDisposalRoleLabel(s.approver_role_name)}`
            : progressLabelForStep({
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

  // Legacy approve-only workflow: one node per step_order (phase-based, not role-name).
  let insertedRejected = false
  for (const s of workflowSteps) {
    const role = shortDisposalRoleLabel(s.approver_role_name)
    const key = `approved_by_${s.step_order}`
    const isCompletedRole = postApproval || s.phase === "completed"
    const isCurrentRole =
      !postApproval &&
      !isRejected &&
      currentApproval != null &&
      Number(s.step_order) === Number(currentApproval.step_order)

    if (isCompletedRole) {
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
      // Stop at rejection — do not paint later not-started steps.
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

  // Synthetic post-approval trailers only for legacy approve-only chains after approval ends.
  if (postApproval) {
    const receiptStatus =
      status === "pending_receipt"
        ? "active"
        : status === "pending_cf_close" || status === "closed"
          ? "completed"
          : "upcoming"
    const cfCloseStatus =
      status === "pending_cf_close"
        ? "active"
        : status === "closed"
          ? "completed"
          : "upcoming"
    steps.push(
      {
        key: "pending_receipt",
        label: "CC Received",
        status: receiptStatus,
        detail: status === "pending_receipt" ? (detail.assigned_to_name ?? null) : null,
        approver_slots: [],
      },
      {
        key: "pending_cf_close",
        label: cfCloseStatus === "completed" ? "Approved by CF" : "CF approval",
        status: cfCloseStatus,
        detail: status === "pending_cf_close" ? (detail.assigned_to_name ?? null) : null,
        approver_slots: [],
      },
    )
  }

  let currentStepKey = "draft"
  if (status === "draft") {
    currentStepKey = "draft"
  } else if (status === "pending_receipt") {
    currentStepKey = "pending_receipt"
  } else if (status === "pending_cf_close" || status === "closed") {
    currentStepKey = "pending_cf_close"
  } else if (currentApproval) {
    currentStepKey = `approved_by_${currentApproval.step_order}`
  }

  return { steps, currentStepKey }
}

function currentDisposalWorkflowSteps(
  detail: DisposalOrderDetail,
): NonNullable<DisposalApprovalPanel["workflow_steps"]> {
  const panel = detail.approval_panel
  const currentRun =
    panel?.workflow_runs?.find((r) => r.is_current) ??
    (panel?.workflow_runs?.length ? panel.workflow_runs[panel.workflow_runs.length - 1] : null)
  if (currentRun?.workflow_steps?.length) return currentRun.workflow_steps
  if (panel?.workflow_steps?.length) return panel.workflow_steps
  return defaultDisposalApprovalSteps(detail.requires_engineering)
}

/** Prior attempt that ended in reject (CF bounce → receiver still pending_receipt). */
function disposalBounceRejectRun(
  detail: DisposalOrderDetail,
): NonNullable<DisposalApprovalPanel["workflow_runs"]>[number] | null {
  const runs = detail.approval_panel?.workflow_runs ?? []
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]
    if (run?.workflow_steps?.some((s) => s.phase === "rejected")) return run
  }
  return null
}

function disposalReturnedToReceiver(detail: DisposalOrderDetail): boolean {
  if (!Boolean((detail.rejection_comment || "").trim())) return false
  // Legacy bounce wrote pending_receipt; transfer-style bounce keeps status rejected
  // with the approval request still pending on receive.
  if (detail.status === "pending_receipt") return true
  if (detail.status !== "rejected") return false
  const panel = detail.approval_panel
  if (!panel || panel.request_status !== "pending") return false
  const kind = (panel.current_step_kind || "").toLowerCase()
  return kind === "receive" || panel.my_pending_task_id != null
}

function defaultDisposalApprovalSteps(
  _requiresEngineering: boolean,
): NonNullable<DisposalApprovalPanel["workflow_steps"]> {
  // No hardcoded role names — wait for the live workflow / preview from the API.
  return []
}

function shortDisposalRoleLabel(roleName: string): string {
  // Always use the live workflow role name — never map by hardcoded synonyms.
  return roleName.trim() || "Approver"
}

type TimelineStep = NonNullable<DisposalApprovalPanel["workflow_steps"]>[number]

/**
 * Append Receiver + CF approval after configured approve-only roles.
 * Skipped when the workflow already defines receive/confirm/close kinds.
 */
export function withDisposalPostApprovalTimelineSteps(
  steps: TimelineStep[],
  detail: Pick<
    DisposalOrderDetail,
    "status" | "assigned_to" | "assigned_to_name" | "rejection_comment"
  >,
): TimelineStep[] {
  if (steps.some((s) => stepKindOf(s) !== "approve")) {
    return steps
  }

  const status = detail.status
  const bounced =
    status === "rejected" && Boolean((detail.rejection_comment || "").trim())
  // Don't paint synthetic trailers while approvals are still in flight, or after
  // creator-terminal reject. Bounce-to-receiver keeps receive/CF trailers.
  if (
    (status === "rejected" && !bounced) ||
    status === "in_rework" ||
    (status !== "pending_receipt" &&
      status !== "pending_cf_close" &&
      status !== "closed" &&
      !bounced)
  ) {
    return steps
  }

  const baseOrder = steps.length > 0 ? Math.max(...steps.map((s) => s.step_order)) : 0
  const total = baseOrder + 2
  const awaitingReceive = status === "pending_receipt" || bounced

  let receivePhase: TimelineStep["phase"] = "upcoming"
  let cfPhase: TimelineStep["phase"] = "upcoming"
  if (awaitingReceive) {
    receivePhase = "current"
  } else if (status === "pending_cf_close") {
    receivePhase = "completed"
    cfPhase = "current"
  } else if (status === "closed") {
    receivePhase = "completed"
    cfPhase = "completed"
  }

  const receiveAssigned = awaitingReceive
    ? { id: detail.assigned_to ?? null, name: detail.assigned_to_name ?? null }
    : { id: null, name: null }
  const cfAssigned =
    status === "pending_cf_close" || status === "closed"
      ? { id: detail.assigned_to ?? null, name: detail.assigned_to_name ?? null }
      : { id: null, name: null }

  const receiveStep: TimelineStep = {
    step_order: baseOrder + 1,
    approver_role_name: "Receiver",
    required_approvals: 1,
    total_steps: total,
    phase: receivePhase,
    approved_count: receivePhase === "completed" ? 1 : 0,
    actions: [],
    status_label:
      receivePhase === "completed"
        ? "Received"
        : receivePhase === "current"
          ? "Receive"
          : "Not started",
    assigned_user_id: receiveAssigned.id,
    assigned_user_name: receiveAssigned.name,
    step_kind: "receive",
  }
  const cfStep: TimelineStep = {
    step_order: baseOrder + 2,
    approver_role_name: "CF approval",
    required_approvals: 1,
    total_steps: total,
    phase: cfPhase,
    approved_count: cfPhase === "completed" ? 1 : 0,
    actions: [],
    status_label:
      cfPhase === "completed"
        ? "Approved"
        : cfPhase === "current"
          ? "In progress"
          : "Not started",
    assigned_user_id: cfAssigned.id,
    assigned_user_name: cfAssigned.name,
    step_kind: "close",
  }

  const normalized = steps.map((s) => ({
    ...s,
    total_steps: total,
    phase:
      awaitingReceive || status === "pending_cf_close" || status === "closed"
        ? ("completed" as const)
        : s.phase,
  }))

  return [...normalized, receiveStep, cfStep]
}
