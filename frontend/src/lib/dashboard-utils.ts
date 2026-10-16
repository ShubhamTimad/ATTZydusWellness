/** Show plant breakdown only when there are multiple named plants (not Unassigned). */
export function shouldShowPlantBreakdown(rows: { plant: string }[] | undefined): boolean {
  if (!rows?.length) return false
  const namedPlants = new Set(
    rows.map((row) => row.plant.trim()).filter((plant) => plant && plant !== "Unassigned")
  )
  return namedPlants.size > 1
}
