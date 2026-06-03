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
}

export type PhysicalOrderAudit = {
  id: number
  action: string
  actor_name: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  created_at: string
}

export type PhysicalOrderDetail = {
  id: number
  order_number: string
  plant_name: string
  cost_center_code: string
  cost_center_description: string
  status: string
  remarks: string | null
  created_by_name: string | null
  assigned_to_name: string | null
  assigned_by_name: string | null
  assigned_at: string | null
  started_at: string | null
  started_by_name: string | null
  completed_at: string | null
  created_at: string
  approval_request_id: number | null
  items: PhysicalOrderItem[]
  verified_count: number
  total_count: number
  audit: PhysicalOrderAudit[]
}

export type OrdersDashboardModule = {
  total_orders: number
  pending_approval: number
  approved: number
  in_progress: number
  pending_closure_approval: number
  completed: number
  rejected: number
  by_status: { status: string; count: number }[]
  by_plant: { plant: string; count: number }[]
}

export const ORDER_TABS = [
  { key: "pending_approval", label: "Pending Approval" },
  { key: "my_orders", label: "My Orders" },
  { key: "assigned_to_me", label: "Assigned To Me" },
  { key: "in_progress", label: "In Progress" },
  { key: "pending_closure", label: "Pending Closure Approval" },
  { key: "completed", label: "Completed" },
] as const

export function orderStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}
