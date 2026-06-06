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
import { adminSelectClass } from "@/components/layout/admin-ui"
import type { ReportDefinition, ReportFilterValues, ReportFormat } from "@/lib/reports-types"
import { cn } from "@/lib/utils"

export type ReportTileStyle = {
  icon: LucideIcon
  tag: string
  accent: string
  surface: string
  iconWrap: string
}

export const REPORT_TILE_STYLES: Record<string, ReportTileStyle> = {
  asset_register: {
    icon: Database,
    tag: "Asset master",
    accent: "border-l-primary bg-primary/[0.03]",
    surface: "border-border/70 bg-card hover:border-primary/25",
    iconWrap: "bg-primary/10 text-primary",
  },
  financial_year_verification: {
    icon: CalendarRange,
    tag: "FY tagging",
    accent: "border-l-emerald-500 bg-emerald-500/[0.04]",
    surface: "border-border/70 bg-card hover:border-emerald-500/25",
    iconWrap: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  physical_orders_summary: {
    icon: ClipboardList,
    tag: "Orders",
    accent: "border-l-sky-500 bg-sky-500/[0.04]",
    surface: "border-border/70 bg-card hover:border-sky-500/25",
    iconWrap: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  physical_order_details: {
    icon: ListTree,
    tag: "Line items",
    accent: "border-l-indigo-500 bg-indigo-500/[0.04]",
    surface: "border-border/70 bg-card hover:border-indigo-500/25",
    iconWrap: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  },
  inventory_mismatch: {
    icon: AlertTriangle,
    tag: "Exceptions",
    accent: "border-l-amber-500 bg-amber-500/[0.05]",
    surface: "border-border/70 bg-card hover:border-amber-500/25",
    iconWrap: "bg-amber-500/12 text-amber-800 dark:text-amber-200",
  },
}

const FALLBACK_STYLE: ReportTileStyle = {
  icon: Layers,
  tag: "Report",
  accent: "border-l-border bg-muted/20",
  surface: "border-border/70 bg-card",
  iconWrap: "bg-muted text-muted-foreground",
}

function ReportFilters({
  report,
  filters,
  onFilterChange,
}: {
  report: ReportDefinition
  filters: ReportFilterValues
  onFilterChange: (key: string, value: string) => void
}) {
  if (!report.filters.length) return null

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {report.filters.map((filter) => (
        <label key={filter.key} className="block min-w-0 space-y-1">
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            {filter.label}
          </span>
          <select
            className={cn(adminSelectClass, "h-8 w-full bg-background/90 px-2.5 text-xs")}
            value={filters[filter.key] ?? "all"}
            onChange={(e) => onFilterChange(filter.key, e.target.value)}
          >
            {filter.options.map((option) => (
              <option key={`${filter.key}-${option.value || "all"}`} value={option.value || "all"}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
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
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        className="h-8 flex-1 px-2.5 text-xs"
        onClick={() => onGenerate(reportKey, "xlsx")}
      >
        {busy && generatingKey === `${reportKey}:xlsx` ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <FileSpreadsheet className="size-3.5" aria-hidden />
        )}
        Excel
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={busy}
        className="h-8 flex-1 px-2.5 text-xs"
        onClick={() => onGenerate(reportKey, "pdf")}
      >
        {busy && generatingKey === `${reportKey}:pdf` ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <FileText className="size-3.5" aria-hidden />
        )}
        PDF
      </Button>
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
  const Icon = style.icon

  return (
    <article
      className={cn(
        "group flex flex-col overflow-hidden rounded-lg border border-l-[3px] shadow-sm transition-all hover:shadow-md",
        style.accent,
        style.surface,
      )}
    >
      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <div className="flex items-start gap-2.5">
          <div
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md",
              style.iconWrap,
            )}
          >
            <Icon className="size-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <h3 className="text-sm font-semibold leading-snug text-foreground">{report.title}</h3>
              <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                {style.tag}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {report.description}
            </p>
          </div>
        </div>

        <ReportFilters report={report} filters={filters} onFilterChange={onFilterChange} />

        <footer className="mt-auto border-t border-border/40 pt-3">
          <ReportActions
            reportKey={report.key}
            busy={busy}
            generatingKey={generatingKey}
            onGenerate={onGenerate}
          />
        </footer>
      </div>
    </article>
  )
}

export function ReportTileSkeleton() {
  return (
    <div className="h-[11.5rem] animate-pulse rounded-lg border border-border/60 border-l-[3px] bg-muted/15" />
  )
}
