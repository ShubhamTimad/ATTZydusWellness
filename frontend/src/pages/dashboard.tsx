import * as React from "react"

import { AssetDashboard } from "@/components/dashboard/asset-dashboard"
import { DashboardLoading } from "@/components/dashboard/dashboard-loading"
import { DASHBOARD_THEMES } from "@/components/dashboard/dashboard-theme"
import { FinancialYearDashboard } from "@/components/dashboard/financial-year-dashboard"
import { ItDashboard } from "@/components/dashboard/it-dashboard"
import { OrdersDashboard } from "@/components/dashboard/orders-dashboard"
import {
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
    <div className="app-page flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <div className="shrink-0 border-b border-border/60 pb-3">
        <h1 className="app-page-heading">Dashboard</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Role-gated overview · physical orders, transfers, disposals, assets, users
        </p>
      </div>

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
        <div className="flex flex-col gap-4">
          {orders || fy ? (
            <div className="grid items-stretch gap-4 xl:grid-cols-2">
              {fy ? <FinancialYearDashboard data={fy} /> : null}
              {orders ? <OrdersDashboard data={orders} /> : null}
            </div>
          ) : null}

          {transfers || disposals ? (
            <div className="grid items-stretch gap-4 xl:grid-cols-2">
              {transfers ? (
                <WorkflowOrdersDashboard
                  title="Asset transfers"
                  theme={DASHBOARD_THEMES.transfers}
                  data={transfers}
                />
              ) : null}
              {disposals ? (
                <WorkflowOrdersDashboard
                  title="Asset disposals"
                  theme={DASHBOARD_THEMES.disposals}
                  data={disposals}
                />
              ) : null}
            </div>
          ) : null}

          {assets || it ? (
            <div className="grid items-stretch gap-4 xl:grid-cols-2">
              {assets ? <AssetDashboard data={assets} /> : null}
              {it ? <ItDashboard data={it} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
