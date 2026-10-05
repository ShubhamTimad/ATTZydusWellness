import * as React from "react"

import { AssetDashboard } from "@/components/dashboard/asset-dashboard"
import {
  DashboardStripCard,
  DashboardSummaryBar,
} from "@/components/dashboard/dashboard-insight-card"
import { DashboardLoading } from "@/components/dashboard/dashboard-loading"
import { ItDashboard } from "@/components/dashboard/it-dashboard"
import { DASHBOARD_COLOR, DASHBOARD_THEMES, dashboardPct } from "@/components/dashboard/dashboard-theme"
import { FinancialYearDashboard, DashboardFyBadge } from "@/components/dashboard/financial-year-dashboard"
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
import type { OrdersDashboardModule } from "@/lib/orders-types"

type DashboardSection =
  | "orders"
  | "assets"
  | "financial_year"
  | "transfers"
  | "disposals"
  | "it"
  | "summary_orders"
  | "summary_transfers"
  | "summary_disposals"
  | "summary_assets"
  | "summary_users"

type DashboardSummary = {
  /** Live role grants per tile; the login-time permission snapshot can be stale. */
  visible_sections?: Partial<Record<DashboardSection, boolean>>
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
        title="Phy. Verification Order"
        value={parts.open}
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
        accent={DASHBOARD_COLOR.red}
      />,
    )
  }
  if (assets) {
    cells.push(
      <DashboardStripCard
        key="rfid"
        title="Asset Tagged"
        value={`${dashboardPct(assets.rfid_tagged, assets.total_assets)}%`}
        accent={DASHBOARD_COLOR.purple}
      />,
    )
  }
  if (it) {
    cells.push(
      <DashboardStripCard
        key="users"
        title="Users"
        value={it.active_users}
        accent={DASHBOARD_COLOR.green}
      />,
    )
  }

  if (cells.length === 0) return null
  return <DashboardSummaryBar>{cells}</DashboardSummaryBar>
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

  const visible = summary?.visible_sections ?? {}
  const mods = summary?.modules
  const orders = visible.orders ? mods?.orders : undefined
  const assets = visible.assets ? mods?.assets : undefined
  const fy = visible.financial_year ? mods?.financial_year : undefined
  const transfers = visible.transfers ? mods?.transfers : undefined
  const disposals = visible.disposals ? mods?.disposals : undefined
  const it = visible.it ? mods?.it : undefined
  const strip = {
    orders: visible.summary_orders ? mods?.orders : undefined,
    transfers: visible.summary_transfers ? mods?.transfers : undefined,
    disposals: visible.summary_disposals ? mods?.disposals : undefined,
    assets: visible.summary_assets ? mods?.assets : undefined,
    it: visible.summary_users ? mods?.it : undefined,
  }
  const hasAny = Boolean(
    orders || assets || fy || transfers || disposals || it || Object.values(strip).some(Boolean),
  )

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
            <CardTitle className="text-sm">No dashboard sections have been assigned to your role. Please contact your administrator to request the required access.</CardTitle>
            {/* <CardDescription className="text-xs">
              Grant section permissions (Orders, Transfers, Disposals, Assets, FY, IT) on the role.
            </CardDescription> */}
          </CardHeader>
        </Card>
      ) : null}

      {!loading && hasAny ? (
        <>
          <div className="flex flex-col gap-3">
            {fy ? (
              <div className="flex justify-end">
                <DashboardFyBadge data={fy} />
              </div>
            ) : null}
            <DashboardSummaryStrip {...strip} />
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:[&>:last-child:nth-child(odd)]:col-span-2">
            {fy ? <FinancialYearDashboard key="fy" data={fy} /> : null}
            {orders ? <OrdersDashboard key="orders" data={orders} /> : null}
            {transfers ? (
              <WorkflowOrdersDashboard
                key="transfers"
                title="Asset Transfer Order"
                theme={DASHBOARD_THEMES.transfers}
                data={transfers}
              />
            ) : null}
            {disposals ? (
              <WorkflowOrdersDashboard
                key="disposals"
                title="Asset Disposal Order"
                theme={DASHBOARD_THEMES.disposals}
                data={disposals}
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
