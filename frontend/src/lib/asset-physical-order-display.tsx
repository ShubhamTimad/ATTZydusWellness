import type { ReactNode } from "react"
import { Link } from "react-router-dom"

import { AdminPillBadge } from "@/components/layout/admin-ui"
import type { AssetActivePhysicalOrder, AssetDetail } from "@/lib/assets-types"
import { orderStatusLabel, orderStatusPillTone } from "@/lib/orders-types"
import { hasPermission } from "@/lib/permissions"

function ordersForDisplay(asset: AssetDetail): AssetActivePhysicalOrder[] {
  if (asset.physical_orders?.length) return asset.physical_orders
  return asset.active_physical_order ? [asset.active_physical_order] : []
}

export function renderPhysicalOrderInventoryField(
  key: string,
  asset: AssetDetail,
  options?: { link?: boolean },
): ReactNode | undefined {
  const orders = ordersForDisplay(asset)
  if (key === "physical_order_id") {
    if (!orders.length) return "—"
    const canOpenOrder =
      options?.link !== false && hasPermission("order.view")
    return (
      <span className="flex flex-col gap-1">
        {orders.map((order) =>
          canOpenOrder ? (
            <Link
              key={order.order_id}
              to={`/dashboard/orders/${order.order_id}`}
              className="font-mono text-sm leading-6 text-foreground underline-offset-2 hover:underline"
            >
              {order.order_number}
            </Link>
          ) : (
            <span key={order.order_id} className="font-mono text-sm leading-6 text-foreground">
              {order.order_number}
            </span>
          ),
        )}
      </span>
    )
  }
  if (key === "physical_order_status") {
    if (!orders.length) return "—"
    return (
      <span className="flex flex-col gap-1">
        {orders.map((order) => (
          <span key={order.order_id} className="leading-6">
            <AdminPillBadge tone={orderStatusPillTone(order.order_status)}>
              {orderStatusLabel(order.order_status)}
            </AdminPillBadge>
          </span>
        ))}
      </span>
    )
  }
  return undefined
}
