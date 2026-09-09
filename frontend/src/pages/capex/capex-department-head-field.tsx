import * as React from "react"

import { adminSelectClass } from "@/components/layout/admin-ui"
import { Input } from "@/components/ui/input"
import { ApiError, getJson } from "@/lib/api"
import type { CapexAssigneeListResponse, CapexAssigneeOption } from "@/lib/capex-types"
import { toast } from "sonner"

const OTHER = "__other__"

export function CapexDepartmentHeadField({
  costCenterId,
  value,
  disabled,
  onChange,
}: {
  costCenterId: number | null
  value: string
  disabled?: boolean
  onChange: (next: string) => void
}) {
  const [items, setItems] = React.useState<CapexAssigneeOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [other, setOther] = React.useState(false)

  React.useEffect(() => {
    if (costCenterId == null) {
      setItems([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void getJson<CapexAssigneeListResponse>(
      `/admin/capitalization-forms/assignees?level=hod&cost_center_id=${costCenterId}`,
    )
      .then((res) => {
        if (!cancelled) setItems(res.items)
      })
      .catch((e) => {
        if (!cancelled) {
          setItems([])
          toast.error(e instanceof ApiError ? e.message : "Could not load department heads.")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [costCenterId])

  const names = React.useMemo(() => new Set(items.map((item) => item.full_name)), [items])
  const listed = Boolean(value && names.has(value))
  const showOther = other || Boolean(value && !listed && !loading)

  return (
    <div className="space-y-2">
      <select
        id="department_head"
        className={adminSelectClass}
        value={listed ? value : showOther ? OTHER : ""}
        disabled={disabled || costCenterId == null || loading}
        onChange={(e) => {
          const next = e.target.value
          if (next === OTHER) {
            setOther(true)
            if (listed) onChange("")
            return
          }
          setOther(false)
          onChange(next)
        }}
      >
        <option value="">
          {costCenterId == null
            ? "Select cost center first"
            : loading
              ? "Loading…"
              : "Select Department Head"}
        </option>
        {items.map((user) => (
          <option key={user.id} value={user.full_name}>
            {user.full_name}
          </option>
        ))}
        {!listed && value ? <option value={value}>{value}</option> : null}
        <option value={OTHER}>Other</option>
      </select>
      {showOther ? (
        <Input
          value={listed ? "" : value}
          disabled={disabled}
          placeholder="Enter Department Head Name"
          onChange={(e) => onChange(e.target.value)}
          aria-label="Other department head name"
        />
      ) : null}
    </div>
  )
}
