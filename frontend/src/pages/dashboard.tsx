import * as React from "react"

import { AssetDashboard } from "@/components/dashboard/asset-dashboard"
import { DashboardLoading } from "@/components/dashboard/dashboard-loading"
import { HeroStatCard } from "@/components/dashboard/dashboard-kpi"
import { DASHBOARD_THEMES } from "@/components/dashboard/dashboard-theme"
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
      <HeroStatCard
        theme={DASHBOARD_THEMES.heroOrders}
        label="Open orders"
        value={openOrders}
        hint={`${orders.total_orders} total · ${orders.completed + orders.closed} finished`}
      />
      <HeroStatCard
        theme={DASHBOARD_THEMES.heroAssets}
        label="RFID tagged assets"
        value={assets.rfid_tagged}
        hint={`${assets.rfid_not_tagged} not tagged · ${assets.rfid_coverage_pct}% coverage`}
      />
      <HeroStatCard
        theme={DASHBOARD_THEMES.heroFy}
        label="FY verification coverage"
        value={`${financialYear.coverage_pct}%`}
        hint={`${financialYear.label} · ${financialYear.verified_in_fy} verified`}
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
    <div className="app-page flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="relative shrink-0 overflow-hidden rounded-[var(--app-radius-surface)] border border-border/70 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary)_6%,var(--card))_0%,var(--card)_50%,color-mix(in_srgb,var(--muted)_40%,var(--card))_100%)] px-5 py-6 sm:px-6">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,color-mix(in_srgb,var(--primary)_10%,transparent)_0%,transparent_45%)]"
          aria-hidden
        />
        <div className="relative">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Organisation overview
          </p>
          <h1 className="app-page-heading mt-1">Dashboard</h1>
          <p className="app-page-subheading mt-1.5 max-w-2xl">
            Physical verification orders, asset register, and financial year verification at a glance.
          </p>
        </div>
      </div>

      {loadError ? (
        <Card className="shrink-0 border-dashed border-primary/25">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Dashboard data unavailable</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {loading && !loadError ? <DashboardLoading /> : null}

      {!loading && ordersModule && assetsModule && financialYearModule ? (
        <div className="flex flex-col gap-[var(--app-section-gap)]">
          <DashboardHero orders={ordersModule} assets={assetsModule} financialYear={financialYearModule} />
          <OrdersDashboard data={ordersModule} />
          <div className="grid items-start gap-[var(--app-section-gap)] xl:grid-cols-2">
            <AssetDashboard data={assetsModule} />
            <FinancialYearDashboard data={financialYearModule} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
