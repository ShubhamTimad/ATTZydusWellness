import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Link } from "react-router-dom"

import { ChartPanel, DashboardSectionTitle, KpiCard } from "@/components/dashboard/dashboard-kpi"
import type { OrdersDashboardModule } from "@/lib/orders-types"
import { BRAND_COLOR } from "@/lib/brand"

export function OrdersDashboard({ data }: { data: OrdersDashboardModule }) {
  const stats = [
    { label: "Total orders", value: data.total_orders },
    { label: "Pending approval", value: data.pending_approval },
    { label: "Approved", value: data.approved },
    { label: "In progress", value: data.in_progress },
    { label: "Pending closure", value: data.pending_closure_approval },
    { label: "Completed", value: data.completed },
    { label: "Rejected", value: data.rejected },
  ]

  return (
    <section className="app-section">
      <DashboardSectionTitle
        action={
          <Link
            to="/dashboard/orders"
            className="text-sm font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
          >
            Open orders
          </Link>
        }
      >
        Physical verification orders <span className="app-brand-dot">•</span>
      </DashboardSectionTitle>

      <div className="app-grid app-grid-4">
        {stats.map((s) => (
          <KpiCard key={s.label} label={s.label} value={s.value} accent />
        ))}
      </div>

      <div className="app-grid app-grid-2">
        <ChartPanel title="Orders by status">
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.by_status} margin={{ left: 4, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="opacity-25" />
                <XAxis dataKey="status" tick={{ fontSize: 10 }} interval={0} angle={-12} textAnchor="end" height={48} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                <Tooltip />
                <Bar dataKey="count" fill={BRAND_COLOR} radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartPanel>

        <ChartPanel title="Orders by plant">
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
