import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"

export type ImportProgressState = {
  processedRows: number
  totalRows: number
  percent: number
  createdCount: number
  chunkIndex: number
  totalChunks: number
}

type AssetImportProgressOverlayProps = {
  progress: ImportProgressState
  onCancel: () => void
  cancelling?: boolean
}

export function AssetImportProgressOverlay({
  progress,
  onCancel,
  cancelling = false,
}: AssetImportProgressOverlayProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-progress-title"
      aria-busy="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 shrink-0 animate-spin text-primary" aria-hidden />
          <h2 id="import-progress-title" className="text-lg font-semibold text-foreground">
            Import in progress
          </h2>
        </div>

        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between text-sm tabular-nums">
            <span className="text-muted-foreground">
              Processed {progress.processedRows.toLocaleString()} / {progress.totalRows.toLocaleString()}
            </span>
            <span className="font-semibold text-primary">{Math.round(progress.percent)}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end border-t border-border/60 pt-4">
          <Button type="button" variant="outline" disabled={cancelling} onClick={onCancel}>
            {cancelling ? "Cancelling…" : "Cancel import"}
          </Button>
        </div>
      </div>
    </div>
  )
}
