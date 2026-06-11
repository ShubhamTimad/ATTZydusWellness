import * as React from "react"

import { getJson } from "@/lib/api"
import type {
  ActualLocationMaster,
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

  const canRead =
    hasPermission("asset.view") || hasPermission("masters.view")

  React.useEffect(() => {
    if (!canRead) return
    void getJson<TagColorMaster[]>("/admin/asset-masters/tag-colors")
      .then(setTagColors)
      .catch(() => setTagColors([]))
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
  }
}

export function tagColorLabel(c: TagColorMaster) {
  return c.name
}

export function plantLabel(p: PlantOption) {
  return `${p.code} — ${p.name}`
}

export function categoryLabel(c: CategoryMaster) {
  return `${c.code} — ${c.name}`
}

/** Display label for hierarchy masters — prefer name over stored code. */
export function masterDisplayName(name?: string | null, code?: string | null): string {
  const n = name?.trim()
  if (n) return n
  return code?.trim() || "—"
}

export function costCenterLabel(m: CostCenterMaster) {
  return masterDisplayName(m.name, m.code)
}

export function profitCenterLabel(m: ProfitCenterMaster) {
  return masterDisplayName(m.name, m.code)
}

export function functionalLocationLabel(m: FunctionalLocationMaster) {
  return masterDisplayName(m.name, m.code)
}

export function actualLocationLabel(m: ActualLocationMaster) {
  return masterDisplayName(m.name, m.code)
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
