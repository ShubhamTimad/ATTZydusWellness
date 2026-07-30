import type { AssetDetail } from "@/lib/assets-types"

/** Canonical asset master fields — same order as Excel import template. */
export type AssetFieldSection = "root" | "location" | "financial" | "inventory"

export type AssetMasterFieldKind =
  | "text"
  | "textarea"
  | "date"
  | "number"
  | "category"
  | "plant"
  | "cost_center"
  | "readonly"

export type AssetMasterFieldDef = {
  key: string
  label: string
  section: AssetFieldSection
  kind?: AssetMasterFieldKind
  readonly?: boolean
}

export const ASSET_MASTER_FIELDS: AssetMasterFieldDef[] = [
  { key: "asset_name", label: "Asset name", section: "root", kind: "text" },
  { key: "asset_code", label: "Asset Number", section: "root", kind: "text" },
  { key: "combined_asset_number", label: "Combined Asset No", section: "root", kind: "text" },
  { key: "sub_no", label: "Sub-No", section: "root", kind: "text" },
  { key: "asset_category_id", label: "Asset Category", section: "root", kind: "category" },
  { key: "asset_class_id", label: "Asset Class", section: "root", kind: "text" },
  { key: "asset_type", label: "Asset Type", section: "root", kind: "text" },
  { key: "asset_condition_id", label: "Asset Physical Condition", section: "root", kind: "text" },
  { key: "asset_custodian_id", label: "Asset Custodian", section: "root", kind: "text" },
  { key: "remark", label: "Asset Remark", section: "root", kind: "textarea" },
  { key: "asset_description", label: "Asset Description", section: "root", kind: "textarea" },
  { key: "rfid_code", label: "RFID Code", section: "root", kind: "text" },
  { key: "tag_color_id", label: "Tag color", section: "root", kind: "text" },
  { key: "sub_location", label: "Sub location", section: "location", kind: "text" },
  { key: "cost_center", label: "Cost center code", section: "financial", kind: "cost_center" },
  { key: "party_details", label: "Party details", section: "financial", kind: "text" },
  { key: "invoice_no", label: "Invoice no.", section: "financial", kind: "text" },
  { key: "invoice_date", label: "Invoice date", section: "financial", kind: "date" },
  { key: "inventory_count", label: "Inventory count", section: "inventory", kind: "readonly", readonly: true },
  { key: "voucher_no", label: "Voucher no.", section: "financial", kind: "text" },
  { key: "voucher_date", label: "Voucher date", section: "financial", kind: "date" },
  { key: "grn_date", label: "GRN date", section: "financial", kind: "date" },
  { key: "grn_no", label: "GRN no.", section: "financial", kind: "text" },
  { key: "put_to_use_date", label: "Put to use", section: "financial", kind: "date" },
  { key: "depreciation_rate", label: "Rate of depreciation", section: "financial", kind: "number" },
  { key: "gross_block", label: "Gross block", section: "financial", kind: "number" },
  { key: "life_span", label: "Life span", section: "financial", kind: "text" },
  { key: "plant_id", label: "Plant name", section: "location", kind: "plant" },
]

/** Excel / CSV header row for download or documentation. */
export const ASSET_IMPORT_HEADERS = ASSET_MASTER_FIELDS.map((f) => f.label)

/** Import grid columns (canonical keys match backend import). */
export type AssetImportColumn = {
  key: string
  label: string
  kind?: "text" | "date" | "readonly" | "select"
  required?: boolean
}

/** Required for create/import (physical order prerequisites; RFID optional at create). */
export const ASSET_REQUIRED_MANUAL_FIELDS = new Set([
  "asset_name",
  "combined_asset_number",
  "asset_category_id",
  "plant_id",
  "cost_center",
  "functional_location",
  "actual_location",
])

export const ASSET_REQUIRED_IMPORT_FIELDS = new Set([
  "asset_name",
  "combined_asset_number",
  "category_code",
  "plant_code",
  "cost_center",
])

export function isAssetManualFieldRequired(key: string): boolean {
  return ASSET_REQUIRED_MANUAL_FIELDS.has(key)
}

export const ASSET_IMPORT_GRID_COLUMNS: AssetImportColumn[] = [
  { key: "asset_name", label: "Asset name", required: true },
  { key: "asset_class_code", label: "Asset Class", kind: "select" },
  { key: "asset_type", label: "Asset Type" },
  { key: "category_code", label: "Asset Category", required: true },
  { key: "combined_asset_number", label: "Combined Asset No", required: true },
  { key: "asset_code", label: "Asset Number" },
  { key: "sub_no", label: "Sub-No" },
  { key: "asset_description", label: "Asset Description" },
  { key: "remark", label: "Asset Remark" },
  { key: "rfid_code", label: "RFID Code" },
  { key: "tag_color_code", label: "Tag color", kind: "select" },
  { key: "asset_custodian_code", label: "Asset Custodian", kind: "select" },
  { key: "asset_condition_code", label: "Asset Physical Condition", kind: "select" },
  { key: "sub_location", label: "Sub location" },
  { key: "plant_code", label: "Plant Code", required: true, kind: "select" },
  { key: "plant_name", label: "Plant Name", kind: "select" },
  { key: "cost_center", label: "Cost Center Code", required: true, kind: "select" },
  { key: "cost_center_name", label: "Cost Center Name", kind: "select" },
  { key: "profit_center", label: "Profit center" },
  { key: "functional_location", label: "Actual Location 1" },
  { key: "actual_location", label: "Actual location 2" },
  { key: "capitalization_form_number", label: "CapEx form number" },
  { key: "party_details", label: "Party Details" },
  { key: "invoice_no", label: "Invoice no." },
  { key: "invoice_date", label: "Invoice date", kind: "date" },
  { key: "inventory_count", label: "Inventory count", kind: "readonly" },
  { key: "voucher_no", label: "Voucher no." },
  { key: "voucher_date", label: "Voucher date", kind: "date" },
  { key: "grn_date", label: "GRN date", kind: "date" },
  { key: "grn_no", label: "GRN no." },
  { key: "put_to_use_date", label: "Put to use", kind: "date" },
  { key: "depreciation_rate", label: "Rate of depreciation" },
  { key: "gross_block", label: "APC-IGAAP" },
  { key: "life_span", label: "Life-Span (Years)" },
  { key: "cap_date", label: "Capitalization Date", kind: "date" },
]

/** Default export columns (import-compatible). */
export const ASSET_EXPORT_DEFAULT_FIELDS = ASSET_IMPORT_GRID_COLUMNS.map((c) => c.key)

export type AssetExportFieldGroup = {
  label: string
  keys: string[]
}

/** All exportable columns grouped for the export dialog. */
export const ASSET_EXPORT_FIELD_GROUPS: AssetExportFieldGroup[] = [
  {
    label: "Import template",
    keys: ASSET_EXPORT_DEFAULT_FIELDS,
  },
  {
    label: "Additional columns",
    keys: ["profit_center", "plant_name", "category_name", "physical_count", "last_verification_date", "serial_no"],
  },
]

export const ASSET_EXPORT_FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(ASSET_IMPORT_GRID_COLUMNS.map((c) => [c.key, c.label])),
  serial_no: "Serial no.",
  functional_location: "Actual Location 1",
  actual_location: "Actual location 2",
  profit_center: "Profit center",
  plant_name: "Plant Name",
  category_name: "Category description",
  physical_count: "Physical count",
  last_verification_date: "Last verification date",
}

const DATE_KEYS = new Set([
  "invoice_date",
  "voucher_date",
  "grn_date",
  "put_to_use_date",
  "cap_date",
])

export function assetMasterFieldValue(asset: AssetDetail, def: AssetMasterFieldDef): unknown {
  if (def.key === "asset_category_id") return asset.category_name ?? asset.asset_category_id
  if (def.key === "tag_color_id") {
    return asset.tag_color_name ?? asset.tag_color_code ?? asset.tag_color_id
  }
  if (def.key === "asset_custodian_id") {
    return asset.asset_custodian_name ?? asset.asset_custodian_code ?? asset.asset_custodian_id
  }
  if (def.key === "asset_condition_id") {
    return asset.asset_condition_name ?? asset.asset_condition_code ?? asset.asset_condition_id
  }
  if (def.key === "plant_id") return asset.plant_name ?? asset.location?.plant_id
  if (def.key === "inventory_count") return asset.inventory?.inventory_count ?? 1
  if (def.section === "root") {
    return (asset as Record<string, unknown>)[def.key]
  }
  const sec = asset[def.section]
  return sec ? (sec as Record<string, unknown>)[def.key] : undefined
}

export function isAssetMasterDateField(key: string): boolean {
  return DATE_KEYS.has(key)
}

/** Display labels for asset detail sections (view + edit). */
export const ASSET_FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(ASSET_MASTER_FIELDS.map((f) => [f.key, f.label])),
  asset_category_id: "Asset Category",
  asset_code: "Asset Number",
  combined_asset_number: "Combined Asset No",
  remark: "Asset Remark",
  sub_no: "Sub-No",
  asset_description: "Asset Description",
  tag_color_id: "Tag color",
  tag_color_code: "Tag color",
  asset_custodian_id: "Asset Custodian",
  asset_custodian_code: "Asset Custodian",
  asset_condition_id: "Asset Physical Condition",
  asset_condition_code: "Asset Physical Condition",
  rfid_code: "RFID Code",
  asset_class: "Asset Class",
  asset_class_id: "Asset Class",
  asset_class_code: "Asset Class",
  asset_type: "Asset Type",
  functional_location: "Actual Location 1",
  actual_location: "Actual location 2",
  building: "Building",
  floor: "Floor",
  cost_center: "Cost Center Code",
  cost_center_name: "Cost Center Name",
  party_details: "Party Details",
  cap_date: "Capitalization Date",
  gross_block: "APC-IGAAP",
  life_span: "Life-Span (Years)",
  pm_equipment_id: "PM equipment ID",
  physical_count: "Physical count",
  last_verification_date: "Last verification date",
  fy_verification_count: "Verifications this FY",
  physical_order_id: "Physical order ID",
  physical_order_status: "Order status",
}

export type AssetViewSectionId = "information" | "location" | "financial" | "inventory"

/** How fields are grouped on the asset detail page (original multi-panel UI). */
export type AssetViewSectionConfig = {
  id: AssetViewSectionId
  title: string
  /** Keys shown in this panel, in display order. */
  keys: string[]
  dateFields?: string[]
  readOnlyKeys?: string[]
  /** Read values from asset root instead of a nested section object. */
  rootFields?: boolean
  showPlant?: boolean
  /** Override storage section for specific keys (e.g. documents on financial row). */
  fieldStorage?: Partial<Record<string, AssetViewSectionId>>
}

/**
 * Asset information panel — order matches create form / multi-column layout.
 * Asset name is included here (also shown in the page header).
 */
export const ASSET_VIEW_SECTIONS: AssetViewSectionConfig[] = [
  {
    id: "information",
    title: "Asset information",
    rootFields: true,
    keys: [
      "asset_name",
      "asset_code",
      "rfid_code",
      "combined_asset_number",
      "sub_no",
      "asset_category_id",
      "asset_class_id",
      "asset_type",
      "asset_condition_id",
      "asset_custodian_id",
      "remark",
      "asset_description",
    ],
    fieldStorage: {
      asset_description: "information",
    },
  },
  {
    id: "location",
    title: "Location",
    showPlant: true,
    keys: [
      "functional_location",
      "actual_location",
    ],
  },
  {
    id: "financial",
    title: "Financial information",
    keys: [
      "cost_center",
      "cost_center_name",
      "cap_date",
      "gross_block",
      "party_details",
      "life_span",
      "pm_equipment_id",
    ],
    dateFields: ["cap_date"],
    readOnlyKeys: [],
    fieldStorage: {
      pm_equipment_id: "information",
    },
  },
  {
    id: "inventory",
    title: "Inventory & verification",
    keys: [
      "inventory_count",
      "physical_count",
      "last_verification_date",
      "fy_verification_count",
      "physical_order_id",
      "physical_order_status",
    ],
    readOnlyKeys: [
      "inventory_count",
      "physical_count",
      "last_verification_date",
      "fy_verification_count",
      "physical_order_id",
      "physical_order_status",
    ],
  },
]

/** Optional min height for panels that must align (e.g. approval dialog). Detail page uses compact layout instead. */
export const ASSET_VIEW_PANEL_MIN_HEIGHT = "min-h-[22.5rem]"
