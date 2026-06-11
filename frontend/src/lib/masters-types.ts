export type CategoryMaster = {
  id: number
  code: string
  name: string
  description: string | null
  is_active: boolean
}

export type CostCenterMaster = {
  id: number
  code: string
  name: string
  description: string
  plant_id: number
  plant_code: string | null
  plant_name: string | null
  is_active: boolean
}

/** @deprecated Use CostCenterMaster */
export type PlantChildMaster = CostCenterMaster

export type FunctionalLocationMaster = {
  id: number
  code: string
  name: string
  description: string
  plant_id: number
  plant_code: string | null
  plant_name: string | null
  is_active: boolean
}

export type ProfitCenterMaster = {
  id: number
  code: string
  name: string
  description: string
  cost_center_id: number
  cost_center_code: string | null
  plant_id: number | null
  plant_code: string | null
  plant_name: string | null
  is_active: boolean
}

/** @deprecated Use ProfitCenterMaster */
export type CostCenterChildMaster = ProfitCenterMaster

export type ActualLocationMaster = {
  id: number
  code: string
  name: string
  description: string
  functional_location_id: number
  functional_location_code: string | null
  plant_id: number | null
  plant_code: string | null
  plant_name: string | null
  is_active: boolean
}

/** @deprecated Use ActualLocationMaster */
export type FunctionalChildMaster = ActualLocationMaster

export type PlantOption = {
  id: number
  name: string
  code: string
}

export type TagColorMaster = {
  id: number
  code: string
  name: string
  color_hex: string | null
  is_active: boolean
}
