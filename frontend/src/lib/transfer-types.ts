export type TransferOrderStatus =
  | "draft"
  | "assigned_to_cf"
  | "rejected"
  | "approved_by_cf"
  | "received_by_cc2"
  | "closed"
  | "cancelled"

export type TransferAssigneeOption = {
  id: number
  full_name: string
  email: string | null
}

export type TransferAssigneeListResponse = {
  role_name: string
  items: TransferAssigneeOption[]
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
}

export type TransferOrderListResponse = {
  items: TransferOrderListItem[]
  total: number
  page: number
  page_size: number
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
  to_functional_location: string | null
  to_actual_location: string | null
  status: string
  remarks: string | null
  rejection_reason: string | null
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
  can_submit: boolean
  can_cf_decide: boolean
  can_cc2_assign: boolean
  can_cf_confirm: boolean
  can_edit: boolean
}

export const TRANSFER_STATUS_TABS = [
  { key: "draft", label: "Draft" },
  { key: "assigned_to_cf", label: "Assigned to CF" },
  { key: "rejected", label: "Rejected" },
  { key: "approved_by_cf", label: "Approved by CF" },
  { key: "received_by_cc2", label: "Received by CC2" },
  { key: "closed", label: "Closed" },
] as const

export function transferStatusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: "Draft",
    assigned_to_cf: "Assigned to CF",
    rejected: "Rejected",
    approved_by_cf: "Approved by CF",
    received_by_cc2: "Received by CC2",
    closed: "Closed",
    cancelled: "Cancelled",
  }
  return map[status] ?? status
}

export function transferStatusPillTone(
  status: string,
): "neutral" | "primary" | "success" | "warning" | "danger" {
  if (status === "closed") return "success"
  if (status === "rejected" || status === "cancelled") return "danger"
  if (status === "draft") return "neutral"
  if (status === "assigned_to_cf" || status === "received_by_cc2") return "warning"
  if (status === "approved_by_cf") return "primary"
  return "neutral"
}
