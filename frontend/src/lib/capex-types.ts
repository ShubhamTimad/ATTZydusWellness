export type CapexFormListItem = {
  id: number
  form_number: string
  asset_name: string
  department: string | null
  status: string
  requires_engineering: boolean
  asset_id: number | null
  created_by_name: string | null
  created_at: string
  needs_my_action?: boolean
  my_action_label?: string | null
}

export type CapexFormListResponse = {
  items: CapexFormListItem[]
  total: number
  page: number
  page_size: number
  tab_counts?: Record<string, number>
}

export type CapexApprovalStepLine = {
  step_order: number
  approver_role_name: string
  required_approvals: number
  total_steps: number
  phase: "completed" | "current" | "upcoming" | "rejected"
  approved_count: number
  actions: {
    actor_user_id: number
    actor_display_name: string
    action: string
    comment: string | null
    created_at: string | null
  }[]
  status_label: string
  pool_size?: number
  pool_member_names?: string[]
  assigned_user_id?: number | null
  assigned_user_name?: string | null
  /** approve | receive | confirm | close */
  step_kind?: string
}

export type CapexWorkflowRun = {
  attempt: number
  request_id: number
  request_status: string
  is_current: boolean
  workflow_steps: CapexApprovalStepLine[]
}

export type CapexApprovalPanel = {
  request_id: number
  request_status: string
  workflow_steps: CapexApprovalStepLine[]
  workflow_runs?: CapexWorkflowRun[]
  my_pending_task_id: number | null
  pending_task_id?: number | null
  current_assignee_user_id?: number | null
  current_assignee_name?: string | null
  current_step_role_name?: string | null
  current_assignee_level?: "hod" | "engineering" | "central_finance" | string | null
  current_assignee_role_id?: number | null
  current_step_kind?: string
  current_step_order?: number | null
  is_final_step?: boolean
  needs_next_assignee?: boolean
  next_step_role_name?: string | null
  next_assignee_role_id?: number | null
  next_assignee_level?: "hod" | "engineering" | "central_finance" | string | null
  next_step_kind?: string | null
}

export type CapexAssigneeOption = {
  id: number
  full_name: string
  email: string | null
}

export type CapexAssigneeListResponse = {
  role_name: string
  items: CapexAssigneeOption[]
}

export type CapexAuditChange = {
  field: string
  from_value: string | null
  to_value: string | null
}

export type CapexAuditEvent = {
  id: number
  action: string
  label: string
  detail: string | null
  actor_name: string | null
  changes: CapexAuditChange[]
  created_at: string
}

export type CapexFormDetail = {
  id: number
  form_number: string
  status: string
  asset_name: string
  equipment_tag_no: string | null
  asset_specifications: string | null
  party_name: string | null
  department: string | null
  installation_location: string | null
  department_head: string | null
  functioning_comment: string | null
  installation_date: string | null
  auc_code: string | null
  useful_life: string | null
  requires_engineering: boolean
  approval_request_id: number | null
  asset_id: number | null
  asset_code: string | null
  rejection_comment: string | null
  created_by: number | null
  created_by_name: string | null
  created_at: string
  updated_at: string
  approval_panel?: CapexApprovalPanel | null
  can_delete?: boolean
  can_archive?: boolean
}

export type CapexFormWritePayload = {
  asset_name: string
  equipment_tag_no?: string | null
  asset_specifications?: string | null
  party_name?: string | null
  department?: string | null
  installation_location?: string | null
  department_head?: string | null
  functioning_comment?: string | null
  installation_date?: string | null
  auc_code?: string | null
  useful_life?: string | null
  requires_engineering: boolean
}

export const CAPEX_STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "needs_action", label: "Needs my action" },
  { key: "done", label: "Done" },
] as const

/** Lifecycle status filter for the CapEx list Status column (not inbox tabs). */
export const CAPEX_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "in_rework", label: "Rejected" },
  { value: "cancelled", label: "Archived" },
]

export function capexTabEmptyMessage(tab: string): string {
  if (tab === "needs_action") return "Nothing waiting on you right now."
  if (tab === "done") return "No approved or archived forms."
  return "No capitalization forms."
}

export function capexStatusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: "Draft",
    pending_approval: "Pending approval",
    approved: "Approved",
    rejected: "Rejected",
    in_rework: "Rejected",
    cancelled: "Archived",
  }
  return map[status] ?? status
}

export function capexStatusPillTone(
  status: string,
): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "approved") return "success"
  if (status === "pending_approval") return "warning"
  if (status === "rejected" || status === "in_rework" || status === "cancelled") return "danger"
  if (status === "draft") return "neutral"
  return "info"
}

export function isCapexEditable(status: string): boolean {
  return status === "draft" || status === "rejected" || status === "in_rework"
}

export type CapexProgressStep = {
  key: string
  label: string
  status: string
  detail?: string | null
  approver_slots: []
}

/**
 * Form-progress path (current attempt only):
 * Draft → workflow role steps (approve/close) → Rejected (if stopped).
 * Completed approve levels use "Approved by {Role}"; close uses "Closed by {Role}".
 */
export function buildCapexProgress(detail: CapexFormDetail): {
  steps: CapexProgressStep[]
  currentStepKey: string
} {
  const status = detail.status
  const isRejected = status === "rejected" || status === "in_rework"
  const workflowSteps = currentCapexWorkflowSteps(detail)
  const currentApproval = workflowSteps.find((s) => s.phase === "current")
  const rejectAtOrder = workflowSteps.find((s) => s.phase === "rejected")?.step_order

  const steps: CapexProgressStep[] = [
    {
      key: "draft",
      label: "Draft",
      status: status === "draft" ? "active" : "completed",
      approver_slots: [],
    },
  ]

  let insertedRejected = false
  for (const s of workflowSteps) {
    const role = shortCapexRoleLabel(s.approver_role_name)
    const kind = (s.step_kind || "approve").toLowerCase()
    const key = `approved_by_${s.step_order}`

    if (s.phase === "completed") {
      steps.push({
        key,
        label: kind === "close" ? `Closed by ${role}` : `Approved by ${role}`,
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
      label: kind === "close" ? `Close — ${role}` : role,
      status: s.phase === "current" ? "active" : "upcoming",
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

  let currentStepKey = "draft"
  if (status === "draft") {
    currentStepKey = "draft"
  } else if (status === "approved") {
    const lastApproved = [...steps].reverse().find((s) => s.key.startsWith("approved_by_"))
    currentStepKey = lastApproved?.key ?? "draft"
  } else if (currentApproval) {
    currentStepKey = `approved_by_${currentApproval.step_order}`
  } else if (status === "pending_approval" && workflowSteps.length > 0) {
    currentStepKey = `approved_by_${workflowSteps[0]!.step_order}`
  }

  return { steps, currentStepKey }
}

function currentCapexWorkflowSteps(detail: CapexFormDetail): CapexApprovalStepLine[] {
  const panel = detail.approval_panel
  const currentRun =
    panel?.workflow_runs?.find((r) => r.is_current) ??
    (panel?.workflow_runs?.length ? panel.workflow_runs[panel.workflow_runs.length - 1] : null)
  if (currentRun?.workflow_steps?.length) return currentRun.workflow_steps
  if (panel?.workflow_steps?.length) return panel.workflow_steps
  return defaultCapexApprovalSteps(detail.requires_engineering)
}

/** Current pending CapEx step kind (approve | close | …). */
export function capexCurrentStepKind(detail: CapexFormDetail): string {
  const fromPanel = detail.approval_panel?.current_step_kind
  if (fromPanel) return String(fromPanel).toLowerCase()
  const current = currentCapexWorkflowSteps(detail).find((s) => s.phase === "current")
  return (current?.step_kind || "approve").toLowerCase()
}

/** True when the pending step is the first approval level (reassign allowed). */
export function capexIsFirstApprovalStep(detail: CapexFormDetail): boolean {
  const steps = currentCapexWorkflowSteps(detail)
  if (!steps.length) return true
  const order =
    detail.approval_panel?.current_step_order ??
    steps.find((s) => s.phase === "current")?.step_order
  if (order == null) return false
  const first = Math.min(...steps.map((s) => s.step_order))
  return Number(order) === first
}

function defaultCapexApprovalSteps(_requiresEngineering: boolean): CapexApprovalStepLine[] {
  // No hardcoded role names — wait for the live workflow / preview from the API.
  return []
}

function shortCapexRoleLabel(roleName: string): string {
  return roleName.trim() || "Approver"
}
