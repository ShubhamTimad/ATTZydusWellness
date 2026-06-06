export type ValidateAssetsResponse = {
  eligible_asset_ids: number[]
  active_order_conflicts: {
    asset_id: number
    asset_code: string
    asset_name: string
    order_id: number
    order_number: string
    order_status: string
  }[]
  missing_rfid: {
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

export type PhysicalOrderListItem = {
  id: number
  order_number: string
  plant_name: string
  cost_center_code: string
  cost_center_description: string
  asset_count: number
  status: string
  assigned_to_name: string | null
  created_by_name: string | null
  created_at: string
}

export type PhysicalOrderListResponse = {
  items: PhysicalOrderListItem[]
  total: number
  page: number
  page_size: number
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
  plant_name: string
  cost_center_code: string
  cost_center_description: string
  status: string
  remarks: string | null
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
}

export type OrdersDashboardModule = {
  total_orders: number
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

export const ORDER_TABS = [
  { key: "pending_approval", label: "Pending Approval" },
  { key: "my_orders", label: "My Orders" },
  { key: "assigned", label: "Assigned" },
  { key: "assigned_to_me", label: "Assigned To Me" },
  { key: "in_progress", label: "In Progress" },
  { key: "pending_closure", label: "Pending Closure Approval" },
  { key: "completed", label: "Completed" },
  { key: "closed", label: "Closed" },
] as const

export function orderStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}
