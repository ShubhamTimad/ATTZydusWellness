import * as React from "react"
import { toast } from "sonner"

import { AdminPrimaryButton } from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ApiError, postJson } from "@/lib/api"
import { invalidateAssetLists, invalidateOrderLists } from "@/lib/query-client"
import type { PhysicalOrderDetail } from "@/lib/orders-types"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  assetIds: number[]
  resetVerificationAssetIds?: number[]
  onCreated: (order: PhysicalOrderDetail) => void
}

export function CreatePhysicalOrderDialog({
  open,
  onOpenChange,
  assetIds,
  resetVerificationAssetIds = [],
  onCreated,
}: Props) {
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) setBusy(false)
  }, [open])

  async function createDraft() {
    setBusy(true)
    try {
      const order = await postJson<PhysicalOrderDetail>("/admin/physical-orders", {
        asset_ids: assetIds,
        submit: false,
        reset_verification_asset_ids: resetVerificationAssetIds,
      })
      toast.success("Physical Verification Order saved as draft successfully.")
      void invalidateAssetLists()
      void invalidateOrderLists()
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
          </DialogHeader>
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
              onClick={() => void createDraft()}
              disabled={busy}
            >
              {busy ? "Creating…" : "Create"}
            </AdminPrimaryButton>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
