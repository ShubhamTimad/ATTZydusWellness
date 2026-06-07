import {
  AlertTriangle,
  CalendarRange,
  ClipboardList,
  Database,
  FileSpreadsheet,
  FileText,
  Layers,
  ListTree,
  Loader2,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { adminSelectClass } from "@/components/layout/admin-ui"
import type { ReportDefinition, ReportFilterValues, ReportFormat } from "@/lib/reports-types"
import { cn } from "@/lib/utils"

export type ReportTileStyle = {
  icon: LucideIcon
  tag: string
  span: "full" | "half"
  surface: string
  iconWrap: string
  accentBar?: string
  pattern?: string
  hint?: string
}

export const REPORT_TILE_STYLES: Record<string, ReportTileStyle> = {
  asset_register: {
    icon: Database,
    tag: "Asset master",
    span: "full",
    surface:
      "border-primary/20 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary)_8%,var(--card))_0%,var(--card)_45%,color-mix(in_srgb,var(--primary)_4%,var(--card))_100%)]",
    iconWrap: "bg-primary/12 text-primary ring-primary/20",
    accentBar: "from-primary/80 via-primary to-primary/70",
    pattern:
      "bg-[radial-gradient(circle_at_100%_0%,color-mix(in_srgb,var(--primary)_14%,transparent)_0%,transparent_55%)]",
  },
  financial_year_verification: {
    icon: CalendarRange,
    tag: "FY verification",
    span: "half",
    surface:
      "border-emerald-200/80 bg-[linear-gradient(160deg,color-mix(in_srgb,#059669_10%,var(--card))_0%,var(--card)_100%)] dark:border-emerald-900/40",
    iconWrap: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
    accentBar: "from-emerald-500/80 to-emerald-600",
  },
  physical_orders_summary: {
    icon: ClipboardList,
    tag: "Orders",
    span: "half",
    surface: "border-border/80 bg-card",
    iconWrap: "bg-sky-500/10 text-sky-700 ring-sky-500/15 dark:text-sky-300",
    accentBar: "from-sky-500/70 to-sky-600/80",
  },
  physical_order_details: {
    icon: ListTree,
    tag: "Line items",
    span: "half",
    surface:
      "border-indigo-200/70 bg-[linear-gradient(180deg,color-mix(in_srgb,#6366f1_7%,var(--card))_0%,var(--card)_100%)] dark:border-indigo-900/40",
    iconWrap: "bg-indigo-500/12 text-indigo-700 ring-indigo-500/20 dark:text-indigo-300",
    accentBar: "from-indigo-500/70 to-violet-600/80",
  },
  inventory_mismatch: {
    icon: AlertTriangle,
    tag: "Exceptions",
    span: "half",
    surface:
      "border-amber-200/90 bg-[linear-gradient(165deg,color-mix(in_srgb,#d97706_9%,var(--card))_0%,var(--card)_100%)] dark:border-amber-900/40",
    iconWrap: "bg-amber-500/14 text-amber-800 ring-amber-500/25 dark:text-amber-200",
    accentBar: "from-amber-500/80 to-orange-500/80",
    hint: "Shows assets where inventory and physical counts differ.",
  },
}

const FALLBACK_STYLE: ReportTileStyle = {
  icon: Layers,
  tag: "Report",
  span: "half",
  surface: "border-border/80 bg-card",
  iconWrap: "bg-muted text-muted-foreground ring-border/60",
}

function ReportFilters({
  report,
  filters,
  onFilterChange,
  columns = 2,
}: {
  report: ReportDefinition
  filters: ReportFilterValues
  onFilterChange: (key: string, value: string) => void
  columns?: 1 | 2
}) {
  if (!report.filters.length) return null

  return (
    <div className={cn("grid gap-3", columns === 2 ? "grid-cols-2" : "grid-cols-1")}>
      {report.filters.map((filter) => (
        <div key={filter.key} className="min-w-0 space-y-1.5">
          <Label className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {filter.label}
          </Label>
          <select
            className={cn(adminSelectClass, "h-9 w-full bg-background text-sm")}
            value={filters[filter.key] ?? "all"}
            onChange={(e) => onFilterChange(filter.key, e.target.value)}
          >
            {filter.options.map((option) => (
              <option key={`${filter.key}-${option.value || "all"}`} value={option.value || "all"}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}

function ReportActions({
  reportKey,
  busy,
  generatingKey,
  onGenerate,
}: {
  reportKey: string
  busy: boolean
  generatingKey: string | null
  onGenerate: (reportKey: string, format: ReportFormat) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        className="h-9 w-full bg-background"
        onClick={() => onGenerate(reportKey, "xlsx")}
      >
        {busy && generatingKey === `${reportKey}:xlsx` ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <FileSpreadsheet className="size-4" aria-hidden />
        )}
        Excel
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={busy}
        className="h-9 w-full"
        onClick={() => onGenerate(reportKey, "pdf")}
      >
        {busy && generatingKey === `${reportKey}:pdf` ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <FileText className="size-4" aria-hidden />
        )}
        PDF
      </Button>
    </div>
  )
}

function TileHeader({ style, report }: { style: ReportTileStyle; report: ReportDefinition }) {
  const Icon = style.icon
  return (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
          style.iconWrap,
        )}
      >
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <span className="inline-flex rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {style.tag}
        </span>
        <h3 className="mt-1.5 text-base font-semibold leading-snug text-foreground">{report.title}</h3>
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {report.description}
        </p>
        {style.hint ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground/90">{style.hint}</p>
        ) : null}
      </div>
    </div>
  )
}

function TileControls({
  report,
  filters,
  onFilterChange,
  onGenerate,
  generatingKey,
  busy,
  filterColumns = 2,
}: {
  report: ReportDefinition
  filters: ReportFilterValues
  onFilterChange: (key: string, value: string) => void
  onGenerate: (reportKey: string, format: ReportFormat) => void
  generatingKey: string | null
  busy: boolean
  filterColumns?: 1 | 2
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-background/60 p-3.5">
      <ReportFilters
        report={report}
        filters={filters}
        onFilterChange={onFilterChange}
        columns={filterColumns}
      />
      <ReportActions
        reportKey={report.key}
        busy={busy}
        generatingKey={generatingKey}
        onGenerate={onGenerate}
      />
    </div>
  )
}

export function ReportTile({
  report,
  filters,
  onFilterChange,
  onGenerate,
  generatingKey,
}: {
  report: ReportDefinition
  filters: ReportFilterValues
  onFilterChange: (key: string, value: string) => void
  onGenerate: (reportKey: string, format: ReportFormat) => void
  generatingKey: string | null
}) {
  const style = REPORT_TILE_STYLES[report.key] ?? FALLBACK_STYLE
  const busy = generatingKey?.startsWith(`${report.key}:`) ?? false
  const isWide = style.span === "full"
  const filterColumns = report.filters.length === 1 ? 1 : 2

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-[var(--app-radius-surface)] border shadow-[var(--app-shadow-surface)] transition-shadow hover:shadow-[var(--app-shadow-elevated)]",
        style.surface,
        isWide ? "lg:col-span-2" : "",
      )}
    >
      {style.accentBar ? (
        <div className={cn("h-1 w-full shrink-0 bg-gradient-to-r", style.accentBar)} aria-hidden />
      ) : null}
      {style.pattern ? (
        <div className={cn("pointer-events-none absolute inset-0", style.pattern)} aria-hidden />
      ) : null}

      <div className="relative flex flex-col gap-4 p-[var(--app-card-padding)]">
        {isWide ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16.5rem] lg:items-start">
            <TileHeader style={style} report={report} />
            <TileControls
              report={report}
              filters={filters}
              onFilterChange={onFilterChange}
              onGenerate={onGenerate}
              generatingKey={generatingKey}
              busy={busy}
              filterColumns={1}
            />
          </div>
        ) : (
          <>
            <TileHeader style={style} report={report} />
            <TileControls
              report={report}
              filters={filters}
              onFilterChange={onFilterChange}
              onGenerate={onGenerate}
              generatingKey={generatingKey}
              busy={busy}
              filterColumns={filterColumns as 1 | 2}
            />
          </>
        )}
      </div>
    </article>
  )
}

export function ReportTileSkeleton({ span = "half" }: { span?: "full" | "half" }) {
  return (
    <div
      className={cn(
        "h-52 animate-pulse rounded-[var(--app-radius-surface)] border border-border/60 bg-muted/20",
        span === "full" ? "lg:col-span-2 lg:h-44" : "",
      )}
    />
  )
}
