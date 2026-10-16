import type { AssetListItem } from "@/lib/assets-types"

export const PHYSICAL_ORDER_PREVIEW_KEY = "physical-order-preview"

export type PhysicalOrderPreviewAsset = {
  id: number
  asset_code: string
  asset_name: string
  rfid_code?: string | null
  cost_center?: string | null
  plant_name?: string | null
  inventory_count?: number | null
  physical_count?: number | null
  last_verification_date?: string | null
}

export type PhysicalOrderPreview = {
  asset_ids: number[]
  reset_verification_asset_ids: number[]
  assets: PhysicalOrderPreviewAsset[]
  selection?: AssetListItem[]
}

export function writePhysicalOrderPreview(preview: PhysicalOrderPreview) {
  try {
    sessionStorage.setItem(PHYSICAL_ORDER_PREVIEW_KEY, JSON.stringify(preview))
  } catch {
    /* quota */
  }
}
