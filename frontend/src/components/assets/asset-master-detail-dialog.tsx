import * as React from "react"
import { ExternalLink } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"

import { AssetMasterReadOnlyView } from "@/components/assets/asset-master-readonly-view"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, getJson } from "@/lib/api"
import type { AssetDetail } from "@/lib/assets-types"
import { hasPermission } from "@/lib/permissions"

type AssetMasterDetailDialogProps = {
  taskId: number
  assetId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AssetMasterDetailDialog({
  taskId,
  assetId,
  open,
  onOpenChange,
}: AssetMasterDetailDialogProps) {
  const [asset, setAsset] = React.useState<AssetDetail | null>(null)
  const [loading, setLoading] = React.useState(false)
  const canOpenAsset = hasPermission("asset.view")

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setAsset(null)
    void getJson<AssetDetail>(`/tasks/${taskId}/asset`)
      .then((data) => {
        if (!cancelled) setAsset(data)
      })
      .catch((e) => {
        if (!cancelled) {
          toast.error(e instanceof ApiError ? e.message : "Could not load asset details.")
          onOpenChange(false)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, taskId, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(92vh,56rem)] w-[min(96vw,72rem)] !max-w-[min(96vw,72rem)] flex-col gap-0 overflow-hidden p-0 sm:!max-w-[min(96vw,72rem)]">
        <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div className="min-w-0 space-y-1">
              <DialogTitle>Asset master details</DialogTitle>
              <DialogDescription>
                Full read-only view of the asset record linked to this approval request.
              </DialogDescription>
            </div>
            {canOpenAsset ? (
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link to={`/dashboard/assets/${assetId}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" aria-hidden />
                  Open Asset
                </Link>
              </Button>
            ) : null}
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-14 w-full rounded-lg" />
              <div className="grid gap-4 lg:grid-cols-2">
                <Skeleton className="h-52 rounded-lg" />
                <Skeleton className="h-52 rounded-lg" />
                <Skeleton className="h-52 rounded-lg" />
                <Skeleton className="h-52 rounded-lg" />
              </div>
            </div>
          ) : asset ? (
            <AssetMasterReadOnlyView asset={asset} />
          ) : (
            <p className="text-sm text-muted-foreground">No asset data available.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
