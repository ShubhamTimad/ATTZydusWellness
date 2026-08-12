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
  PackageX,
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

export function canActOnAsset(row: { action_allowed?: boolean | null }): boolean {
  return row.action_allowed !== false
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
  return rows.filter(
    (r) => canActOnAsset(r) && canSubmitForApproval(r.lifecycle_status, r.approval_status),
  )
}

/** Physical verification: approved + RFID attached only. */
export function canCreatePhysicalVerificationOrder(row: {
  approval_status?: string | null
  lifecycle_status?: string | null
  rfid_code?: string | null
}): boolean {
  const approval = (row.approval_status ?? "").trim().toLowerCase()
  if (approval !== "approved") return false
  const lifecycle = (row.lifecycle_status ?? "").trim().toLowerCase()
  if (lifecycle && lifecycle !== "active") return false
  return Boolean((row.rfid_code || "").trim())
}

export function eligiblePhysicalOrderAssets(rows: AssetListItem[]): AssetListItem[] {
  return rows.filter((r) => canActOnAsset(r) && canCreatePhysicalVerificationOrder(r))
}

export function eligibleDecisionAssets(rows: AssetListItem[]): AssetListItem[] {
  return rows.filter(
    (r) => canActOnAsset(r) && (r.approval_status || "").toLowerCase() === "pending",
  )
}

export function eligibleDeactivateAssets(rows: AssetListItem[]): AssetListItem[] {
  return rows.filter(
    (r) => canActOnAsset(r) && canDeactivateAsset(r.lifecycle_status, r.approval_status),
  )
}

export function eligibleReactivateAssets(rows: AssetListItem[]): AssetListItem[] {
  return rows.filter((r) => canActOnAsset(r) && canReactivateAsset(r.lifecycle_status))
}

export function buildAssetListActionItems(opts: {
  selectedCount: number
  rfidTaggedCount?: number
  physicalOrderEligibleCount?: number
  submitEligibleCount?: number
  deactivateEligibleCount?: number
  reactivateEligibleCount?: number
  transferEligibleCount?: number
  disposalEligibleCount?: number
  canDelete: boolean
  canDeactivate?: boolean
  canReactivate?: boolean
  canAttachRfid?: boolean
  canCreateOrder?: boolean
  canCreateTransfer?: boolean
  canCreateDisposal?: boolean
  canSubmitForApproval?: boolean
}): AssetActionItem[] {
  const {
    selectedCount,
    rfidTaggedCount = 0,
    physicalOrderEligibleCount = rfidTaggedCount,
    submitEligibleCount = 0,
    deactivateEligibleCount = 0,
    reactivateEligibleCount = 0,
    transferEligibleCount = 0,
    disposalEligibleCount = 0,
    canDelete,
    canDeactivate = false,
    canReactivate = false,
    canAttachRfid,
    canCreateOrder,
    canCreateTransfer = false,
    canCreateDisposal = false,
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
    const hint =
      selectedCount === 0
        ? undefined
        : physicalOrderEligibleCount === 0
          ? "Only approved assets with RFID can be included"
          : physicalOrderEligibleCount < selectedCount
            ? `${physicalOrderEligibleCount} of ${selectedCount} approved with RFID`
            : `${physicalOrderEligibleCount} asset(s)`
    actions.push({
      id: "create-physical-order",
      label: "Create physical verification order",
      hint,
      disabled: selectedCount === 0 || physicalOrderEligibleCount === 0,
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
      label: "Create transfer order",
      hint,
      disabled: transferEligibleCount === 0,
      icon: ArrowRightLeft,
    })
  }

  if (canCreateDisposal) {
    const hint =
      selectedCount === 0
        ? undefined
        : disposalEligibleCount === 0
          ? "Only the asset custodian can create a disposal"
          : disposalEligibleCount < selectedCount
            ? `${disposalEligibleCount} of ${selectedCount} as custodian`
            : `${disposalEligibleCount} asset(s)`
    actions.push({
      id: "create-disposal-order",
      label: "Create disposal order",
      hint,
      disabled: disposalEligibleCount === 0,
      icon: PackageX,
    })
  }

  if (canDeactivate) {
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
  }

  if (canReactivate) {
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

  if (canDeactivate && !editing) {
    actions.push({
      id: "deactivate",
      label: "Deactivate asset",
      icon: PowerOff,
    })
  }

  if (canReactivate && !editing) {
    actions.push({
      id: "reactivate",
      label: "Reactivate asset",
      icon: Power,
    })
  }

  return actions
}
