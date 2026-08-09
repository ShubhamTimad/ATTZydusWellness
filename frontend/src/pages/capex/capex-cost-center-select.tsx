import * as React from "react"

import { adminSelectClass } from "@/components/layout/admin-ui"
import { getJson } from "@/lib/api"
import type { CostCenterMaster } from "@/lib/masters-types"
import { cn } from "@/lib/utils"

type Props = {
  id?: string
  value: number | null | undefined
  disabled?: boolean
  /** Shown when the saved cost center is no longer in the active list. */
  fallbackLabel?: string | null
  onChange: (costCenterId: number | null) => void
}

export function CapexCostCenterSelect({
  id = "cost_center_id",
  value,
  disabled,
  fallbackLabel,
  onChange,
}: Props) {
  const [items, setItems] = React.useState<CostCenterMaster[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    void getJson<CostCenterMaster[]>("/admin/asset-masters/cost-centers")
      .then((rows) => {
        if (!cancelled) setItems(rows)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const missing = value != null && !items.some((c) => c.id === value)

  return (
    <select
      id={id}
      className={cn(adminSelectClass, "h-9")}
      value={value == null ? "" : String(value)}
      disabled={disabled || loading}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{loading ? "Loading…" : "No cost center"}</option>
      {missing ? (
        <option value={String(value)}>{fallbackLabel || `Cost center #${value}`}</option>
      ) : null}
      {items.map((c) => (
        <option key={c.id} value={c.id}>
          {c.code} — {c.name}
          {c.plant_name ? ` (${c.plant_name})` : ""}
        </option>
      ))}
    </select>
  )
}
