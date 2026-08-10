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
  AdminTableBodyRow,
  AdminTableEmptyRow,
} from "@/components/layout/list-page-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { UserCostCentersDisplay } from "@/components/users/user-cost-centers"
import { getJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type UserPublic = {
  id: number
  full_name: string
  username: string
  phone: string | null
  email: string | null
  is_active: boolean
  is_superuser: boolean
  role: { id: number; name: string } | null
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
  status: "" | "active" | "inactive"
  role_id: string
}

const DEFAULT_COLUMN_FILTERS: UserColumnFilters = {
  status: "",
  role_id: "",
}

const listToolbarBtnClass = "h-9 shrink-0 gap-1.5 px-3"
const columnFilterControlClass = "h-8 w-full min-w-[6rem] text-xs"

function joinNames(items: { name: string }[] | undefined, fallback: string | null | undefined): string {
  if (items && items.length > 0) return items.map((i) => i.name).join(", ")
  return fallback ?? "—"
}

export function UsersPage() {
  const [users, setUsers] = React.useState<UserPublic[] | null>(null)
  const [roles, setRoles] = React.useState<RoleListItem[]>([])
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
    try {
      const q = new URLSearchParams({ skip: "0", limit: "200" })
      if (search.trim()) q.set("search", search.trim())
      if (columnFilters.status === "active") q.set("is_active", "true")
      if (columnFilters.status === "inactive") q.set("is_active", "false")
      if (columnFilters.role_id.trim()) q.set("role_id", columnFilters.role_id.trim())
      const u = await getJson<UserPublic[]>(`/admin/users?${q}`)
      setUsers(u)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users")
      setUsers([])
    }
  }, [search, columnFilters])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    void getJson<RoleListItem[]>("/admin/roles?skip=0&limit=200")
      .then(setRoles)
      .catch(() => setRoles([]))
  }, [])

  React.useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput), 300)
    return () => window.clearTimeout(t)
  }, [searchInput])

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setColumnFilters((prev) => {
        const changed = Object.entries(columnFilterInputs).some(
          ([k, v]) => prev[k as keyof UserColumnFilters] !== v,
        )
        return changed ? { ...columnFilterInputs } : prev
      })
    }, 300)
    return () => window.clearTimeout(t)
  }, [columnFilterInputs])

  function clearFilters() {
    setSearchInput("")
    setSearch("")
    setColumnFilterInputs({ ...DEFAULT_COLUMN_FILTERS })
    setColumnFilters({ ...DEFAULT_COLUMN_FILTERS })
  }

  return (
    <AdminPage
      fullWidth
      viewportFill
      description="Manage accounts, roles, plant, department, and cost center assignments."
      actions={
        canCreate ? (
          <AdminPrimaryButton asChild className="h-9 px-4 font-semibold shadow-sm">
            <Link to="new">
              <Plus className="size-4" aria-hidden />
              Create user
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

      <AdminDataTable className="min-h-0 flex-1">
        <Table className="app-table-head-sticky">
          <TableHeader>
            <AdminTableHeaderRow>
              <AdminTableHeadCell>Name</AdminTableHeadCell>
              <AdminTableHeadCell>Phone</AdminTableHeadCell>
              <AdminTableHeadCell>Role</AdminTableHeadCell>
              <AdminTableHeadCell>Plant</AdminTableHeadCell>
              <AdminTableHeadCell>Department</AdminTableHeadCell>
              <AdminTableHeadCell>Cost center</AdminTableHeadCell>
              <AdminTableHeadCell className="w-[110px]">Status</AdminTableHeadCell>
              <AdminTableHeadCell className="w-[150px] text-right">Actions</AdminTableHeadCell>
            </AdminTableHeaderRow>
            {columnFiltersOpen ? (
              <AdminTableHeaderRow className="border-b bg-muted/20 hover:bg-muted/20">
                <AdminTableHeadCell className="px-2 py-1.5" colSpan={2}>
                  <span className="text-xs text-muted-foreground">Use search for name / email / phone</span>
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
                    <option value="">All roles</option>
                    {roles.map((r) => (
                      <option key={r.id} value={String(r.id)}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </AdminTableHeadCell>
                <AdminTableHeadCell className="px-2 py-1.5" colSpan={3} />
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
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </AdminTableHeadCell>
                <AdminTableHeadCell className="px-2 py-1.5" />
              </AdminTableHeaderRow>
            ) : null}
          </TableHeader>
          <TableBody>
            {users === null ? (
              <AdminTableEmptyRow colSpan={8}>Loading users…</AdminTableEmptyRow>
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
                  <AdminTableCell>{u.role?.name ?? "—"}</AdminTableCell>
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
                    <UserCostCentersDisplay items={u.cost_centers} fallback={u.cost_center} />
                  </AdminTableCell>
                  <AdminTableCell>
                    <AdminStatusBadge active={u.is_active} />
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
