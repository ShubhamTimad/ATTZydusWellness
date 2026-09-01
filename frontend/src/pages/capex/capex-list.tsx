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
import {
  CAPEX_STATUS_FILTERS,
  CAPEX_STATUS_TABS,
  capexStatusLabel,
  capexStatusPillTone,
  type CapexFormListResponse,
} from "@/lib/capex-types"
import { hasPermission } from "@/lib/permissions"
import { useUrlPage, useUrlTab } from "@/lib/use-url-tab"
import { cn } from "@/lib/utils"

const listToolbarBtnClass = "h-9 shrink-0 gap-1.5 px-3"
const columnFilterControlClass = "h-8 w-full min-w-[6rem] text-xs"
const CAPEX_TAB_KEYS = ["all", "needs_action"] as const

type CapexColumnFilters = {
  form_number: string
  asset_name: string
  department: string
  status: string
  created_by: string
}

const DEFAULT_COLUMN_FILTERS: CapexColumnFilters = {
  form_number: "",
  asset_name: "",
  department: "",
  status: "",
  created_by: "",
}

export function CapexListPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useUrlTab(CAPEX_TAB_KEYS, "all")
  const [page, setPage] = useUrlPage()
  const [data, setData] = React.useState<CapexFormListResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [columnFiltersOpen, setColumnFiltersOpen] = React.useState(false)
  const [columnFilterInputs, setColumnFilterInputs] =
    React.useState<CapexColumnFilters>(DEFAULT_COLUMN_FILTERS)
  const [columnFilters, setColumnFilters] =
    React.useState<CapexColumnFilters>(DEFAULT_COLUMN_FILTERS)
  const [sortBy, setSortBy] = React.useState("form_number")
  const [sortDir, setSortDir] = React.useState<SortDir>("desc")
  const canCreate = hasPermission("capitalization.create")

  const activeColumnFilterCount =
    Object.values(columnFilters).filter((value) => value.trim()).length

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams({ tab, page: String(page), page_size: "25" })
      if (search.trim()) q.set("search", search.trim())
      for (const [key, value] of Object.entries(columnFilters)) {
        if (value.trim()) q.set(key, value.trim())
      }
      q.set("sort_by", sortBy)
      q.set("sort_dir", sortDir)
      const res = await getJson<CapexFormListResponse>(`/admin/capitalization-forms?${q}`)
      setData(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load forms")
    } finally {
      setLoading(false)
    }
  }, [tab, page, search, columnFilters, sortBy, sortDir])

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
          ([k, v]) => prev[k as keyof CapexColumnFilters] !== v,
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
    setTab("needs_action")
    setPage(1)
  }

  function toggleColumnSort(columnKey: string) {
    const next = nextColumnSort(
      sortBy,
      sortDir,
      columnKey,
      columnKey === "form_number" ? "desc" : "asc",
    )
    setSortBy(next.sort_by)
    setSortDir(next.sort_dir)
    setPage(1)
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageSize = data?.page_size ?? 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <AdminPage fullWidth dense viewportFill className="w-full gap-[var(--app-grid-gap)]">
      <ListPageHeader
        className="shrink-0"
        title="Capitalization Form"
        // description="Request and track asset capitalization approvals."
        actions={
          canCreate ? (
            <AdminPrimaryButton type="button" onClick={() => navigate("/dashboard/capitalization/new")}>
              <PlusIcon className="h-4 w-4" /> New Form
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
        className="min-h-0 flex-1"
      >
        <WorkspaceTabsList className="shrink-0">
          {CAPEX_STATUS_TABS.map((t) => {
            const count = data?.tab_counts?.[t.key]
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

        {CAPEX_STATUS_TABS.map((t) => (
          <WorkspaceTabsContent key={t.key} value={t.key} className="flex min-h-0 flex-1 flex-col gap-[var(--app-grid-gap)]">
            <div className="app-list-toolbar shrink-0">
              <div className="relative min-w-[16rem] flex-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="capex-search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search by Form No., Asset Name, Department, Status or Created By"
                  className="w-full pl-9"
                  aria-label="Search capitalization forms"
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
                  itemLabel="Forms"
                  onPageChange={setPage}
                />
              }
            >
              <Table className="app-table-head-sticky">
                <TableHeader>
                  <AdminTableHeaderRow>
                    <SortableColumnHeader
                      label="Form number"
                      columnKey="form_number"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={toggleColumnSort}
                    />
                    <SortableColumnHeader
                      label="Asset name"
                      columnKey="asset_name"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={toggleColumnSort}
                    />
                    <SortableColumnHeader
                      label="Dept"
                      columnKey="department"
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
                          value={columnFilterInputs.form_number}
                          onChange={(e) =>
                            setColumnFilterInputs((f) => ({ ...f, form_number: e.target.value }))
                          }
                          aria-label="Filter form number"
                          placeholder="Form number"
                          className={columnFilterControlClass}
                        />
                      </AdminTableHeadCell>
                      <AdminTableHeadCell className="px-2 py-1.5">
                        <Input
                          value={columnFilterInputs.asset_name}
                          onChange={(e) =>
                            setColumnFilterInputs((f) => ({ ...f, asset_name: e.target.value }))
                          }
                          aria-label="Filter asset name"
                          placeholder="Asset name"
                          className={columnFilterControlClass}
                        />
                      </AdminTableHeadCell>
                      <AdminTableHeadCell className="px-2 py-1.5">
                        <Input
                          value={columnFilterInputs.department}
                          onChange={(e) =>
                            setColumnFilterInputs((f) => ({ ...f, department: e.target.value }))
                          }
                          aria-label="Filter department"
                          placeholder="Department"
                          className={columnFilterControlClass}
                        />
                      </AdminTableHeadCell>
                      <AdminTableHeadCell className="px-2 py-1.5">
                        <Input
                          value={columnFilterInputs.created_by}
                          onChange={(e) =>
                            setColumnFilterInputs((f) => ({ ...f, created_by: e.target.value }))
                          }
                          aria-label="Filter created by"
                          placeholder="Created by"
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
                          {CAPEX_STATUS_FILTERS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </AdminTableHeadCell>
                    </AdminTableHeaderRow>
                  ) : null}
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <AdminTableEmptyRow colSpan={5}>Loading forms…</AdminTableEmptyRow>
                  ) : items.length === 0 ? (
                    <AdminTableEmptyRow colSpan={5}>
                      No forms match your search or filters.
                    </AdminTableEmptyRow>
                  ) : (
                    items.map((row) => (
                      <AdminTableBodyRow
                        key={row.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/dashboard/capitalization/${row.id}`)}
                      >
                        <AdminTableCell>
                          <span
                            className="block max-w-[12rem] truncate font-medium"
                            title={row.form_number}
                          >
                            {row.form_number}
                          </span>
                        </AdminTableCell>
                        <AdminTableCell>
                          <span
                            className="block max-w-[16rem] truncate"
                            title={row.asset_name}
                          >
                            {row.asset_name}
                          </span>
                        </AdminTableCell>
                        <AdminTableCell>
                          <span
                            className="block max-w-[12rem] truncate"
                            title={row.department ?? undefined}
                          >
                            {row.department ?? "—"}
                          </span>
                        </AdminTableCell>
                        <AdminTableCell>
                          <span
                            className="block max-w-[12rem] truncate"
                            title={row.created_by_name ?? undefined}
                          >
                            {row.created_by_name ?? "—"}
                          </span>
                        </AdminTableCell>
                        <AdminTableCell>
                          <AdminPillBadge tone={capexStatusPillTone(row.status)}>
                            {capexStatusLabel(row.status)}
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
