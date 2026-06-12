import type { ReactNode } from "react"
import { Link } from "react-router-dom"

import { AdminPillBadge } from "@/components/layout/admin-ui"
import type { AssetDetail } from "@/lib/assets-types"
import { orderStatusLabel, orderStatusPillTone } from "@/lib/orders-types"

export function renderPhysicalOrderInventoryField(
  key: string,
  asset: AssetDetail,
  options?: { link?: boolean },
): ReactNode | undefined {
  const order = asset.active_physical_order
  if (key === "physical_order_id") {
    if (!order) return "—"
    if (options?.link === false) return order.order_number
    return (
      <Link
        to={`/dashboard/orders/${order.order_id}`}
        className="font-mono text-sm text-primary hover:underline"
      >
        {order.order_number}
      </Link>
    )
  }
  if (key === "physical_order_status") {
    if (!order) return "—"
    return (
      <AdminPillBadge tone={orderStatusPillTone(order.order_status)}>
        {orderStatusLabel(order.order_status)}
      </AdminPillBadge>
    )
  }
  return undefined
}
