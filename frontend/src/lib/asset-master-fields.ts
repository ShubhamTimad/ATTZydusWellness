import type { AssetDetail } from "@/lib/assets-types"

/** Canonical asset master fields — same order as Excel import template. */
export type AssetFieldSection = "root" | "location" | "financial" | "inventory"

export type AssetMasterFieldKind =
  | "text"
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
  { key: "asset_class", label: "Asset class", section: "root", kind: "text" },
  { key: "asset_type", label: "Asset type", section: "root", kind: "text" },
  { key: "asset_category_id", label: "Asset category", section: "root", kind: "category" },
  { key: "asset_code", label: "Asset code", section: "root", kind: "text" },
  { key: "rfid_code", label: "RFID code", section: "root", kind: "text" },
  { key: "tag_color_id", label: "Tag color", section: "root", kind: "text" },
  { key: "sub_location", label: "Sub location", section: "location", kind: "text" },
  { key: "cost_center", label: "Cost center", section: "financial", kind: "cost_center" },
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
  kind?: "text" | "date" | "readonly"
}

export const ASSET_IMPORT_GRID_COLUMNS: AssetImportColumn[] = [
  { key: "asset_name", label: "Asset name" },
  { key: "asset_class", label: "Asset class" },
  { key: "asset_type", label: "Asset type" },
  { key: "category_code", label: "Asset category" },
  { key: "asset_code", label: "Asset code" },
  { key: "rfid_code", label: "RFID code" },
  { key: "tag_color_code", label: "Tag color" },
  { key: "sub_location", label: "Sub location" },
  { key: "cost_center", label: "Cost center" },
  { key: "party_details", label: "Party details" },
  { key: "invoice_no", label: "Invoice no." },
  { key: "invoice_date", label: "Invoice date", kind: "date" },
  { key: "inventory_count", label: "Inventory count", kind: "readonly" },
  { key: "voucher_no", label: "Voucher no." },
  { key: "voucher_date", label: "Voucher date", kind: "date" },
  { key: "grn_date", label: "GRN date", kind: "date" },
  { key: "grn_no", label: "GRN no." },
  { key: "put_to_use_date", label: "Put to use", kind: "date" },
  { key: "depreciation_rate", label: "Rate of depreciation" },
  { key: "gross_block", label: "Gross block" },
  { key: "life_span", label: "Life span" },
  { key: "plant_code", label: "Plant name" },
]

const DATE_KEYS = new Set([
  "invoice_date",
  "voucher_date",
  "grn_date",
  "put_to_use_date",
])

export function assetMasterFieldValue(asset: AssetDetail, def: AssetMasterFieldDef): unknown {
  if (def.key === "asset_category_id") return asset.category_name ?? asset.asset_category_id
  if (def.key === "tag_color_id") {
    return asset.tag_color_name ?? asset.tag_color_code ?? asset.tag_color_id
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
  asset_category_id: "Asset category",
  tag_color_id: "Tag color",
  tag_color_code: "Tag color",
  functional_location: "Functional location",
  actual_location: "Actual location",
  building: "Building",
  floor: "Floor",
  physical_count: "Physical count",
  last_verification_date: "Last verification date",
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
 * Four panels in a 2×2 grid (information | location, financial | inventory).
 * Invoice and voucher fields live under financial; inventory holds verification counts only.
 */
export const ASSET_VIEW_SECTIONS: AssetViewSectionConfig[] = [
  {
    id: "information",
    title: "Asset information",
    rootFields: true,
    keys: [
      "asset_name",
      "asset_class",
      "asset_type",
      "asset_category_id",
      "asset_code",
      "rfid_code",
      "tag_color_id",
    ],
  },
  {
    id: "location",
    title: "Location",
    showPlant: true,
    keys: [
      "sub_location",
      "functional_location",
      "actual_location",
      "building",
      "floor",
    ],
  },
  {
    id: "financial",
    title: "Financial detail",
    keys: [
      "cost_center",
      "party_details",
      "gross_block",
      "depreciation_rate",
      "life_span",
      "put_to_use_date",
      "voucher_date",
      "voucher_no",
      "grn_no",
      "grn_date",
      "invoice_no",
      "invoice_date",
    ],
    dateFields: ["put_to_use_date", "voucher_date", "grn_date", "invoice_date"],
  },
  {
    id: "inventory",
    title: "Inventory & verification",
    keys: ["inventory_count", "physical_count", "last_verification_date"],
    readOnlyKeys: ["inventory_count", "physical_count", "last_verification_date"],
  },
]

/** Optional min height for panels that must align (e.g. approval dialog). Detail page uses compact layout instead. */
export const ASSET_VIEW_PANEL_MIN_HEIGHT = "min-h-[22.5rem]"
