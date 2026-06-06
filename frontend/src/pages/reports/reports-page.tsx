import * as React from "react"
import { toast } from "sonner"

import { ReportTile, ReportTileSkeleton } from "@/components/reports/report-tile"
import { ApiError, downloadFile, getJson } from "@/lib/api"
import type { ReportCatalog, ReportFilterValues, ReportFormat } from "@/lib/reports-types"

const DEFAULT_FILTERS: ReportFilterValues = {
  plant_id: "all",
  status: "all",
  fy_status: "all",
}

function normalizeFilterValue(value: string): string | undefined {
  if (!value || value === "all") return undefined
  return value
}

function buildDownloadPath(
  reportKey: string,
  format: ReportFormat,
  filters: ReportFilterValues,
): string {
  const params = new URLSearchParams({ report: reportKey, format })
  for (const [key, value] of Object.entries(filters)) {
    const normalized = normalizeFilterValue(value)
    if (normalized) params.set(key, normalized)
  }
  return `/reports/generate?${params.toString()}`
}

export function ReportsPage() {
  const [catalog, setCatalog] = React.useState<ReportCatalog | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [generatingKey, setGeneratingKey] = React.useState<string | null>(null)
  const [filterState, setFilterState] = React.useState<Record<string, ReportFilterValues>>({})

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await getJson<ReportCatalog>("/reports/catalog")
        if (cancelled) return
        setCatalog(data)
        setFilterState(
          Object.fromEntries(data.reports.map((report) => [report.key, { ...DEFAULT_FILTERS }])),
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
        ...(prev[reportKey] ?? DEFAULT_FILTERS),
        [filterKey]: value,
      },
    }))
  }

  async function handleGenerate(reportKey: string, format: ReportFormat) {
    const filters = filterState[reportKey] ?? DEFAULT_FILTERS
    const token = `${reportKey}:${format}`
    setGeneratingKey(token)
    try {
      const path = buildDownloadPath(reportKey, format, filters)
      await downloadFile(path, `${reportKey}.${format === "xlsx" ? "xlsx" : "pdf"}`)
      toast.success(`${format.toUpperCase()} report downloaded`)
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Failed to generate report"
      toast.error(message)
    } finally {
      setGeneratingKey(null)
    }
  }

  return (
    <div className="app-page">
      <div>
        <h1 className="app-page-heading">Reports</h1>
        <p className="app-page-subheading mt-1">
          Pick a report tile, set filters, and export to Excel or PDF.
        </p>
      </div>

      {loadError ? (
        <div className="rounded-[var(--app-radius-surface)] border border-dashed border-destructive/30 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive">
          {loadError}
        </div>
      ) : null}

      <div className="grid items-start gap-[var(--app-grid-gap)] md:grid-cols-2">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <ReportTileSkeleton key={i} span={i === 0 ? "full" : "half"} />
            ))
          : null}

        {!loading && !loadError && catalog
          ? catalog.reports.map((report) => (
              <ReportTile
                key={report.key}
                report={report}
                filters={filterState[report.key] ?? DEFAULT_FILTERS}
                onFilterChange={(key, value) => updateFilter(report.key, key, value)}
                onGenerate={handleGenerate}
                generatingKey={generatingKey}
              />
            ))
          : null}
      </div>

      {!loading && !loadError && catalog ? (
        <p className="text-center text-xs text-muted-foreground">
          {catalog.reports.length} report types · {catalog.plants.length} plant
          {catalog.plants.length === 1 ? "" : "s"} available for filtering
        </p>
      ) : null}
    </div>
  )
}
