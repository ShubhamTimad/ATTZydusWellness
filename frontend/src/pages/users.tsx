import * as React from "react"
import { Eye, Pencil, Plus } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"

import {
  AdminPanel,
  AdminPrimaryButton,
  AdminStatusBadge,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
} from "@/components/layout/admin-ui"
import { AdminPage } from "@/components/layout/admin-page"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
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
  org_unit: { id: number; name: string; type: string } | null
  created_at: string
  updated_at: string
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
      description="Manage accounts, roles, and plant assignments."
      actions={
        canCreate ? (
          <AdminPrimaryButton asChild>
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

      <AdminPanel>
        <Table>
          <TableHeader>
            <AdminTableHeaderRow>
              <AdminTableHeadCell>Name</AdminTableHeadCell>
              <AdminTableHeadCell>Phone</AdminTableHeadCell>
              <AdminTableHeadCell>Role</AdminTableHeadCell>
              <AdminTableHeadCell>Plant</AdminTableHeadCell>
              <AdminTableHeadCell className="w-[110px]">Status</AdminTableHeadCell>
              <AdminTableHeadCell className="w-[140px] text-right">Actions</AdminTableHeadCell>
            </AdminTableHeaderRow>
          </TableHeader>
          <TableBody>
            {users === null ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-sm text-muted-foreground">
                  Loading users…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-sm text-muted-foreground">
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-border/40 transition-colors last:border-0 hover:bg-muted/15"
                >
                  <AdminTableCell>
                    <button
                      type="button"
                      className="block max-w-[240px] truncate text-left font-semibold text-foreground transition-colors hover:text-primary"
                      onClick={() => navigate(String(u.id))}
                    >
                      {u.full_name}
                    </button>
                    <div className="mt-0.5 max-w-[240px] truncate text-xs text-muted-foreground">
                      {u.email ?? "—"}
                    </div>
                  </AdminTableCell>
                  <AdminTableCell className="text-muted-foreground">{u.phone ?? "—"}</AdminTableCell>
                  <AdminTableCell>{u.role?.name ?? "—"}</AdminTableCell>
                  <AdminTableCell>{u.org_unit?.name ?? "—"}</AdminTableCell>
                  <AdminTableCell>
                    <AdminStatusBadge active={u.is_active} />
                  </AdminTableCell>
                  <AdminTableCell className="text-right">
                    <div className="inline-flex items-center justify-end gap-0.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground"
                        onClick={() => navigate(String(u.id))}
                      >
                        <Eye className="size-3.5" aria-hidden />
                        View
                      </Button>
                      {canUpdate ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className={cn(
                            "h-8 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground",
                            u.is_superuser && "pointer-events-none opacity-40",
                          )}
                          onClick={() => navigate(`${u.id}/edit`)}
                          disabled={u.is_superuser}
                        >
                          <Pencil className="size-3.5" aria-hidden />
                          Edit
                        </Button>
                      ) : null}
                    </div>
                  </AdminTableCell>
                </tr>
              ))
            )}
          </TableBody>
        </Table>
      </AdminPanel>
    </AdminPage>
  )
}
