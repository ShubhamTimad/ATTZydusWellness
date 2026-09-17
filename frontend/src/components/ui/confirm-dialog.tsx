import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type ConfirmDialogOptions = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive styling for the confirm button. */
  destructive?: boolean
  /** When set, confirm stays disabled until the user types this exact text. */
  requireText?: string
}

type Pending = ConfirmDialogOptions & {
  resolve: (ok: boolean) => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  requireText,
  typedValue,
  onTypedValueChange,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogOptions & {
  open: boolean
  typedValue?: string
  onTypedValueChange?: (value: string) => void
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const requireOk = !requireText || (typedValue ?? "") === requireText
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel()
      }}
    >
      <DialogContent showCloseButton={false} className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="px-5 py-4">
          <DialogTitle>{title}</DialogTitle>
          {description.trim() ? (
            <DialogDescription className="whitespace-pre-wrap">{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        {requireText ? (
          <div className="space-y-1.5 border-t border-border/60 px-5 py-3">
            <Label htmlFor="confirm-require-text">
              Type <span className="font-semibold text-foreground">{requireText}</span> to confirm
            </Label>
            <Input
              id="confirm-require-text"
              value={typedValue ?? ""}
              onChange={(e) => onTypedValueChange?.(e.target.value)}
              autoComplete="off"
              disabled={busy}
              autoFocus
            />
          </div>
        ) : null}
        <DialogFooter className="border-t border-border/60 px-5 py-3 sm:justify-end">
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={busy || !requireOk}
            onClick={onConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Promise-based confirm that renders an in-app dialog (replaces window.confirm). */
export function useConfirmDialog() {
  const [pending, setPending] = React.useState<Pending | null>(null)
  const [typed, setTyped] = React.useState("")

  const ask = React.useCallback((options: ConfirmDialogOptions) => {
    setTyped("")
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve })
    })
  }, [])

  const finish = React.useCallback((ok: boolean) => {
    setPending((cur) => {
      cur?.resolve(ok)
      return null
    })
    setTyped("")
  }, [])

  const dialog = (
    <ConfirmDialog
      open={pending != null}
      title={pending?.title ?? ""}
      description={pending?.description ?? ""}
      confirmLabel={pending?.confirmLabel}
      cancelLabel={pending?.cancelLabel}
      destructive={pending?.destructive}
      requireText={pending?.requireText}
      typedValue={typed}
      onTypedValueChange={setTyped}
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    />
  )

  return { ask, dialog }
}
