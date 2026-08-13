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

/** One grid for all panels — pairs fill the row; a lone last panel spans full width. */
function DashboardPanelsGrid({ panels }: { panels: React.ReactNode[] }) {
  if (panels.length === 0) return null
  return (
    <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 [&>*:last-child:nth-child(odd)]:sm:col-span-2">
      {panels}
    </div>
  )
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
        {/* <p className="mt-0.5 text-xs text-muted-foreground">
          Role-gated overview · physical orders, transfers, disposals, assets, users
        </p> */}
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
        <DashboardPanelsGrid
          panels={[
            fy ? <FinancialYearDashboard key="fy" data={fy} /> : null,
            orders ? <OrdersDashboard key="orders" data={orders} /> : null,
            transfers ? (
              <WorkflowOrdersDashboard
                key="transfers"
                title="Asset Transfer"
                theme={DASHBOARD_THEMES.transfers}
                data={transfers}
              />
            ) : null,
            disposals ? (
              <WorkflowOrdersDashboard
                key="disposals"
                title="Asset Disposal"
                theme={DASHBOARD_THEMES.disposals}
                data={disposals}
              />
            ) : null,
            assets ? <AssetDashboard key="assets" data={assets} /> : null,
            it ? <ItDashboard key="it" data={it} /> : null,
          ].filter(Boolean)}
        />
      ) : null}
    </div>
  )
}
