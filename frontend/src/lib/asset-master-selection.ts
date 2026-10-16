import type { AssetListItem } from "@/lib/assets-types"

const SELECTION_KEY = "asset-master-selection"
const RETURN_KEY = "asset-master-return"

/** Survives a storage clear that races the Asset Master mount. */
let pendingReturn: AssetListItem[] | null = null

/** Snapshot enough of a list row to restore selection and list actions. */
export function asAssetListItem(
  row: Partial<AssetListItem> & Pick<AssetListItem, "id">,
): AssetListItem {
  return {
    asset_name: "",
    asset_code: "",
    rfid_code: null,
    category_name: null,
    plant_id: null,
    plant_code: null,
    plant_name: null,
    functional_location: null,
    functional_location_description: null,
    actual_location: null,
    actual_location_description: null,
    cost_center: null,
    cost_center_description: null,
    inventory_count: null,
    physical_count: null,
    last_verification_date: null,
    lifecycle_status: "active",
    approval_status: "",
    source_type: "",
    created_at: "",
    action_allowed: true,
    ...row,
    id: row.id,
  }
}

function readStoredSelection(): AssetListItem[] {
  try {
    const raw = sessionStorage.getItem(SELECTION_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AssetListItem[]
    return Array.isArray(parsed) ? parsed.filter((row) => row && Number.isFinite(row.id)) : []
  } catch {
    return []
  }
}

export function writeAssetMasterSelection(
  rows: Array<Partial<AssetListItem> & { id: number }>,
  opts?: { allowEmpty?: boolean },
) {
  try {
    const previous = new Map(readStoredSelection().map((row) => [row.id, row]))
    const seen = new Set<number>()
    const next: AssetListItem[] = []
    if (rows.length === 0 && !opts?.allowEmpty && previous.size > 0) return
    for (const row of rows) {
      if (!Number.isFinite(row.id) || seen.has(row.id)) continue
      seen.add(row.id)
      const prior = previous.get(row.id)
      next.push(
        asAssetListItem({
          ...prior,
          ...row,
          rfid_code: row.rfid_code ?? prior?.rfid_code ?? null,
        }),
      )
    }
    pendingReturn = next
    sessionStorage.setItem(SELECTION_KEY, JSON.stringify(next))
    sessionStorage.setItem(RETURN_KEY, "1")
  } catch {
    /* quota */
  }
}

/** Read the handoff without deleting it. Safe to call more than once (Strict Mode remounts). */
export function takeAssetMasterSelection(): AssetListItem[] | null {
  if (pendingReturn && pendingReturn.length > 0) return pendingReturn
  try {
    if (sessionStorage.getItem(RETURN_KEY) !== "1") return null
    const raw = sessionStorage.getItem(SELECTION_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as AssetListItem[]
    if (!Array.isArray(parsed)) return []
    const rows = parsed
      .filter((row) => row && Number.isFinite(row.id))
      .map((row) => asAssetListItem(row))
    if (rows.length > 0) pendingReturn = rows
    return rows
  } catch {
    return pendingReturn
  }
}

/** Drop a pending return unless this navigation landed on Asset Master. */
export function releaseAssetMasterSelectionUnlessReturn() {
  window.setTimeout(() => {
    if (window.location.pathname === "/dashboard/assets") return
    clearAssetMasterSelection()
  }, 0)
}

export function clearAssetMasterSelection() {
  pendingReturn = null
  try {
    sessionStorage.removeItem(SELECTION_KEY)
    sessionStorage.removeItem(RETURN_KEY)
  } catch {
    /* ignore */
  }
}
