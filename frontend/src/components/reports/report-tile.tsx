import {
  CalendarRange,
  ClipboardList,
  Database,
  FileSpreadsheet,
  FileText,
  Layers,
  Loader2,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { adminSelectClass } from "@/components/layout/admin-ui"
import type { ReportDefinition, ReportFilterValues, ReportFormat } from "@/lib/reports-types"
import { categoryLabel, plantLabel, useAssetMasterLookups } from "@/lib/use-asset-masters"
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
  /** Shorter tile — e.g. register opens a dialog instead of inline filters. */
  compact?: boolean
}

export const REPORT_TILE_STYLES: Record<string, ReportTileStyle> = {
  asset_register: {
    icon: Database,
    tag: "Asset master",
    span: "full",
    compact: true,
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
}

const FALLBACK_STYLE: ReportTileStyle = {
  icon: Layers,
  tag: "Report",
  span: "half",
  surface: "border-border/80 bg-card",
  iconWrap: "bg-muted text-muted-foreground ring-border/60",
}

const exportBtnClass =
  "h-9 min-w-[6.75rem] gap-1.5 px-3 text-sm font-medium shadow-sm"

const FILTER_LABELS: Record<string, string> = {
  fy_start_year: "Financial year",
  plant_id: "Plant",
  fy_status: "Verification",
  status: "Order status",
}

function shortenFilterOptionLabel(key: string, value: string, label: string): string {
  if (key === "fy_status") {
    if (value === "verified") return "Verified"
    if (value === "pending") return "Pending"
    if (value === "all") return "All"
  }
  if (key === "status" && value === "all") return "All statuses"
  if (key === "plant_id" && value === "all") return "All plants"
  return label
}

const FILTER_ORDER = [
  "fy_start_year",
  "plant_id",
  "category_id",
  "cost_center",
  "functional_location",
  "actual_location",
  "fy_status",
  "status",
]

function orderedFilters(report: ReportDefinition) {
  return [...report.filters].sort((a, b) => {
    const ai = FILTER_ORDER.indexOf(a.key)
    const bi = FILTER_ORDER.indexOf(b.key)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
}

function masterOptionLabel(_code: string, name?: string | null): string {
  const n = name?.trim()
  if (n) return n
  return _code.trim()
}

function ReportActions({
  reportKey,
  busy,
  generatingKey,
  formats,
  onGenerate,
  onOpenRegister,
}: {
  reportKey: string
  busy: boolean
  generatingKey: string | null
  formats: ReportFormat[]
  onGenerate: (format: ReportFormat) => void
  onOpenRegister?: () => void
}) {
  if (onOpenRegister) {
    return (
      <Button type="button" size="sm" className={exportBtnClass} onClick={onOpenRegister}>
        <FileSpreadsheet className="size-4 shrink-0" aria-hidden />
        Get report
      </Button>
    )
  }

  const showPdf = formats.includes("pdf")
  return (
    <div className="flex shrink-0 gap-2">
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
      {showPdf ? (
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
      ) : null}
    </div>
  )
}

function TileHeader({ style, report }: { style: ReportTileStyle; report: ReportDefinition }) {
  const Icon = style.icon
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-3 overflow-hidden",
        style.compact ? "min-h-[4.5rem] items-start" : "h-[7.5rem] items-start",
      )}
    >
      <div
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
          style.iconWrap,
        )}
      >
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <span className="inline-flex rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-foreground uppercase">
          {style.tag}
        </span>
        <h3
          className={cn(
            "font-semibold leading-snug text-foreground",
            style.compact ? "mt-1.5 line-clamp-1 text-lg" : "mt-1.5 line-clamp-2 text-base",
          )}
        >
          {report.title}
        </h3>
        <p
          className={cn(
            "text-foreground",
            style.compact
              ? "mt-1.5 line-clamp-2 text-sm leading-relaxed"
              : "mt-1 line-clamp-2 text-sm leading-relaxed",
          )}
        >
          {report.description}
        </p>
        {style.hint && !style.compact ? (
          <p className="mt-1 line-clamp-1 text-xs leading-relaxed text-foreground">{style.hint}</p>
        ) : null}
      </div>
    </div>
  )
}

function FilterField({
  filter,
  value,
  options,
  disabled,
  placeholder,
  onChange,
}: {
  filter: ReportDefinition["filters"][number]
  value: string
  options: { value: string; label: string }[]
  disabled?: boolean
  placeholder?: string
  onChange: (value: string) => void
}) {
  const displayLabel = FILTER_LABELS[filter.key] ?? filter.label

  return (
    <div className={cn("min-w-0 space-y-1.5", filter.key === "actual_location" ? "sm:col-span-2" : "")}>
      <Label className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {displayLabel}
      </Label>
      <select
        className={cn(adminSelectClass, "h-9 w-full min-w-0 bg-background text-sm")}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        title={
          filter.key === "fy_status"
            ? "Filter by physical verification status within the selected financial year."
            : filter.key === "fy_start_year"
              ? "Choose which financial year the report should cover."
              : undefined
        }
      >
        {options.length === 0 && placeholder ? (
          <option value="all">{placeholder}</option>
        ) : null}
        {options.map((option) => {
          const optionValue = option.value || "all"
          return (
            <option key={`${filter.key}-${optionValue}`} value={optionValue}>
              {shortenFilterOptionLabel(filter.key, optionValue, option.label)}
            </option>
          )
        })}
      </select>
    </div>
  )
}

function resolveFilterOptions(
  filter: ReportDefinition["filters"][number],
  filters: ReportFilterValues,
  masters: ReturnType<typeof useAssetMasterLookups>,
): { options: { value: string; label: string }[]; disabled?: boolean; placeholder?: string } {
  const plantId = filters.plant_id && filters.plant_id !== "all" ? Number(filters.plant_id) : null

  if (filter.kind === "category") {
    return {
      options: [
        { value: "all", label: "All categories" },
        ...masters.categories.map((c) => ({ value: String(c.id), label: categoryLabel(c) })),
      ],
    }
  }
  if (filter.kind === "cost_center") {
    return {
      disabled: !plantId,
      placeholder: plantId ? "All cost centers" : "Select plant first",
      options: plantId
        ? [
            { value: "all", label: "All cost centers" },
            ...masters.costCenters.map((cc) => ({
              value: cc.code,
              label: masterOptionLabel(cc.code, cc.name),
            })),
          ]
        : [],
    }
  }
  if (filter.kind === "functional_location") {
    return {
      disabled: !plantId,
      placeholder: plantId ? "All functional locations" : "Select plant first",
      options: plantId
        ? [
            { value: "all", label: "All functional locations" },
            ...masters.functionalLocations.map((fl) => ({
              value: fl.code,
              label: masterOptionLabel(fl.code, fl.name),
            })),
          ]
        : [],
    }
  }
  if (filter.kind === "actual_location") {
    const fl = filters.functional_location
    const hasFl = Boolean(fl && fl !== "all")
    return {
      disabled: !plantId || !hasFl,
      placeholder: !plantId
        ? "Select plant first"
        : !hasFl
          ? "Select functional location first"
          : "All actual locations",
      options: plantId && hasFl
        ? [
            { value: "all", label: "All actual locations" },
            ...masters.actualLocations.map((al) => ({
              value: al.code,
              label: masterOptionLabel(al.code, al.name),
            })),
          ]
        : [],
    }
  }

  if (filter.kind === "plant") {
    return {
      options: [
        { value: "all", label: "All plants" },
        ...masters.plants.map((p) => ({ value: String(p.id), label: plantLabel(p) })),
      ],
    }
  }

  if (filter.kind === "financial_year") {
    return {
      options: filter.options.map((o) => ({
        value: o.value,
        label: o.label.replace(" (running)", ""),
      })),
    }
  }

  return {
    options: filter.options.map((o) => ({
      value: o.value || "all",
      label: shortenFilterOptionLabel(filter.key, o.value || "all", o.label),
    })),
  }
}

function TileControls({
  report,
  filters,
  onFilterChange,
  onGenerate,
  onOpenRegister,
  generatingKey,
  busy,
}: {
  report: ReportDefinition
  filters: ReportFilterValues
  onFilterChange: (key: string, value: string) => void
  onGenerate: (format: ReportFormat) => void
  onOpenRegister?: () => void
  generatingKey: string | null
  busy: boolean
}) {
  const isRegisterDialog = report.key === "asset_register"
  const plantId = filters.plant_id && filters.plant_id !== "all" ? Number(filters.plant_id) : null
  const masters = useAssetMasterLookups(
    plantId,
    filters.cost_center && filters.cost_center !== "all" ? filters.cost_center : null,
    filters.functional_location && filters.functional_location !== "all"
      ? filters.functional_location
      : null,
  )
  const filtersList = orderedFilters(report)
  const formats: ReportFormat[] = report.formats ?? ["xlsx", "pdf"]
  const showFilters = !isRegisterDialog && filtersList.length > 0
  const filterColumnClass =
    filtersList.length === 1 ? "grid-cols-1" : "grid-cols-1 @[26rem]:grid-cols-2"

  return (
    <div className="mt-auto shrink-0 rounded-lg border border-border/60 bg-background/70 p-4">
      <div className="flex min-h-[4.75rem] flex-col gap-4 @[32rem]:flex-row @[32rem]:items-end @[32rem]:justify-between">
        {showFilters ? (
          <div className={cn("grid min-w-0 flex-1 gap-3", filterColumnClass)}>
            {filtersList.map((filter) => {
              const resolved = resolveFilterOptions(filter, filters, masters)
              return (
                <FilterField
                  key={filter.key}
                  filter={filter}
                  value={filters[filter.key] ?? "all"}
                  options={resolved.options}
                  disabled={resolved.disabled}
                  placeholder={resolved.placeholder}
                  onChange={(value) => onFilterChange(filter.key, value)}
                />
              )
            })}
          </div>
        ) : (
          <div className="hidden flex-1 @[32rem]:block" aria-hidden />
        )}

        <div className="flex shrink-0 justify-end gap-2">
          <ReportActions
            reportKey={report.key}
            busy={busy}
            generatingKey={generatingKey}
            formats={formats}
            onGenerate={onGenerate}
            onOpenRegister={onOpenRegister}
          />
        </div>
      </div>
    </div>
  )
}

export function ReportTile({
  report,
  filters,
  onFilterChange,
  onGenerate,
  onOpenRegister,
  generatingKey,
}: {
  report: ReportDefinition
  filters: ReportFilterValues
  onFilterChange: (key: string, value: string) => void
  onGenerate: (format: ReportFormat) => void
  onOpenRegister?: () => void
  generatingKey: string | null
}) {
  const style = REPORT_TILE_STYLES[report.key] ?? FALLBACK_STYLE
  const busy = generatingKey?.startsWith(`${report.key}:`) ?? false

  return (
    <article
      className={cn(
        "group @container relative flex flex-col overflow-hidden rounded-[var(--app-radius-surface)] border shadow-[var(--app-shadow-surface)] transition-shadow hover:shadow-[var(--app-shadow-elevated)]",
        style.compact ? "h-auto min-h-[8.5rem] self-start" : "h-full min-h-[15.5rem]",
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

      <div
        className={cn(
          "relative",
          style.compact
            ? "flex min-h-[7.75rem] flex-col justify-center gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
            : "flex flex-1 flex-col gap-4 p-[var(--app-card-padding)]",
        )}
      >
        <TileHeader style={style} report={report} />
        {style.compact ? (
          <div className="flex shrink-0 justify-end sm:justify-start">
            <ReportActions
              reportKey={report.key}
              busy={busy}
              generatingKey={generatingKey}
              formats={report.formats ?? ["xlsx", "pdf"]}
              onGenerate={onGenerate}
              onOpenRegister={report.key === "asset_register" ? onOpenRegister : undefined}
            />
          </div>
        ) : (
          <TileControls
            report={report}
            filters={filters}
            onFilterChange={onFilterChange}
            onGenerate={onGenerate}
            onOpenRegister={report.key === "asset_register" ? onOpenRegister : undefined}
            generatingKey={generatingKey}
            busy={busy}
          />
        )}
      </div>
    </article>
  )
}

export function ReportTileSkeleton({
  span = "half",
  compact = false,
}: {
  span?: "full" | "half"
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        "h-full animate-pulse rounded-[var(--app-radius-surface)] border border-border/60 bg-muted/20",
        compact ? "h-[8.5rem] self-start" : "h-full min-h-[15.5rem]",
        span === "full" ? "lg:col-span-2" : "",
      )}
    />
  )
}
