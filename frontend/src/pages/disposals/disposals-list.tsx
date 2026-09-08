import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { ListFilter, Search, X } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminDataTable,
  AdminTableBodyRow,
  AdminTableEmptyRow,
  AdminTableLoadingRow,
  AdminTablePagination,
  ListPageHeader,
  WorkspaceTabs,
  WorkspaceTabsContent,
  WorkspaceTabsList,
  WorkspaceTabsTrigger,
} from "@/components/layout/list-page-ui"
import {
  AdminPillBadge,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import {
  nextColumnSort,
  SortableColumnHeader,
  type SortDir,
} from "@/components/layout/sortable-column-header"
import { Button } from "@/components/ui/button"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { ApiError, deleteJson, getJson, postJson } from "@/lib/api"
import { disposalListRootKey } from "@/lib/query-client"
import {
  DISPOSAL_STATUS_TABS,
  disposalStatusLabel,
  disposalStatusPillTone,
  disposalTabEmptyMessage,
  type DisposalOrderListItem,
  type DisposalOrderListResponse,
} from "@/lib/disposal-types"
import { formatAppDate } from "@/lib/dates"
import { useUrlPage, useUrlTab } from "@/lib/use-url-tab"
import { cn } from "@/lib/utils"

const listToolbarBtnClass = "h-9 shrink-0 gap-1.5 px-3"
const columnFilterControlClass = "h-8 w-full min-w-[6rem] text-xs"
const DEFAULT_TAB = "all"
const DISPOSAL_TAB_KEYS = ["all", "needs_action"] as const

type DisposalColumnFilters = {
  order_number: string
  plant_id: string
  from_cost_center_id: string
  asset_count: string
  assigned_to: string
  status: string
  created_on: string
}

const DEFAULT_COLUMN_FILTERS: DisposalColumnFilters = {
  order_number: "",
  plant_id: "",
  from_cost_center_id: "",
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

export function DisposalOrdersListPage() {
  const navigate = useNavigate()
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()
  const [tab, setTab] = useUrlTab(DISPOSAL_TAB_KEYS, DEFAULT_TAB)
  const [page, setPage] = useUrlPage()
  const [busyId, setBusyId] = React.useState<number | null>(null)
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [columnFiltersOpen, setColumnFiltersOpen] = React.useState(false)
  const [columnFilterInputs, setColumnFilterInputs] =
    React.useState<DisposalColumnFilters>(DEFAULT_COLUMN_FILTERS)
  const [columnFilters, setColumnFilters] =
    React.useState<DisposalColumnFilters>(DEFAULT_COLUMN_FILTERS)
  const [filterPlants, setFilterPlants] = React.useState<ListFilterPlant[]>([])
  const [filterFromCostCenters, setFilterFromCostCenters] = React.useState<
    ListFilterCostCenter[]
  >([])
  const [filterStatuses, setFilterStatuses] = React.useState<string[]>([])
  const [sortBy, setSortBy] = React.useState("created_at")
  const [sortDir, setSortDir] = React.useState<SortDir>("desc")

  const activeColumnFilterCount = Object.values(columnFilters).filter((value) => value.trim()).length

  React.useEffect(() => {
    const qs = columnFilterInputs.plant_id
      ? `?plant_id=${encodeURIComponent(columnFilterInputs.plant_id)}`
      : ""
    void getJson<{
      plants: ListFilterPlant[]
      from_cost_centers: ListFilterCostCenter[]
      statuses: string[]
    }>(`/admin/disposal-orders/column-filter-options${qs}`)
      .then((res) => {
        setFilterPlants(res.plants)
        setFilterFromCostCenters(res.from_cost_centers)
        setFilterStatuses(res.statuses)
        setColumnFilterInputs((prev) => {
          let next = prev
          if (
            prev.from_cost_center_id &&
            !res.from_cost_centers.some((c) => String(c.id) === prev.from_cost_center_id)
          ) {
            next = { ...next, from_cost_center_id: "" }
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
        setFilterStatuses([])
      })
  }, [columnFilterInputs.plant_id])

  const disposalsQuery = useQuery({
    queryKey: [...disposalListRootKey, { tab, page, search, columnFilters, sortBy, sortDir }],
    queryFn: async () => {
      const q = new URLSearchParams({ tab, page: String(page), page_size: "25" })
      if (search.trim()) q.set("search", search.trim())
      if (columnFilters.order_number.trim()) q.set("order_number", columnFilters.order_number.trim())
      if (columnFilters.plant_id.trim()) q.set("plant_id", columnFilters.plant_id.trim())
      if (columnFilters.from_cost_center_id.trim()) {
        q.set("from_cost_center_id", columnFilters.from_cost_center_id.trim())
      }
      if (columnFilters.asset_count.trim()) q.set("asset_count", columnFilters.asset_count.trim())
      if (columnFilters.assigned_to.trim()) q.set("assigned_to", columnFilters.assigned_to.trim())
      if (columnFilters.status.trim()) q.set("status", columnFilters.status.trim())
      if (columnFilters.created_on.trim()) q.set("created_on", columnFilters.created_on.trim())
      q.set("sort_by", sortBy)
      q.set("sort_dir", sortDir)
      return getJson<DisposalOrderListResponse>(`/admin/disposal-orders?${q}`)
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: (query) => query.state.isInvalidated,
  })
  const data = disposalsQuery.data ?? null
  const loading = disposalsQuery.isPending && !disposalsQuery.data

  React.useEffect(() => {
    if (disposalsQuery.error) {
      toast.error(
        disposalsQuery.error instanceof Error
          ? disposalsQuery.error.message
          : "Failed to load disposal orders",
      )
    }
  }, [disposalsQuery.error])

  const load = React.useCallback(async () => {
    await disposalsQuery.refetch()
  }, [disposalsQuery])

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
    const t = window.setTimeout(() => {
      setColumnFilters((prev) => {
        const changed = Object.entries(columnFilterInputs).some(
          ([k, v]) => prev[k as keyof DisposalColumnFilters] !== v,
        )
        if (!changed) return prev
        setPage(1)
        return { ...columnFilterInputs }
      })
    }, 300)
    return () => window.clearTimeout(t)
  }, [columnFilterInputs])

  function clearFilters() {
    setSearchInput("")
    setSearch("")
    setColumnFilterInputs({ ...DEFAULT_COLUMN_FILTERS })
    setColumnFilters({ ...DEFAULT_COLUMN_FILTERS })
    setPage(1)
  }

  function toggleColumnSort(columnKey: string) {
    const next = nextColumnSort(
      sortBy,
      sortDir,
      columnKey,
      columnKey === "created_at" || columnKey === "asset_count" ? "desc" : "asc",
    )
    setSortBy(next.sort_by)
    setSortDir(next.sort_dir)
    setPage(1)
  }

  async function discardRow(row: DisposalOrderListItem) {
    if (row.can_delete) {
      const ok = await confirmAsk({
        title: "Delete draft disposal?",
        description: `Permanently delete draft ${row.order_number} and reactivate its assets? This cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      })
      if (!ok) return
      setBusyId(row.id)
      try {
        await deleteJson(`/admin/disposal-orders/${row.id}`)
        toast.success("Draft disposal order deleted. Assets reactivated.")
        await load()
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Could not delete disposal order")
      } finally {
        setBusyId(null)
      }
      return
    }
    if (row.can_archive) {
      const ok = await confirmAsk({
        title: "Archive disposal order?",
        description: `Archive ${row.order_number} and reactivate its assets? The order stays for audit history.`,
        confirmLabel: "Archive",
      })
      if (!ok) return
      setBusyId(row.id)
      try {
        await postJson(`/admin/disposal-orders/${row.id}/archive`, {})
        toast.success("Disposal order archived. Assets reactivated.")
        await load()
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Could not archive disposal order")
      } finally {
        setBusyId(null)
      }
      return
    }
    if (row.can_unarchive) {
      const ok = await confirmAsk({
        title: "Unarchive disposal order?",
        description: `Restore ${row.order_number} so you can edit and resubmit it?`,
        confirmLabel: "Unarchive",
      })
      if (!ok) return
      setBusyId(row.id)
      try {
        await postJson(`/admin/disposal-orders/${row.id}/unarchive`, {})
        toast.success("Disposal order unarchived.")
        await load()
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Could not unarchive disposal order")
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
  const showDiscard = true
  const colSpan = 7 + (showDiscard ? 1 : 0)

  return (
    <AdminPage fullWidth dense viewportFill className="w-full gap-[var(--app-grid-gap)]">
      {confirmDialog}
      <ListPageHeader
        className="shrink-0"
        title="Asset Disposal Order"
        // description="Pending action is work waiting on you. Done is closed or archived. All shows every disposal."
      />

      <WorkspaceTabs
        value={tab}
        onValueChange={(v) => {
          setTab(v)
          setPage(1)
        }}
        className="min-h-0 flex-1"
      >
        <WorkspaceTabsList className="shrink-0">
          {DISPOSAL_STATUS_TABS.map((t) => {
            const count = counts[t.key]
            return (
              <WorkspaceTabsTrigger key={t.key} value={t.key}>
                {t.label}
                <span className="ml-1.5 inline-block min-w-[3.25rem] text-left tabular-nums text-muted-foreground">
                  {typeof count === "number" ? `(${count})` : "\u00a0"}
                </span>
              </WorkspaceTabsTrigger>
            )
          })}
        </WorkspaceTabsList>
        <WorkspaceTabsContent
          value={tab}
          className="flex min-h-0 flex-1 flex-col gap-[var(--app-grid-gap)]"
        >
          <div className="app-list-toolbar shrink-0">
            <div className="relative min-w-[16rem] flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="disposals-search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search Order Records by Order Number, Cost Center, Status, etc."
                className="w-full pl-9"
                aria-label="Search Order Records by Order Number, Cost Center, Status, etc."
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
              <span className="inline-flex items-center gap-0.5">
                Filter
                {activeColumnFilterCount > 0 ? (
                  <span className="text-xs font-medium text-red-600">
                    ({activeColumnFilterCount})
                  </span>
                ) : null}
              </span>
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
            className="min-h-0 flex-1"
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
                  <SortableColumnHeader
                    label="Order ID"
                    columnKey="order_number"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleColumnSort}
                  />
                  <SortableColumnHeader
                    label="Plant"
                    columnKey="plant_name"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleColumnSort}
                  />
                  <SortableColumnHeader
                    label="From Source"
                    columnKey="from_cost_center_code"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleColumnSort}
                  />
                  <SortableColumnHeader
                    label="Asset Count"
                    columnKey="asset_count"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleColumnSort}
                  />
                  <SortableColumnHeader
                    label="Creation Date"
                    columnKey="created_at"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleColumnSort}
                  />
                  <SortableColumnHeader
                    label="Assignee"
                    columnKey="assigned_to_name"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleColumnSort}
                  />
                  <SortableColumnHeader
                    label="Status"
                    columnKey="status"
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSort={toggleColumnSort}
                  />
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
                        aria-label="Filter order ID"
                        placeholder="Order ID"
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
                          }))
                        }
                      >
                        <option value="">All</option>
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
                        <option value="">All</option>
                        {filterFromCostCenters.map((c) => (
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
                        type="date"
                        value={columnFilterInputs.created_on}
                        onChange={(e) =>
                          setColumnFilterInputs((f) => ({ ...f, created_on: e.target.value }))
                        }
                        aria-label="Filter created date"
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
                        <option value="">All</option>
                        {filterStatuses.map((status) => (
                          <option key={status} value={status}>
                            {disposalStatusLabel(status)}
                          </option>
                        ))}
                      </select>
                    </AdminTableHeadCell>
                    {showDiscard ? <AdminTableHeadCell className="px-2 py-1.5">{null}</AdminTableHeadCell> : null}
                  </AdminTableHeaderRow>
                ) : null}
              </TableHeader>
              <TableBody>
                {loading && items.length === 0 ? (
                  <AdminTableLoadingRow colSpan={colSpan} label="Loading disposals" />
                ) : items.length === 0 ? (
                  <AdminTableEmptyRow colSpan={colSpan}>
                    {search.trim() || activeColumnFilterCount > 0
                      ? "No orders match your search or filters."
                      : disposalTabEmptyMessage(tab)}
                  </AdminTableEmptyRow>
                ) : (
                  items.map((row) => (
                    <AdminTableBodyRow
                      key={row.id}
                      className={cn(
                        "cursor-pointer",
                        row.needs_my_action && "bg-primary/[0.03]",
                      )}
                      onClick={() => navigate(`/dashboard/disposal-orders/${row.id}`)}
                    >
                      <AdminTableCell className="font-medium">{row.order_number}</AdminTableCell>
                      <AdminTableCell>{row.plant_name}</AdminTableCell>
                      <AdminTableCell>{row.from_cost_center_code ?? "—"}</AdminTableCell>
                      <AdminTableCell className="tabular-nums">{row.asset_count}</AdminTableCell>
                      <AdminTableCell className="text-muted-foreground">
                        {formatAppDate(row.created_at)}
                      </AdminTableCell>
                      <AdminTableCell>{row.assigned_to_name ?? "—"}</AdminTableCell>
                      <AdminTableCell>
                        <AdminPillBadge tone={disposalStatusPillTone(row.status)}>
                          {disposalStatusLabel(row.status, row.pending_role_name)}
                        </AdminPillBadge>
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
                              title={row.can_delete ? "Delete" : row.can_archive ? "Archive" : "Unarchive"}
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
    </AdminPage>
  )
}
