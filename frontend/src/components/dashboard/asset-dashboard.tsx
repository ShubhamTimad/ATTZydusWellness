import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Link } from "react-router-dom"

import type { AssetsDashboardModule } from "@/lib/assets-types"
import { BRAND_COLOR } from "@/lib/brand"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function AssetDashboard({ data }: { data: AssetsDashboardModule }) {
  const stats = [
    { label: "Total assets", value: data.total_assets },
    { label: "Pending approval", value: data.pending_approvals },
    { label: "Inventory mismatch", value: data.inventory_mismatch },
    { label: "Added (7 days)", value: data.recently_added },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">
          Asset Master <span className="text-primary">•</span>
        </h2>
        <Link to="/dashboard/assets" className="text-sm font-medium text-primary hover:underline">
          Open asset register
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="border-primary/15 shadow-sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums text-primary">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-primary/15">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Assets by category</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.by_category}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill={BRAND_COLOR} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="border-primary/15">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Assets by plant</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.by_plant}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="plant" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill={BRAND_COLOR} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
