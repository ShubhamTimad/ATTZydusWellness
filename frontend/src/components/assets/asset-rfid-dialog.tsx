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

type AssetRfidDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onChange: (value: string) => void
  onSave: () => void
  saving?: boolean
}

export function AssetRfidDialog({
  open,
  onOpenChange,
  value,
  onChange,
  onSave,
  saving = false,
}: AssetRfidDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden rounded-2xl p-0 sm:max-w-md">

        <div className="border-b px-6 py-4">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-lg font-semibold tracking-tight">
              {value ? "Update RFID" : "Attach RFID"}
            </DialogTitle>
          </DialogHeader>

          <p className="mt-1 text-sm text-muted-foreground">
            Scan the RFID tag or enter the RFID manually.
          </p>
        </div>

        <div className="space-y-5 px-6 py-5">
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
              autoFocus
              className="h-11 font-mono"
            />

            <p className="text-xs text-muted-foreground">
              RFID must be unique for every asset.
            </p>
          </div>
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

            <Button
              type="button"
              disabled={saving || !value.trim()}
              onClick={onSave}
              className="min-w-28"
            >
              {saving
                ? "Saving..."
                : value
                  ? "Update RFID"
                  : "Attach RFID"}
            </Button>
          </div>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  )
}
