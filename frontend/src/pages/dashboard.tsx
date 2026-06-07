import * as React from "react"

import { AssetDashboard } from "@/components/dashboard/asset-dashboard"
import { DashboardLoading } from "@/components/dashboard/dashboard-loading"
import { KpiCard } from "@/components/dashboard/dashboard-kpi"
import { FinancialYearDashboard } from "@/components/dashboard/financial-year-dashboard"
import { OrdersDashboard } from "@/components/dashboard/orders-dashboard"
import type { AssetsDashboardModule, FinancialYearDashboardModule } from "@/lib/assets-types"
import type { OrdersDashboardModule } from "@/lib/orders-types"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getJson } from "@/lib/api"

type DashboardSummary = {
  modules: {
    orders: OrdersDashboardModule
    assets: AssetsDashboardModule
    financial_year: FinancialYearDashboardModule
  }
}

function DashboardHero({
  orders,
  assets,
  financialYear,
}: {
  orders: OrdersDashboardModule
  assets: AssetsDashboardModule
  financialYear: FinancialYearDashboardModule
}) {
  const openOrders =
    orders.pending_approval +
    orders.assigned +
    orders.in_progress +
    orders.pending_closure_approval

  return (
    <div className="app-grid app-grid-3">
      <KpiCard
        label="Open orders"
        value={openOrders}
        hint={`${orders.total_orders} total · ${orders.completed + orders.closed} finished`}
        accent
      />
      <KpiCard
        label="RFID tagged"
        value={assets.rfid_tagged}
        hint={`${assets.rfid_not_tagged} not tagged · ${assets.active_assets} active`}
        accent
      />
      <KpiCard
        label="FY coverage"
        value={`${financialYear.coverage_pct}%`}
        hint={`${financialYear.label} · ${financialYear.verified_in_fy} verified`}
        accent
      />
    </div>
  )
}

export function DashboardPage() {
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

  const ordersModule = summary?.modules?.orders
  const assetsModule = summary?.modules?.assets
  const financialYearModule = summary?.modules?.financial_year

  return (
    <div className="app-page">
      <div>
        <h1 className="app-page-heading">Dashboard</h1>
        <p className="app-page-subheading mt-1">
          Organisation overview for physical verification orders, assets, and financial year physical verification.
        </p>
      </div>

      {loadError ? (
        <Card className="border-dashed border-primary/25">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Dashboard data unavailable</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {loading && !loadError ? <DashboardLoading /> : null}

      {!loading && ordersModule && assetsModule && financialYearModule ? (
        <>
          <DashboardHero orders={ordersModule} assets={assetsModule} financialYear={financialYearModule} />
          <OrdersDashboard data={ordersModule} />
          <AssetDashboard data={assetsModule} />
          <FinancialYearDashboard data={financialYearModule} />
        </>
      ) : null}
    </div>
  )
}
