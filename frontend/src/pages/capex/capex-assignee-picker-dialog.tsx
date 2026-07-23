import * as React from "react"

import { AdminPrimaryButton, adminSelectClass } from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ApiError, getJson } from "@/lib/api"
import type { CapexAssigneeListResponse, CapexAssigneeOption } from "@/lib/capex-types"
import { toast } from "sonner"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Assignee pool level: hod | engineering | central_finance (CapEx). Ignored when assigneesUrl is set. */
  level?: string
  /** Full assignees API path (e.g. /admin/assets/12/assignees). */
  assigneesUrl?: string
  roleLabel: string
  confirmLabel?: string
  busy?: boolean
  onConfirm: (userId: number) => void | Promise<void>
}

export function CapexAssigneePickerDialog({
  open,
  onOpenChange,
  level = "hod",
  assigneesUrl,
  roleLabel,
  confirmLabel = "Continue",
  busy = false,
  onConfirm,
}: Props) {
  const [items, setItems] = React.useState<CapexAssigneeOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState("")
  const [resolvedRole, setResolvedRole] = React.useState(roleLabel)

  const fetchUrl =
    assigneesUrl ??
    `/admin/capitalization-forms/assignees?level=${encodeURIComponent(level)}`

  React.useEffect(() => {
    if (!open) return
    setSelectedId("")
    setResolvedRole(roleLabel)
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await getJson<CapexAssigneeListResponse>(fetchUrl)
        if (!cancelled) {
          setItems(res.items)
          if (res.role_name) setResolvedRole(res.role_name)
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
  }, [open, fetchUrl, roleLabel])

  async function confirm() {
    if (!selectedId) {
      toast.error("Select a user.")
      return
    }
    await onConfirm(Number(selectedId))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{resolvedRole || roleLabel}</DialogTitle>
        </DialogHeader>
        <div className="dialog-body">
          <select
            id="capex_assignee_picker"
            className={adminSelectClass}
            value={selectedId}
            disabled={loading || busy}
            onChange={(e) => setSelectedId(e.target.value)}
            autoFocus
          >
            <option value="">{loading ? "Loading…" : "Select user"}</option>
            {items.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
          {!loading && items.length === 0 ? (
            <p className="text-xs text-muted-foreground">No users in this role.</p>
          ) : null}
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
          <AdminPrimaryButton type="button" disabled={busy || loading} onClick={() => void confirm()}>
            {busy ? "Working…" : confirmLabel}
          </AdminPrimaryButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}
