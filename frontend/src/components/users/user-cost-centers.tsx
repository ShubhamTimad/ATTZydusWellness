import { AdminPillBadge } from "@/components/layout/admin-ui"

export type UserCostCenterRef = { code: string; name: string }

function resolveCostCenters(
  items: UserCostCenterRef[] | undefined,
  fallback: UserCostCenterRef | null | undefined,
): UserCostCenterRef[] {
  if (items && items.length > 0) return items
  return fallback ? [fallback] : []
}

/** Codes only; full names on hover. Keeps user list / detail columns compact. */
export function UserCostCentersDisplay({
  items,
  fallback,
}: {
  items?: UserCostCenterRef[]
  fallback?: UserCostCenterRef | null
}) {
  const list = resolveCostCenters(items, fallback)
  if (list.length === 0) return <span className="text-muted-foreground">—</span>
  const tip = list.map((c) => `${c.code} — ${c.name}`).join("\n")
  return (
    <span className="inline-flex max-w-[14rem] flex-wrap gap-1" title={tip}>
      {list.map((c) => (
        <AdminPillBadge key={c.code} tone="neutral" className="max-w-full truncate tabular-nums">
          {c.code}
        </AdminPillBadge>
      ))}
    </span>
  )
}
