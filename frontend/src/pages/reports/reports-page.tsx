import * as React from "react"
import { toast } from "sonner"

import { AssetExportDialog } from "@/components/assets/asset-export-dialog"
import { ReportGenerateDialog } from "@/components/reports/report-generate-dialog"
import { ReportTile, ReportTileSkeleton } from "@/components/reports/report-tile"
import { ApiError, downloadFile, getJson } from "@/lib/api"
import type { ReportCatalog, ReportDefinition, ReportFilterValues, ReportFormat } from "@/lib/reports-types"

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
  const [registerFormat, setRegisterFormat] = React.useState<ReportFormat>("xlsx")
  const [pending, setPending] = React.useState<{
    report: ReportDefinition
    format: ReportFormat
  } | null>(null)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await getJson<ReportCatalog>("/reports/catalog")
        if (cancelled) return
        setCatalog(data)
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

  function requestGenerate(report: ReportDefinition, format: ReportFormat) {
    if (report.key === "asset_register") {
      setRegisterFormat(format)
      setRegisterOpen(true)
      return
    }
    setPending({ report, format })
  }

  async function handleGenerate(report: ReportDefinition, format: ReportFormat, filters: ReportFilterValues) {
    const token = `${report.key}:${format}`
    setGeneratingKey(token)
    try {
      const path = buildDownloadPath(report, format, filters)
      await downloadFile(path, `${report.key}.${format === "xlsx" ? "xlsx" : "pdf"}`)
      toast.success(`${format.toUpperCase()} report downloaded`)
      setPending(null)
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
      </div>

      {loadError ? (
        <div className="rounded-[var(--app-radius-surface)] border border-dashed border-destructive/30 bg-destructive/5 px-4 py-8 text-center text-sm text-destructive">
          {loadError}
        </div>
      ) : null}

      <div className="grid w-full min-w-0 grid-cols-1 gap-[var(--app-grid-gap)] lg:grid-cols-2">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <ReportTileSkeleton key={i} />)
          : null}

        {!loading && !loadError && catalog
          ? catalog.reports.map((report) => (
              <ReportTile
                key={report.key}
                report={report}
                onGenerate={(format) => requestGenerate(report, format)}
                generatingKey={generatingKey}
              />
            ))
          : null}
      </div>

      <AssetExportDialog
        variant="register"
        format={registerFormat}
        open={registerOpen}
        onOpenChange={setRegisterOpen}
      />
      <ReportGenerateDialog
        open={pending != null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        report={pending?.report ?? null}
        format={pending?.format ?? "xlsx"}
        generating={generatingKey != null}
        onGenerate={(filters) => {
          if (!pending) return
          void handleGenerate(pending.report, pending.format, filters)
        }}
      />
    </div>
  )
}
