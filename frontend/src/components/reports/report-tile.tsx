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

const exportBtnClass =
  "h-9 min-w-0 flex-1 gap-1.5 px-3 text-sm font-medium shadow-sm sm:flex-none sm:w-[6.75rem]"

function orderedFilters(report: ReportDefinition) {
  return [...report.filters].sort((a, b) => {
    if (a.key === "fy_status") return -1
    if (b.key === "fy_status") return 1
    return 0
  })
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
  onGenerate: (format: ReportFormat) => void
}) {
  return (
    <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        className={cn(exportBtnClass, "bg-background")}
        onClick={() => onGenerate("xlsx")}
      >
        {busy && generatingKey === `${reportKey}:xlsx` ? (
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
        ) : (
          <FileSpreadsheet className="size-4 shrink-0" aria-hidden />
        )}
        Excel
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={busy}
        className={exportBtnClass}
        onClick={() => onGenerate("pdf")}
      >
        {busy && generatingKey === `${reportKey}:pdf` ? (
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
        ) : (
          <FileText className="size-4 shrink-0" aria-hidden />
        )}
        PDF
      </Button>
    </div>
  )
}

function TileHeader({ style, report }: { style: ReportTileStyle; report: ReportDefinition }) {
  const Icon = style.icon
  return (
    <div className="flex h-[7.5rem] shrink-0 items-start gap-3 overflow-hidden">
      <div
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
          style.iconWrap,
        )}
      >
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <span className="inline-flex rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {style.tag}
        </span>
        <h3 className="mt-1.5 line-clamp-2 text-base font-semibold leading-snug text-foreground">
          {report.title}
        </h3>
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {report.description}
        </p>
        {style.hint ? (
          <p className="mt-1 line-clamp-1 text-xs leading-relaxed text-muted-foreground/90">{style.hint}</p>
        ) : null}
      </div>
    </div>
  )
}

function FilterField({
  filter,
  value,
  onChange,
}: {
  filter: ReportDefinition["filters"][number]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {filter.label}
      </Label>
      <select
        className={cn(adminSelectClass, "h-9 w-full bg-background text-sm")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={
          filter.key === "fy_status"
            ? "Physically verified exports only assets scanned in the current financial year."
            : undefined
        }
      >
        {filter.options.map((option) => (
          <option key={`${filter.key}-${option.value || "all"}`} value={option.value || "all"}>
            {option.label}
          </option>
        ))}
      </select>
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
}: {
  report: ReportDefinition
  filters: ReportFilterValues
  onFilterChange: (key: string, value: string) => void
  onGenerate: (format: ReportFormat) => void
  generatingKey: string | null
  busy: boolean
}) {
  const filtersList = orderedFilters(report)
  const showTwoFilterColumns = filtersList.length > 0

  return (
    <div className="mt-auto shrink-0 rounded-lg border border-border/60 bg-background/70 p-4">
      <div className="flex min-h-[4.75rem] flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        {showTwoFilterColumns ? (
          <div className="grid min-h-[4.75rem] min-w-0 flex-1 gap-3 sm:grid-cols-2">
            {filtersList.map((filter) => (
              <FilterField
                key={filter.key}
                filter={filter}
                value={filters[filter.key] ?? "all"}
                onChange={(value) => onFilterChange(filter.key, value)}
              />
            ))}
            {filtersList.length === 1 ? <div aria-hidden className="hidden min-w-0 sm:block" /> : null}
          </div>
        ) : (
          <div className="min-h-[4.75rem] flex-1" />
        )}

        <ReportActions
          reportKey={report.key}
          busy={busy}
          generatingKey={generatingKey}
          onGenerate={onGenerate}
        />
      </div>
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
  onGenerate: (format: ReportFormat) => void
  generatingKey: string | null
}) {
  const style = REPORT_TILE_STYLES[report.key] ?? FALLBACK_STYLE
  const busy = generatingKey?.startsWith(`${report.key}:`) ?? false

  return (
    <article
      className={cn(
        "group relative flex h-full min-h-[15.5rem] flex-col overflow-hidden rounded-[var(--app-radius-surface)] border shadow-[var(--app-shadow-surface)] transition-shadow hover:shadow-[var(--app-shadow-elevated)]",
        style.surface,
        style.span === "full" ? "lg:col-span-2" : "",
      )}
    >
      {style.accentBar ? (
        <div className={cn("h-1 w-full shrink-0 bg-gradient-to-r", style.accentBar)} aria-hidden />
      ) : null}
      {style.pattern ? (
        <div className={cn("pointer-events-none absolute inset-0", style.pattern)} aria-hidden />
      ) : null}

      <div className="relative flex flex-1 flex-col gap-4 p-[var(--app-card-padding)]">
        <TileHeader style={style} report={report} />
        <TileControls
          report={report}
          filters={filters}
          onFilterChange={onFilterChange}
          onGenerate={onGenerate}
          generatingKey={generatingKey}
          busy={busy}
        />
      </div>
    </article>
  )
}

export function ReportTileSkeleton({ span = "half" }: { span?: "full" | "half" }) {
  return (
    <div
      className={cn(
        "h-full min-h-[15.5rem] animate-pulse rounded-[var(--app-radius-surface)] border border-border/60 bg-muted/20",
        span === "full" ? "lg:col-span-2" : "",
      )}
    />
  )
}
