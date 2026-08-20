import * as React from "react"
import { toast } from "sonner"

import { MultiCheckList } from "@/components/admin/multi-check-list"
import {
  AdminPanel,
  AdminPrimaryButton,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { Label } from "@/components/ui/label"
import { ApiError, getJson, putJson } from "@/lib/api"
import type { CostCenterMaster, PlantOption } from "@/lib/masters-types"
import { costCenterLabel, plantLabel } from "@/lib/use-asset-masters"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type UserOption = {
  id: number
  username: string
  full_name: string
  email: string | null
}

type CustodiansResponse = {
  cost_center_id: number
  cost_center_code: string
  cost_center_name: string
  plant_id: number
  items: { id: number; full_name: string; email: string | null; username: string | null }[]
}

export function CostCenterCustodiansPanel({ plants }: { plants: PlantOption[] }) {
  const canUpdate = hasPermission("masters.update")
  const [plantId, setPlantId] = React.useState("")
  const [costCenters, setCostCenters] = React.useState<CostCenterMaster[]>([])
  const [costCenterId, setCostCenterId] = React.useState("")
  const [allUsers, setAllUsers] = React.useState<UserOption[]>([])
  const [selected, setSelected] = React.useState<string[]>([])
  const [userFilter, setUserFilter] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    void getJson<UserOption[]>("/admin/asset-masters/cost-center-custodian-users")
      .then((rows) =>
        setAllUsers(
          rows
            .map((u) => ({
              id: u.id,
              username: u.username ?? "",
              full_name: u.full_name,
              email: u.email,
            }))
            .sort((a, b) => a.full_name.localeCompare(b.full_name)),
        ),
      )
      .catch(() => setAllUsers([]))
  }, [])

  React.useEffect(() => {
    setCostCenterId("")
    setSelected([])
    if (!plantId) {
      setCostCenters([])
      return
    }
    void getJson<CostCenterMaster[]>(
      `/admin/asset-masters/cost-centers?plant_id=${plantId}&active_only=true`,
    )
      .then(setCostCenters)
      .catch(() => {
        setCostCenters([])
        toast.error("Could not load cost centers.")
      })
  }, [plantId])

  React.useEffect(() => {
    if (!costCenterId) {
      setSelected([])
      return
    }
    let cancelled = false
    setLoading(true)
    void getJson<CustodiansResponse>(
      `/admin/asset-masters/cost-centers/${costCenterId}/custodians`,
    )
      .then((res) => {
        if (!cancelled) setSelected(res.items.map((u) => String(u.id)))
      })
      .catch(() => {
        if (!cancelled) {
          setSelected([])
          toast.error("Could not load custodians.")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [costCenterId])

  const filteredUsers = React.useMemo(() => {
    const q = userFilter.trim().toLowerCase()
    const opts = allUsers.map((u) => ({
      id: u.id,
      label: `${u.full_name} (${u.username})${u.email ? ` — ${u.email}` : ""}`,
    }))
    if (!q) return opts
    return opts.filter((o) => o.label.toLowerCase().includes(q))
  }, [allUsers, userFilter])

  async function save() {
    if (!costCenterId) return
    setSaving(true)
    try {
      await putJson<CustodiansResponse>(
        `/admin/asset-masters/cost-centers/${costCenterId}/custodians`,
        { user_ids: selected.map((id) => Number(id)) },
      )
      toast.success("Cost center custodians saved.")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to save custodians.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminPanel
      title="Custodians"
      description="Assign which users may be asset custodians for each cost center. Transfer and asset forms use this list."
      contentClassName="px-5 py-5"
      footer={
        canUpdate && costCenterId ? (
          <div className="flex justify-end">
            <AdminPrimaryButton type="button" disabled={saving || loading} onClick={() => void save()}>
              {saving ? "Saving…" : "Save custodians"}
            </AdminPrimaryButton>
          </div>
        ) : null
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cc-custodian-plant">Plant</Label>
          <select
            id="cc-custodian-plant"
            className={adminSelectClass}
            value={plantId}
            onChange={(e) => setPlantId(e.target.value)}
          >
            <option value="">Select plant</option>
            {plants.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {plantLabel(p)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cc-custodian-cc">Cost center</Label>
          <select
            id="cc-custodian-cc"
            className={adminSelectClass}
            value={costCenterId}
            disabled={!plantId}
            onChange={(e) => setCostCenterId(e.target.value)}
          >
            <option value="">{plantId ? "Select cost center" : "Select plant first"}</option>
            {costCenters.map((cc) => (
              <option key={cc.id} value={String(cc.id)}>
                {costCenterLabel(cc)}
                {cc.code ? ` (${cc.code})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Custodians</Label>
          {costCenterId ? (
            <input
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              placeholder="Filter users…"
              className={cn(
                "h-8 w-full max-w-xs rounded-md border border-input bg-background px-2.5 text-xs shadow-sm",
              )}
              disabled={!canUpdate}
            />
          ) : null}
        </div>
        {!costCenterId ? (
          <p className="text-sm text-muted-foreground">Select a cost center to manage its custodians.</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <MultiCheckList
            options={filteredUsers}
            values={selected}
            onChange={setSelected}
            disabled={!canUpdate}
            emptyLabel="You do not have permission to update masters."
          />
        )}
      </div>
    </AdminPanel>
  )
}
