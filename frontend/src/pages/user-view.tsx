import * as React from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminDangerButton,
  AdminDetailField,
  AdminDetailGrid,
  AdminPanel,
  AdminPrimaryButton,
  AdminStatusBadge,
} from "@/components/layout/admin-ui"
import { UserAuditLog, type UserTimelineEvent } from "@/components/users/user-audit-log"
import { UserCostCentersDisplay } from "@/components/users/user-cost-centers"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ApiError, deleteJson, getJson, postJson } from "@/lib/api"
import { hasPermission, isSuperuser } from "@/lib/permissions"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"

type UserPublic = {
  id: number
  full_name: string
  username: string
  phone: string | null
  email: string | null
  is_active: boolean
  is_superuser: boolean
  mfa_setup_completed?: boolean
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

function formatOrgList(
  items: { name: string; code?: string | null }[] | undefined,
  fallback: { name: string; code?: string | null } | null,
): string {
  const list =
    items && items.length > 0
      ? items
      : fallback
        ? [fallback]
        : []
  if (list.length === 0) return "—"
  return list.map((d) => (d.code ? `${d.code} — ${d.name}` : d.name)).join(", ")
}

function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

export function UserViewPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [user, setUser] = React.useState<UserPublic | null>(null)
  const [timeline, setTimeline] = React.useState<UserTimelineEvent[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [meId, setMeId] = React.useState<number | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [resendingMfa, setResendingMfa] = React.useState(false)
  const [resendingWelcome, setResendingWelcome] = React.useState(false)
  const [mfaEnabled, setMfaEnabled] = React.useState<boolean>(false)

  const canUpdate = hasPermission("users.update")
  const canViewAudit = hasPermission("users.view")
  const canResendMfa = hasPermission("mfa.manage")

  const canHardDelete = isSuperuser() && meId !== null && user !== null && user.id !== meId
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()

  async function resendWelcomeEmail() {
    if (!user) return
    setResendingWelcome(true)
    try {
      await postJson(`/admin/users/${user.id}/resend-welcome`, {})
      toast.success("Welcome email queued (if email templates are configured).")
    } catch (e) {
      const message =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not resend welcome email"
      toast.error(message)
    } finally {
      setResendingWelcome(false)
    }
  }

  async function resendMfaSetupEmail() {
    if (!user) return
    setResendingMfa(true)
    try {
      await postJson(`/admin/users/${user.id}/resend-mfa`, {})
      toast.success("MFA setup email queued (if email templates are configured).")
    } catch (e) {
      const message =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not resend MFA email"
      toast.error(message)
    } finally {
      setResendingMfa(false)
    }
  }

  async function handleDeleteUser() {
    if (!user) return
    const ok = await confirmAsk({
      title: "Permanently delete user?",
      description: `Permanently delete ${user.full_name}?\n\nThis removes the account and related onboarding approvals / task rows. This cannot be undone.`,
      confirmLabel: "Delete permanently",
      destructive: true,
      requireText: "DELETE",
    })
    if (!ok) return
    setDeleting(true)
    setError(null)
    try {
      await deleteJson(`/admin/users/${user.id}`)
      navigate("..", { replace: true })
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to delete user"
      setError(message)
    } finally {
      setDeleting(false)
    }
  }

  React.useEffect(() => {
    const userId = Number(id)
    if (!Number.isFinite(userId) || userId <= 0) {
      navigate("..", { replace: true })
      return
    }

    void (async () => {
      setLoading(true)
      setError(null)
      setUser(null)
      setMeId(null)
      setTimeline(null)
      try {
        try {
          const me = await getJson<{ id: number }>("/me")
          setMeId(me.id)
        } catch {
          setMeId(null)
        }

        const all = await getJson<UserPublic[]>("/admin/users?skip=0&limit=200")
        const u = all.find((x) => x.id === userId) ?? null
        setUser(u)
        if (u?.org_unit?.id) {
          try {
            const pol = await getJson<{ mfa_enabled?: boolean }>(`/admin/auth-policy?company_id=${u.org_unit.id}`)
            setMfaEnabled(Boolean(pol?.mfa_enabled))
          } catch {
            setMfaEnabled(false)
          }
        } else {
          setMfaEnabled(false)
        }
        if (canViewAudit) {
          try {
            const tl = await getJson<UserTimelineEvent[]>(`/audit/entity/user/${userId}`)
            setTimeline(tl)
          } catch {
            setTimeline([])
          }
        } else {
          setTimeline([])
        }
      } catch (e) {
        const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to load user"
        setError(message)
      } finally {
        setLoading(false)
      }
    })()
  }, [id, navigate, canViewAudit])

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <AdminBackLink to=".." />
      {user && canUpdate && user.is_active && !user.is_superuser ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 shadow-sm"
          disabled={resendingWelcome}
          onClick={() => void resendWelcomeEmail()}
        >
          {resendingWelcome ? "Sending…" : "Resend welcome email"}
        </Button>
      ) : null}
      {user && canResendMfa && mfaEnabled && user.is_active && !user.is_superuser && !user.mfa_setup_completed ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 shadow-sm"
          disabled={resendingMfa}
          onClick={() => void resendMfaSetupEmail()}
        >
          {resendingMfa ? "Sending…" : "Resend MFA setup"}
        </Button>
      ) : null}
      {user && canUpdate && !user.is_superuser ? (
        <AdminPrimaryButton asChild>
          <Link to="edit">Edit user</Link>
        </AdminPrimaryButton>
      ) : null}
      {user && canHardDelete ? (
        <AdminDangerButton disabled={deleting} onClick={() => void handleDeleteUser()}>
          {deleting ? "Deleting…" : "Delete user"}
        </AdminDangerButton>
      ) : null}
    </div>
  )

  if (loading) {
    return (
      <>
        <AdminPage fullWidth description="Loading user profile…" actions={toolbar}>
          <p className="text-sm text-muted-foreground">Please wait.</p>
        </AdminPage>
        {confirmDialog}
      </>
    )
  }

  return (
    <>
    <AdminPage
      fullWidth
      description={user ? `${user.username} · ${user.email ?? "no email"}` : "User profile and audit history."}
      actions={toolbar}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!user ? (
        <Alert>
          <AlertTitle>User not found</AlertTitle>
          <AlertDescription>This user may have been deleted or is outside the loaded range.</AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-6">
          <AdminPanel title={user.full_name} description="Profile and assignment">
            <div className="px-5 py-5">
              <AdminDetailGrid>
                <AdminDetailField label="Full name" value={user.full_name} className="sm:col-span-2" />
                <AdminDetailField label="Username" value={user.username} />
                <AdminDetailField label="Email" value={user.email ?? "—"} />
                <AdminDetailField label="Phone" value={user.phone ?? "—"} />
                <AdminDetailField label="Role" value={user.role?.name ?? "—"} />
                <AdminDetailField
                  label="Plants"
                  value={formatOrgList(user.org_units, user.org_unit)}
                />
                <AdminDetailField
                  label="Departments"
                  value={formatOrgList(user.departments, user.department)}
                />
                <AdminDetailField
                  label="Cost centers"
                  value={
                    <UserCostCentersDisplay
                      items={user.cost_centers}
                      fallback={user.cost_center}
                    />
                  }
                />
                <AdminDetailField
                  label="Status"
                  value={
                    <span className="flex flex-wrap items-center gap-2">
                      <AdminStatusBadge active={user.is_active} />
                      {user.is_superuser ? (
                        <Badge variant="outline" className="rounded-md border-amber-300/80 text-amber-800">
                          Superuser
                        </Badge>
                      ) : null}
                    </span>
                  }
                  className="sm:col-span-2"
                />
              </AdminDetailGrid>
            </div>
            <div className="grid gap-3 border-t border-border/60 bg-muted/15 px-5 py-3 text-xs text-muted-foreground sm:grid-cols-2">
              <div>
                <span className="font-medium text-foreground/70">Created</span>
                <p className="mt-0.5 tabular-nums">{formatDateTime(user.created_at)}</p>
              </div>
              <div>
                <span className="font-medium text-foreground/70">Last updated</span>
                <p className="mt-0.5 tabular-nums">{formatDateTime(user.updated_at)}</p>
              </div>
            </div>
          </AdminPanel>

          <UserAuditLog events={timeline} loading={loading && timeline === null} canView={canViewAudit} />
        </div>
      )}
    </AdminPage>
    {confirmDialog}
    </>
  )
}
