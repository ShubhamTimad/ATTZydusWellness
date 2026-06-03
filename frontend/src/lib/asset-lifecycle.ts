export function isAssetActive(lifecycleStatus: string, approvalStatus: string): boolean {
  return lifecycleStatus === "active" && approvalStatus !== "pending"
}

/** List/detail badge: only Active or Inactive. */
export function assetStatusLabel(lifecycleStatus: string, approvalStatus: string): string {
  if (isAssetActive(lifecycleStatus, approvalStatus)) return "Active"
  return "Inactive"
}

export function assetStatusVariant(
  lifecycleStatus: string,
  approvalStatus: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (isAssetActive(lifecycleStatus, approvalStatus)) return "default"
  if (approvalStatus === "rejected") return "destructive"
  return "secondary"
}

export type AssetStatusPillTone = "primary" | "success" | "warning" | "danger" | "neutral"

export function assetStatusPillTone(
  lifecycleStatus: string,
  approvalStatus: string,
): AssetStatusPillTone {
  if (isAssetActive(lifecycleStatus, approvalStatus)) return "success"
  if (approvalStatus === "rejected") return "danger"
  if (approvalStatus === "pending") return "warning"
  return "neutral"
}

export function canSubmitForApproval(lifecycleStatus: string, approvalStatus: string): boolean {
  if (isAssetActive(lifecycleStatus, approvalStatus)) return false
  const approval = approvalStatus.toLowerCase()
  if (approval === "pending") return false
  if (approval === "draft" || approval === "rejected") return true
  if (approval === "not_required" && lifecycleStatus !== "active") return true
  return false
}
