import * as React from "react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { ChartEmpty, ChartPanel } from "@/components/dashboard/dashboard-kpi"
import { BRAND_COLOR } from "@/lib/brand"
import { cn } from "@/lib/utils"

const PENDING_COLOR = "hsl(var(--muted-foreground) / 0.35)"

type BarSeries = {
  dataKey: string
  name?: string
  fill?: string
  stackId?: string
  radius?: [number, number, number, number]
}

export function DashboardBarChart({
  data,
  xKey,
  series,
  height = 208,
  xAngle,
  xHeight,
  emptyMessage,
  className,
}: {
  data: Record<string, unknown>[]
  xKey: string
  series: BarSeries[]
  height?: number
  xAngle?: number
  xHeight?: number
  emptyMessage?: string
  className?: string
}) {
  if (!data.length) {
    return <ChartEmpty message={emptyMessage} />
  }

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 4, right: 8, top: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="opacity-25" />
          <XAxis
            dataKey={xKey}
            tick={{ fontSize: 11 }}
            interval={0}
            angle={xAngle}
            textAnchor={xAngle ? "end" : "middle"}
            height={xHeight ?? (xAngle ? 48 : 30)}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
          <Tooltip />
          {series.some((s) => s.stackId) ? <Legend /> : null}
          {series.map((s) => (
            <Bar
              key={s.dataKey}
              dataKey={s.dataKey}
              name={s.name ?? s.dataKey}
              stackId={s.stackId}
              fill={s.fill ?? BRAND_COLOR}
              radius={s.radius ?? [4, 4, 0, 0]}
              maxBarSize={40}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function DashboardChartGrid({
  children,
  columns = 2,
}: {
  children: React.ReactNode
  columns?: 1 | 2
}) {
  return (
    <div className={cn("app-grid", columns === 2 ? "app-grid-2" : "grid-cols-1")}>{children}</div>
  )
}

export { ChartPanel, PENDING_COLOR }
