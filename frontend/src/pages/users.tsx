import * as React from "react"
import { Eye, Pencil, Plus } from "lucide-react"
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
} from "@/components/layout/admin-ui"
import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminDataTable,
  AdminTableBodyRow,
  AdminTableEmptyRow,
} from "@/components/layout/list-page-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { getJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"

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

function joinNames(items: { name: string }[] | undefined, fallback: string | null | undefined): string {
  if (items && items.length > 0) return items.map((i) => i.name).join(", ")
  return fallback ?? "—"
}

function joinCostCenters(
  items: { code: string; name: string }[] | undefined,
  fallback: { code: string; name: string } | null | undefined,
): string {
  if (items && items.length > 0) return items.map((c) => `${c.code} — ${c.name}`).join(", ")
  return fallback ? `${fallback.code} — ${fallback.name}` : "—"
}

export function UsersPage() {
  const [users, setUsers] = React.useState<UserPublic[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const canUpdate = hasPermission("users.update")
  const canCreate = hasPermission("users.create")
  const navigate = useNavigate()

  async function load() {
    setError(null)
    try {
      const u = await getJson<UserPublic[]>("/admin/users?skip=0&limit=50")
      setUsers(u)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users")
      setUsers([])
    }
  }

  React.useEffect(() => {
    void load()
  }, [])

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
          </TableHeader>
          <TableBody>
            {users === null ? (
              <AdminTableEmptyRow colSpan={8}>Loading users…</AdminTableEmptyRow>
            ) : users.length === 0 ? (
              <AdminTableEmptyRow colSpan={8}>No users found.</AdminTableEmptyRow>
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
                  <AdminTableCell>{joinCostCenters(u.cost_centers, u.cost_center)}</AdminTableCell>
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
