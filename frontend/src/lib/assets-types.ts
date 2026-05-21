export type AssetCategory = { id: number; code: string; name: string; is_active: boolean }

export type AssetListItem = {
  id: number
  asset_name: string
  asset_code: string
  category_name: string | null
  plant_name: string | null
  functional_location: string | null
  actual_location: string | null
  cost_center: string | null
  inventory_count: number | null
  physical_count: number | null
  last_verification_date: string | null
  lifecycle_status: string
  approval_status: string
  source_type: string
  created_at: string
}

export type AssetListResponse = {
  items: AssetListItem[]
  total: number
  page: number
  page_size: number
}

export type AssetSectionPayloads = {
  inventory_no?: string | null
  asset_description?: string | null
  engineering_description?: string | null
  qa_description?: string | null
  is_local_finance_user?: boolean | null
  asset_allocation?: string | null
  pm_equipment_id?: string | null
  plant_id?: number | null
  functional_location?: string | null
  actual_location?: string | null
  building?: string | null
  floor?: string | null
  room?: string | null
  zone?: string | null
  cost_center?: string | null
  profit_center?: string | null
  cap_date?: string | null
  gross_block?: number | string | null
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
  rfid_code: string | null
  serial_no: string | null
  asset_category_id: number | null
  category_name: string | null
  lifecycle_status: string
  approval_status: string
  ownership_type: string | null
  source_type: string
  import_batch_id: number | null
  created_by: number | null
  approved_by: number | null
  created_at: string
  updated_at: string
  plant_name: string | null
  information?: AssetSectionPayloads | null
  location?: AssetSectionPayloads | null
  financial?: AssetSectionPayloads | null
  inventory?: AssetSectionPayloads | null
}

export type AssetAuditEvent = {
  id: number
  action: string
  section: string | null
  actor_user_id: number | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  created_at: string
}

export type AssetsDashboardModule = {
  total_assets: number
  pending_approvals: number
  inventory_mismatch: number
  recently_added: number
  by_category: { category: string; count: number }[]
  by_plant: { plant: string; count: number }[]
}
