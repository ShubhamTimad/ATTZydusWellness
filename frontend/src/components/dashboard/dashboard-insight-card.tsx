import * as React from "react"
import { type LucideIcon } from "lucide-react"

import {
  GAUGE,
  GAUGE_HEIGHT,
  GAUGE_TRACK_PATH,
  GAUGE_WIDTH,
  gaugeArcs,
  type DashboardSlice,
} from "@/components/dashboard/dashboard-gauge-math"
import { cn } from "@/lib/utils"

export type { DashboardSlice }

export type DashboardMetric = {
  value: React.ReactNode
  label: string
  accent?: boolean
}

export function DashboardSummaryBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid shrink-0 grid-cols-2 divide-x divide-border overflow-hidden rounded-xl border border-border bg-card shadow-[var(--app-shadow-surface)] sm:grid-cols-3 xl:grid-cols-5">
      {children}
    </div>
  )
}

export function DashboardStripCard({
  title,
  value,
  aside,
  caption,
  accent,
}: {
  title: string
  value: React.ReactNode
  aside?: { text: React.ReactNode; tone?: "danger" | "success" | "muted" }
  caption?: string
  accent: string
}) {
  const asideClass =
    aside?.tone === "danger"
      ? "text-[#EA4335]"
      : aside?.tone === "success"
        ? "text-[#34A853]"
        : "text-muted-foreground"

  return (
    <article className="min-w-0 px-5 py-4">
      <p className="flex items-center gap-2">
        <span className="h-3.5 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
        <span className="text-[13px] leading-snug text-foreground">{title}</span>
      </p>
      <p className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-2xl leading-none font-bold tabular-nums tracking-tight text-foreground">{value}</span>
        {aside ? <span className={cn("text-[13px] tabular-nums", asideClass)}>{aside.text}</span> : null}
      </p>
      {caption ? <p className="mt-2 truncate text-xs leading-none text-muted-foreground">{caption}</p> : null}
    </article>
  )
}

function DashboardGauge({
  slices,
  centerLabel,
  centerCaption,
}: {
  slices: DashboardSlice[]
  centerLabel: React.ReactNode
  centerCaption: string
}) {
  const arcs = gaugeArcs(slices)

  return (
    <div className="mt-6 flex flex-col items-center">
      <div className="relative w-[min(70%,20rem)]">
        <svg
          viewBox={`0 0 ${GAUGE_WIDTH} ${GAUGE_HEIGHT}`}
          className="h-auto w-full"
          role="img"
          aria-label={`${centerLabel} ${centerCaption}`}
        >
          <path
            d={GAUGE_TRACK_PATH}
            fill="none"
            stroke="#E8EAED"
            strokeWidth={GAUGE.stroke}
            strokeLinecap="round"
          />
          {arcs.map((arc) => (
            <path
              key={arc.name}
              d={arc.d}
              fill="none"
              stroke={arc.color}
              strokeWidth={GAUGE.stroke}
              strokeLinecap="round"
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-x-0 bottom-[7%] text-center">
          <p className="text-[1.75rem] leading-none font-bold tabular-nums tracking-tight text-foreground">
            {centerLabel}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{centerCaption}</p>
        </div>
      </div>
      <ul className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5">
        {slices.map((slice) => (
          <li
            key={slice.name}
            className="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground"
          >
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
            {slice.name}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function DashboardInsightCard({
  title,
  subtitle,
  icon: Icon,
  iconWrap,
  metrics,
  slices,
  centerLabel,
  centerCaption,
}: {
  title: string
  subtitle?: string
  icon: LucideIcon
  iconWrap: string
  metrics: DashboardMetric[]
  slices: DashboardSlice[]
  centerLabel: React.ReactNode
  centerCaption: string
}) {
  return (
    <section className="flex flex-col rounded-xl border border-border bg-card px-5 py-5 shadow-[var(--app-shadow-surface)]">
      <div className="flex min-w-0 items-center gap-2.5">
        <Icon className={cn("size-5 shrink-0", iconWrap)} aria-hidden />
        <h2 className="truncate text-base font-semibold tracking-tight text-foreground">{title}</h2>
        {subtitle ? <span className="truncate text-sm text-muted-foreground">{subtitle}</span> : null}
      </div>

      <div className="mt-5 flex">
        {metrics.map((metric, index) => (
          <div
            key={metric.label}
            className={cn(
              "min-w-0 flex-1 text-center",
              index > 0 && "border-l border-border pl-4",
              index < metrics.length - 1 && "pr-4",
            )}
          >
            <p
              className={cn(
                "text-[1.65rem] leading-none font-bold tabular-nums tracking-tight",
                metric.accent ? "text-[#EA4335]" : "text-foreground",
              )}
            >
              {metric.value}
            </p>
            <p className="mt-1.5 truncate text-xs text-muted-foreground">{metric.label}</p>
          </div>
        ))}
      </div>

      <DashboardGauge slices={slices} centerLabel={centerLabel} centerCaption={centerCaption} />
    </section>
  )
}
