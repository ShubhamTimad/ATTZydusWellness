import * as React from "react"

import { AssetDashboard } from "@/components/dashboard/asset-dashboard"
import {
  DashboardStripCard,
  DashboardSummaryBar,
} from "@/components/dashboard/dashboard-insight-card"
import { DashboardLoading } from "@/components/dashboard/dashboard-loading"
import { ItDashboard } from "@/components/dashboard/it-dashboard"
import { DASHBOARD_COLOR, DASHBOARD_THEMES } from "@/components/dashboard/dashboard-theme"
import { FinancialYearDashboard } from "@/components/dashboard/financial-year-dashboard"
import { orderInsightParts, OrdersDashboard } from "@/components/dashboard/orders-dashboard"
import {
  workflowInsightParts,
  WorkflowOrdersDashboard,
  type WorkflowOrdersModule,
} from "@/components/dashboard/workflow-orders-dashboard"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getJson } from "@/lib/api"
import type {
  AssetsDashboardModule,
  FinancialYearDashboardModule,
  ItDashboardModule,
} from "@/lib/assets-types"
import {
  DASHBOARD_ASSETS_VIEW,
  DASHBOARD_DISPOSALS_VIEW,
  DASHBOARD_FY_VIEW,
  DASHBOARD_IT_VIEW,
  DASHBOARD_ORDERS_VIEW,
  DASHBOARD_TRANSFERS_VIEW,
} from "@/lib/dashboard-permissions"
import type { OrdersDashboardModule } from "@/lib/orders-types"
import { hasPermission } from "@/lib/permissions"

type DashboardSummary = {
  modules: {
    orders?: OrdersDashboardModule
    assets?: AssetsDashboardModule
    financial_year?: FinancialYearDashboardModule
    transfers?: WorkflowOrdersModule
    disposals?: WorkflowOrdersModule
    it?: ItDashboardModule
  }
}

function DashboardSummaryStrip({
  orders,
  transfers,
  disposals,
  assets,
  it,
}: {
  orders?: OrdersDashboardModule
  transfers?: WorkflowOrdersModule
  disposals?: WorkflowOrdersModule
  assets?: AssetsDashboardModule
  it?: ItDashboardModule
}) {
  const cells: React.ReactNode[] = []

  if (orders) {
    const parts = orderInsightParts(orders)
    cells.push(
      <DashboardStripCard
        key="orders"
        title="Physical Verification Order"
        value={parts.open}
        aside={{ text: `${parts.total} Total` }}
        accent={DASHBOARD_COLOR.blue}
      />,
    )
  }
  if (transfers) {
    const parts = workflowInsightParts(transfers)
    cells.push(
      <DashboardStripCard
        key="transfers"
        title="Transfer Order"
        value={parts.open}
        aside={{ text: `${parts.total} Total` }}
        accent={DASHBOARD_COLOR.orange}
      />,
    )
  }
  if (disposals) {
    const parts = workflowInsightParts(disposals)
    cells.push(
      <DashboardStripCard
        key="disposals"
        title="Disposal Order"
        value={parts.open}
        aside={{ text: `${parts.total} Total` }}
        accent={DASHBOARD_COLOR.red}
      />,
    )
  }
  if (assets) {
    cells.push(
      <DashboardStripCard
        key="rfid"
        title="RFID"
        value={assets.rfid_tagged}
        aside={{ text: `${assets.total_assets} Total` }}
        accent={DASHBOARD_COLOR.purple}
      />,
    )
  }
  if (it) {
    cells.push(
      <DashboardStripCard
        key="users"
        title="User"
        value={it.total_users}
        aside={{ text: `${it.active_users} Active` }}
        accent={DASHBOARD_COLOR.green}
      />,
    )
  }

  if (cells.length === 0) return null
  return <DashboardSummaryBar>{cells}</DashboardSummaryBar>
}

export function DashboardPage() {
  const canOrders = hasPermission(DASHBOARD_ORDERS_VIEW)
  const canAssets = hasPermission(DASHBOARD_ASSETS_VIEW)
  const canFy = hasPermission(DASHBOARD_FY_VIEW)
  const canTransfers = hasPermission(DASHBOARD_TRANSFERS_VIEW)
  const canDisposals = hasPermission(DASHBOARD_DISPOSALS_VIEW)
  const canIt = hasPermission(DASHBOARD_IT_VIEW)

  const [summary, setSummary] = React.useState<DashboardSummary | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = await getJson<DashboardSummary>("/dashboard/summary")
        if (cancelled) return
        setSummary(s)
        setLoadError(null)
      } catch (e) {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : "Failed to load dashboard stats")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const orders = canOrders ? summary?.modules?.orders : undefined
  const assets = canAssets ? summary?.modules?.assets : undefined
  const fy = canFy ? summary?.modules?.financial_year : undefined
  const transfers = canTransfers ? summary?.modules?.transfers : undefined
  const disposals = canDisposals ? summary?.modules?.disposals : undefined
  const it = canIt ? summary?.modules?.it : undefined
  const hasAny = Boolean(orders || assets || fy || transfers || disposals || it)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
      {loadError ? (
        <Card className="shrink-0 border-dashed border-primary/25">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Dashboard data unavailable</CardTitle>
            <CardDescription className="text-xs">{loadError}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {loading && !loadError ? <DashboardLoading /> : null}

      {!loading && !loadError && !hasAny ? (
        <Card className="shrink-0 border-dashed">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">No dashboard sections assigned</CardTitle>
            <CardDescription className="text-xs">
              Grant section permissions (Orders, Transfers, Disposals, Assets, FY, IT) on the role.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {!loading && hasAny ? (
        <>
          <DashboardSummaryStrip
            orders={orders}
            transfers={transfers}
            disposals={disposals}
            assets={assets}
            it={it}
          />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {fy ? <FinancialYearDashboard key="fy" data={fy} /> : null}
            {orders ? <OrdersDashboard key="orders" data={orders} /> : null}
            {transfers ? (
              <WorkflowOrdersDashboard
                key="transfers"
                title="Asset Transfer"
                theme={DASHBOARD_THEMES.transfers}
                data={transfers}
                openColor={DASHBOARD_COLOR.red}
                closedColor={DASHBOARD_COLOR.blue}
              />
            ) : null}
            {disposals ? (
              <WorkflowOrdersDashboard
                key="disposals"
                title="Asset Disposal"
                theme={DASHBOARD_THEMES.disposals}
                data={disposals}
                openColor={DASHBOARD_COLOR.orange}
                closedColor={DASHBOARD_COLOR.red}
              />
            ) : null}
            {assets ? <AssetDashboard key="assets" data={assets} /> : null}
            {it ? <ItDashboard key="it" data={it} /> : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
