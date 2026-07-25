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
import type { ExecutorListResponse, PhysicalOrderDetail } from "@/lib/orders-types"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  assetIds: number[]
  plantId?: number | null
  resetVerificationAssetIds?: number[]
  onCreated: (order: PhysicalOrderDetail) => void
}

export function CreatePhysicalOrderDialog({
  open,
  onOpenChange,
  assetIds,
  plantId,
  resetVerificationAssetIds = [],
  onCreated,
}: Props) {
  const [executors, setExecutors] = React.useState<ExecutorListResponse["items"]>([])
  const [roleName, setRoleName] = React.useState<string | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [assignedTo, setAssignedTo] = React.useState("")
  const [remarks, setRemarks] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [loadingExecutors, setLoadingExecutors] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      setAssignedTo("")
      setRemarks("")
      setBusy(false)
      setExecutors([])
      setRoleName(null)
      setLoadError(null)
      return
    }
    setLoadingExecutors(true)
    const q = plantId != null ? `?plant_id=${plantId}` : ""
    void getJson<ExecutorListResponse>(`/admin/physical-orders/executors${q}`)
      .then((res) => {
        setExecutors(res.items)
        setRoleName(res.role_name)
        setLoadError(null)
      })
      .catch((e) => {
        setExecutors([])
        setRoleName(null)
        setLoadError(e instanceof ApiError ? e.message : "Could not load assignees from workflow.")
      })
      .finally(() => setLoadingExecutors(false))
  }, [open, plantId])

  async function createAndAssign() {
    if (!assignedTo) {
      toast.error(roleName ? `Select a ${roleName} user.` : "Select an assignee.")
      return
    }
    setBusy(true)
    try {
      const order = await postJson<PhysicalOrderDetail>("/admin/physical-orders", {
        asset_ids: assetIds,
        assigned_to: Number(assignedTo),
        remarks: remarks.trim() || null,
        submit: true,
        reset_verification_asset_ids: resetVerificationAssetIds,
      })
      toast.success(
        order.assigned_to_name
          ? `Order ${order.order_number} assigned to ${order.assigned_to_name}.`
          : `Order ${order.order_number} created.`,
      )
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
            {assetIds.length} RFID-tagged asset(s) will be included. Pick the next user from the
            assignment workflow role; the order goes to Assigned so they can start.
            {resetVerificationAssetIds.length > 0
              ? ` ${resetVerificationAssetIds.length} asset(s) were already verified this financial year; physical count and verification date will be cleared when the order is assigned.`
              : null}
          </DialogDescription>
        </DialogHeader>
        <div className="dialog-body space-y-4">
          <div className="space-y-2">
            <Label htmlFor="executor">{roleName ? `${roleName} *` : "Assignee *"}</Label>
            <select
              id="executor"
              className={adminSelectClass}
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              disabled={loadingExecutors || busy || Boolean(loadError)}
            >
              <option value="">
                {loadingExecutors
                  ? "Loading…"
                  : roleName
                    ? `Select ${roleName}…`
                    : "Select assignee…"}
              </option>
              {executors.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.full_name}
                  {u.email ? ` (${u.email})` : ""}
                </option>
              ))}
            </select>
            {loadError ? (
              <p className="text-xs text-destructive">{loadError}</p>
            ) : !loadingExecutors && executors.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {roleName
                  ? `No users in the "${roleName}" role for this plant. Assign that role to users scoped to this plant.`
                  : "Configure the physical order assignment workflow (order.create) first."}
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
              placeholder="Optional notes for the assignee"
            />
          </div>
          <div className="dialog-footer-actions">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <AdminPrimaryButton
              type="button"
              onClick={() => void createAndAssign()}
              disabled={busy || loadingExecutors || !assignedTo}
            >
              {busy ? "Creating…" : "Create & assign"}
            </AdminPrimaryButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
