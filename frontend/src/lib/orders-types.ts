export type ValidateAssetsResponse = {
  eligible_asset_ids: number[]
  active_order_conflicts: {
    asset_id: number
    asset_code: string
    asset_name: string
    order_id: number
    order_number: string
    order_status: string
    order_kind?: string
  }[]
  missing_rfid: {
    asset_id: number
    asset_code: string
    asset_name: string
  }[]
  not_approved?: {
    asset_id: number
    asset_code: string
    asset_name: string
  }[]
  plant_mismatch: {
    asset_id: number
    asset_code: string
    asset_name: string
    plant_name?: string | null
  }[]
  cost_center_mismatch: {
    asset_id: number
    asset_code: string
    asset_name: string
    cost_center_code?: string | null
  }[]
  plant_id?: number | null
  cost_center_id?: number | null
  cost_center_ids?: number[]
  financial_year_label?: string | null
  financial_year_start?: string | null
  financial_year_end?: string | null
  already_verified_in_fy: {
    asset_id: number
    asset_code: string
    asset_name: string
    last_verification_date?: string | null
    physical_count?: number | null
  }[]
}

export type ExecutorUser = {
  id: number
  full_name: string
  email: string | null
}

export type ExecutorListResponse = {
  role_id: number
  role_name: string
  items: ExecutorUser[]
}

export type PhysicalOrderListItem = {
  id: number
  order_number: string
  plant_name: string
  cost_center_code: string
  cost_center_description: string
  asset_count: number
  status: string
  closed_at?: string | null
  has_closure_workflow?: boolean
  assigned_to_name: string | null
  created_by_name: string | null
  created_at: string
  needs_my_action?: boolean
  my_action_label?: string | null
}

export type PhysicalOrderListResponse = {
  items: PhysicalOrderListItem[]
  total: number
  page: number
  page_size: number
  tab_counts?: Record<string, number>
}

export type PhysicalOrderItem = {
  id: number
  asset_id: number
  asset_code: string
  asset_name: string
  rfid_code: string | null
  verification_status: string
  rejection_reason: string | null
  scan_time: string | null
  verified_by_name: string | null
  physically_verified: boolean
  last_verification_date: string | null
  inventory_count: number | null
  physical_count: number | null
  /** Per-asset remark on this order line (not Asset Master remark). */
  remark: string | null
  cost_center_code?: string | null
}

export type PhysicalOrderAuditVerifiedAsset = {
  asset_code: string
  asset_name: string | null
  rfid_code: string | null
  verified_at: string | null
  verified_by_name: string | null
  remark?: string | null
}

export type PhysicalOrderAudit = {
  id: number
  action: string
  label: string
  detail: string | null
  actor_name: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  created_at: string
  verified_assets?: PhysicalOrderAuditVerifiedAsset[]
}

export type OrderWorkflowStepDefinition = {
  step_order: number
  role_name: string
  required_approvals: number
}

export type OrderWorkflowDefinition = {
  phase: string
  workflow_name: string
  action_code: string
  steps: OrderWorkflowStepDefinition[]
}

export type OrderLifecycleApproverSlot = {
  slot: number
  status: string
  actor_name?: string | null
  acted_at?: string | null
  comment?: string | null
}

export type OrderLifecycleStep = {
  key: string
  label: string
  status: string
  role_name?: string | null
  actor_name?: string | null
  occurred_at?: string | null
  detail?: string | null
  approver_slots: OrderLifecycleApproverSlot[]
}

export type PhysicalOrderApprovalNotice = {
  financial_year_label?: string | null
  financial_year_start?: string | null
  financial_year_end?: string | null
  fy_verified_asset_codes: string[]
  reset_on_approval_asset_codes: string[]
  message?: string | null
}

export type PhysicalOrderProgress = {
  steps: OrderLifecycleStep[]
  current_step_key: string | null
  creation_workflow: OrderWorkflowDefinition | null
  closure_workflow: OrderWorkflowDefinition | null
}

export type PhysicalOrderDetail = {
  id: number
  order_number: string
  plant_id: number
  plant_name: string
  cost_center_id: number
  cost_center_ids?: number[]
  cost_center_code: string
  cost_center_description: string
  status: string
  remarks: string | null
  rejection_reason?: string | null
  created_by: number | null
  created_by_name: string | null
  assigned_to: number | null
  assigned_to_name: string | null
  assigned_by_name: string | null
  assigned_at: string | null
  started_at: string | null
  started_by_name: string | null
  completed_at: string | null
  closed_at: string | null
  created_at: string
  approval_request_id: number | null
  items: PhysicalOrderItem[]
  verified_count: number
  physically_verified_count: number
  pending_physical_count: number
  rejected_item_count: number
  total_count: number
  audit: PhysicalOrderAudit[]
  progress: PhysicalOrderProgress
  approval_notice?: PhysicalOrderApprovalNotice | null
  can_delete?: boolean
  can_archive?: boolean
  can_unarchive?: boolean
  can_review_creation?: boolean
  can_review_closure?: boolean
  /** Viewer rejected this order after work started and holds order.reassign. */
  can_reassign_rejected?: boolean
  is_final_closure_step?: boolean
  needs_next_closure_assignee?: boolean
  next_closure_role_id?: number | null
  next_closure_role_name?: string | null
  closure_approver_role_name?: string | null
}

export type OrdersDashboardModule = {
  total_orders: number
  draft?: number
  pending_approval: number
  approved: number
  assigned: number
  in_progress: number
  pending_closure_approval: number
  completed: number
  closed: number
  rejected: number
  by_status: { status: string; count: number }[]
  by_plant: { plant: string; count: number }[]
}

export type OrderListTab = {
  key: string
  label: string
  /** Key on OrdersDashboardModule for tab badge counts. */
  countKey?: keyof OrdersDashboardModule
}

/** Physical order status filter on the asset list (matches the Order status column). */
export const ASSET_PHYSICAL_ORDER_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "none", label: "No order" },
  { value: "draft", label: "Draft" },
  { value: "assigned", label: "Assigned" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "approved", label: "Approved" },
  { value: "closed", label: "Closed" },
  { value: "rejected", label: "Rejected" },
]

/** Lifecycle status filter for the orders list Status column (not inbox tabs). */
export const ORDER_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "assigned", label: "Assigned" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "closed", label: "Closed" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Archived" },
]

/** Inbox-style list tabs (All / Pending action). */
export const ORDER_STATUS_TABS: OrderListTab[] = [
  { key: "all", label: "All" },
  { key: "needs_action", label: "Pending Action" },
]

export function orderTabEmptyMessage(tab: string): string {
  if (tab === "needs_action") return "No pending action available."
  return "No Physical Verification Orders found."
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  assigned: "Assigned",
  pending_closure_approval: "Completed",
  completed: "Completed",
  closed: "Closed",
  in_progress: "In Progress",
  rejected: "Rejected",
  cancelled: "Archived",
}

export function orderStatusLabel(status: string): string {
  if (ORDER_STATUS_LABELS[status]) return ORDER_STATUS_LABELS[status]
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function orderStatusPillTone(
  status: string,
): "neutral" | "success" | "warning" | "danger" {
  if (
    status === "completed" ||
    status === "approved" ||
    status === "closed" ||
    status === "pending_closure_approval"
  ) {
    return "success"
  }
  if (status === "rejected" || status === "cancelled") return "danger"
  if (status === "in_progress" || status === "assigned") {
    return "warning"
  }
  return "neutral"
}
