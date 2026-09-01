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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { getJson } from "@/lib/api"
import { orderListRootKey, LIST_STALE_MS } from "@/lib/query-client"
import {
  ORDER_STATUS_TABS,
  orderStatusLabel,
  orderStatusPillTone,
  orderTabEmptyMessage,
  type PhysicalOrderListResponse,
} from "@/lib/orders-types"
import { formatAppDate } from "@/lib/dates"
import { useUrlPage, useUrlTab } from "@/lib/use-url-tab"
import { cn } from "@/lib/utils"

const listToolbarBtnClass = "h-9 shrink-0 gap-1.5 px-3"
const columnFilterControlClass = "h-8 w-full min-w-[6rem] text-xs"
const DEFAULT_TAB = "all"
const ORDER_TAB_KEYS = ["all", "needs_action"] as const

type OrderColumnFilters = {
  order_number: string
  plant_id: string
  cost_center_id: string
  asset_count: string
  status: string
  assigned_to: string
  created_by: string
  created_on: string
}

const DEFAULT_COLUMN_FILTERS: OrderColumnFilters = {
  order_number: "",
  plant_id: "",
  cost_center_id: "",
  asset_count: "",
  status: "",
  assigned_to: "",
  created_by: "",
  created_on: "",
}

type OrderFilterPlant = { id: number; code: string | null; name: string }
type OrderFilterCostCenter = {
  id: number
  code: string
  name: string | null
  plant_id: number | null
}

function tabCount(
  counts: Record<string, number> | null | undefined,
  tab: (typeof ORDER_STATUS_TABS)[number],
): number {
  if (!counts) return 0
  const value = counts[tab.key]
  return typeof value === "number" ? value : 0
}

export function OrdersListPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useUrlTab(ORDER_TAB_KEYS, DEFAULT_TAB)
  const [page, setPage] = useUrlPage()
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [columnFiltersOpen, setColumnFiltersOpen] = React.useState(false)
  const [columnFilterInputs, setColumnFilterInputs] =
    React.useState<OrderColumnFilters>(DEFAULT_COLUMN_FILTERS)
  const [columnFilters, setColumnFilters] =
    React.useState<OrderColumnFilters>(DEFAULT_COLUMN_FILTERS)
  const [filterPlants, setFilterPlants] = React.useState<OrderFilterPlant[]>([])
  const [filterCostCenters, setFilterCostCenters] = React.useState<OrderFilterCostCenter[]>([])
  const [filterStatuses, setFilterStatuses] = React.useState<string[]>([])
  const [sortBy, setSortBy] = React.useState("created_at")
  const [sortDir, setSortDir] = React.useState<SortDir>("desc")

  const activeColumnFilterCount = Object.values(columnFilters).filter((value) => value.trim()).length

  React.useEffect(() => {
    const qs = columnFilterInputs.plant_id
      ? `?plant_id=${encodeURIComponent(columnFilterInputs.plant_id)}`
      : ""
    void getJson<{
      plants: OrderFilterPlant[]
      cost_centers: OrderFilterCostCenter[]
      statuses: string[]
    }>(`/admin/physical-orders/column-filter-options${qs}`)
      .then((res) => {
        setFilterPlants(res.plants)
        setFilterCostCenters(res.cost_centers)
        setFilterStatuses(res.statuses)
        setColumnFilterInputs((prev) => {
          let next = prev
          if (
            prev.cost_center_id &&
            !res.cost_centers.some((c) => String(c.id) === prev.cost_center_id)
          ) {
            next = { ...next, cost_center_id: "" }
          }
          if (prev.status && !res.statuses.includes(prev.status)) {
            next = { ...next, status: "" }
          }
          return next
        })
      })
      .catch(() => {
        setFilterPlants([])
        setFilterCostCenters([])
        setFilterStatuses([])
      })
  }, [columnFilterInputs.plant_id])

  const ordersQueryKey = React.useMemo(
    () =>
      [
        ...orderListRootKey,
        { tab, page, search, columnFilters, sortBy, sortDir },
      ] as const,
    [tab, page, search, columnFilters, sortBy, sortDir],
  )

  const ordersQuery = useQuery({
    queryKey: ordersQueryKey,
    queryFn: async () => {
      const q = new URLSearchParams({ tab, page: String(page), page_size: "25" })
      if (search.trim()) q.set("search", search.trim())
      if (columnFilters.order_number.trim()) q.set("order_number", columnFilters.order_number.trim())
      if (columnFilters.plant_id.trim()) q.set("plant_id", columnFilters.plant_id.trim())
      if (columnFilters.cost_center_id.trim()) {
        q.set("cost_center_id", columnFilters.cost_center_id.trim())
      }
      if (columnFilters.asset_count.trim()) q.set("asset_count", columnFilters.asset_count.trim())
      if (columnFilters.status.trim()) q.set("status", columnFilters.status.trim())
      if (columnFilters.assigned_to.trim()) q.set("assigned_to", columnFilters.assigned_to.trim())
      if (columnFilters.created_by.trim()) q.set("created_by", columnFilters.created_by.trim())
      if (columnFilters.created_on.trim()) q.set("created_on", columnFilters.created_on.trim())
      q.set("sort_by", sortBy)
      q.set("sort_dir", sortDir)
      return getJson<PhysicalOrderListResponse>(`/admin/physical-orders?${q}`)
    },
    staleTime: LIST_STALE_MS,
  })

  const data = ordersQuery.data ?? null
  const loading = ordersQuery.isPending && !ordersQuery.data

  React.useEffect(() => {
    if (ordersQuery.error) {
      toast.error(
        ordersQuery.error instanceof Error ? ordersQuery.error.message : "Failed to load orders",
      )
    }
  }, [ordersQuery.error])

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
          ([k, v]) => prev[k as keyof OrderColumnFilters] !== v,
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

  const items = data?.items ?? []
  const colSpan = 8
  const total = data?.total ?? 0
  const pageSize = data?.page_size ?? 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <AdminPage fullWidth dense viewportFill className="w-full gap-[var(--app-grid-gap)]">
      <ListPageHeader className="shrink-0" title="Physical Verification Order" description="" />

      <WorkspaceTabs
        value={tab}
        onValueChange={(v) => {
          setTab(v)
          setPage(1)
        }}
        className="min-h-0 flex-1"
      >
        <WorkspaceTabsList className="shrink-0">
          {ORDER_STATUS_TABS.map((t) => {
            const count = tabCount(data?.tab_counts, t)
            return (
              <WorkspaceTabsTrigger key={t.key} value={t.key}>
                {t.label}
                {typeof count === "number" ? (
                  <span className="ml-1.5 tabular-nums text-muted-foreground">({count})</span>
                ) : null}
              </WorkspaceTabsTrigger>
            )
          })}
        </WorkspaceTabsList>

        {ORDER_STATUS_TABS.map((t) => (
          <WorkspaceTabsContent
            key={t.key}
            value={t.key}
            className="flex min-h-0 flex-1 flex-col gap-[var(--app-grid-gap)]"
          >
            <div className="app-list-toolbar shrink-0">
              <div className="relative min-w-[16rem] flex-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="orders-search"
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
                      label="Cost center"
                      columnKey="cost_center_code"
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
                      label="Created by"
                      columnKey="created_by_name"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={toggleColumnSort}
                    />
                    <SortableColumnHeader
                      label="Assigned to"
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
                              cost_center_id: "",
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
                          value={columnFilterInputs.cost_center_id}
                          aria-label="Filter cost center"
                          onChange={(e) =>
                            setColumnFilterInputs((f) => ({
                              ...f,
                              cost_center_id: e.target.value,
                            }))
                          }
                        >
                          <option value="">All</option>
                          {filterCostCenters.map((c) => (
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
                          value={columnFilterInputs.created_by}
                          onChange={(e) =>
                            setColumnFilterInputs((f) => ({ ...f, created_by: e.target.value }))
                          }
                          aria-label="Filter creator"
                          placeholder="Created by"
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
                          placeholder="Assigned to"
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
                              {orderStatusLabel(status)}
                            </option>
                          ))}
                        </select>
                      </AdminTableHeadCell>
                    </AdminTableHeaderRow>
                  ) : null}
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <AdminTableEmptyRow colSpan={colSpan}>Loading orders…</AdminTableEmptyRow>
                  ) : items.length === 0 ? (
                    <AdminTableEmptyRow colSpan={colSpan}>
                      {orderTabEmptyMessage(tab)}
                    </AdminTableEmptyRow>
                  ) : (
                    items.map((row) => (
                      <AdminTableBodyRow
                        key={row.id}
                        className={cn(row.needs_my_action && "bg-primary/[0.03]")}
                        onClick={() => navigate(String(row.id))}
                      >
                        <AdminTableCell className="font-mono text-xs font-medium">
                          {row.order_number}
                        </AdminTableCell>
                        <AdminTableCell>{row.plant_name}</AdminTableCell>
                        <AdminTableCell>
                          {row.cost_center_code}
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {row.cost_center_description}
                          </span>
                        </AdminTableCell>
                        <AdminTableCell className="tabular-nums">{row.asset_count}</AdminTableCell>
                        <AdminTableCell>
                          {formatAppDate(row.created_at)}
                        </AdminTableCell>
                        <AdminTableCell>{row.created_by_name ?? "—"}</AdminTableCell>
                        <AdminTableCell>{row.assigned_to_name ?? "—"}</AdminTableCell>
                        <AdminTableCell>
                          <AdminPillBadge tone={orderStatusPillTone(row.status)} className="font-normal">
                            {orderStatusLabel(row.status)}
                          </AdminPillBadge>
                        </AdminTableCell>
                      </AdminTableBodyRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </AdminDataTable>
          </WorkspaceTabsContent>
        ))}
      </WorkspaceTabs>
    </AdminPage>
  )
}
