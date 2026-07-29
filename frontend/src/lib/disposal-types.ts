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
}

export type DisposalOrderListResponse = {
  items: DisposalOrderListItem[]
  total: number
  page: number
  page_size: number
}

export type DisposalOrderItem = {
  id: number
  asset_id: number
  asset_code: string
  asset_name: string
  from_cost_center_code: string | null
  from_functional_location: string | null
  from_actual_location: string | null
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
  can_receive: boolean
  can_close: boolean
}

/** Tab keys must match _TAB_STATUSES in backend/modules/disposals/service.py. */
export const DISPOSAL_STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "pending", label: "Pending approval" },
  { key: "receipt", label: "Receipt & approval" },
  { key: "closed", label: "Closed / archived" },
] as const

export function disposalStatusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: "Draft",
    pending_approval: "Pending approval",
    rejected: "Rejected",
    in_rework: "In rework",
    pending_receipt: "Pending receive",
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

/**
 * Disposal process path (one active node per action):
 * Draft → workflow roles → CC Received → CF approval/close
 *
 * "Pending for approval" is not a separate step — after submit, the current
 * approver role is the active node (same as Transfer: Draft → Assigned to CF).
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
  const approvedRoleNames = approvedDisposalRoleNames(detail)
  const auditNextRole = nextPendingDisposalRoleName(detail)
  const currentApproval =
    workflowSteps.find((s) => s.phase === "current") ??
    (status === "pending_approval" && auditNextRole
      ? workflowSteps.find((s) => roleMatches(s.approver_role_name, auditNextRole))
      : undefined) ??
    (status === "pending_approval"
      ? workflowSteps.find(
          (s) => s.phase === "upcoming" && !approvedRoleNames.has(normalizeRoleName(s.approver_role_name)),
        )
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

  let insertedRejected = false
  for (const s of workflowSteps) {
    const role = shortDisposalRoleLabel(s.approver_role_name)
    const key = `approved_by_${s.step_order}`
    const isCompletedRole =
      postApproval ||
      s.phase === "completed" ||
      approvedRoleNames.has(normalizeRoleName(s.approver_role_name))
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
      if (!insertedRejected && (rejectAtOrder == null || s.step_order === rejectAtOrder)) {
        steps.push({
          key: "rejected",
          label: "Rejected",
          status: "rejected",
          approver_slots: [],
        })
        insertedRejected = true
      }
      if (rejectAtOrder != null && s.step_order <= rejectAtOrder) continue
      steps.push({
        key,
        label: role,
        status: "upcoming",
        detail: s.assigned_user_name ?? null,
        approver_slots: [],
      })
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
    steps.push(
      {
        key: "pending_receipt",
        label: "CC Received",
        status: "upcoming",
        approver_slots: [],
      },
      {
        key: "pending_cf_close",
        label: "CF approval",
        status: "upcoming",
        approver_slots: [],
      },
    )
    return { steps, currentStepKey: "rejected" }
  }

  if (status === "cancelled") {
    return {
      steps: [
        { key: "draft", label: "Draft", status: "completed", approver_slots: [] },
        { key: "cancelled", label: "Archived", status: "rejected", approver_slots: [] },
      ],
      currentStepKey: "cancelled",
    }
  }

  const receiptStatus =
    status === "pending_receipt"
      ? "active"
      : status === "pending_cf_close" || status === "closed"
        ? "completed"
        : "upcoming"
  const cfCloseStatus =
    status === "pending_cf_close" ? "active" : status === "closed" ? "completed" : "upcoming"

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

  let currentStepKey = "draft"
  if (status === "draft") {
    currentStepKey = "draft"
  } else if (status === "pending_receipt") {
    currentStepKey = "pending_receipt"
  } else if (status === "pending_cf_close") {
    currentStepKey = "pending_cf_close"
  } else if (status === "closed") {
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

function defaultDisposalApprovalSteps(
  requiresEngineering: boolean,
): NonNullable<DisposalApprovalPanel["workflow_steps"]> {
  const roles = requiresEngineering
    ? ["Department HOD", "Engineering", "Central Finance", "CFM", "MD", "Store Person"]
    : ["Department HOD", "Central Finance", "CFM", "MD", "Store Person"]
  return roles.map((approver_role_name, i) => ({
    step_order: i + 1,
    approver_role_name,
    required_approvals: 1,
    total_steps: roles.length,
    phase: "upcoming" as const,
    approved_count: 0,
    actions: [],
    status_label: "",
  }))
}

function shortDisposalRoleLabel(roleName: string): string {
  const n = roleName.trim().toLowerCase()
  if (n.includes("hod")) return "HOD"
  if (n.includes("engineering")) return "Engineering"
  if (n === "cfm" || n.includes("finance manager")) return "CFM"
  if (n === "md" || n.includes("managing director")) return "MD"
  if (n.includes("store")) return "Store"
  if (n.includes("finance") || n.includes("central finance")) return "CF"
  return roleName
}

function normalizeRoleName(roleName: string | null | undefined): string {
  return (roleName ?? "").trim().toLowerCase()
}

function roleMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeRoleName(a) === normalizeRoleName(b)
}

function approvedDisposalRoleNames(detail: DisposalOrderDetail): Set<string> {
  const out = new Set<string>()
  for (const ev of detail.audit ?? []) {
    if (ev.action !== "step_approved" && ev.action !== "approved") continue
    const role = readAuditString(ev.new_value, "step_role_name")
    if (role) out.add(normalizeRoleName(role))
  }
  return out
}

function nextPendingDisposalRoleName(detail: DisposalOrderDetail): string | null {
  for (const ev of detail.audit ?? []) {
    if (ev.action !== "step_approved") continue
    const role = readAuditString(ev.new_value, "next_role_name")
    if (role) return role
  }
  return null
}

function readAuditString(
  payload: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = payload?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

type TimelineStep = NonNullable<DisposalApprovalPanel["workflow_steps"]>[number]

/**
 * Append Receiver + CF approval after the configured workflow roles
 * so Approval progress mirrors the full disposal path.
 */
export function withDisposalPostApprovalTimelineSteps(
  steps: TimelineStep[],
  detail: Pick<DisposalOrderDetail, "status" | "assigned_to" | "assigned_to_name">,
): TimelineStep[] {
  const status = detail.status
  const baseOrder = steps.length > 0 ? Math.max(...steps.map((s) => s.step_order)) : 0
  const total = baseOrder + 2

  let receivePhase: TimelineStep["phase"] = "upcoming"
  let cfPhase: TimelineStep["phase"] = "upcoming"
  if (status === "pending_receipt") {
    receivePhase = "current"
  } else if (status === "pending_cf_close") {
    receivePhase = "completed"
    cfPhase = "current"
  } else if (status === "closed") {
    receivePhase = "completed"
    cfPhase = "completed"
  } else if (status === "rejected" || status === "in_rework" || status === "cancelled") {
    receivePhase = "upcoming"
    cfPhase = "upcoming"
  }

  const receiveAssigned =
    status === "pending_receipt"
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
    step_kind: "approve",
  }

  const normalized = steps.map((s) => ({
    ...s,
    total_steps: total,
    // Once post-approval starts, every workflow role is done.
    phase:
      status === "pending_receipt" || status === "pending_cf_close" || status === "closed"
        ? ("completed" as const)
        : s.phase,
  }))

  return [...normalized, receiveStep, cfStep]
}
