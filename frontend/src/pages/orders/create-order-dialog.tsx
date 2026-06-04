import * as React from "react"
import { toast } from "sonner"

import { AdminPrimaryButton, adminSelectClass, adminTextareaClass } from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { ApiError, getJson, postJson } from "@/lib/api"
import type { ExecutorUser, PhysicalOrderDetail } from "@/lib/orders-types"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  assetIds: number[]
  onCreated: (order: PhysicalOrderDetail) => void
}

export function CreatePhysicalOrderDialog({ open, onOpenChange, assetIds, onCreated }: Props) {
  const [executors, setExecutors] = React.useState<ExecutorUser[]>([])
  const [assignedTo, setAssignedTo] = React.useState("")
  const [remarks, setRemarks] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    void getJson<ExecutorUser[]>("/admin/physical-orders/executors")
      .then(setExecutors)
      .catch(() => setExecutors([]))
  }, [open])

  async function submit() {
    if (!assignedTo) {
      toast.error("Select an executor.")
      return
    }
    setBusy(true)
    try {
      const order = await postJson<PhysicalOrderDetail>("/admin/physical-orders", {
        asset_ids: assetIds,
        assigned_to: Number(assignedTo),
        remarks: remarks.trim() || null,
        submit: true,
      })
      toast.success(`Order ${order.order_number} created.`)
      onCreated(order)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to create order.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create physical verification order</DialogTitle>
          <DialogDescription>
            {assetIds.length} RFID-tagged asset(s) will be included. An executor must be assigned before
            submission.
          </DialogDescription>
        </DialogHeader>
        <div className="dialog-body space-y-4">
          <div className="space-y-2">
            <Label htmlFor="executor">Operator / executor</Label>
            <select
              id="executor"
              className={adminSelectClass}
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            >
              <option value="">Select operator…</option>
              {executors.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.full_name}
                  {u.email ? ` (${u.email})` : ""}
                </option>
              ))}
            </select>
            {executors.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No users with order execution permission. Assign the Operator role (or order.execute) to users who
                should run physical verification.
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="remarks">Remarks</Label>
            <textarea
              id="remarks"
              className={cn(adminTextareaClass, "min-h-[80px]")}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              placeholder="Optional notes for approvers and executor"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <AdminPrimaryButton type="button" onClick={() => void submit()} disabled={busy}>
              Create & submit
            </AdminPrimaryButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
