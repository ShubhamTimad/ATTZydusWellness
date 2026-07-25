import * as React from "react"
import { ListFilter, PlusIcon, Search, X } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
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
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { getJson } from "@/lib/api"
import {
  CAPEX_STATUS_TABS,
  capexStatusLabel,
  capexStatusPillTone,
  type CapexFormListResponse,
} from "@/lib/capex-types"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

const listToolbarBtnClass = "h-9 shrink-0 gap-1.5 px-3"
const columnFilterControlClass = "h-8 w-full min-w-[6rem] text-xs"

type CapexColumnFilters = {
  form_number: string
  asset_name: string
  department: string
  created_by: string
}

const DEFAULT_COLUMN_FILTERS: CapexColumnFilters = {
  form_number: "",
  asset_name: "",
  department: "",
  created_by: "",
}

export function CapexListPage() {
  const navigate = useNavigate()
  const [tab, setTab] = React.useState("all")
  const [page, setPage] = React.useState(1)
  const [data, setData] = React.useState<CapexFormListResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [columnFiltersOpen, setColumnFiltersOpen] = React.useState(false)
  const [columnFilterInputs, setColumnFilterInputs] =
    React.useState<CapexColumnFilters>(DEFAULT_COLUMN_FILTERS)
  const [columnFilters, setColumnFilters] =
    React.useState<CapexColumnFilters>(DEFAULT_COLUMN_FILTERS)
  const canCreate = hasPermission("capitalization.create")

  const activeColumnFilterCount =
    Object.values(columnFilters).filter((value) => value.trim()).length + (tab !== "all" ? 1 : 0)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams({ tab, page: String(page), page_size: "25" })
      if (search.trim()) q.set("search", search.trim())
      for (const [key, value] of Object.entries(columnFilters)) {
        if (value.trim()) q.set(key, value.trim())
      }
      const res = await getJson<CapexFormListResponse>(`/admin/capitalization-forms?${q}`)
      setData(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load forms")
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
    setTab("all")
    setPage(1)
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageSize = data?.page_size ?? 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <AdminPage fullWidth dense className="w-full">
      <ListPageHeader
        title="Capitalization forms"
        description="Request and track asset capitalization approvals."
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
      >
        <WorkspaceTabsList>
          {CAPEX_STATUS_TABS.map((t) => (
            <WorkspaceTabsTrigger key={t.key} value={t.key}>
              {t.label}
            </WorkspaceTabsTrigger>
          ))}
        </WorkspaceTabsList>

        {CAPEX_STATUS_TABS.map((t) => (
          <WorkspaceTabsContent key={t.key} value={t.key} className="flex min-h-0 flex-1 flex-col gap-[var(--app-grid-gap)]">
            <div className="app-list-toolbar">
              <div className="relative min-w-[16rem] flex-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="capex-search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search by form number, asset, department, or creator…"
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
                  variant="ghost"
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
                  itemLabel="forms"
                  onPageChange={setPage}
                />
              }
            >
              <Table>
                <TableHeader>
                  <AdminTableHeaderRow>
                    <AdminTableHeadCell>Form number</AdminTableHeadCell>
                    <AdminTableHeadCell>Asset name</AdminTableHeadCell>
                    <AdminTableHeadCell>Department</AdminTableHeadCell>
                    <AdminTableHeadCell>Status</AdminTableHeadCell>
                    <AdminTableHeadCell>Created by</AdminTableHeadCell>
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
                        <select
                          className={cn(adminSelectClass, columnFilterControlClass)}
                          value={tab}
                          aria-label="Filter status"
                          onChange={(e) => {
                            setTab(e.target.value)
                            setPage(1)
                          }}
                        >
                          {CAPEX_STATUS_TABS.map((statusTab) => (
                            <option key={statusTab.key} value={statusTab.key}>
                              {statusTab.label}
                            </option>
                          ))}
                        </select>
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
                          <Link
                            to={`/dashboard/capitalization/${row.id}`}
                            className="font-medium text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row.form_number}
                          </Link>
                        </AdminTableCell>
                        <AdminTableCell>{row.asset_name}</AdminTableCell>
                        <AdminTableCell>{row.department ?? "—"}</AdminTableCell>
                        <AdminTableCell>
                          <AdminPillBadge tone={capexStatusPillTone(row.status)}>
                            {capexStatusLabel(row.status)}
                          </AdminPillBadge>
                        </AdminTableCell>
                        <AdminTableCell>{row.created_by_name ?? "—"}</AdminTableCell>
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
