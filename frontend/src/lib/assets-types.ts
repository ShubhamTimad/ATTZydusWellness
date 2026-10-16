export type AssetCategory = { id: number; code: string; name: string; is_active: boolean }

export type AssetActivePhysicalOrder = {
  order_id: number
  order_number: string
  order_status: string
  closed_at?: string | null
  has_closure_workflow?: boolean
}

export type AssetListItem = {
  id: number
  asset_name: string
  asset_code: string
  combined_asset_number?: string | null
  rfid_code: string | null
  tag_color_id?: number | null
  tag_color_code?: string | null
  tag_color_name?: string | null
  tag_color_hex?: string | null
  category_name: string | null
  sub_no?: string | null
  asset_class?: string | null
  asset_class_name?: string | null
  asset_type?: string | null
  asset_condition_name?: string | null
  plant_id: number | null
  plant_code: string | null
  plant_name: string | null
  functional_location: string | null
  functional_location_description: string | null
  actual_location: string | null
  actual_location_description: string | null
  cost_center: string | null
  cost_center_description: string | null
  cap_date?: string | null
  gross_block?: number | string | null
  party_details?: string | null
  life_span?: string | null
  pm_equipment_id?: string | null
  /** User id of the asset custodian; only they may create a transfer for this asset. */
  asset_custodian_id?: number | null
  asset_custodian_name?: string | null
  inventory_count: number | null
  physical_count: number | null
  last_verification_date: string | null
  fy_verified?: boolean | null
  fy_verification_count?: number | null
  lifecycle_status: string
  approval_status: string
  source_type: string
  created_at: string
  active_physical_order?: AssetActivePhysicalOrder | null
  /** False when the viewer can see the row but not mutate it (other cost center). */
  action_allowed?: boolean
  /** True when the viewer is the assigned approver (or in the assigned role) for pending approval. */
  can_approve?: boolean
}

export type AssetRfidAttachResult = {
  asset_id: number
  asset_code: string
  asset_name: string
  rfid_code: string
  previous_rfid_code: string | null
  operation: "attached" | "updated"
  tag_color_id?: number | null
  tag_color_code?: string | null
  tag_color_name?: string | null
  tag_color_hex?: string | null
}

/** User-facing success toast after attach/update RFID. */
export function formatRfidAttachSuccess(res: AssetRfidAttachResult): string {
  return res.operation === "updated"
    ? "Tag updated successfully."
    : "Tag linked to the asset successfully."
}

type RfidErrorDetail = {
  code?: string
  message?: string
  rfid_code?: string
  existing_asset_code?: string
}

/** User-facing error toast when attach/update RFID fails. */
export function formatRfidAttachError(error: unknown, fallback = "Failed to save RFID."): string {
  if (!(error instanceof Error)) return fallback

  const body =
    "body" in error && error.body && typeof error.body === "object"
      ? (error.body as { detail?: unknown }).detail
      : undefined

  const detail =
    body && typeof body === "object" && !Array.isArray(body) ? (body as RfidErrorDetail) : null

  if (detail?.code === "duplicate_rfid") {
    const rfid = detail.rfid_code?.trim()
    const other = detail.existing_asset_code?.trim()
    if (rfid && other) {
      return `RFID ${rfid} is already assigned to asset ${other}. Enter a different code.`
    }
    if (typeof detail.message === "string" && detail.message.trim()) return detail.message.trim()
  }

  if (detail?.code === "invalid_rfid" || detail?.code === "invalid_tag_color") {
    if (typeof detail.message === "string" && detail.message.trim()) return detail.message.trim()
  }

  const msg = error.message.trim()
  if (/Asset .+ not found/i.test(msg)) {
    const match = msg.match(/Asset ['"]?([^'"]+)['"]? not found/i)
    return match?.[1]
      ? `Asset ${match[1]} was not found. Check the asset code and try again.`
      : "Asset was not found. Check the asset code and try again."
  }
  if (msg) return msg
  return fallback
}

export type SubmitForApprovalResult = {
  submitted_count: number
  activated_count: number
  errors: string[]
}

type SubmitForApprovalMessageOpts = {
  assetCode?: string | null
  assetName?: string | null
}

function assetDisplayLabel(opts?: SubmitForApprovalMessageOpts): string | null {
  const code = opts?.assetCode?.trim()
  if (!code) return null
  const name = opts?.assetName?.trim()
  if (name && name !== code) return `${code} (${name})`
  return code
}

/** User-facing success toast for submit-for-approval API results. */
export function formatSubmitForApprovalSuccess(
  res: SubmitForApprovalResult,
  opts?: SubmitForApprovalMessageOpts,
): string | null {
  const asset = assetDisplayLabel(opts)
  const parts: string[] = []

  if (res.submitted_count > 0) {
    if (res.submitted_count === 1) {
      parts.push("Asset submitted for approval successfully")
    } else {
      parts.push("Assets submitted for approval successfully")
    }
  }

  if (res.activated_count > 0) {
    if (res.activated_count === 1) {
      parts.push(
        asset && res.submitted_count === 0
          ? `Asset ${asset} activated — no approval workflow is configured`
          : "1 asset activated — no approval workflow is configured",
      )
    } else {
      parts.push(
        `${res.activated_count} assets activated — no approval workflow is configured`,
      )
    }
  }

  return parts.length > 0 ? `${parts.join(". ")}.` : null
}

/** User-facing error toast for a submit-for-approval failure line. */
export function formatSubmitForApprovalError(
  error: string | null | undefined,
  fallback = "Asset could not be submitted for approval. Check its status and try again.",
): string {
  const msg = (error ?? "").trim()
  if (!msg) return fallback
  if (/Asset #\d+: not found\.?/i.test(msg)) {
    return msg.replace(/Asset #(\d+): not found\.?/i, "Asset #$1 was not found.")
  }
  return msg.endsWith(".") ? msg : `${msg}.`
}

export type AssetListResponse = {
  items: AssetListItem[]
  total: number
  page: number
  page_size: number
  financial_year_label?: string | null
  financial_year_start?: string | null
  financial_year_end?: string | null
  financial_year_start_year?: number | null
  financial_year_is_current?: boolean | null
  scan_window_start?: string | null
  scan_window_end?: string | null
  total_fy_verification_events?: number | null
  verified_assets_total?: number | null
  pending_assets_total?: number | null
  total_rfid_assets?: number | null
  rfid_tagged_total?: number | null
  rfid_not_tagged_total?: number | null
  tab_counts?: Record<string, number>
}

export type FinancialYearOption = {
  label: string
  start: string
  end: string
  start_year: number
  is_current: boolean
}

export type FinancialYearListResponse = {
  items: FinancialYearOption[]
  current_start_year: number
}

export type AssetSectionPayloads = {
  inventory_no?: string | null
  asset_description?: string | null
  engineering_description?: string | null
  qa_description?: string | null
  asset_allocation?: string | null
  pm_equipment_id?: string | null
  plant_id?: number | null
  sub_location?: string | null
  functional_location?: string | null
  functional_location_name?: string | null
  actual_location?: string | null
  actual_location_name?: string | null
  building?: string | null
  floor?: string | null
  room?: string | null
  zone?: string | null
  cost_center?: string | null
  cost_center_name?: string | null
  laboratory?: string | null
  profit_center?: string | null
  profit_center_name?: string | null
  cap_date?: string | null
  gross_block?: number | string | null
  party_details?: string | null
  invoice_no?: string | null
  invoice_date?: string | null
  voucher_no?: string | null
  voucher_date?: string | null
  grn_no?: string | null
  grn_date?: string | null
  put_to_use_date?: string | null
  depreciation_rate?: number | string | null
  life_span?: string | null
  vendor_name?: string | null
  po_number?: string | null
  currency?: string | null
  inventory_count?: number | null
  physical_count?: number | null
  last_verification_date?: string | null
  verification_status?: string | null
  verification_remarks?: string | null
}

export type AssetDetail = {
  id: number
  asset_name: string
  asset_code: string
  combined_asset_number: string
  remark?: string | null
  sub_no?: string | null
  rfid_code: string | null
  serial_no: string | null
  asset_category_id: number | null
  asset_class: string | null
  asset_class_id: number | null
  asset_class_code: string | null
  asset_class_name: string | null
  asset_type: string | null
  category_name: string | null
  tag_color_id: number | null
  tag_color_code: string | null
  tag_color_name: string | null
  tag_color_hex: string | null
  asset_custodian_id: number | null
  asset_custodian_code: string | null
  asset_custodian_name: string | null
  asset_condition_id: number | null
  asset_condition_code: string | null
  asset_condition_name: string | null
  lifecycle_status: string
  approval_status: string
  ownership_type: string | null
  source_type: string
  import_batch_id: number | null
  created_by: number | null
  approved_by: number | null
  created_at: string
  updated_at: string
  has_image: boolean
  image_filename: string | null
  image_content_type: string | null
  plant_code: string | null
  plant_name: string | null
  information?: AssetSectionPayloads | null
  location?: AssetSectionPayloads | null
  financial?: AssetSectionPayloads | null
  inventory?: AssetSectionPayloads | null
  financial_year_label?: string | null
  fy_verification_count?: number | null
  active_physical_order?: AssetActivePhysicalOrder | null
  physical_orders?: AssetActivePhysicalOrder[]
  capitalization_form_id?: number | null
  capitalization_form_number?: string | null
  capitalization_form_asset_name?: string | null
  approval_panel?: AssetApprovalPanel | null
  action_allowed?: boolean
}

export type AssetApprovalStepLine = {
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

export type AssetWorkflowRun = {
  attempt: number
  request_id: number
  request_status: string
  is_current: boolean
  workflow_steps: AssetApprovalStepLine[]
}

export type AssetApprovalPanel = {
  request_id: number
  request_status: string
  workflow_steps: AssetApprovalStepLine[]
  workflow_runs?: AssetWorkflowRun[]
  my_pending_task_id: number | null
  pending_task_id?: number | null
  current_assignee_user_id?: number | null
  current_assignee_name?: string | null
  current_step_role_name?: string | null
  is_final_step?: boolean
}

export type AssetAuditChangeLine = {
  field_label: string
  from_value: string
  to_value: string
}

export type AssetAuditEvent = {
  id: number
  action: string
  actor_user_id: number | null
  actor_name: string | null
  activity_verb: string
  summary: string
  changes: AssetAuditChangeLine[]
  created_at: string
}

export type AssetsDashboardModule = {
  total_assets: number
  active_assets: number
  approved_assets: number
  verified_in_fy: number
  rfid_tagged: number
  rfid_not_tagged: number
  rfid_coverage_pct: number
  pending_approvals: number
  inventory_mismatch: number
  recently_added: number
  by_category: { category: string; count: number }[]
  by_plant: { plant: string; count: number }[]
  rfid_by_plant: { plant: string; tagged: number; not_tagged: number }[]
}

export type FinancialYearDashboardModule = {
  label: string
  start: string
  end: string
  total_rfid_assets: number
  verified_in_fy: number
  pending_fy_verification: number
  total_fy_verification_events: number
  coverage_pct: number
  by_plant: { plant: string; verified: number; pending: number }[]
}

export type ItDashboardModule = {
  total_users: number
  active_users: number
  inactive_users: number
  new_users_last_7_days: number
  without_role: number
  mfa_pending: number
}
