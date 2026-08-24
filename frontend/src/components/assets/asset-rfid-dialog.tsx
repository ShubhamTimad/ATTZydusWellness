import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TagColorSelect } from "@/components/assets/tag-color-select"
import type { TagColorMaster } from "@/lib/masters-types"

type AssetRfidDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onChange: (value: string) => void
  onSave: () => void
  saving?: boolean
  /** True when the asset already had an RFID before this dialog was opened. */
  isUpdate?: boolean
  /** When set, show asset code field (toolbar attach-by-code flow). */
  assetCode?: string
  onAssetCodeChange?: (value: string) => void
  assetCodeReadOnly?: boolean
  tagColorId?: string
  onTagColorChange?: (value: string) => void
  tagColors?: TagColorMaster[]
}

export function AssetRfidDialog({
  open,
  onOpenChange,
  value,
  onChange,
  onSave,
  saving = false,
  isUpdate = false,
  assetCode,
  onAssetCodeChange,
  assetCodeReadOnly = false,
  tagColorId = "",
  onTagColorChange,
  tagColors = [],
}: AssetRfidDialogProps) {
  const showAssetCode = onAssetCodeChange != null
  // Tag color picker hidden for now — restore when product wants it back.
  const showTagColor = false
  // const showTagColor = value.trim().length > 0 && onTagColorChange != null

  const [openedBaseline, setOpenedBaseline] = React.useState({ value: "", tagColorId: "" })
  React.useEffect(() => {
    if (!open) return
    setOpenedBaseline({ value: value.trim(), tagColorId })
    // Capture values only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-only snapshot
  }, [open])

  const unchanged =
    isUpdate &&
    value.trim() === openedBaseline.value &&
    (!showTagColor || tagColorId === openedBaseline.tagColorId)

  const canSave =
    value.trim().length > 0 &&
    (!showAssetCode || (assetCode?.trim().length ?? 0) > 0) &&
    !unchanged

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden rounded-2xl p-0 sm:max-w-md">

        <div className="border-b px-6 py-4">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-lg font-semibold tracking-tight">
              {isUpdate ? "Update RFID" : "Attach RFID"}
            </DialogTitle>
          </DialogHeader>

          <p className="mt-1 text-sm text-muted-foreground">
            {showAssetCode
              ? "Enter asset code and RFID. Codes must be unique."
              : isUpdate
                ? ""
                : ""}
          </p>
        </div>

        <div className="space-y-5 px-6 py-5">
          {showAssetCode ? (
            <div className="space-y-2">
              <Label htmlFor="asset-code" className="text-sm font-medium">
                Asset code
              </Label>
              <Input
                id="asset-code"
                value={assetCode ?? ""}
                onChange={(e) => onAssetCodeChange(e.target.value)}
                placeholder="e.g. DEMO-AST-001"
                readOnly={assetCodeReadOnly}
                autoFocus={!assetCodeReadOnly}
                className="h-11 font-mono uppercase"
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label
              htmlFor="rfid"
              className="text-sm font-medium"
            >
              RFID Code
            </Label>

            <Input
              id="rfid"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Scan or enter RFID code"
              autoFocus={!showAssetCode}
              className="h-11 font-mono"
            />

            {/* <p className="text-xs text-muted-foreground">
              RFID must be unique for every asset.
            </p> */}
          </div>

          {showTagColor && onTagColorChange ? (
            <TagColorSelect
              value={tagColorId}
              onChange={onTagColorChange}
              tagColors={tagColors}
            />
          ) : null}
        </div>

        <DialogFooter className="border-t bg-muted/20 px-6 py-4">
          <div className="flex w-full justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>

            <span
              className="inline-flex"
              title={
                unchanged
                  ? "Change the RFID code before updating"
                  : !value.trim()
                    ? "Enter an RFID code"
                    : undefined
              }
            >
              <Button
                type="button"
                disabled={saving || !canSave}
                onClick={onSave}
                className="min-w-28"
              >
                {saving
                  ? "Saving..."
                  : isUpdate
                    ? "Update RFID"
                    : "Attach RFID"}
              </Button>
            </span>
          </div>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  )
}
