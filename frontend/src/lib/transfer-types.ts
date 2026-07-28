export type TransferOrderStatus =
  | "draft"
  | "assigned_to_cf"
  | "rejected"
  | "approved_by_cf"
  | "received_by_cc2"
  | "confirmed_by_cf"
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
  to_asset_custodian_id: number | null
  to_asset_custodian_name: string | null
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
  can_cf_reject: boolean
  can_cc2_assign: boolean
  can_cf_confirm: boolean
  can_cf_close: boolean
  can_edit: boolean
}

export const TRANSFER_STATUS_TABS = [
  { key: "draft", label: "Draft" },
  { key: "assigned_to_cf", label: "Assigned to CF" },
  { key: "rejected", label: "Rejected" },
  { key: "approved_by_cf", label: "Approved by CF" },
  { key: "received_by_cc2", label: "Received" },
  { key: "confirmed_by_cf", label: "Confirmed by CF" },
  { key: "closed", label: "Closed" },
] as const

export function transferStatusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: "Draft",
    assigned_to_cf: "Assigned to CF",
    rejected: "Rejected",
    approved_by_cf: "Approved by CF",
    received_by_cc2: "Received",
    confirmed_by_cf: "Confirmed by CF",
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
  if (status === "approved_by_cf" || status === "confirmed_by_cf") return "primary"
  return "neutral"
}

export type TransferProgressStep = {
  key: string
  label: string
  status: string
  detail?: string | null
  approver_slots: []
}

/**
 * Transfer happy path:
 * Draft → Assigned to CF → Approved by CF → Received → Confirmed by CF → Closed
 */
export function buildTransferProgress(
  status: string,
  assignedToName?: string | null,
): { steps: TransferProgressStep[]; currentStepKey: string } {
  const happy: { key: string; label: string }[] = [
    { key: "draft", label: "Draft" },
    { key: "assigned_to_cf", label: "Assigned to CF" },
    { key: "approved_by_cf", label: "Approved by CF" },
    { key: "received_by_cc2", label: "Received" },
    { key: "confirmed_by_cf", label: "Confirmed by CF" },
    { key: "closed", label: "Closed" },
  ]

  if (status === "cancelled") {
    return {
      steps: [
        { key: "draft", label: "Draft", status: "completed", approver_slots: [] },
        { key: "cancelled", label: "Cancelled", status: "rejected", approver_slots: [] },
      ],
      currentStepKey: "cancelled",
    }
  }

  if (status === "rejected") {
    return {
      steps: [
        { key: "draft", label: "Draft", status: "completed", approver_slots: [] },
        {
          key: "assigned_to_cf",
          label: "Assigned to CF",
          status: "completed",
          detail: assignedToName ?? null,
          approver_slots: [],
        },
        { key: "rejected", label: "Rejected", status: "rejected", approver_slots: [] },
        {
          key: "approved_by_cf",
          label: "Approved by CF",
          status: "upcoming",
          approver_slots: [],
        },
        { key: "received_by_cc2", label: "Received", status: "upcoming", approver_slots: [] },
        { key: "confirmed_by_cf", label: "Confirmed by CF", status: "upcoming", approver_slots: [] },
        { key: "closed", label: "Closed", status: "upcoming", approver_slots: [] },
      ],
      currentStepKey: "rejected",
    }
  }

  // Status values are completed milestones. Highlight the next pending action.
  const pendingCurrentKey: Record<string, string> = {
    approved_by_cf: "received_by_cc2",
    received_by_cc2: "confirmed_by_cf",
    confirmed_by_cf: "closed",
  }
  const displayKey = pendingCurrentKey[status] ?? status
  const currentIdx = Math.max(
    0,
    happy.findIndex((s) => s.key === displayKey),
  )
  const reachedIdx = Math.max(
    0,
    happy.findIndex((s) => s.key === status),
  )
  const steps: TransferProgressStep[] = happy.map((s, i) => {
    let stepStatus: string
    if (status === "closed" || i < currentIdx) stepStatus = "completed"
    else if (i === currentIdx) stepStatus = "active"
    else stepStatus = "upcoming"
    return {
      key: s.key,
      label: s.label,
      status: stepStatus,
      detail:
        (s.key === "assigned_to_cf" ||
          s.key === "approved_by_cf" ||
          s.key === "received_by_cc2" ||
          s.key === "confirmed_by_cf") &&
        i <= reachedIdx
          ? (assignedToName ?? null)
          : null,
      approver_slots: [],
    }
  })

  return {
    steps,
    currentStepKey: status === "closed" ? "closed" : (happy[currentIdx]?.key ?? "draft"),
  }
}
