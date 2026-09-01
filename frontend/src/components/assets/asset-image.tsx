import * as React from "react"
import { ImageIcon, Trash2, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
export const MAX_ASSET_IMAGE_BYTES = 5 * 1024 * 1024

export function validateAssetImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) return "Select a PNG, JPEG, or WebP image."
  if (file.size > MAX_ASSET_IMAGE_BYTES) return "Asset image must be 5 MB or smaller."
  return null
}

export function AssetImage({
  imageUrl,
  file,
  editable = false,
  busy = false,
  onFileChange,
  onRemove,
}: {
  imageUrl?: string | null
  file?: File | null
  editable?: boolean
  busy?: boolean
  onFileChange?: (file: File) => void
  onRemove?: () => void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = React.useState(false)

  React.useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }
    const next = URL.createObjectURL(file)
    setPreviewUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])

  const src = previewUrl ?? imageUrl

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/20 transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={!src}
          aria-label={src ? "Open asset image" : "No asset image"}
          onClick={() => src && setPreviewOpen(true)}
        >
          {src ? (
            <img src={src} alt="Asset" className="h-full w-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
              <ImageIcon className="size-6" aria-hidden />
              <span className="text-[11px]">No Image</span>
            </div>
          )}
        </button>
        {editable ? (
          <div className="flex flex-col items-start gap-1.5">
            <div className="flex flex-wrap gap-2">
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(event) => {
                  const selected = event.target.files?.[0]
                  if (selected) onFileChange?.(selected)
                  event.target.value = ""
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                <Upload className="size-4" aria-hidden />
                {src ? "Replace Image" : "Upload Image"}
              </Button>
              {src && onRemove ? (
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRemove}>
                  <Trash2 className="size-4" aria-hidden />
                  Remove
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPEG, or WebP · max 5 MB</p>
          </div>
        ) : null}
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Asset image</DialogTitle>
          </DialogHeader>
          {src ? (
            <div className="flex max-h-[80vh] items-center justify-center overflow-hidden rounded-md bg-muted/20">
              <img src={src} alt="Asset full size" className="max-h-[80vh] max-w-full object-contain" />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
