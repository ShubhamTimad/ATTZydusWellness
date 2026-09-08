import { AdminPillBadge } from "@/components/layout/admin-ui"
import { cn } from "@/lib/utils"

export type UserCostCenterRef = { code: string; name: string }

function resolveCostCenters(
  items: UserCostCenterRef[] | undefined,
  fallback: UserCostCenterRef | null | undefined,
): UserCostCenterRef[] {
  if (items && items.length > 0) return items
  return fallback ? [fallback] : []
}

/** Codes only; full names on hover. Table lists show three pills, then +N more. */
export function UserCostCentersDisplay({
  items,
  fallback,
  className,
  maxVisible,
}: {
  items?: UserCostCenterRef[]
  fallback?: UserCostCenterRef | null
  className?: string
  /** When set and the list is longer, show that many codes then +N. */
  maxVisible?: number
}) {
  const list = resolveCostCenters(items, fallback)
  if (list.length === 0) return <span className="text-muted-foreground">—</span>
  const tip = list.map((c) => `${c.code} — ${c.name}`).join("\n")
  const limit = maxVisible != null && maxVisible > 0 ? maxVisible : list.length
  const shown = list.slice(0, limit)
  const hidden = list.length - shown.length
  return (
    <span
      className={cn("inline-flex flex-wrap items-center gap-1.5", className)}
      title={tip}
    >
      {shown.map((c) => (
        <AdminPillBadge key={c.code} tone="neutral">
          {c.code}
        </AdminPillBadge>
      ))}
      {hidden > 0 ? (
        <AdminPillBadge tone="danger">+{hidden} more</AdminPillBadge>
      ) : null}
    </span>
  )
}
