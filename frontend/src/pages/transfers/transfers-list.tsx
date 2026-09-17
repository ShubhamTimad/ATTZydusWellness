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
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { getJson } from "@/lib/api"
import { transferListRootKey } from "@/lib/query-client"
import {
  TRANSFER_STATUS_TABS,
  transferStatusLabel,
  transferStatusPillTone,
  transferTabEmptyMessage,
  type TransferOrderListResponse,
} from "@/lib/transfer-types"
import { formatCostCenterWithCode } from "@/lib/use-asset-masters"
import { formatAppDate } from "@/lib/dates"
import { useUrlPage, useUrlTab } from "@/lib/use-url-tab"
import { cn } from "@/lib/utils"

const listToolbarBtnClass = "h-9 shrink-0 gap-1.5 px-3"
const columnFilterControlClass = "h-8 w-full min-w-[6rem] text-xs"
const DEFAULT_TAB = "all"
const TRANSFER_TAB_KEYS = ["all", "needs_action"] as const

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
  const [tab, setTab] = useUrlTab(TRANSFER_TAB_KEYS, DEFAULT_TAB)
  const [page, setPage] = useUrlPage()
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

  const transfersQuery = useQuery({
    queryKey: [...transferListRootKey, { tab, page, search, columnFilters, sortBy, sortDir }],
    queryFn: async () => {
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
      q.set("sort_by", sortBy)
      q.set("sort_dir", sortDir)
      return getJson<TransferOrderListResponse>(`/admin/transfer-orders?${q}`)
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: (query) => query.state.isInvalidated,
  })
  const data = transfersQuery.data ?? null
  const loading = transfersQuery.isPending && !transfersQuery.data

  React.useEffect(() => {
    if (transfersQuery.error) {
      toast.error(
        transfersQuery.error instanceof Error
          ? transfersQuery.error.message
          : "Failed to load transfer orders",
      )
    }
  }, [transfersQuery.error])

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
          ([k, v]) => prev[k as keyof TransferColumnFilters] !== v,
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
  const total = data?.total ?? 0
  const pageSize = data?.page_size ?? 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const counts = data?.tab_counts ?? {}
  const colSpan = 8

  return (
    <AdminPage fullWidth dense viewportFill className="w-full gap-[var(--app-grid-gap)]">
      <ListPageHeader className="shrink-0" title="Asset Transfer Order" />

      <WorkspaceTabs
        value={tab}
        onValueChange={(v) => {
          setTab(v)
          setPage(1)
        }}
        className="min-h-0 flex-1"
      >
        <WorkspaceTabsList className="shrink-0">
          {TRANSFER_STATUS_TABS.map((t) => {
            const count = counts[t.key]
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
                id="transfers-search"
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
                    label="To Destination"
                    columnKey="to_cost_center_code"
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
                    label="Created On"
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
                            to_cost_center_id: "",
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
                        <option value="">All</option>
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
                            {transferStatusLabel(status)}
                          </option>
                        ))}
                      </select>
                    </AdminTableHeadCell>
                  </AdminTableHeaderRow>
                ) : null}
              </TableHeader>
              <TableBody>
                {loading && items.length === 0 ? (
                  <AdminTableLoadingRow colSpan={colSpan} label="Loading transfers" />
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
                      <AdminTableCell>
                        {formatCostCenterWithCode(row.from_cost_center_code, filterFromCostCenters)}
                      </AdminTableCell>
                      <AdminTableCell>{row.to_cost_center_code}</AdminTableCell>
                      <AdminTableCell className="tabular-nums">{row.asset_count}</AdminTableCell>
                      <AdminTableCell className="text-muted-foreground">
                        {formatAppDate(row.created_at)}
                      </AdminTableCell>
                      <AdminTableCell>{row.assigned_to_name ?? "—"}</AdminTableCell>
                      <AdminTableCell>
                        <AdminPillBadge tone={transferStatusPillTone(row.status)}>
                          {transferStatusLabel(row.status, row.pending_role_name)}
                        </AdminPillBadge>
                      </AdminTableCell>
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
