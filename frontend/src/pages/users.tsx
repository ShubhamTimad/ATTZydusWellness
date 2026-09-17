import * as React from "react"
import { Eye, ListFilter, Pencil, Plus, Search, X } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"

import {
  AdminPrimaryButton,
  AdminRowAction,
  AdminRowActions,
  AdminStatusBadge,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  AdminTablePrimaryCell,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminDataTable,
  type AdminListPage,
  AdminTableBodyRow,
  AdminTableEmptyRow,
  AdminTableLoadingRow,
  AdminTablePagination,
  LIST_PAGE_SIZE,
} from "@/components/layout/list-page-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { UserCostCentersDisplay } from "@/components/users/user-cost-centers"
import { getJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import { useUrlPage } from "@/lib/use-url-tab"
import { cn } from "@/lib/utils"

type UserPublic = {
  id: number
  full_name: string
  username: string
  phone: string | null
  email: string | null
  is_active: boolean
  is_superuser: boolean
  is_locked?: boolean
  role: { id: number; name: string } | null
  roles?: { id: number; name: string }[]
  org_units?: { id: number; name: string; type: string; code?: string | null }[]
  departments?: { id: number; name: string; type: string; code?: string | null }[]
  cost_centers?: { id: number; code: string; name: string }[]
  org_unit: { id: number; name: string; type: string } | null
  department: { id: number; name: string; type: string; code?: string | null } | null
  cost_center: { id: number; code: string; name: string } | null
  created_at: string
  updated_at: string
}

type RoleListItem = {
  id: number
  name: string
}

type UserColumnFilters = {
  name: string
  phone: string
  role_id: string
  plant: string
  department: string
  cost_center: string
  status: "" | "active" | "inactive" | "locked"
}

const DEFAULT_COLUMN_FILTERS: UserColumnFilters = {
  name: "",
  phone: "",
  role_id: "",
  plant: "",
  department: "",
  cost_center: "",
  status: "",
}

const listToolbarBtnClass = "h-9 shrink-0 gap-1.5 px-3"
const columnFilterControlClass = "h-8 w-full min-w-[6rem] text-xs"

function joinNames(items: { name: string }[] | undefined, fallback: string | null | undefined): string {
  if (items && items.length > 0) return items.map((i) => i.name).join(", ")
  return fallback ?? "—"
}

export function UsersPage() {
  const [page, setPage] = useUrlPage()
  const [users, setUsers] = React.useState<UserPublic[] | null>(null)
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [roles, setRoles] = React.useState<RoleListItem[]>([])
  const [plantOptions, setPlantOptions] = React.useState<string[]>([])
  const [departmentOptions, setDepartmentOptions] = React.useState<string[]>([])
  const [costCenterOptions, setCostCenterOptions] = React.useState<string[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [columnFiltersOpen, setColumnFiltersOpen] = React.useState(false)
  const [columnFilterInputs, setColumnFilterInputs] =
    React.useState<UserColumnFilters>(DEFAULT_COLUMN_FILTERS)
  const [columnFilters, setColumnFilters] =
    React.useState<UserColumnFilters>(DEFAULT_COLUMN_FILTERS)

  const canUpdate = hasPermission("users.update")
  const canCreate = hasPermission("users.create")
  const navigate = useNavigate()

  const activeColumnFilterCount = Object.values(columnFilters).filter((v) => v.trim()).length

  const load = React.useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const q = new URLSearchParams({
        page: String(page),
        page_size: String(LIST_PAGE_SIZE),
      })
      if (search.trim()) q.set("search", search.trim())
      if (columnFilters.name.trim()) q.set("name", columnFilters.name.trim())
      if (columnFilters.phone.trim()) q.set("phone", columnFilters.phone.trim())
      if (columnFilters.status === "active") {
        q.set("is_active", "true")
        q.set("is_locked", "false")
      } else if (columnFilters.status === "inactive") {
        q.set("is_active", "false")
      } else if (columnFilters.status === "locked") {
        q.set("is_locked", "true")
      }
      if (columnFilters.role_id.trim()) q.set("role_id", columnFilters.role_id.trim())
      if (columnFilters.plant.trim()) q.set("plant", columnFilters.plant.trim())
      if (columnFilters.department.trim()) q.set("department", columnFilters.department.trim())
      if (columnFilters.cost_center.trim()) q.set("cost_center", columnFilters.cost_center.trim())
      const u = await getJson<AdminListPage<UserPublic>>(`/admin/users/page?${q}`)
      setUsers(u.items)
      setTotal(u.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users")
      setUsers([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, search, columnFilters])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    void getJson<RoleListItem[]>("/admin/roles?skip=0&limit=200")
      .then(setRoles)
      .catch(() => setRoles([]))
    void getJson<{ plants: string[]; departments: string[]; cost_centers: string[] }>(
      "/admin/users/filter-options",
    )
      .then((opts) => {
        setPlantOptions(opts.plants)
        setDepartmentOptions(opts.departments)
        setCostCenterOptions(opts.cost_centers)
      })
      .catch(() => {
        setPlantOptions([])
        setDepartmentOptions([])
        setCostCenterOptions([])
      })
  }, [])

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
          ([k, v]) => prev[k as keyof UserColumnFilters] !== v,
        )
        if (!changed) return prev
        setPage(1)
        return { ...columnFilterInputs }
      })
    }, 300)
    return () => window.clearTimeout(t)
  }, [columnFilterInputs, setPage])

  function clearFilters() {
    setSearchInput("")
    setSearch("")
    setColumnFilterInputs({ ...DEFAULT_COLUMN_FILTERS })
    setColumnFilters({ ...DEFAULT_COLUMN_FILTERS })
    setPage(1)
  }

  const pageSize = LIST_PAGE_SIZE
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages, setPage])

  return (
    <AdminPage
      fullWidth
      viewportFill
      // description="Manage accounts, roles, plant, department, and cost center assignments."
      actions={
        canCreate ? (
          <AdminPrimaryButton asChild className="h-9 px-4 font-semibold shadow-sm">
            <Link to="new">
              <Plus className="size-4" aria-hidden />
              Create User
            </Link>
          </AdminPrimaryButton>
        ) : undefined
      }
    >
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="app-list-toolbar">
        <div className="relative min-w-[16rem] flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="users-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, email, username, or phone"
            className="w-full pl-9"
            aria-label="Search users"
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
              <span className="text-xs font-medium text-red-600">({activeColumnFilterCount})</span>
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
            page={Math.min(page, totalPages)}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            loading={loading || users === null}
            itemLabel="users"
            onPageChange={setPage}
          />
        }
      >
        <Table className="app-table-head-sticky">
          <TableHeader>
            <AdminTableHeaderRow>
              <AdminTableHeadCell>Name</AdminTableHeadCell>
              <AdminTableHeadCell>Phone</AdminTableHeadCell>
              <AdminTableHeadCell>Roles</AdminTableHeadCell>
              <AdminTableHeadCell>Plant</AdminTableHeadCell>
              <AdminTableHeadCell>Department</AdminTableHeadCell>
              <AdminTableHeadCell>Cost center</AdminTableHeadCell>
              <AdminTableHeadCell className="w-[110px]">Status</AdminTableHeadCell>
              <AdminTableHeadCell className="w-[150px] text-right">Actions</AdminTableHeadCell>
            </AdminTableHeaderRow>
            {columnFiltersOpen ? (
              <AdminTableHeaderRow className="border-b bg-muted/20 hover:bg-muted/20">
                <AdminTableHeadCell className="px-2 py-1.5">
                  <Input
                    value={columnFilterInputs.name}
                    onChange={(e) => setColumnFilterInputs((f) => ({ ...f, name: e.target.value }))}
                    aria-label="Filter name"
                    placeholder="Name"
                    className={columnFilterControlClass}
                  />
                </AdminTableHeadCell>
                <AdminTableHeadCell className="px-2 py-1.5">
                  <Input
                    value={columnFilterInputs.phone}
                    onChange={(e) => setColumnFilterInputs((f) => ({ ...f, phone: e.target.value }))}
                    aria-label="Filter phone"
                    placeholder="Phone"
                    className={columnFilterControlClass}
                  />
                </AdminTableHeadCell>
                <AdminTableHeadCell className="px-2 py-1.5">
                  <select
                    className={cn(adminSelectClass, columnFilterControlClass)}
                    value={columnFilterInputs.role_id}
                    aria-label="Filter role"
                    onChange={(e) =>
                      setColumnFilterInputs((f) => ({ ...f, role_id: e.target.value }))
                    }
                  >
                    <option value="">All</option>
                    {roles.map((r) => (
                      <option key={r.id} value={String(r.id)}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </AdminTableHeadCell>
                <AdminTableHeadCell className="px-2 py-1.5">
                  <select
                    className={cn(adminSelectClass, columnFilterControlClass)}
                    value={columnFilterInputs.plant}
                    aria-label="Filter plant"
                    onChange={(e) => setColumnFilterInputs((f) => ({ ...f, plant: e.target.value }))}
                  >
                    <option value="">All</option>
                    {plantOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </AdminTableHeadCell>
                <AdminTableHeadCell className="px-2 py-1.5">
                  <select
                    className={cn(adminSelectClass, columnFilterControlClass)}
                    value={columnFilterInputs.department}
                    aria-label="Filter department"
                    onChange={(e) =>
                      setColumnFilterInputs((f) => ({ ...f, department: e.target.value }))
                    }
                  >
                    <option value="">All</option>
                    {departmentOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </AdminTableHeadCell>
                <AdminTableHeadCell className="px-2 py-1.5">
                  <select
                    className={cn(adminSelectClass, columnFilterControlClass)}
                    value={columnFilterInputs.cost_center}
                    aria-label="Filter cost center"
                    onChange={(e) =>
                      setColumnFilterInputs((f) => ({ ...f, cost_center: e.target.value }))
                    }
                  >
                    <option value="">All</option>
                    {costCenterOptions.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </AdminTableHeadCell>
                <AdminTableHeadCell className="px-2 py-1.5">
                  <select
                    className={cn(adminSelectClass, columnFilterControlClass)}
                    value={columnFilterInputs.status}
                    aria-label="Filter status"
                    onChange={(e) =>
                      setColumnFilterInputs((f) => ({
                        ...f,
                        status: e.target.value as UserColumnFilters["status"],
                      }))
                    }
                  >
                    <option value="">All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="locked">Locked</option>
                  </select>
                </AdminTableHeadCell>
                <AdminTableHeadCell className="px-2 py-1.5">{null}</AdminTableHeadCell>
              </AdminTableHeaderRow>
            ) : null}
          </TableHeader>
          <TableBody>
            {users === null ? (
              <AdminTableLoadingRow colSpan={8} label="Loading users" />
            ) : users.length === 0 ? (
              <AdminTableEmptyRow colSpan={8}>
                {search.trim() || activeColumnFilterCount > 0
                  ? "No users match your search or filters."
                  : "No users found."}
              </AdminTableEmptyRow>
            ) : (
              users.map((u) => (
                <AdminTableBodyRow key={u.id} interactive={false}>
                  <AdminTableCell>
                    <AdminTablePrimaryCell
                      primary={u.full_name}
                      secondary={u.email ?? "—"}
                      onPrimaryClick={() => navigate(String(u.id))}
                    />
                  </AdminTableCell>
                  <AdminTableCell className="text-muted-foreground">{u.phone ?? "—"}</AdminTableCell>
                  <AdminTableCell>{joinNames(u.roles, u.role?.name ?? null)}</AdminTableCell>
                  <AdminTableCell>
                    {joinNames(
                      u.org_units,
                      u.org_unit?.name ?? null,
                    )}
                  </AdminTableCell>
                  <AdminTableCell>
                    {joinNames(u.departments, u.department?.name ?? null)}
                  </AdminTableCell>
                  <AdminTableCell>
                    <UserCostCentersDisplay
                      items={u.cost_centers}
                      fallback={u.cost_center}
                      maxVisible={3}
                    />
                  </AdminTableCell>
                  <AdminTableCell>
                    <AdminStatusBadge active={u.is_active} locked={u.is_locked} />
                  </AdminTableCell>
                  <AdminTableCell className="text-right">
                    <AdminRowActions>
                      <AdminRowAction
                        icon={Eye}
                        label="View"
                        onClick={() => navigate(String(u.id))}
                      />
                      {canUpdate ? (
                        <AdminRowAction
                          icon={Pencil}
                          label="Edit"
                          onClick={() => navigate(`${u.id}/edit`)}
                          disabled={u.is_superuser}
                        />
                      ) : null}
                    </AdminRowActions>
                  </AdminTableCell>
                </AdminTableBodyRow>
              ))
            )}
          </TableBody>
        </Table>
      </AdminDataTable>
    </AdminPage>
  )
}
