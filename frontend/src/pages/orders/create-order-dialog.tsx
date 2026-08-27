import * as React from "react"
import { toast } from "sonner"

import { AdminPrimaryButton, adminSelectClass, adminTextareaClass } from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  costCenterIds?: number[]
  resetVerificationAssetIds?: number[]
  onCreated: (order: PhysicalOrderDetail) => void
}

function executorsQuery(plantId?: number | null, costCenterIds: number[] = []): string {
  const params = new URLSearchParams()
  if (plantId != null) params.set("plant_id", String(plantId))
  for (const id of costCenterIds) params.append("cost_center_id", String(id))
  const q = params.toString()
  return q ? `?${q}` : ""
}

export function CreatePhysicalOrderDialog({
  open,
  onOpenChange,
  assetIds,
  plantId,
  costCenterIds = [],
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

  // const assetCountLabel =
  //   assetIds.length === 1 ? "1 RFID asset" : `${assetIds.length} RFID assets`

  const ccKey = costCenterIds.join(",")
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
    const ids = ccKey ? ccKey.split(",").map(Number) : []
    void getJson<ExecutorListResponse>(
      `/admin/physical-orders/executors${executorsQuery(plantId, ids)}`,
    )
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
  }, [open, plantId, ccKey])

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
      // toast.success(
      //   order.assigned_to_name
      //     ? `Physical verification order ${order.order_number} created with ${assetIds.length} ${assetIds.length === 1 ? "asset" : "assets"} and assigned to ${order.assigned_to_name}.`
      //     : `Physical verification order ${order.order_number} created with ${assetIds.length} ${assetIds.length === 1 ? "asset" : "assets"}.`,
      // )
      toast.success(
        order.assigned_to_name
          ? `Physical Verification Order created and assigned successfully.`
          : `Physical Verification Order created`,
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
      <DialogContent className="overflow-hidden rounded-2xl p-0 sm:max-w-md">
        <div className="border-b px-6 py-4 pr-12">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-lg font-semibold tracking-tight">
              Create Physical Verification Order
            </DialogTitle>
            <DialogDescription> Assign To Start
            </DialogDescription>
          </DialogHeader>
          {resetVerificationAssetIds.length > 0 ? (
            <p className="mt-2 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
              {resetVerificationAssetIds.length === 1
                ? "1 asset already verified this year — count & date will reset."
                : `${resetVerificationAssetIds.length} assets already verified this year — count & date will reset.`}
            </p>
          ) : null}
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="space-y-2">
            <Label htmlFor="executor" className="text-sm font-medium">
              {roleName ? `Select ${roleName}` : "Select assignee"}{" "}
              <span className="text-destructive" aria-hidden>
                *
              </span>
            </Label>
            <select
              id="executor"
              className={cn(adminSelectClass, "h-11")}
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              disabled={loadingExecutors || busy || Boolean(loadError)}
            >
              <option value="">
                {loadingExecutors
                  ? "Loading…"
                  : roleName
                    ? `Select ${roleName}`
                    : "Select assignee"}
              </option>
              {executors.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.full_name}
                </option>
              ))}
            </select>
            {loadError ? (
              <p className="text-xs text-destructive">{loadError}</p>
            ) : !loadingExecutors && executors.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {roleName
                  ? `No users in the "${roleName}" role with access to all selected cost centers.`
                  : "Configure the Physical order workflow Assign step first."}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="remarks" className="text-sm font-medium">
              Remark
            </Label>
            <textarea
              id="remarks"
              className={cn(adminTextareaClass, "min-h-[88px] resize-y")}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              placeholder="Add a remark (Optional)"
              disabled={busy}
            />
          </div>
        </div>

        <DialogFooter className="border-t bg-muted/20 px-6 py-4 sm:justify-end">
          <div className="flex w-full justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <AdminPrimaryButton
              type="button"
              className="min-w-28"
              onClick={() => void createAndAssign()}
              disabled={busy || loadingExecutors || !assignedTo}
            >
              {busy ? "Creating…" : "Create & Assign"}
            </AdminPrimaryButton>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
