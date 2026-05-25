import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { ChartPanel, DashboardSectionTitle, KpiCard } from "@/components/dashboard/dashboard-kpi"
import { BRAND_COLOR } from "@/lib/brand"

export type TasksDashboardModule = {
  pending: number
  approved: number
  rejected: number
  completed: number
}

export function TaskDashboard({ data }: { data: TasksDashboardModule }) {
  const chartData = [
    { name: "Pending", value: data.pending },
    { name: "Approved", value: data.approved },
    { name: "Rejected", value: data.rejected },
    { name: "Completed", value: data.completed },
  ]

  return (
    <section className="app-section">
      <DashboardSectionTitle>
        Task dashboard <span className="app-brand-dot">•</span>
      </DashboardSectionTitle>

      <div className="app-grid app-grid-4">
        <KpiCard label="Pending" value={data.pending} />
        <KpiCard label="Approved" value={data.approved} />
        <KpiCard label="Rejected" value={data.rejected} />
        <KpiCard label="Completed" value={data.completed} />
      </div>

      <ChartPanel title="Status breakdown" description="Counts across your assigned tasks">
        <div className="h-52 w-full sm:h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: 4, right: 8, top: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="opacity-25" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} width={32} />
              <Tooltip />
              <Bar dataKey="value" fill={BRAND_COLOR} radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartPanel>
    </section>
  )
}
