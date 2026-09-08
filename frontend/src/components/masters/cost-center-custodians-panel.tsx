import * as React from "react"
import { ListFilter, Search, X } from "lucide-react"
import { toast } from "sonner"

import { MultiCheckList } from "@/components/admin/multi-check-list"
import {
  AdminPanel,
  AdminPrimaryButton,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import {
  AdminTablePagination,
  LIST_PAGE_SIZE,
} from "@/components/layout/list-page-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, getJson, putJson } from "@/lib/api"
import type { CostCenterMaster, PlantOption } from "@/lib/masters-types"
import { costCenterLabel, plantLabel } from "@/lib/use-asset-masters"
import { hasPermission } from "@/lib/permissions"
import { useUrlPage } from "@/lib/use-url-tab"
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
  const [page, setPage] = useUrlPage("page_custodians")
  const [plantId, setPlantId] = React.useState("")
  const [costCenters, setCostCenters] = React.useState<CostCenterMaster[]>([])
  const [costCenterId, setCostCenterId] = React.useState("")
  const [allUsers, setAllUsers] = React.useState<UserOption[]>([])
  const [selected, setSelected] = React.useState<string[]>([])
  const [userFilter, setUserFilter] = React.useState("")
  const [filtersOpen, setFiltersOpen] = React.useState(true)
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

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / LIST_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageUsers = filteredUsers.slice((safePage - 1) * LIST_PAGE_SIZE, safePage * LIST_PAGE_SIZE)

  React.useEffect(() => {
    setPage(1)
  }, [userFilter, costCenterId, setPage])

  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages, setPage])

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
      // description="Assign which users may be asset custodians for each cost center. Transfer and asset forms use this list."
      className="flex min-h-0 flex-1 flex-col"
      contentClassName="flex min-h-0 flex-1 flex-col gap-4 px-5 py-5"
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
      <div className="app-list-toolbar shrink-0">
        <div className="relative min-w-[16rem] flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            placeholder="Search users by name, username, or email"
            className="w-full pl-9"
            aria-label="Search custodians"
            disabled={!costCenterId}
          />
          {userFilter ? (
            <button
              type="button"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
              onClick={() => setUserFilter("")}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("h-9 shrink-0 gap-1.5 px-3", filtersOpen && "border-primary/40 bg-primary/5")}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <ListFilter className="size-4" aria-hidden />
          <span className="inline-flex items-center gap-0.5">
            Filter
            {plantId || costCenterId ? (
              <span className="text-xs font-medium text-red-600">
                ({(plantId ? 1 : 0) + (costCenterId ? 1 : 0)})
              </span>
            ) : null}
          </span>
        </Button>
        {userFilter || plantId ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0 gap-1.5 px-3"
            onClick={() => {
              setUserFilter("")
              setPlantId("")
              setCostCenterId("")
              setSelected([])
              setPage(1)
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>

      {filtersOpen ? (
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
      ) : null}

      <div className="mt-4 space-y-2">
        <Label>Custodians</Label>
        {!costCenterId ? (
          <p className="text-sm text-muted-foreground">Select a cost center to manage its custodians.</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <MultiCheckList
              options={pageUsers}
              values={selected}
              onChange={setSelected}
              disabled={!canUpdate}
              emptyLabel="You do not have permission to update masters."
            />
            <AdminTablePagination
              page={safePage}
              totalPages={totalPages}
              total={filteredUsers.length}
              pageSize={LIST_PAGE_SIZE}
              loading={loading}
              itemLabel="users"
              onPageChange={setPage}
            />
          </>
        )}
      </div>
    </AdminPanel>
  )
}
