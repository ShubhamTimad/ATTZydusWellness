export type CategoryMaster = {
  id: number
  code: string
  name: string
  description: string | null
  is_active: boolean
}

export type PlantChildMaster = {
  id: number
  code: string
  description: string
  plant_id: number
  plant_code: string | null
  plant_name: string | null
  is_active: boolean
}

export type CostCenterChildMaster = {
  id: number
  code: string
  description: string
  cost_center_id: number
  cost_center_code: string | null
  plant_id: number | null
  plant_code: string | null
  plant_name: string | null
  is_active: boolean
}

export type FunctionalChildMaster = {
  id: number
  code: string
  description: string
  functional_location_id: number
  functional_location_code: string | null
  plant_id: number | null
  plant_code: string | null
  plant_name: string | null
  is_active: boolean
}

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
