import * as React from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { ChartPanel, DashboardSectionTitle, KpiCard } from "@/components/dashboard/dashboard-kpi"
import { BRAND_COLOR } from "@/lib/brand"

export type UsersByRoleRow = { role: string; count: number }

export type UsersDashboardModule = {
  total_users: number
  active_users: number
  inactive_users: number
  new_users_last_7_days: number
  users_by_role: UsersByRoleRow[]
}

export function UserDashboard({ data }: { data: UsersDashboardModule }) {
  const roleData = React.useMemo(
    () => (data.users_by_role ?? []).map((r) => ({ name: r.role, value: r.count })),
    [data.users_by_role],
  )
  const activeInactive = React.useMemo(
    () => [
      { name: "Active", value: data.active_users },
      { name: "Inactive", value: data.inactive_users },
    ],
    [data.active_users, data.inactive_users],
  )

  return (
    <section className="app-section">
      <DashboardSectionTitle>
        User dashboard <span className="app-brand-dot">•</span>
      </DashboardSectionTitle>

      <div className="app-grid app-grid-4">
        <KpiCard label="Total users" value={data.total_users} />
        <KpiCard label="Active users" value={data.active_users} />
        <KpiCard label="Inactive users" value={data.inactive_users} />
        <KpiCard label="New users" value={data.new_users_last_7_days} hint="Last 7 days" />
      </div>

      <div className="app-grid app-grid-2">
        <ChartPanel
          title="Users by role"
          description="Distinct users assigned to each role"
        >
          <div className="h-52 w-full sm:h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={roleData} margin={{ left: 4, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="opacity-25" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12 }}
                  interval={0}
                  angle={-18}
                  textAnchor="end"
                  height={44}
                />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} width={32} />
                <Tooltip />
                <Bar dataKey="value" fill={BRAND_COLOR} radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartPanel>

        <ChartPanel
          title="Active vs inactive"
          description="Current user status distribution"
        >
          <div className="h-52 w-full sm:h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip />
                <Pie
                  data={activeInactive}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={80}
                  paddingAngle={3}
                  fill={BRAND_COLOR}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </ChartPanel>
      </div>
    </section>
  )
}
