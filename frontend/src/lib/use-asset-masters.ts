import * as React from "react"

import { getJson } from "@/lib/api"
import type {
  ActualLocationMaster,
  AssetClassMaster,
  AssetConditionMaster,
  AssetCustodianUser,
  CategoryMaster,
  CostCenterMaster,
  FunctionalLocationMaster,
  PlantOption,
  ProfitCenterMaster,
  TagColorMaster,
} from "@/lib/masters-types"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"

export function useAssetMasterLookups(
  plantId?: number | null,
  costCenterCode?: string | null,
  functionalLocationCode?: string | null,
) {
  const [categories, setCategories] = React.useState<CategoryMaster[]>([])
  const [plants, setPlants] = React.useState<PlantOption[]>([])
  const [functionalLocations, setFunctionalLocations] = React.useState<FunctionalLocationMaster[]>([])
  const [actualLocations, setActualLocations] = React.useState<ActualLocationMaster[]>([])
  const [costCenters, setCostCenters] = React.useState<CostCenterMaster[]>([])
  const [profitCenters, setProfitCenters] = React.useState<ProfitCenterMaster[]>([])
  const [tagColors, setTagColors] = React.useState<TagColorMaster[]>([])
  const [custodianUsers, setCustodianUsers] = React.useState<AssetCustodianUser[]>([])
  const [assetConditions, setAssetConditions] = React.useState<AssetConditionMaster[]>([])
  const [assetClasses, setAssetClasses] = React.useState<AssetClassMaster[]>([])

  const canRead =
    hasPermission("asset.view") || hasPermission("masters.view")
  const canReadCustodianUsers =
    hasPermission("asset.view") ||
    hasPermission("asset.create") ||
    hasPermission("asset.update")

  React.useEffect(() => {
    if (!canRead) return
    void getJson<TagColorMaster[]>("/admin/asset-masters/tag-colors")
      .then(setTagColors)
      .catch(() => setTagColors([]))
  }, [canRead])

  React.useEffect(() => {
    if (!canRead) return
    void getJson<AssetClassMaster[]>("/admin/asset-masters/asset-classes?active_only=false")
      .then(setAssetClasses)
      .catch(() => setAssetClasses([]))
  }, [canRead])

  React.useEffect(() => {
    if (!canReadCustodianUsers) return
    if (!costCenterCode) {
      if (!plantId) {
        // Unscoped (e.g. import): all users designated as custodians on any CC.
        void getJson<AssetCustodianUser[]>("/admin/assets/custodian-users")
          .then(setCustodianUsers)
          .catch(() => setCustodianUsers([]))
      } else {
        setCustodianUsers([])
      }
      return
    }
    const cc = costCenters.find((c) => c.code === costCenterCode)
    if (!cc) {
      // Cost centers still loading for this plant.
      if (plantId && costCenters.length === 0) return
      setCustodianUsers([])
      return
    }
    void getJson<AssetCustodianUser[]>(`/admin/assets/custodian-users?cost_center_id=${cc.id}`)
      .then(setCustodianUsers)
      .catch(() => setCustodianUsers([]))
  }, [canReadCustodianUsers, costCenterCode, costCenters, plantId])

  React.useEffect(() => {
    if (!canRead) return
    void getJson<AssetConditionMaster[]>("/admin/asset-masters/asset-conditions?active_only=false")
      .then(setAssetConditions)
      .catch(() => setAssetConditions([]))
  }, [canRead])

  React.useEffect(() => {
    if (!canRead) return
    void getJson<CategoryMaster[]>("/admin/asset-masters/categories")
      .then(setCategories)
      .catch(() => setCategories([]))
  }, [canRead])

  React.useEffect(() => {
    if (!canListOrgUnitsForAssignments()) return
    void getJson<PlantOption[]>("/admin/org-units?type=PLANT")
      .then(setPlants)
      .catch(() => setPlants([]))
  }, [])

  React.useEffect(() => {
    if (!canRead) return
    if (!plantId) {
      setCostCenters([])
      setFunctionalLocations([])
      return
    }
    const q = `plant_id=${plantId}&active_only=false`
    void getJson<CostCenterMaster[]>(`/admin/asset-masters/cost-centers?${q}`)
      .then(setCostCenters)
      .catch(() => setCostCenters([]))
    void getJson<FunctionalLocationMaster[]>(`/admin/asset-masters/functional-locations?${q}`)
      .then(setFunctionalLocations)
      .catch(() => setFunctionalLocations([]))
  }, [canRead, plantId])

  React.useEffect(() => {
    if (!canRead) return
    if (!plantId || !costCenterCode) {
      setProfitCenters([])
      return
    }
    const cc = costCenters.find((c) => c.code === costCenterCode)
    if (cc) {
      void getJson<ProfitCenterMaster[]>(
        `/admin/asset-masters/profit-centers?cost_center_id=${cc.id}&active_only=false`,
      )
        .then(setProfitCenters)
        .catch(() => setProfitCenters([]))
      return
    }
    void getJson<ProfitCenterMaster[]>(
      `/admin/asset-masters/profit-centers?plant_id=${plantId}&active_only=false`,
    )
      .then((rows) => setProfitCenters(rows.filter((p) => p.cost_center_code === costCenterCode)))
      .catch(() => setProfitCenters([]))
  }, [canRead, plantId, costCenterCode, costCenters])

  React.useEffect(() => {
    if (!canRead) return
    if (!plantId || !functionalLocationCode) {
      setActualLocations([])
      return
    }
    const fl = functionalLocations.find((l) => l.code === functionalLocationCode)
    if (fl) {
      void getJson<ActualLocationMaster[]>(
        `/admin/asset-masters/actual-locations?functional_location_id=${fl.id}&active_only=false`,
      )
        .then(setActualLocations)
        .catch(() => setActualLocations([]))
      return
    }
    void getJson<ActualLocationMaster[]>(
      `/admin/asset-masters/actual-locations?plant_id=${plantId}&active_only=false`,
    )
      .then((rows) =>
        setActualLocations(rows.filter((al) => al.functional_location_code === functionalLocationCode)),
      )
      .catch(() => setActualLocations([]))
  }, [canRead, plantId, functionalLocationCode, functionalLocations])

  return {
    categories,
    plants,
    functionalLocations,
    actualLocations,
    costCenters,
    profitCenters,
    tagColors,
    custodianUsers,
    assetConditions,
    assetClasses,
  }
}

export function tagColorLabel(c: TagColorMaster) {
  return c.name
}

export function assetCustodianLabel(c: AssetCustodianUser) {
  return c.full_name?.trim() || c.username
}

export function assetConditionLabel(c: AssetConditionMaster) {
  return c.name?.trim() || c.code
}

export function assetClassLabel(c: AssetClassMaster) {
  return c.name?.trim() || c.code
}

export function plantLabel(p: PlantOption) {
  return `${p.code} — ${p.name}`
}

export function categoryLabel(c: CategoryMaster) {
  return c.name?.trim() || c.code
}

/** Display label for hierarchy masters — prefer name over stored code. */
export function masterDisplayName(name?: string | null, code?: string | null): string {
  const n = name?.trim()
  if (n) return n
  return code?.trim() || "—"
}

/** Location masters: prefer name, then description; skip name when it is only the code. */
export function locationMasterLabel(m: {
  name?: string | null
  description?: string | null
  code?: string | null
}): string {
  const n = m.name?.trim() || ""
  const d = m.description?.trim() || ""
  const c = m.code?.trim() || ""
  if (n && (!c || n.toLowerCase() !== c.toLowerCase())) return n
  if (d) return d
  if (n) return n
  return c || "—"
}

export function costCenterLabel(m: { name?: string | null; code?: string | null }) {
  return masterDisplayName(m.name, m.code)
}

/** Display name with code, matching destination CC: "QC & Quality (CC-4200)". */
export function formatCostCenterWithCode(
  code: string | null | undefined,
  centers: { name?: string | null; code?: string | null; description?: string | null }[],
  fallbackDescription?: string | null,
): string {
  const c = (code ?? "").trim()
  if (!c) return "—"
  const cc = centers.find((m) => (m.code ?? "").trim() === c)
  const name = (
    cc
      ? costCenterLabel({ name: (cc.name || cc.description || "").trim() || null, code: cc.code })
      : (fallbackDescription ?? "").trim()
  ).trim()
  if (name && name.toLowerCase() !== c.toLowerCase()) return `${name} (${c})`
  return c
}

export function profitCenterLabel(m: ProfitCenterMaster) {
  return masterDisplayName(m.name, m.code)
}

export function functionalLocationLabel(m: FunctionalLocationMaster) {
  return locationMasterLabel(m)
}

export function actualLocationLabel(m: ActualLocationMaster) {
  return locationMasterLabel(m)
}

/** @deprecated Use costCenterLabel */
export function plantChildLabel(m: CostCenterMaster) {
  return costCenterLabel(m)
}

/** @deprecated Use profitCenterLabel */
export function costCenterChildLabel(m: ProfitCenterMaster) {
  return profitCenterLabel(m)
}

/** @deprecated Use actualLocationLabel */
export function functionalChildLabel(m: ActualLocationMaster) {
  return actualLocationLabel(m)
}
