import * as React from "react"
import { Link } from "react-router-dom"

import { CoverageBar, DashboardPanel, KpiCard, KpiGrid } from "@/components/dashboard/dashboard-kpi"
import type { AssetsDashboardModule } from "@/lib/assets-types"
import { cn } from "@/lib/utils"

function RfidKpiLink({
  to,
  children,
  className,
}: {
  to: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Link
      to={to}
      className={cn(
        "block rounded-[var(--app-radius-surface)] transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        className,
      )}
    >
      {children}
    </Link>
  )
}

export function AssetDashboard({ data }: { data: AssetsDashboardModule }) {
  const stats = [
    { label: "Total assets", value: data.total_assets },
    { label: "Active assets", value: data.active_assets },
    { label: "Added (7 days)", value: data.recently_added },
  ]

  return (
    <DashboardPanel
      title="Asset register"
      description={`${data.active_assets} active assets · ${data.rfid_coverage_pct}% RFID tagged`}
      action={{ label: "Open register", to: "/dashboard/assets" }}
    >
      <KpiGrid>
        {stats.map((s) => (
          <KpiCard key={s.label} label={s.label} value={s.value} accent />
        ))}
      </KpiGrid>

      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">RFID tagging</p>
        <KpiGrid>
          <RfidKpiLink to="/dashboard/assets?rfid_status=tagged">
            <KpiCard
              label="RFID tagged"
              value={data.rfid_tagged}
              hint="Active assets with a tag"
              accent
            />
          </RfidKpiLink>
          <RfidKpiLink to="/dashboard/assets?rfid_status=not_tagged">
            <KpiCard
              label="Not RFID tagged"
              value={data.rfid_not_tagged}
              hint="Active assets missing a tag"
              accent
            />
          </RfidKpiLink>
        </KpiGrid>
        <CoverageBar value={data.rfid_coverage_pct} label="RFID tagging coverage" className="max-w-md" />
      </div>
    </DashboardPanel>
  )
}
