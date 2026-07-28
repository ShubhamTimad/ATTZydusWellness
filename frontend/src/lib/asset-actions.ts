import type { LucideIcon } from "lucide-react"
import type { AssetListItem } from "@/lib/assets-types"
import {
  canDeactivateAsset,
  canReactivateAsset,
  canSubmitForApproval,
} from "@/lib/asset-lifecycle"
import {
  ArrowRightLeft,
  ClipboardList,
  ExternalLink,
  Pencil,
  Power,
  PowerOff,
  Send,
  Trash2,
  ScanLine,
  X,
} from "lucide-react"

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

export function countRfidTaggedSelected(rows: { rfid_code?: string | null }[]): number {
  return rows.filter((r) => (r.rfid_code || "").trim().length > 0).length
}

export function eligibleSubmitAssets(rows: AssetListItem[]): AssetListItem[] {
  return rows.filter((r) => canSubmitForApproval(r.lifecycle_status, r.approval_status))
}

export function eligibleDecisionAssets(rows: AssetListItem[]): AssetListItem[] {
  return rows.filter((r) => (r.approval_status || "").toLowerCase() === "pending")
}

export function eligibleDeactivateAssets(rows: AssetListItem[]): AssetListItem[] {
  return rows.filter((r) => canDeactivateAsset(r.lifecycle_status, r.approval_status))
}

export function eligibleReactivateAssets(rows: AssetListItem[]): AssetListItem[] {
  return rows.filter((r) => canReactivateAsset(r.lifecycle_status))
}

export function buildAssetListActionItems(opts: {
  selectedCount: number
  rfidTaggedCount?: number
  submitEligibleCount?: number
  deactivateEligibleCount?: number
  reactivateEligibleCount?: number
  transferEligibleCount?: number
  canDelete: boolean
  canUpdate?: boolean
  canAttachRfid?: boolean
  canCreateOrder?: boolean
  canCreateTransfer?: boolean
  canSubmitForApproval?: boolean
}): AssetActionItem[] {
  const {
    selectedCount,
    rfidTaggedCount = 0,
    submitEligibleCount = 0,
    deactivateEligibleCount = 0,
    reactivateEligibleCount = 0,
    transferEligibleCount = 0,
    canDelete,
    canUpdate = false,
    canAttachRfid,
    canCreateOrder,
    canCreateTransfer = false,
    canSubmitForApproval: canSubmit = false,
  } = opts

  const actions: AssetActionItem[] = []

  if (canAttachRfid && selectedCount === 1) {
    actions.push({
      id: "attach-rfid",
      label: "Attach RFID",
      icon: ScanLine,
    })
  }

  if (canSubmit) {
    const hint =
      selectedCount === 0
        ? undefined
        : submitEligibleCount === 0
          ? "No draft/rejected assets in selection"
          : submitEligibleCount < selectedCount
            ? `${submitEligibleCount} of ${selectedCount} eligible`
            : `${submitEligibleCount} asset(s)`
    actions.push({
      id: "submit-for-approval",
      label: "Submit for approval",
      hint,
      disabled: submitEligibleCount === 0,
      icon: Send,
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

  if (canCreateTransfer) {
    const hint =
      selectedCount === 0
        ? undefined
        : transferEligibleCount === 0
          ? "Only the asset custodian can create a transfer"
          : transferEligibleCount < selectedCount
            ? `${transferEligibleCount} of ${selectedCount} as custodian`
            : `${transferEligibleCount} asset(s)`
    actions.push({
      id: "create-transfer-order",
      label: "Create transfer",
      hint,
      disabled: transferEligibleCount === 0,
      icon: ArrowRightLeft,
    })
  }

  if (canUpdate) {
    actions.push({
      id: "deactivate",
      label: "Deactivate",
      hint:
        selectedCount === 0
          ? undefined
          : deactivateEligibleCount === 0
            ? "No active assets in selection"
            : deactivateEligibleCount < selectedCount
              ? `${deactivateEligibleCount} of ${selectedCount} active`
              : `${deactivateEligibleCount} asset(s)`,
      disabled: deactivateEligibleCount === 0,
      icon: PowerOff,
    })
    actions.push({
      id: "reactivate",
      label: "Reactivate",
      hint:
        selectedCount === 0
          ? undefined
          : reactivateEligibleCount === 0
            ? "No deactivated assets in selection"
            : reactivateEligibleCount < selectedCount
              ? `${reactivateEligibleCount} of ${selectedCount} deactivated`
              : `${reactivateEligibleCount} asset(s)`,
      disabled: reactivateEligibleCount === 0,
      icon: Power,
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
  canUpdate: boolean
  canEdit: boolean
  editing: boolean
  canDeactivate?: boolean
  canReactivate?: boolean
  canSubmit?: boolean
}): AssetActionItem[] {
  const {
    canUpdate,
    canEdit,
    editing,
    canDeactivate = false,
    canReactivate = false,
    canSubmit = false,
  } = opts
  const actions: AssetActionItem[] = []

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

  if (canSubmit && !editing) {
    actions.push({
      id: "submit",
      label: "Submit for approval",
      icon: Send,
    })
  }

  if (canUpdate && canDeactivate && !editing) {
    actions.push({
      id: "deactivate",
      label: "Deactivate asset",
      icon: PowerOff,
    })
  }

  if (canUpdate && canReactivate && !editing) {
    actions.push({
      id: "reactivate",
      label: "Reactivate asset",
      icon: Power,
    })
  }

  return actions
}
