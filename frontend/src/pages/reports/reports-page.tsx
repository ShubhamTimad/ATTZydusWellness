import * as React from "react"
import { toast } from "sonner"

import { AssetExportDialog } from "@/components/assets/asset-export-dialog"
import { ReportTile, ReportTileSkeleton } from "@/components/reports/report-tile"
import { ApiError, downloadFile, getJson } from "@/lib/api"
import type { ReportCatalog, ReportDefinition, ReportFilterValues, ReportFormat } from "@/lib/reports-types"

function defaultFyStartYear(report: ReportDefinition): string {
  const fyFilter = report.filters.find((f) => f.key === "fy_start_year")
  if (!fyFilter || fyFilter.options.length === 0) return ""
  const running = fyFilter.options.find((o) => o.label.includes("(running)"))
  return running?.value ?? fyFilter.options[0]?.value ?? ""
}

function buildInitialFilters(report: ReportDefinition): ReportFilterValues {
  const values: ReportFilterValues = {}
  for (const filter of report.filters) {
    if (filter.key === "fy_start_year") {
      values[filter.key] = defaultFyStartYear(report)
    } else if (filter.key === "fy_status") {
      values[filter.key] = report.key === "financial_year_verification" ? "verified" : "all"
    } else {
      values[filter.key] = "all"
    }
  }
  return values
}

function normalizeFilterValue(value: string): string | undefined {
  if (!value || value === "all") return undefined
  return value
}

function buildDownloadPath(
  report: ReportDefinition,
  format: ReportFormat,
  filters: ReportFilterValues,
): string {
  const params = new URLSearchParams({ report: report.key, format })
  for (const filter of report.filters) {
    const value = filters[filter.key] ?? "all"
    const normalized = normalizeFilterValue(value)
    if (normalized) params.set(filter.key, normalized)
  }
  return `/reports/generate?${params.toString()}`
}

export function ReportsPage() {
  const [catalog, setCatalog] = React.useState<ReportCatalog | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [generatingKey, setGeneratingKey] = React.useState<string | null>(null)
  const [registerOpen, setRegisterOpen] = React.useState(false)
  const [filterState, setFilterState] = React.useState<Record<string, ReportFilterValues>>({})

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await getJson<ReportCatalog>("/reports/catalog")
        if (cancelled) return
        setCatalog(data)
        setFilterState(
          Object.fromEntries(data.reports.map((report) => [report.key, buildInitialFilters(report)])),
        )
        setLoadError(null)
      } catch (e) {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : "Failed to load reports")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function updateFilter(reportKey: string, filterKey: string, value: string) {
    setFilterState((prev) => ({
      ...prev,
      [reportKey]: {
        ...(prev[reportKey] ?? {}),
        [filterKey]: value,
      },
    }))
  }

  async function handleGenerate(report: ReportDefinition, format: ReportFormat) {
    const filters = filterState[report.key] ?? buildInitialFilters(report)
    const token = `${report.key}:${format}`
    setGeneratingKey(token)
    try {
      const path = buildDownloadPath(report, format, filters)
      await downloadFile(path, `${report.key}.${format === "xlsx" ? "xlsx" : "pdf"}`)
      toast.success(`${format.toUpperCase()} report downloaded`)
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to generate report"
      toast.error(message)
    } finally {
      setGeneratingKey(null)
    }
  }

  return (
    <div className="app-page flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-x-hidden overflow-y-auto">
      <div>
        <h1 className="app-page-heading">Reports</h1>
        {/* <p className="app-page-subheading mt-1">
          Pick a report tile, set filters, and export to Excel or PDF.
        </p> */}
      </div>

      {loadError ? (
        <div className="rounded-[var(--app-radius-surface)] border border-dashed border-destructive/30 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive">
          {loadError}
        </div>
      ) : null}

      <div className="grid w-full min-w-0 grid-cols-1 items-start gap-[var(--app-grid-gap)] lg:grid-cols-2">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <ReportTileSkeleton key={i} span={i === 0 ? "full" : "half"} compact={i === 0} />
            ))
          : null}

        {!loading && !loadError && catalog
          ? catalog.reports.map((report) => (
              <ReportTile
                key={report.key}
                report={report}
                filters={filterState[report.key] ?? buildInitialFilters(report)}
                onFilterChange={(key, value) => updateFilter(report.key, key, value)}
                onGenerate={(format) => void handleGenerate(report, format)}
                onOpenRegister={report.key === "asset_register" ? () => setRegisterOpen(true) : undefined}
                generatingKey={generatingKey}
              />
            ))
          : null}
      </div>

      {/* {!loading && !loadError && catalog ? (
        <p className="text-center text-xs text-foreground">
          {catalog.reports.length} report types · {catalog.plants.length} plant
          {catalog.plants.length === 1 ? "" : "s"} available for filtering
        </p>
      ) : null} */}

      <AssetExportDialog variant="register" open={registerOpen} onOpenChange={setRegisterOpen} />
    </div>
  )
}
