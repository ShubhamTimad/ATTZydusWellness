import * as React from "react"
import { ListFilter, PlusIcon, Search, X } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminDataTable,
  AdminTableBodyRow,
  AdminTableEmptyRow,
  AdminTablePagination,
  ListPageHeader,
  WorkspaceTabs,
  WorkspaceTabsContent,
  WorkspaceTabsList,
  WorkspaceTabsTrigger,
} from "@/components/layout/list-page-ui"
import {
  AdminPillBadge,
  AdminPrimaryButton,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { ApiError, deleteJson, getJson, postJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import {
  TRANSFER_STATUS_TABS,
  transferStatusLabel,
  transferStatusPillTone,
  transferTabEmptyMessage,
  type TransferOrderListItem,
  type TransferOrderListResponse,
} from "@/lib/transfer-types"
import { cn } from "@/lib/utils"

const listToolbarBtnClass = "h-9 shrink-0 gap-1.5 px-3"
const columnFilterControlClass = "h-8 w-full min-w-[6rem] text-xs"
const DEFAULT_TAB = "all"

type TransferColumnFilters = {
  order_number: string
  plant_id: string
  from_cost_center_id: string
  to_cost_center_id: string
  asset_count: string
  assigned_to: string
  status: string
  created_on: string
}

const DEFAULT_COLUMN_FILTERS: TransferColumnFilters = {
  order_number: "",
  plant_id: "",
  from_cost_center_id: "",
  to_cost_center_id: "",
  asset_count: "",
  assigned_to: "",
  status: "",
  created_on: "",
}

type ListFilterPlant = { id: number; code: string | null; name: string }
type ListFilterCostCenter = {
  id: number
  code: string
  name: string | null
  plant_id: number | null
}

export function TransferOrdersListPage() {
  const navigate = useNavigate()
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()
  const [tab, setTab] = React.useState<string>(DEFAULT_TAB)
  const [page, setPage] = React.useState(1)
  const [data, setData] = React.useState<TransferOrderListResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busyId, setBusyId] = React.useState<number | null>(null)
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [columnFiltersOpen, setColumnFiltersOpen] = React.useState(false)
  const [columnFilterInputs, setColumnFilterInputs] =
    React.useState<TransferColumnFilters>(DEFAULT_COLUMN_FILTERS)
  const [columnFilters, setColumnFilters] =
    React.useState<TransferColumnFilters>(DEFAULT_COLUMN_FILTERS)
  const [filterPlants, setFilterPlants] = React.useState<ListFilterPlant[]>([])
  const [filterFromCostCenters, setFilterFromCostCenters] = React.useState<
    ListFilterCostCenter[]
  >([])
  const [filterToCostCenters, setFilterToCostCenters] = React.useState<ListFilterCostCenter[]>(
    [],
  )
  const [filterStatuses, setFilterStatuses] = React.useState<string[]>([])
  const canCreate = hasPermission("transfer.create")

  const activeColumnFilterCount = Object.values(columnFilters).filter((value) => value.trim()).length

  React.useEffect(() => {
    const qs = columnFilterInputs.plant_id
      ? `?plant_id=${encodeURIComponent(columnFilterInputs.plant_id)}`
      : ""
    void getJson<{
      plants: ListFilterPlant[]
      from_cost_centers: ListFilterCostCenter[]
      to_cost_centers: ListFilterCostCenter[]
      statuses: string[]
    }>(`/admin/transfer-orders/column-filter-options${qs}`)
      .then((res) => {
        setFilterPlants(res.plants)
        setFilterFromCostCenters(res.from_cost_centers)
        setFilterToCostCenters(res.to_cost_centers)
        setFilterStatuses(res.statuses)
        setColumnFilterInputs((prev) => {
          let next = prev
          if (
            prev.from_cost_center_id &&
            !res.from_cost_centers.some((c) => String(c.id) === prev.from_cost_center_id)
          ) {
            next = { ...next, from_cost_center_id: "" }
          }
          if (
            prev.to_cost_center_id &&
            !res.to_cost_centers.some((c) => String(c.id) === prev.to_cost_center_id)
          ) {
            next = { ...next, to_cost_center_id: "" }
          }
          if (prev.status && !res.statuses.includes(prev.status)) {
            next = { ...next, status: "" }
          }
          return next
        })
      })
      .catch(() => {
        setFilterPlants([])
        setFilterFromCostCenters([])
        setFilterToCostCenters([])
        setFilterStatuses([])
      })
  }, [columnFilterInputs.plant_id])

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams({ tab, page: String(page), page_size: "25" })
      if (search.trim()) q.set("search", search.trim())
      if (columnFilters.order_number.trim()) q.set("order_number", columnFilters.order_number.trim())
      if (columnFilters.plant_id.trim()) q.set("plant_id", columnFilters.plant_id.trim())
      if (columnFilters.from_cost_center_id.trim()) {
        q.set("from_cost_center_id", columnFilters.from_cost_center_id.trim())
      }
      if (columnFilters.to_cost_center_id.trim()) {
        q.set("to_cost_center_id", columnFilters.to_cost_center_id.trim())
      }
      if (columnFilters.asset_count.trim()) q.set("asset_count", columnFilters.asset_count.trim())
      if (columnFilters.assigned_to.trim()) q.set("assigned_to", columnFilters.assigned_to.trim())
      if (columnFilters.status.trim()) q.set("status", columnFilters.status.trim())
      if (columnFilters.created_on.trim()) q.set("created_on", columnFilters.created_on.trim())
      const res = await getJson<TransferOrderListResponse>(`/admin/transfer-orders?${q}`)
      setData(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load transfer orders")
    } finally {
      setLoading(false)
    }
  }, [tab, page, search, columnFilters])

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, 300)
    return () => window.clearTimeout(t)
  }, [searchInput])

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setColumnFilters((prev) => {
        const changed = Object.entries(columnFilterInputs).some(
          ([k, v]) => prev[k as keyof TransferColumnFilters] !== v,
        )
        if (!changed) return prev
        setPage(1)
        return { ...columnFilterInputs }
      })
    }, 300)
    return () => window.clearTimeout(t)
  }, [columnFilterInputs])

  React.useEffect(() => {
    void load()
  }, [load])

  function clearFilters() {
    setSearchInput("")
    setSearch("")
    setColumnFilterInputs({ ...DEFAULT_COLUMN_FILTERS })
    setColumnFilters({ ...DEFAULT_COLUMN_FILTERS })
    setPage(1)
  }

  async function discardRow(row: TransferOrderListItem) {
    if (row.can_delete) {
      const ok = await confirmAsk({
        title: "Delete draft transfer?",
        description: `Permanently delete draft ${row.order_number}? This cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      })
      if (!ok) return
      setBusyId(row.id)
      try {
        await deleteJson(`/admin/transfer-orders/${row.id}`)
        toast.success("Draft transfer order deleted.")
        await load()
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Could not delete transfer order")
      } finally {
        setBusyId(null)
      }
      return
    }
    if (row.can_archive) {
      const ok = await confirmAsk({
        title: "Archive transfer order?",
        description: `Archive ${row.order_number}? It will be cancelled and kept in the audit trail.`,
        confirmLabel: "Archive",
      })
      if (!ok) return
      setBusyId(row.id)
      try {
        await postJson(`/admin/transfer-orders/${row.id}/archive`, {})
        toast.success("Transfer order archived.")
        await load()
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Could not archive transfer order")
      } finally {
        setBusyId(null)
      }
      return
    }
    if (row.can_unarchive) {
      const ok = await confirmAsk({
        title: "Unarchive transfer order?",
        description: `Restore ${row.order_number} so you can edit and resubmit it?`,
        confirmLabel: "Unarchive",
      })
      if (!ok) return
      setBusyId(row.id)
      try {
        await postJson(`/admin/transfer-orders/${row.id}/unarchive`, {})
        toast.success("Transfer order unarchived.")
        await load()
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Could not unarchive transfer order")
      } finally {
        setBusyId(null)
      }
    }
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageSize = data?.page_size ?? 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const counts = data?.tab_counts ?? {}
  const showDiscard = items.some((r) => r.can_delete || r.can_archive || r.can_unarchive)
  const colSpan = 8 + (showDiscard ? 1 : 0)

  return (
    <AdminPage fullWidth dense className="w-full">
      <ListPageHeader
        title="Asset Transfer Orders"
        description="Needs my action is work waiting on you. Done is closed or cancelled. All shows every transfer."
        actions={
          canCreate ? (
            <AdminPrimaryButton
              type="button"
              onClick={() => navigate("/dashboard/transfer-orders/new")}
            >
              <PlusIcon className="h-4 w-4" />
              Create transfer
            </AdminPrimaryButton>
          ) : null
        }
      />

      <WorkspaceTabs
        value={tab}
        onValueChange={(v) => {
          setTab(v)
          setPage(1)
        }}
      >
        <WorkspaceTabsList>
          {TRANSFER_STATUS_TABS.map((t) => {
            const count = counts[t.key]
            const highlight = t.key === "needs_action" && typeof count === "number" && count > 0
            return (
              <WorkspaceTabsTrigger key={t.key} value={t.key}>
                <span className="inline-flex items-center gap-1.5">
                  {t.label}
                  {typeof count === "number" ? (
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                        highlight
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  ) : null}
                </span>
              </WorkspaceTabsTrigger>
            )
          })}
        </WorkspaceTabsList>
        <WorkspaceTabsContent
          value={tab}
          className="mt-4 flex min-h-0 flex-1 flex-col gap-[var(--app-grid-gap)]"
        >
          <div className="app-list-toolbar">
            <div className="relative min-w-[16rem] flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="transfers-search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search order number, plant, cost center, assignee…"
                className="w-full pl-9"
                aria-label="Search transfer orders"
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
              className={cn(
                listToolbarBtnClass,
                columnFiltersOpen && "border-primary/40 bg-primary/5",
              )}
              aria-expanded={columnFiltersOpen}
              onClick={() => setColumnFiltersOpen((open) => !open)}
            >
              <ListFilter className="size-4" aria-hidden />
              Filter
              {activeColumnFilterCount > 0 ? (
                <Badge variant="secondary" className="h-5 min-w-5 rounded-full px-1.5 text-[10px]">
                  {activeColumnFilterCount}
                </Badge>
              ) : null}
            </Button>

              {activeColumnFilterCount > 0 || search.trim() ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={listToolbarBtnClass}
                  onClick={clearFilters}
                >
                  Clear
                </Button>
              ) : null}
          </div>

          <AdminDataTable
            footer={
              <AdminTablePagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                loading={loading}
                itemLabel="orders"
                onPageChange={setPage}
              />
            }
          >
            <Table className="app-table-head-sticky">
              <TableHeader>
                <AdminTableHeaderRow>
                  <AdminTableHeadCell>Order</AdminTableHeadCell>
                  <AdminTableHeadCell>Plant</AdminTableHeadCell>
                  <AdminTableHeadCell>From CC</AdminTableHeadCell>
                  <AdminTableHeadCell>To CC</AdminTableHeadCell>
                  <AdminTableHeadCell>Assets</AdminTableHeadCell>
                  <AdminTableHeadCell>Assignee</AdminTableHeadCell>
                  <AdminTableHeadCell>Status</AdminTableHeadCell>
                  <AdminTableHeadCell>Created</AdminTableHeadCell>
                  {showDiscard ? (
                    <AdminTableHeadCell className="text-right">Actions</AdminTableHeadCell>
                  ) : null}
                </AdminTableHeaderRow>
                {columnFiltersOpen ? (
                  <AdminTableHeaderRow>
                    <AdminTableHeadCell className="px-2 py-1.5">
                      <Input
                        value={columnFilterInputs.order_number}
                        onChange={(e) =>
                          setColumnFilterInputs((f) => ({ ...f, order_number: e.target.value }))
                        }
                        aria-label="Filter order number"
                        placeholder="Order number"
                        className={columnFilterControlClass}
                      />
                    </AdminTableHeadCell>
                    <AdminTableHeadCell className="px-2 py-1.5">
                      <select
                        className={cn(adminSelectClass, columnFilterControlClass)}
                        value={columnFilterInputs.plant_id}
                        aria-label="Filter plant"
                        onChange={(e) =>
                          setColumnFilterInputs((f) => ({
                            ...f,
                            plant_id: e.target.value,
                            from_cost_center_id: "",
                            to_cost_center_id: "",
                          }))
                        }
                      >
                        <option value="">All plants</option>
                        {filterPlants.map((p) => (
                          <option key={p.id} value={String(p.id)}>
                            {p.code ? `${p.code} — ${p.name}` : p.name}
                          </option>
                        ))}
                      </select>
                    </AdminTableHeadCell>
                    <AdminTableHeadCell className="px-2 py-1.5">
                      <select
                        className={cn(adminSelectClass, columnFilterControlClass)}
                        value={columnFilterInputs.from_cost_center_id}
                        aria-label="Filter from cost center"
                        onChange={(e) =>
                          setColumnFilterInputs((f) => ({
                            ...f,
                            from_cost_center_id: e.target.value,
                          }))
                        }
                      >
                        <option value="">All from CC</option>
                        {filterFromCostCenters.map((c) => (
                          <option key={c.id} value={String(c.id)}>
                            {c.name?.trim() ? `${c.code} — ${c.name}` : c.code}
                          </option>
                        ))}
                      </select>
                    </AdminTableHeadCell>
                    <AdminTableHeadCell className="px-2 py-1.5">
                      <select
                        className={cn(adminSelectClass, columnFilterControlClass)}
                        value={columnFilterInputs.to_cost_center_id}
                        aria-label="Filter to cost center"
                        onChange={(e) =>
                          setColumnFilterInputs((f) => ({
                            ...f,
                            to_cost_center_id: e.target.value,
                          }))
                        }
                      >
                        <option value="">All to CC</option>
                        {filterToCostCenters.map((c) => (
                          <option key={c.id} value={String(c.id)}>
                            {c.name?.trim() ? `${c.code} — ${c.name}` : c.code}
                          </option>
                        ))}
                      </select>
                    </AdminTableHeadCell>
                    <AdminTableHeadCell className="px-2 py-1.5">
                      <Input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={columnFilterInputs.asset_count}
                        onChange={(e) =>
                          setColumnFilterInputs((f) => ({ ...f, asset_count: e.target.value }))
                        }
                        aria-label="Filter asset count"
                        placeholder="Assets"
                        className={columnFilterControlClass}
                      />
                    </AdminTableHeadCell>
                    <AdminTableHeadCell className="px-2 py-1.5">
                      <Input
                        value={columnFilterInputs.assigned_to}
                        onChange={(e) =>
                          setColumnFilterInputs((f) => ({ ...f, assigned_to: e.target.value }))
                        }
                        aria-label="Filter assignee"
                        placeholder="Assignee"
                        className={columnFilterControlClass}
                      />
                    </AdminTableHeadCell>
                    <AdminTableHeadCell className="px-2 py-1.5">
                      <select
                        className={cn(adminSelectClass, columnFilterControlClass)}
                        value={columnFilterInputs.status}
                        aria-label="Filter status"
                        onChange={(e) =>
                          setColumnFilterInputs((f) => ({ ...f, status: e.target.value }))
                        }
                      >
                        <option value="">All statuses</option>
                        {filterStatuses.map((status) => (
                          <option key={status} value={status}>
                            {transferStatusLabel(status)}
                          </option>
                        ))}
                      </select>
                    </AdminTableHeadCell>
                    <AdminTableHeadCell className="px-2 py-1.5">
                      <Input
                        type="date"
                        value={columnFilterInputs.created_on}
                        onChange={(e) =>
                          setColumnFilterInputs((f) => ({ ...f, created_on: e.target.value }))
                        }
                        aria-label="Filter created date"
                        className={columnFilterControlClass}
                      />
                    </AdminTableHeadCell>
                    {showDiscard ? <AdminTableHeadCell className="px-2 py-1.5">{null}</AdminTableHeadCell> : null}
                  </AdminTableHeaderRow>
                ) : null}
              </TableHeader>
              <TableBody>
                {loading && items.length === 0 ? (
                  <AdminTableEmptyRow colSpan={colSpan}>Loading…</AdminTableEmptyRow>
                ) : items.length === 0 ? (
                  <AdminTableEmptyRow colSpan={colSpan}>
                    {search.trim() || activeColumnFilterCount > 0
                      ? "No orders match your search or filters."
                      : transferTabEmptyMessage(tab)}
                  </AdminTableEmptyRow>
                ) : (
                  items.map((row) => (
                    <AdminTableBodyRow
                      key={row.id}
                      className={cn(
                        "cursor-pointer",
                        row.needs_my_action && "bg-primary/[0.03]",
                      )}
                      onClick={() => navigate(`/dashboard/transfer-orders/${row.id}`)}
                    >
                      <AdminTableCell className="font-medium">{row.order_number}</AdminTableCell>
                      <AdminTableCell>{row.plant_name}</AdminTableCell>
                      <AdminTableCell>{row.from_cost_center_code ?? "—"}</AdminTableCell>
                      <AdminTableCell>{row.to_cost_center_code}</AdminTableCell>
                      <AdminTableCell className="tabular-nums">{row.asset_count}</AdminTableCell>
                      <AdminTableCell>{row.assigned_to_name ?? "—"}</AdminTableCell>
                      <AdminTableCell>
                        <AdminPillBadge tone={transferStatusPillTone(row.status)}>
                          {transferStatusLabel(row.status)}
                        </AdminPillBadge>
                      </AdminTableCell>
                      <AdminTableCell className="text-muted-foreground">
                        {new Date(row.created_at).toLocaleDateString()}
                      </AdminTableCell>
                      {showDiscard ? (
                        <AdminTableCell className="text-right">
                          {row.can_delete || row.can_archive || row.can_unarchive ? (
                            <Button
                              type="button"
                              variant={row.can_delete ? "destructive" : "outline"}
                              size="sm"
                              className="h-8"
                              disabled={busyId === row.id}
                              onClick={(e) => {
                                e.stopPropagation()
                                void discardRow(row)
                              }}
                            >
                              {row.can_delete ? "Delete" : row.can_archive ? "Archive" : "Unarchive"}
                            </Button>
                          ) : null}
                        </AdminTableCell>
                      ) : null}
                    </AdminTableBodyRow>
                  ))
                )}
              </TableBody>
            </Table>
          </AdminDataTable>
        </WorkspaceTabsContent>
      </WorkspaceTabs>
      {confirmDialog}
    </AdminPage>
  )
}
