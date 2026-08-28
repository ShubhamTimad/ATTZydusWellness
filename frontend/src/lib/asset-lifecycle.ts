export function isAssetActive(lifecycleStatus: string, approvalStatus: string): boolean {
  return lifecycleStatus === "active" && approvalStatus !== "pending"
}

export function isAssetDeactivated(lifecycleStatus: string): boolean {
  return (lifecycleStatus || "").toLowerCase() === "deactivated"
}

export function isAssetDisposed(lifecycleStatus: string): boolean {
  return (lifecycleStatus || "").toLowerCase() === "disposed"
}

export function isAssetPendingDisposal(lifecycleStatus: string): boolean {
  return (lifecycleStatus || "").toLowerCase() === "pending_disposal"
}

export function isAssetPendingTransfer(lifecycleStatus: string): boolean {
  return (lifecycleStatus || "").toLowerCase() === "pending_transfer"
}

/** Mirrors backend ACTIVE_ORDER_STATUSES (not closed / cancelled / rejected). */
const OPEN_PHYSICAL_ORDER_STATUSES = new Set([
  "draft",
  "pending_approval",
  "approved",
  "assigned",
  "in_progress",
  "pending_closure_approval",
  "completed",
])

/** True when the asset is on an open physical order (list may show closed as fallback). */
export function hasOpenPhysicalOrder(order?: {
  order_status?: string | null
  closed_at?: string | null
} | null): boolean {
  if (!order) return false
  if (order.closed_at) return false
  const status = (order.order_status || "").trim().toLowerCase()
  return OPEN_PHYSICAL_ORDER_STATUSES.has(status)
}

export function canDeactivateAsset(
  lifecycleStatus: string,
  approvalStatus: string,
  activePhysicalOrder?: { order_status?: string | null; closed_at?: string | null } | null,
): boolean {
  if (
    isAssetDisposed(lifecycleStatus) ||
    isAssetPendingDisposal(lifecycleStatus) ||
    isAssetPendingTransfer(lifecycleStatus) ||
    hasOpenPhysicalOrder(activePhysicalOrder)
  ) {
    return false
  }
  return isAssetActive(lifecycleStatus, approvalStatus)
}

export function canReactivateAsset(lifecycleStatus: string): boolean {
  return isAssetDeactivated(lifecycleStatus)
}

/** List/detail badge from approval + lifecycle. */
export function assetStatusLabel(lifecycleStatus: string, approvalStatus: string): string {
  const lifecycle = (lifecycleStatus || "").toLowerCase()
  if (lifecycle === "disposed") return "Disposed"
  if (lifecycle === "pending_disposal") return "Pending Disposal"
  if (lifecycle === "pending_transfer") return "Pending Transfer"
  if (lifecycle === "deactivated") return "Inactive"
  const approval = (approvalStatus || "").toLowerCase()
  if (approval === "draft") return "Draft"
  if (approval === "pending") return "Pending Approval"
  if (approval === "rejected") return "Rejected"
  if (approval === "approved") return "Approved"
  if (isAssetActive(lifecycleStatus, approvalStatus) || approval === "not_required") {
    return "Active"
  }
  return "Inactive"
}

/** Column / filter options — same labels as {@link assetStatusLabel}. */
export const ASSET_STATUS_FILTER_OPTIONS = [
  {
    value: "draft",
    label: "Draft",
    approval_status: "draft",
    lifecycle_status: "",
  },
  {
    value: "pending",
    label: "Pending Approval",
    approval_status: "pending",
    lifecycle_status: "",
  },
  {
    value: "rejected",
    label: "Rejected",
    approval_status: "rejected",
    lifecycle_status: "",
  },
  {
    value: "approved",
    label: "Approved",
    approval_status: "approved",
    lifecycle_status: "",
  },
  {
    value: "active",
    label: "Active",
    approval_status: "",
    lifecycle_status: "active",
  },
  {
    value: "deactivated",
    label: "Inactive",
    approval_status: "",
    lifecycle_status: "deactivated",
  },
  {
    value: "pending_disposal",
    label: "Pending Disposal",
    approval_status: "",
    lifecycle_status: "pending_disposal",
  },
  {
    value: "pending_transfer",
    label: "Pending Transfer",
    approval_status: "",
    lifecycle_status: "pending_transfer",
  },
  {
    value: "disposed",
    label: "Disposed",
    approval_status: "",
    lifecycle_status: "disposed",
  },
] as const

export type AssetStatusFilterValue = (typeof ASSET_STATUS_FILTER_OPTIONS)[number]["value"]

/** Resolve current list filters to a Status dropdown value. */
export function assetStatusFilterValue(
  lifecycleStatus: string,
  approvalStatus: string,
): AssetStatusFilterValue | "" {
  const lifecycle = (lifecycleStatus || "").toLowerCase()
  const approval = (approvalStatus || "").toLowerCase()
  if (lifecycle === "disposed") return "disposed"
  if (lifecycle === "pending_disposal") return "pending_disposal"
  if (lifecycle === "pending_transfer") return "pending_transfer"
  if (lifecycle === "deactivated") return "deactivated"
  if (approval === "draft") return "draft"
  if (approval === "pending") return "pending"
  if (approval === "rejected") return "rejected"
  if (approval === "approved") return "approved"
  if (lifecycle === "active") return "active"
  return ""
}

export function assetStatusFilterOption(value: string) {
  return ASSET_STATUS_FILTER_OPTIONS.find((o) => o.value === value) ?? null
}

export function assetStatusVariant(
  lifecycleStatus: string,
  approvalStatus: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (isAssetDisposed(lifecycleStatus)) return "secondary"
  if (isAssetPendingDisposal(lifecycleStatus) || isAssetPendingTransfer(lifecycleStatus)) return "outline"
  if (isAssetDeactivated(lifecycleStatus)) return "secondary"
  const approval = (approvalStatus || "").toLowerCase()
  if (approval === "rejected") return "destructive"
  if (approval === "pending") return "outline"
  if (approval === "approved" || isAssetActive(lifecycleStatus, approvalStatus)) return "default"
  return "secondary"
}

export type AssetStatusPillTone =
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "neutral"
  | "info"
  | "disposed"

export function assetStatusPillTone(
  lifecycleStatus: string,
  approvalStatus: string,
): AssetStatusPillTone {
  if (isAssetDisposed(lifecycleStatus)) return "disposed"
  if (isAssetPendingDisposal(lifecycleStatus) || isAssetPendingTransfer(lifecycleStatus)) return "info"
  if (isAssetDeactivated(lifecycleStatus)) return "neutral"
  const approval = (approvalStatus || "").toLowerCase()
  if (approval === "rejected") return "danger"
  if (approval === "pending") return "warning"
  if (approval === "approved" || isAssetActive(lifecycleStatus, approvalStatus)) return "success"
  if (approval === "draft") return "neutral"
  return "neutral"
}

export function canSubmitForApproval(lifecycleStatus: string, approvalStatus: string): boolean {
  if (
    isAssetDisposed(lifecycleStatus) ||
    isAssetPendingDisposal(lifecycleStatus) ||
    isAssetPendingTransfer(lifecycleStatus) ||
    isAssetDeactivated(lifecycleStatus)
  ) {
    return false
  }
  if (isAssetActive(lifecycleStatus, approvalStatus)) return false
  const approval = approvalStatus.toLowerCase()
  if (approval === "pending") return false
  if (approval === "draft" || approval === "rejected") return true
  if (approval === "not_required" && lifecycleStatus !== "active") return true
  return false
}

export const ASSET_APPROVAL_STATUS_TABS = [
  { key: "approved", label: "Approved", approval_status: "approved" },
  { key: "draft", label: "Draft", approval_status: "draft" },
  { key: "pending", label: "Pending Approval", approval_status: "pending" },
  { key: "rejected", label: "Rejected", approval_status: "rejected" },
  { key: "all", label: "All", approval_status: "" },
] as const

export type AssetApprovalStatusTabKey = (typeof ASSET_APPROVAL_STATUS_TABS)[number]["key"]

export type AssetProgressStep = {
  key: string
  label: string
  status: string
  detail?: string | null
  approver_slots: []
}

type AssetProgressPanel = {
  workflow_steps?: {
    step_order: number
    approver_role_name: string
    phase: string
    assigned_user_name?: string | null
  }[]
  workflow_runs?: {
    is_current: boolean
    workflow_steps: {
      step_order: number
      approver_role_name: string
      phase: string
      assigned_user_name?: string | null
    }[]
  }[]
}

/** Draft → configured role level(s) → Rejected (if stopped). While still draft, the next
 *  node reads as pending approval; after submit it shows the role; when done, Approved by {role}. */
export function buildAssetProgress(detail: {
  approval_status: string
  approval_panel?: AssetProgressPanel | null
}): { steps: AssetProgressStep[]; currentStepKey: string } {
  const status = (detail.approval_status || "").toLowerCase()
  const isRejected = status === "rejected"
  const isDraft = status === "draft"
  const workflowSteps = currentAssetWorkflowSteps(detail.approval_panel)
  const currentApproval = workflowSteps.find((s) => s.phase === "current")
  const rejectAtOrder = workflowSteps.find((s) => s.phase === "rejected")?.step_order

  const steps: AssetProgressStep[] = [
    {
      key: "draft",
      label: "Draft",
      status: isDraft ? "active" : "completed",
      approver_slots: [],
    },
  ]

  let insertedRejected = false
  for (const s of workflowSteps) {
    const role = s.approver_role_name || "Approver"
    const key = `approved_by_${s.step_order}`

    // Asset-level approved wins over stale workflow phase (panel can lag or still say "current").
    if (status === "approved" || status === "not_required" || s.phase === "completed") {
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
      label: isDraft ? "Pending for Approval" : role,
      status: s.phase === "current" ? "active" : "upcoming",
      detail: isDraft ? null : (s.assigned_user_name ?? null),
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
  } else if (status === "approved" || status === "not_required") {
    const lastApproved = [...steps].reverse().find((s) => s.key.startsWith("approved_by_"))
    currentStepKey = lastApproved?.key ?? "draft"
  } else if (currentApproval) {
    currentStepKey = `approved_by_${currentApproval.step_order}`
  } else if (status === "pending" && workflowSteps.length > 0) {
    currentStepKey = `approved_by_${workflowSteps[0]!.step_order}`
  }

  return { steps, currentStepKey }
}

function currentAssetWorkflowSteps(
  panel: AssetProgressPanel | null | undefined,
): NonNullable<AssetProgressPanel["workflow_steps"]> {
  const currentRun =
    panel?.workflow_runs?.find((r) => r.is_current) ??
    (panel?.workflow_runs?.length ? panel.workflow_runs[panel.workflow_runs.length - 1] : null)
  if (currentRun?.workflow_steps?.length) return currentRun.workflow_steps
  if (panel?.workflow_steps?.length) return panel.workflow_steps
  // Default one-level Approver when no request yet (draft).
  return [
    {
      step_order: 1,
      approver_role_name: "Approver",
      phase: "upcoming",
      assigned_user_name: null,
    },
  ]
}
