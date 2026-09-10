import * as React from "react"
import { ListFilter, Plus, Search, X } from "lucide-react"
import { toast } from "sonner"

import { MultiCheckList } from "@/components/admin/multi-check-list"
import {
  AdminPrimaryButton,
  AdminTableCell,
  AdminTableEmptyRow,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import {
  AdminDataTable,
  AdminTableBodyRow,
  AdminTablePagination,
  LIST_PAGE_SIZE,
} from "@/components/layout/list-page-ui"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
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

type Assignment = {
  id: number
  user_id: number
  full_name: string
  email: string | null
  username: string | null
  cost_center_id: number
  cost_center_code: string
  cost_center_name: string
  plant_id: number
  plant_code: string | null
  plant_name: string | null
}

type CustodiansResponse = {
  items: { id: number }[]
}

const listToolbarBtnClass = "h-9 shrink-0 gap-1.5 px-3"

function HeaderLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xm font-bold uppercase tracking-wide text-black">{children}</span>
}

function plantText(row: Assignment) {
  const name = row.plant_name?.trim()
  const code = row.plant_code?.trim()
  if (name && code) return `${code} — ${name}`
  return name || code || "—"
}

function costCenterText(row: Assignment) {
  const name = row.cost_center_name?.trim()
  const code = row.cost_center_code?.trim()
  if (name && code) return `${name} (${code})`
  return name || code || "—"
}

export function CostCenterCustodiansPanel({ plants }: { plants: PlantOption[] }) {
  const canUpdate = hasPermission("masters.update")
  const [page, setPage] = useUrlPage("page_custodians")
  const [rows, setRows] = React.useState<Assignment[]>([])
  const [loading, setLoading] = React.useState(true)
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const [plantId, setPlantId] = React.useState("")
  const [costCenterId, setCostCenterId] = React.useState("")
  const [costCenters, setCostCenters] = React.useState<CostCenterMaster[]>([])

  const [manageOpen, setManageOpen] = React.useState(false)
  const [managePlantId, setManagePlantId] = React.useState("")
  const [manageCostCenters, setManageCostCenters] = React.useState<CostCenterMaster[]>([])
  const [manageCostCenterId, setManageCostCenterId] = React.useState("")
  const [allUsers, setAllUsers] = React.useState<UserOption[]>([])
  const [selected, setSelected] = React.useState<string[]>([])
  const [userFilter, setUserFilter] = React.useState("")
  const [manageLoading, setManageLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (costCenterId) params.set("cost_center_id", costCenterId)
    else if (plantId) params.set("plant_id", plantId)
    const qs = params.toString()
    void getJson<Assignment[]>(`/admin/asset-masters/cost-center-custodians${qs ? `?${qs}` : ""}`)
      .then(setRows)
      .catch(() => {
        setRows([])
        toast.error("Could not load custodians.")
      })
      .finally(() => setLoading(false))
  }, [plantId, costCenterId])

  React.useEffect(() => {
    load()
  }, [load])

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch((prev) => {
        if (prev === searchInput) return prev
        setPage(1)
        return searchInput
      })
    }, 300)
    return () => window.clearTimeout(t)
  }, [searchInput, setPage])

  React.useEffect(() => {
    setCostCenterId("")
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

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      [row.full_name, row.username, row.email, plantText(row), costCenterText(row)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    )
  }, [rows, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * LIST_PAGE_SIZE, safePage * LIST_PAGE_SIZE)
  const activeFilterCount = (plantId ? 1 : 0) + (costCenterId ? 1 : 0)
  const hasQuery = Boolean(searchInput || plantId || costCenterId)

  React.useEffect(() => {
    setPage(1)
  }, [plantId, costCenterId, setPage])

  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages, setPage])

  function openManage() {
    setManagePlantId(plantId)
    setManageCostCenterId(costCenterId)
    setUserFilter("")
    setSelected([])
    setManageOpen(true)
    if (allUsers.length === 0) {
      void getJson<UserOption[]>("/admin/asset-masters/cost-center-custodian-users")
        .then((users) =>
          setAllUsers(
            users
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
    }
  }

  React.useEffect(() => {
    if (!manageOpen || !managePlantId) {
      setManageCostCenters([])
      return
    }
    void getJson<CostCenterMaster[]>(
      `/admin/asset-masters/cost-centers?plant_id=${managePlantId}&active_only=true`,
    )
      .then(setManageCostCenters)
      .catch(() => setManageCostCenters([]))
  }, [manageOpen, managePlantId])

  React.useEffect(() => {
    if (!manageOpen || !manageCostCenterId) {
      setSelected([])
      return
    }
    let cancelled = false
    setManageLoading(true)
    void getJson<CustodiansResponse>(
      `/admin/asset-masters/cost-centers/${manageCostCenterId}/custodians`,
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
        if (!cancelled) setManageLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [manageOpen, manageCostCenterId])

  const manageUsers = React.useMemo(() => {
    const q = userFilter.trim().toLowerCase()
    const opts = allUsers.map((u) => ({
      id: u.id,
      label: u.full_name,
    }))
    if (!q) return opts
    return opts.filter((o) => o.label.toLowerCase().includes(q))
  }, [allUsers, userFilter])

  async function save() {
    if (!manageCostCenterId) return
    setSaving(true)
    try {
      await putJson<CustodiansResponse>(
        `/admin/asset-masters/cost-centers/${manageCostCenterId}/custodians`,
        { user_ids: selected.map((id) => Number(id)) },
      )
      toast.success("Cost center custodians saved.")
      setManageOpen(false)
      load()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to save custodians.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--app-grid-gap)]">
      <div className="app-list-toolbar shrink-0">
        <div className="relative min-w-[16rem] flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, username, email, plant, or cost center"
            className="w-full pl-9"
            aria-label="Search custodians"
          />
          {searchInput ? (
            <button
              type="button"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
              onClick={() => setSearchInput("")}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(listToolbarBtnClass, filtersOpen && "border-primary/40 bg-primary/5")}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <ListFilter className="size-4" aria-hidden />
          <span className="inline-flex items-center gap-0.5">
            Filter
            {activeFilterCount > 0 ? (
              <span className="text-xs font-medium text-red-600">({activeFilterCount})</span>
            ) : null}
          </span>
        </Button>
        {hasQuery ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={listToolbarBtnClass}
            onClick={() => {
              setSearchInput("")
              setSearch("")
              setPlantId("")
              setCostCenterId("")
              setPage(1)
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>

      {filtersOpen ? (
        <div className="grid shrink-0 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cc-custodian-plant">Plant</Label>
            <select
              id="cc-custodian-plant"
              className={adminSelectClass}
              value={plantId}
              onChange={(e) => setPlantId(e.target.value)}
            >
              <option value="">All plants</option>
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
              <option value="">{plantId ? "All cost centers" : "Select plant first"}</option>
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

      <AdminDataTable
        title="Custodians"
        className="min-h-0 flex-1"
        headerActions={
          canUpdate ? (
            <AdminPrimaryButton type="button" className="h-8 gap-1.5" onClick={openManage}>
              <Plus className="size-3.5" />
              Manage
            </AdminPrimaryButton>
          ) : null
        }
        footer={
          <AdminTablePagination
            page={safePage}
            totalPages={totalPages}
            total={filtered.length}
            pageSize={LIST_PAGE_SIZE}
            loading={loading}
            itemLabel="custodians"
            onPageChange={setPage}
          />
        }
      >
        <Table className="app-table-head-sticky">
          <TableHeader>
            <AdminTableHeaderRow>
              <AdminTableHeadCell>
                <HeaderLabel>Name</HeaderLabel>
              </AdminTableHeadCell>
              <AdminTableHeadCell>
                <HeaderLabel>Username</HeaderLabel>
              </AdminTableHeadCell>
              <AdminTableHeadCell>
                <HeaderLabel>Email</HeaderLabel>
              </AdminTableHeadCell>
              <AdminTableHeadCell>
                <HeaderLabel>Plant</HeaderLabel>
              </AdminTableHeadCell>
              <AdminTableHeadCell>
                <HeaderLabel>Cost center</HeaderLabel>
              </AdminTableHeadCell>
            </AdminTableHeaderRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <AdminTableEmptyRow colSpan={5}>Loading…</AdminTableEmptyRow>
            ) : pageRows.length === 0 ? (
              <AdminTableEmptyRow colSpan={5}>
                {hasQuery ? "No custodians match your search or filters." : "No custodians assigned yet."}
              </AdminTableEmptyRow>
            ) : (
              pageRows.map((row) => (
                <AdminTableBodyRow key={row.id} interactive={false}>
                  <AdminTableCell>{row.full_name}</AdminTableCell>
                  <AdminTableCell className="font-mono text-xs">{row.username || "—"}</AdminTableCell>
                  <AdminTableCell className="text-muted-foreground">{row.email || "—"}</AdminTableCell>
                  <AdminTableCell>{plantText(row)}</AdminTableCell>
                  <AdminTableCell>{costCenterText(row)}</AdminTableCell>
                </AdminTableBodyRow>
              ))
            )}
          </TableBody>
        </Table>
      </AdminDataTable>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="flex max-h-[min(90vh,40rem)] w-full flex-col overflow-hidden sm:max-w-xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>Manage Custodians</DialogTitle>
          </DialogHeader>
          <div className="dialog-body min-h-0 flex-1 space-y-4 overflow-y-auto">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="manage-custodian-plant">Plant</Label>
                <select
                  id="manage-custodian-plant"
                  className={adminSelectClass}
                  value={managePlantId}
                  onChange={(e) => {
                    setManagePlantId(e.target.value)
                    setManageCostCenterId("")
                  }}
                >
                  <option value="">Select Plant</option>
                  {plants.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {plantLabel(p)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manage-custodian-cc">Cost Center</Label>
                <select
                  id="manage-custodian-cc"
                  className={adminSelectClass}
                  value={manageCostCenterId}
                  disabled={!managePlantId}
                  onChange={(e) => setManageCostCenterId(e.target.value)}
                >
                  <option value="">{managePlantId ? "Select Cost Center" : "Select plant first"}</option>
                  {manageCostCenters.map((cc) => (
                    <option key={cc.id} value={String(cc.id)}>
                      {costCenterLabel(cc)}
                      {cc.code ? ` (${cc.code})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Custodians</Label>
              {!manageCostCenterId ? (
                <p className="text-sm text-muted-foreground">Select a cost center to assign custodians.</p>
              ) : manageLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  <Input
                    value={userFilter}
                    onChange={(e) => setUserFilter(e.target.value)}
                    placeholder="Search users by name, username, or email"
                    aria-label="Search users"
                  />
                  <MultiCheckList
                    options={manageUsers}
                    values={selected}
                    onChange={setSelected}
                    emptyLabel="No users match."
                    className="max-h-64"
                  />
                </>
              )}
            </div>
          </div>
          <div className="dialog-footer-actions shrink-0">
            <Button type="button" variant="outline" onClick={() => setManageOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <AdminPrimaryButton
              type="button"
              className="shrink-0"
              disabled={saving || manageLoading || !manageCostCenterId}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save"}
            </AdminPrimaryButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
