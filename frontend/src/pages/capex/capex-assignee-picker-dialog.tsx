import * as React from "react"

import { RequiredFieldMark } from "@/components/assets/required-field-mark"
import { AdminPrimaryButton, adminSelectClass } from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { ApiError, getJson } from "@/lib/api"
import type { CapexAssigneeListResponse, CapexAssigneeOption } from "@/lib/capex-types"
import { toast } from "sonner"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Assignee pool level (legacy name map). Prefer assigneesUrl with role_id. */
  level?: string
  /** Full assignees API path (e.g. /admin/.../assignees?role_id=12). */
  assigneesUrl?: string
  /** Hide this user from the list (e.g. current assignee on reassign). */
  excludeUserId?: number | null
  roleLabel: string
  /** Action headline (e.g. "Submit for Approval"); defaults to confirmLabel. */
  title?: string
  confirmLabel?: string
  busy?: boolean
  onConfirm: (userId: number) => void | Promise<void>
}

export function CapexAssigneePickerDialog({
  open,
  onOpenChange,
  level,
  assigneesUrl,
  excludeUserId,
  roleLabel,
  title,
  confirmLabel = "Continue",
  busy = false,
  onConfirm,
}: Props) {
  const [items, setItems] = React.useState<CapexAssigneeOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState("")
  const [loadedRoleName, setLoadedRoleName] = React.useState("")

  const fetchUrl =
    assigneesUrl ??
    (level
      ? `/admin/capitalization-forms/assignees?level=${encodeURIComponent(level)}`
      : null)

  React.useEffect(() => {
    if (!open) return
    setSelectedId("")
    setLoadedRoleName("")
    if (!fetchUrl) {
      setItems([])
      setLoading(false)
      toast.error("No assignee role is configured for this step.")
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await getJson<CapexAssigneeListResponse>(fetchUrl)
        if (!cancelled) {
          const excludeId = excludeUserId != null ? Number(excludeUserId) : null
          setItems(
            excludeId == null
              ? res.items
              : res.items.filter((u) => Number(u.id) !== excludeId),
          )
          setLoadedRoleName((res.role_name || "").trim())
        }
      } catch (e) {
        if (!cancelled) {
          setItems([])
          toast.error(e instanceof ApiError ? e.message : "Could not load users.")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, fetchUrl, excludeUserId])

  async function confirm() {
    if (!selectedId) {
      toast.error("Select a user.")
      return
    }
    await onConfirm(Number(selectedId))
  }

  const titleRole = loadedRoleName || roleLabel || "User"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title ?? confirmLabel}</DialogTitle>
        </DialogHeader>
        <div className="dialog-body">
          <div className="app-form-field">
            <Label htmlFor="capex_assignee_picker" className="app-form-label">
              Select {titleRole}
              <RequiredFieldMark />
            </Label>
            <select
              id="capex_assignee_picker"
              className={adminSelectClass}
              value={selectedId}
              disabled={loading || busy}
              onChange={(e) => setSelectedId(e.target.value)}
              autoFocus
            >
              <option value="">{loading ? "Loading…" : "Select User"}</option>
              {items.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
            </select>
            {!loading && items.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">No users in this role.</p>
            ) : null}
          </div>
        </div>
        <div className="dialog-footer-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <AdminPrimaryButton
            type="button"
            disabled={busy || loading || !selectedId}
            onClick={() => void confirm()}
          >
            {busy ? "Working…" : confirmLabel}
          </AdminPrimaryButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}
