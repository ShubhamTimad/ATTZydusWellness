import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Link } from "react-router-dom"

import { ChartPanel, DashboardSectionTitle, KpiCard } from "@/components/dashboard/dashboard-kpi"
import type { AssetsDashboardModule } from "@/lib/assets-types"
import { BRAND_COLOR } from "@/lib/brand"

export function AssetDashboard({ data }: { data: AssetsDashboardModule }) {
  const stats = [
    { label: "Total assets", value: data.total_assets },
    { label: "Pending approval", value: data.pending_approvals },
    { label: "Inventory mismatch", value: data.inventory_mismatch },
    { label: "Added (7 days)", value: data.recently_added },
  ]

  return (
    <section className="app-section">
      <DashboardSectionTitle
        action={
          <Link
            to="/dashboard/assets"
            className="text-sm font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
          >
            Open asset register
          </Link>
        }
      >
        Asset Master <span className="app-brand-dot">•</span>
      </DashboardSectionTitle>

      <div className="app-grid app-grid-4">
        {stats.map((s) => (
          <KpiCard key={s.label} label={s.label} value={s.value} accent />
        ))}
      </div>

      <div className="app-grid app-grid-2">
        <ChartPanel title="Assets by category">
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.by_category} margin={{ left: 4, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="opacity-25" />
                <XAxis
                  dataKey="category"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-18}
                  textAnchor="end"
                  height={44}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                <Tooltip />
                <Bar dataKey="count" fill={BRAND_COLOR} radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartPanel>

        <ChartPanel title="Assets by plant">
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.by_plant} margin={{ left: 4, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="opacity-25" />
                <XAxis dataKey="plant" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                <Tooltip />
                <Bar dataKey="count" fill={BRAND_COLOR} radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartPanel>
      </div>
    </section>
  )
}
