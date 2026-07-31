import * as React from "react"

import { RequiredFieldMark } from "@/components/assets/required-field-mark"
import { AdminPrimaryButton, adminSelectClass, adminTextareaClass } from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { ApiError, getJson } from "@/lib/api"
import type { CapexAssigneeListResponse, CapexAssigneeOption } from "@/lib/capex-types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

type DecisionMode = "approve" | "reject"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: DecisionMode
  busy?: boolean
  /** When true, comment/reason is required for both approve and reject. */
  requireComment?: boolean
  title?: string
  confirmLabel?: string
  /** When approving and another step follows, pick next user (via assigneesUrl or level). */
  needsNextAssignee?: boolean
  nextAssigneeLevel?: string | null
  nextStepRoleName?: string | null
  /** Assignees API path for the next-approver pool (prefer role_id from workflow). */
  assigneesUrl?: string
  onConfirm: (payload: {
    comment: string | null
    nextAssignedUserId: number | null
  }) => void | Promise<void>
}

export function CapexDecisionDialog({
  open,
  onOpenChange,
  mode,
  busy = false,
  requireComment = false,
  title,
  confirmLabel,
  needsNextAssignee = false,
  nextAssigneeLevel = null,
  nextStepRoleName = null,
  assigneesUrl,
  onConfirm,
}: Props) {
  const [comment, setComment] = React.useState("")
  const [items, setItems] = React.useState<CapexAssigneeOption[]>([])
  const [loadingUsers, setLoadingUsers] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState("")

  const showNextPicker =
    mode === "approve" && needsNextAssignee && Boolean(assigneesUrl)
  const commentRequired = requireComment || mode === "reject"

  React.useEffect(() => {
    if (!open) return
    setComment("")
    setSelectedId("")
  }, [open, mode])

  React.useEffect(() => {
    if (!open || !showNextPicker) {
      setItems([])
      return
    }
    const url =
      assigneesUrl ??
      (nextAssigneeLevel
        ? `/admin/capitalization-forms/assignees?level=${encodeURIComponent(nextAssigneeLevel)}`
        : null)
    if (!url) {
      setItems([])
      return
    }
    let cancelled = false
    setLoadingUsers(true)
    void (async () => {
      try {
        const res = await getJson<CapexAssigneeListResponse>(url)
        if (!cancelled) setItems(res.items)
      } catch (e) {
        if (!cancelled) {
          setItems([])
          toast.error(e instanceof ApiError ? e.message : "Could not load users.")
        }
      } finally {
        if (!cancelled) setLoadingUsers(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, showNextPicker, nextAssigneeLevel, assigneesUrl])

  async function confirm() {
    if (commentRequired && !comment.trim()) {
      toast.error(
        mode === "reject" ? "Reason is required when rejecting." : "Reason is required.",
      )
      return
    }
    if (showNextPicker && !selectedId) {
      toast.error(`Select a ${nextStepRoleName ?? "next approver"}.`)
      return
    }
    await onConfirm({
      comment: comment.trim() ? comment.trim() : null,
      nextAssignedUserId: showNextPicker ? Number(selectedId) : null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {title ?? (mode === "approve" ? "Approve" : "Reject")}
          </DialogTitle>
        </DialogHeader>
        <div className="dialog-body space-y-3">
          {showNextPicker ? (
            <div className="app-form-field">
              <Label htmlFor="capex_decision_next" className="app-form-label">
                Next approver · {nextStepRoleName ?? "Next step"}
                <RequiredFieldMark />
              </Label>
              <select
                id="capex_decision_next"
                className={adminSelectClass}
                value={selectedId}
                disabled={loadingUsers || busy}
                onChange={(e) => setSelectedId(e.target.value)}
                autoFocus
              >
                <option value="">{loadingUsers ? "Loading…" : "Select user"}</option>
                {items.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
              {!loadingUsers && items.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">No users in this role.</p>
              ) : null}
            </div>
          ) : null}

          <div className="app-form-field">
            <Label htmlFor="capex_decision_comment" className="app-form-label">
              {mode === "reject" || requireComment ? "Reason" : "Comment"}
              {commentRequired ? <RequiredFieldMark /> : null}
            </Label>
            <textarea
              id="capex_decision_comment"
              className={cn(adminTextareaClass, "min-h-[88px]")}
              value={comment}
              disabled={busy}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                commentRequired
                  ? mode === "reject"
                    ? "Reason for rejection…"
                    : "Reason for approval…"
                  : "Optional comment…"
              }
              rows={3}
              autoFocus={!showNextPicker}
            />
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
            disabled={busy || (showNextPicker && loadingUsers)}
            onClick={() => void confirm()}
          >
            {busy
              ? "Working…"
              : confirmLabel ?? (mode === "approve" ? "Approve" : "Reject")}
          </AdminPrimaryButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}
