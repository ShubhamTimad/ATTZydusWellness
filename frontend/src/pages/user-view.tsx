import * as React from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import { PageLoader } from "@/components/ui/page-loader"
import {
  AdminBackLink,
  AdminDangerButton,
  AdminDetailField,
  AdminDetailGrid,
  AdminPanel,
  AdminPillBadge,
  AdminPrimaryButton,
  AdminStatusBadge,
} from "@/components/layout/admin-ui"
import { UserAuditLog, type UserTimelineEvent } from "@/components/users/user-audit-log"
import { UserCostCentersDisplay } from "@/components/users/user-cost-centers"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AssetImage } from "@/components/assets/asset-image"
import { ApiError, deleteJson, getBlob, getJson, postJson } from "@/lib/api"
import { formatAppDateTime as formatDateTime } from "@/lib/dates"
import { hasPermission, isSuperuser } from "@/lib/permissions"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"
import { CapexAssigneePickerDialog } from "@/pages/capex/capex-assignee-picker-dialog"

type UserPublic = {
  id: number
  full_name: string
  username: string
  phone: string | null
  email: string | null
  is_active: boolean
  is_superuser: boolean
  is_locked?: boolean
  locked_at?: string | null
  mfa_setup_completed?: boolean
  has_photo?: boolean
  approval_status?: "draft" | "pending" | "rejected" | "approved" | string
  can_submit_for_approval?: boolean
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

function orgItems(
  items: { id?: number; name: string; code?: string | null }[] | undefined,
  fallback: { id?: number; name: string; code?: string | null } | null,
) {
  if (items && items.length > 0) return items
  return fallback ? [fallback] : []
}

function OrgPills({
  items,
  fallback,
}: {
  items?: { id?: number; name: string; code?: string | null }[]
  fallback?: { id?: number; name: string; code?: string | null } | null
}) {
  const list = orgItems(items, fallback ?? null)
  if (list.length === 0) return <span className="text-sm font-normal text-muted-foreground">—</span>
  return (
    <span className="flex flex-wrap gap-1.5">
      {list.map((item) => (
        <AdminPillBadge key={item.id ?? item.name} tone="neutral">
          {item.code ? `${item.code} — ${item.name}` : item.name}
        </AdminPillBadge>
      ))}
    </span>
  )
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
  const [unlocking, setUnlocking] = React.useState(false)
  const [mfaEnabled, setMfaEnabled] = React.useState<boolean>(false)
  const [photoUrl, setPhotoUrl] = React.useState<string | null>(null)
  const [submitOpen, setSubmitOpen] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    setPhotoUrl(null)
    if (!user?.id || !user.has_photo) return
    let cancelled = false
    let objectUrl: string | null = null
    void getBlob(`/admin/users/${user.id}/photo`)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setPhotoUrl(objectUrl)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [user?.id, user?.has_photo])

  const canUpdate = hasPermission("users.update")
  const canCreate = hasPermission("users.create")
  const canUnlock = hasPermission("users.unlock")
  const canViewAudit = hasPermission("users.view")
  const canResendMfa = hasPermission("mfa.manage")
  const canSubmit =
    Boolean(user?.can_submit_for_approval) && (canCreate || canUpdate) && !user?.is_superuser

  const canHardDelete = isSuperuser() && meId !== null && user !== null && user.id !== meId
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()

  async function reloadUser(userId: number) {
    const u = await getJson<UserPublic>(`/admin/users/${userId}`)
    setUser(u)
  }

  async function submitWithAssignee(assigneeUserId?: number) {
    if (!user) return
    setSubmitting(true)
    try {
      const res = await postJson<{ status: string }>(
        `/admin/users/${user.id}/submit-for-approval`,
        assigneeUserId != null && assigneeUserId > 0
          ? { assignee_user_id: assigneeUserId }
          : {},
      )
      setSubmitOpen(false)
      await reloadUser(user.id)
      if (res.status === "activated") {
        toast.success("User activated — no approval workflow is configured.")
      } else {
        toast.success("User submitted for approval successfully.")
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not submit this user for approval.")
    } finally {
      setSubmitting(false)
    }
  }

  async function requestSubmit() {
    if (!user) return
    try {
      await getJson(`/admin/users/${user.id}/assignees`)
      setSubmitOpen(true)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        await submitWithAssignee()
        return
      }
      toast.error(e instanceof ApiError ? e.message : "Could not load approvers.")
    }
  }

  async function unlockAccount() {
    if (!user) return
    const ok = await confirmAsk({
      title: "Unlock Account?",
      description:
        "This will set a temporary password and email a reset link to the user if an email address is available.",
      confirmLabel: "Unlock",
    })
    if (!ok) return
    setUnlocking(true)
    try {
      const res = await postJson<{ email_sent?: boolean }>(`/admin/users/${user.id}/unlock`, {})
      setUser((prev) => (prev ? { ...prev, is_locked: false, locked_at: null } : prev))
      if (canViewAudit) {
        try {
          const tl = await getJson<UserTimelineEvent[]>(`/audit/entity/user/${user.id}`)
          setTimeline(tl)
        } catch {
          /* keep the trail already shown */
        }
      }
      toast.success(
        res.email_sent
          ? "Account unlocked. A temporary password and reset link were emailed."
          : "Account unlocked. No email was sent because this user has no email address.",
      )
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not unlock account"
      toast.error(message)
    } finally {
      setUnlocking(false)
    }
  }

  async function resendWelcomeEmail() {
    if (!user) return
    setResendingWelcome(true)
    try {
      await postJson(`/admin/users/${user.id}/resend-welcome`, {})
      toast.success("Welcome email sent successfully.")
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
      toast.success("User deleted successfully.")
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

        const u = await getJson<UserPublic>(`/admin/users/${userId}`)
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
      {user && canUnlock && user.is_locked ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={unlocking}
          onClick={() => void unlockAccount()}
        >
          {unlocking ? "Unlocking…" : "Unlock Account"}
        </Button>
      ) : null}
      {user && canSubmit ? (
        <AdminPrimaryButton
          type="button"
          disabled={submitting}
          onClick={() => void requestSubmit()}
        >
          {user.approval_status === "rejected" ? "Resubmit for Approval" : "Submit for Approval"}
        </AdminPrimaryButton>
      ) : null}
      {user && canUpdate && user.is_active && !user.is_superuser ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
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
        <AdminPage fullWidth viewportFill actions={toolbar}>
          <PageLoader label="Loading user" />
        </AdminPage>
        {confirmDialog}
      </>
    )
  }

  return (
    <>
    <AdminPage fullWidth actions={toolbar}>
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
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <AdminPanel
              title={user.full_name}
              // description={user.username}
              headerActions={
                <span className="flex flex-wrap items-center gap-1.5">
                  <AdminStatusBadge active={user.is_active} locked={user.is_locked} />
                  {user.approval_status === "draft" ? (
                    <Badge variant="outline" className="rounded-md">
                      Draft
                    </Badge>
                  ) : null}
                  {user.approval_status === "pending" ? (
                    <Badge variant="outline" className="rounded-md border-amber-300/80 text-amber-800">
                      Pending Approval
                    </Badge>
                  ) : null}
                  {user.approval_status === "rejected" ? (
                    <Badge variant="outline" className="rounded-md border-destructive/50 text-destructive">
                      Rejected
                    </Badge>
                  ) : null}
                  {user.is_superuser ? (
                    <Badge variant="outline" className="rounded-md border-amber-300/80 text-amber-800">
                      Superuser
                    </Badge>
                  ) : null}
                </span>
              }
            >
              <div className="px-5 py-5">
                <AdminDetailGrid>
                  <AdminDetailField label="Email" value={user.email ?? "—"} />
                  <AdminDetailField label="Phone" value={user.phone ?? "—"} />
                  <AdminDetailField
                    label="Roles"
                    value={<OrgPills items={user.roles} fallback={user.role} />}
                  />
                  <AdminDetailField label="Username" value={user.username} />
                  {user.has_photo ? (
                    <AdminDetailField label="Photo" value={<AssetImage label="Photo" imageUrl={photoUrl} />} />
                  ) : null}
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

            <AdminPanel title="Assignment" >
              <div className="space-y-5 px-5 py-5">
                <AdminDetailField
                  label="Plant"
                  value={<OrgPills items={user.org_units} fallback={user.org_unit} />}
                />
                <AdminDetailField
                  label="Department"
                  value={<OrgPills items={user.departments} fallback={user.department} />}
                />
                <AdminDetailField
                  label="Cost center"
                  value={
                    <UserCostCentersDisplay
                      items={user.cost_centers}
                      fallback={user.cost_center}
                      className="max-w-none"
                    />
                  }
                />
              </div>
            </AdminPanel>
          </div>

          <UserAuditLog events={timeline} loading={loading && timeline === null} canView={canViewAudit} />
        </div>
      )}
    </AdminPage>
    {confirmDialog}
    <CapexAssigneePickerDialog
      open={submitOpen}
      onOpenChange={setSubmitOpen}
      assigneesUrl={user ? `/admin/users/${user.id}/assignees` : undefined}
      roleLabel="Approver"
      title="Submit for Approval"
      confirmLabel={submitting ? "Submitting…" : "Submit"}
      busy={submitting}
      onConfirm={(userId) => void submitWithAssignee(userId)}
    />
    </>
  )
}
