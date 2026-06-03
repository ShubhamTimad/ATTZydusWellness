import type { LucideIcon } from "lucide-react"
import type { AssetListItem } from "@/lib/assets-types"
import { canSubmitForApproval } from "@/lib/asset-lifecycle"
import { ClipboardList, ExternalLink, Pencil, Send, Trash2, X, ScanLine } from "lucide-react"

export type AssetActionItem = {
  id: string
  label: string
  hint?: string
  disabled?: boolean
  variant?: "default" | "destructive"
  icon?: LucideIcon
}

export function selectedAssetsFromList(
  items: AssetListItem[],
  selected: Set<number>,
): AssetListItem[] {
  return items.filter((row) => selected.has(row.id))
}

export function countSubmittableSelected(
  rows: AssetListItem[],
  canSubmit: boolean,
): number {
  if (!canSubmit) return 0
  return rows.filter((row) =>
    canSubmitForApproval(row.lifecycle_status, row.approval_status),
  ).length
}

export function countRfidTaggedSelected(rows: { rfid_code?: string | null }[]): number {
  return rows.filter((r) => (r.rfid_code || "").trim().length > 0).length
}

export function buildAssetListActionItems(opts: {
  selectedCount: number
  submittableCount: number
  rfidTaggedCount?: number
  canSubmitApproval: boolean
  canDelete: boolean
  canAttachRfid?: boolean
  canCreateOrder?: boolean
}): AssetActionItem[] {
  const {
    selectedCount,
    submittableCount,
    rfidTaggedCount = 0,
    canSubmitApproval,
    canDelete,
    canAttachRfid,
    canCreateOrder,
  } = opts

  const actions: AssetActionItem[] = []

  if (canAttachRfid && selectedCount === 1) {
    actions.push({
      id: "attach-rfid",
      label: "Attach RFID",
      icon: ScanLine,
    })
  }

  if (canCreateOrder) {
    const rfidHint =
      selectedCount > 0
        ? rfidTaggedCount > 0
          ? `${rfidTaggedCount} of ${selectedCount} with RFID tagged`
          : "Selected assets need an attached RFID"
        : undefined
    actions.push({
      id: "create-physical-order",
      label: "Create physical order",
      hint: rfidHint,
      disabled: selectedCount === 0 || rfidTaggedCount === 0,
      icon: ClipboardList,
    })
  }

  if (canSubmitApproval) {
    actions.push({
      id: "submit-for-approval",
      label: "Submit for approval",
      hint:
        submittableCount > 0
          ? `${submittableCount} of ${selectedCount} selected`
          : "No selected assets are eligible",
      disabled: submittableCount === 0,
      icon: Send,
    })
  }

  actions.push({
    id: "open",
    label: "Open asset",
    hint: selectedCount === 1 ? undefined : "Select exactly one asset",
    disabled: selectedCount !== 1,
    icon: ExternalLink,
  })

  if (canDelete) {
    actions.push({
      id: "delete",
      label: "Delete selected",
      hint: selectedCount > 0 ? `${selectedCount} asset(s)` : undefined,
      disabled: selectedCount === 0,
      variant: "destructive",
      icon: Trash2,
    })
  }

  actions.push({
    id: "clear-selection",
    label: "Clear selection",
    icon: X,
  })

  return actions
}

export function buildAssetDetailActionItems(opts: {
  canSubmitApproval: boolean
  canSubmit: boolean
  canUpdate: boolean
  canEdit: boolean
  editing: boolean
}): AssetActionItem[] {
  const { canSubmitApproval, canSubmit, canUpdate, canEdit, editing } = opts
  const actions: AssetActionItem[] = []

  if (canSubmitApproval) {
    actions.push({
      id: "submit-for-approval",
      label: "Submit for approval",
      hint: canSubmit ? undefined : "Not available for this status",
      disabled: !canSubmit || editing,
      icon: Send,
    })
  }

  if (canUpdate) {
    actions.push({
      id: "update-rfid",
      label: "Attach / Update RFID",
      icon: ScanLine,
    })
  }


  if (canUpdate) {
    actions.push({
      id: "edit",
      label: editing ? "Cancel edit" : "Edit asset",
      hint: canEdit ? undefined : "Cannot edit while approval is pending",
      disabled: !canEdit && !editing,
      icon: Pencil,
    })
  }



  return actions
}
