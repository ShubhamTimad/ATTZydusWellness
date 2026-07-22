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
}

export type CapexFormListResponse = {
  items: CapexFormListItem[]
  total: number
  page: number
  page_size: number
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
  is_final_step?: boolean
  needs_next_assignee?: boolean
  next_step_role_name?: string | null
  next_assignee_level?: "hod" | "engineering" | "central_finance" | string | null
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
  { key: "draft", label: "Draft" },
  { key: "pending_approval", label: "Pending approval" },
  { key: "in_rework", label: "Rejected" },
  { key: "approved", label: "Approved" },
] as const

export function capexStatusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: "Draft",
    pending_approval: "Pending approval",
    approved: "Approved",
    rejected: "Rejected",
    in_rework: "Rejected",
  }
  return map[status] ?? status
}

export function capexStatusPillTone(
  status: string,
): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "approved") return "success"
  if (status === "pending_approval") return "warning"
  if (status === "rejected" || status === "in_rework") return "danger"
  if (status === "draft") return "neutral"
  return "info"
}

export function isCapexEditable(status: string): boolean {
  return status === "draft" || status === "rejected" || status === "in_rework"
}
