import { Package, Radio, RadioOff } from "lucide-react"

import { DASHBOARD_THEMES } from "@/components/dashboard/dashboard-theme"
import { CoverageBar, DashboardPanel, KpiCard, KpiGrid } from "@/components/dashboard/dashboard-kpi"
import type { AssetsDashboardModule } from "@/lib/assets-types"

export function AssetDashboard({ data }: { data: AssetsDashboardModule }) {
  const theme = DASHBOARD_THEMES.assets

  return (
    <DashboardPanel
      title="Asset register"
      description={`${data.active_assets} active · ${data.rfid_coverage_pct}% RFID coverage`}
      theme={theme}
    >
      <KpiGrid className="sm:grid-cols-3">
        <KpiCard label="Total assets" value={data.total_assets} tint={theme.kpiTint} accent />
        <KpiCard label="Active assets" value={data.active_assets} icon={Package} tint={theme.kpiTint} accent />
        <KpiCard label="Added (7 days)" value={data.recently_added} tint={theme.kpiTint} />
      </KpiGrid>

      <div className="space-y-3 rounded-[var(--app-radius-surface)] border border-border/60 bg-background/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">RFID tagging</p>
        <KpiGrid className="sm:grid-cols-2">
          <KpiCard
            label="RFID tagged"
            value={data.rfid_tagged}
            hint="Active assets with a tag"
            icon={Radio}
            tint={theme.kpiTint}
            accent
          />
          <KpiCard
            label="Not tagged"
            value={data.rfid_not_tagged}
            hint="Missing RFID assignment"
            icon={RadioOff}
            tint={theme.kpiTint}
          />
        </KpiGrid>
        <CoverageBar value={data.rfid_coverage_pct} label="RFID tagging coverage" className="border-0 bg-transparent p-0" />
      </div>
    </DashboardPanel>
  )
}
