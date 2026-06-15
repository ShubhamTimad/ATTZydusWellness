import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"

import { AssetImportGrid, type ImportGridRow } from "@/components/assets/asset-import-grid"
import {
  AssetImportProgressOverlay,
  type ImportProgressState,
} from "@/components/assets/asset-import-progress"
import { AdminPage } from "@/components/layout/admin-page"
import { AdminPanel, AdminPrimaryButton } from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { API_BASE_URL, downloadFile, postJson } from "@/lib/api"
import {
  assetConditionLabel,
  assetCustodianLabel,
  tagColorLabel,
  useAssetMasterLookups,
} from "@/lib/use-asset-masters"

type PreviewResponse = {
  filename: string | null
  total_rows: number
  valid_rows: number
  error_rows: number
  rows: ImportGridRow[]
}

function getToken() {
  try {
    return localStorage.getItem("access_token")
  } catch {
    return null
  }
}

function normalizePreview(data: PreviewResponse): PreviewResponse {
  return {
    ...data,
    rows: data.rows.map((r) => ({
      ...r,
      field_errors: r.field_errors ?? {},
      errors: r.errors ?? [],
    })),
  }
}

function rowsForValidate(rows: ImportGridRow[]) {
  return rows.map((r) => ({ row_number: r.row_number, data: r.data }))
}

const IMPORT_CHUNK_SIZE = 100

type ImportChunkResponse = {
  batch_id: number
  chunk_created_count: number
  chunk_error_count: number
  total_created_count: number
  processed_rows: number
  total_rows: number
  percent: number
  errors: string[]
  is_complete: boolean
  pending_approval: boolean
}

function chunkRows<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

export function AssetImportPage() {
  const navigate = useNavigate()
  const masters = useAssetMasterLookups()
  const columnSelectOptions = React.useMemo(
    () => ({
      tag_color_code: masters.tagColors.map((c) => ({ value: c.code, label: tagColorLabel(c) })),
      asset_custodian_code: masters.assetCustodians.map((c) => ({
        value: c.code,
        label: assetCustodianLabel(c),
      })),
      asset_condition_code: masters.assetConditions.map((c) => ({
        value: c.code,
        label: assetConditionLabel(c),
      })),
    }),
    [masters.tagColors, masters.assetCustodians, masters.assetConditions],
  )
  const [file, setFile] = React.useState<File | null>(null)
  const [preview, setPreview] = React.useState<PreviewResponse | null>(null)
  const [step, setStep] = React.useState<"upload" | "review" | "done">("upload")
  const [loading, setLoading] = React.useState(false)
  const [result, setResult] = React.useState<{ created_count: number; pending_approval: boolean } | null>(
    null,
  )
  const [errorsOnly, setErrorsOnly] = React.useState(false)
  const [rowSearch, setRowSearch] = React.useState("")
  const [selectedRows, setSelectedRows] = React.useState<Set<number>>(new Set())
  const [importProgress, setImportProgress] = React.useState<ImportProgressState | null>(null)
  const [cancellingImport, setCancellingImport] = React.useState(false)
  const [downloadingTemplate, setDownloadingTemplate] = React.useState(false)
  const importAbortRef = React.useRef<AbortController | null>(null)
  const importBatchIdRef = React.useRef<number | null>(null)
  const importCancelledRef = React.useRef(false)

  async function rollbackImportBatch(batchId: number) {
    return postJson<{ batch_id: number; assets_removed: number }>(
      `/admin/assets/import/cancel-batch/${batchId}`,
      {},
    )
  }

  async function cancelImport() {
    importCancelledRef.current = true
    importAbortRef.current?.abort()
    setCancellingImport(true)

    const batchId = importBatchIdRef.current
    try {
      if (batchId != null) {
        const res = await rollbackImportBatch(batchId)
        toast.success(
          res.assets_removed > 0
            ? `Import cancelled. Removed ${res.assets_removed.toLocaleString()} partial assets.`
            : "Import cancelled. No assets were kept.",
        )
      } else {
        toast.info("Import cancelled.")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel import.")
    } finally {
      importBatchIdRef.current = null
      importAbortRef.current = null
      setCancellingImport(false)
      setImportProgress(null)
      setLoading(false)
    }
  }

  async function downloadTemplate() {
    setDownloadingTemplate(true)
    try {
      await downloadFile("/admin/assets/import/template", "asset-import-template.xlsx")
      toast.success("Import template downloaded.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to download template.")
    } finally {
      setDownloadingTemplate(false)
    }
  }

  async function runPreview() {
    if (!file) {
      toast.error("Choose a CSV or Excel file.")
      return
    }
    setLoading(true)
    const fd = new FormData()
    fd.append("file", file)
    const token = getToken()
    try {
      const res = await fetch(`${API_BASE_URL}/admin/assets/import/preview`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })
      const text = await res.text()
      const data = text ? (JSON.parse(text) as PreviewResponse) : null
      if (!res.ok || !data) throw new Error((data as { detail?: string })?.detail ?? "Preview failed")
      const normalized = normalizePreview(data)
      setPreview(normalized)
      setSelectedRows(new Set())
      setStep("review")
      if (normalized.error_rows > 0) {
        toast.warning(
          `${normalized.error_rows} row(s) have errors. Fix highlighted cells and re-validate.`,
        )
      } else {
        toast.success("All rows passed validation. You can submit the import.")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed")
    } finally {
      setLoading(false)
    }
  }

  async function revalidate() {
    if (!preview) return
    setLoading(true)
    try {
      const data = await postJson<PreviewResponse>("/admin/assets/import/validate", {
        filename: preview.filename,
        rows: rowsForValidate(preview.rows),
      })
      const normalized = normalizePreview(data)
      setPreview(normalized)
      if (normalized.error_rows > 0) {
        toast.warning(`${normalized.error_rows} row(s) still have errors.`)
      } else {
        toast.success("All rows are valid. Submit when ready.")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Validation failed")
    } finally {
      setLoading(false)
    }
  }

  async function confirmImport() {
    if (!preview) return
    if (preview.error_rows > 0) {
      toast.error("Fix all highlighted errors and re-validate before submitting.")
      return
    }

    const allRows = rowsForValidate(preview.rows)
    const chunks = chunkRows(allRows, IMPORT_CHUNK_SIZE)
    const totalRows = allRows.length
    const totalChunks = chunks.length
    let batchId: number | null = null
    let processedRows = 0
    let totalCreated = 0
    const importErrors: string[] = []

    importCancelledRef.current = false
    importBatchIdRef.current = null
    const abortController = new AbortController()
    importAbortRef.current = abortController

    setLoading(true)
    setImportProgress({
      processedRows: 0,
      totalRows,
      percent: 0,
      createdCount: 0,
      chunkIndex: 0,
      totalChunks,
    })

    const token = getToken()
    try {
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        if (importCancelledRef.current) {
          return
        }

        const chunk = chunks[chunkIndex]
        const processedBeforeChunk = chunkIndex * IMPORT_CHUNK_SIZE

        setImportProgress({
          processedRows: Math.min(processedBeforeChunk, totalRows),
          totalRows,
          percent:
            totalChunks > 0 ? Math.round((chunkIndex / totalChunks) * 1000) / 10 : 0,
          createdCount: totalCreated,
          chunkIndex,
          totalChunks,
        })

        const res = await fetch(`${API_BASE_URL}/admin/assets/import/confirm-chunk`, {
          method: "POST",
          signal: abortController.signal,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            rows: chunk,
            filename: preview.filename,
            batch_id: batchId,
            chunk_index: chunkIndex,
            total_chunks: totalChunks,
            total_rows: totalRows,
            processed_rows: Math.min(processedBeforeChunk + chunk.length, totalRows),
            is_final_chunk: chunkIndex === chunks.length - 1,
            initiate_approval: false,
          }),
        })
        const text = await res.text()
        const data = text ? (JSON.parse(text) as ImportChunkResponse & { detail?: unknown }) : null

        if (res.status === 422 && data && typeof data.detail === "object" && data.detail !== null) {
          const detail = data.detail as PreviewResponse
          if (detail.rows) {
            const normalized = normalizePreview(detail)
            setPreview(normalized)
            setStep("review")
            toast.error("Validation failed on submit. Correct highlighted cells and re-validate.")
            return
          }
        }
        if (!res.ok || !data || typeof data.batch_id !== "number") {
          const message =
            typeof data?.detail === "string"
              ? data.detail
              : data && typeof data.detail === "object"
                ? "Import failed during batch processing."
                : "Import failed"
          throw new Error(message)
        }

        batchId = data.batch_id
        importBatchIdRef.current = batchId
        totalCreated = data.total_created_count
        processedRows = data.processed_rows
        if (data.errors?.length) {
          importErrors.push(...data.errors)
        }

        setImportProgress({
          processedRows,
          totalRows: data.total_rows,
          percent: data.percent,
          createdCount: totalCreated,
          chunkIndex,
          totalChunks,
        })
      }

      if (importCancelledRef.current) {
        return
      }

      importBatchIdRef.current = null
      setResult({ created_count: totalCreated, pending_approval: false })
      setStep("done")
      if (importErrors.length > 0) {
        toast.warning(
          `Imported ${totalCreated} assets with ${importErrors.length} row error(s). Check the batch for details.`,
        )
      } else {
        toast.success(`Imported ${totalCreated} assets.`)
      }
    } catch (e) {
      if (importCancelledRef.current || (e instanceof DOMException && e.name === "AbortError")) {
        return
      }
      if (batchId != null) {
        try {
          await rollbackImportBatch(batchId)
        } catch {
          // keep original error visible
        }
      }
      toast.error(e instanceof Error ? e.message : "Import failed")
    } finally {
      importAbortRef.current = null
      if (!importCancelledRef.current) {
        importBatchIdRef.current = null
        setImportProgress(null)
        setLoading(false)
      }
    }
  }

  const allValid = preview ? preview.error_rows === 0 && preview.valid_rows > 0 : false

  function deleteSelectedRows() {
    if (!preview || selectedRows.size === 0) return
    if (selectedRows.size >= preview.rows.length) {
      toast.error("Keep at least one row, or upload another file.")
      return
    }
    const removed = selectedRows.size
    const nextRows = preview.rows.filter((row) => !selectedRows.has(row.row_number))
    const validRows = nextRows.filter((row) => row.valid).length
    setPreview({
      ...preview,
      rows: nextRows,
      total_rows: nextRows.length,
      valid_rows: validRows,
      error_rows: nextRows.length - validRows,
    })
    setSelectedRows(new Set())
    toast.success(`Removed ${removed} row(s). Re-validate before submit.`)
  }

  const handleCellChange = React.useCallback((rowIndex: number, key: string, value: string) => {
    React.startTransition(() => {
      setPreview((p) => {
        if (!p) return p
        const row = p.rows[rowIndex]
        if (!row) return p
        const nextData = { ...row.data }
        if (!value.trim()) {
          delete nextData[key]
        } else {
          nextData[key] = value
        }
        const nextRows = p.rows.slice()
        const wasValid = row.valid
        nextRows[rowIndex] = {
          ...row,
          valid: false,
          errors: [],
          field_errors: {},
          data: nextData,
        }
        return {
          ...p,
          rows: nextRows,
          valid_rows: wasValid ? Math.max(0, p.valid_rows - 1) : p.valid_rows,
          error_rows: wasValid ? p.error_rows + 1 : p.error_rows,
        }
      })
    })
  }, [])

  const importing = importProgress !== null

  return (
    <AdminPage
      fullWidth
      dense
      viewportFill={step === "review"}
      actions={
        <Button type="button" variant="outline" size="sm" asChild>
          <Link to="/dashboard/assets">← Assets</Link>
        </Button>
      }
    >
      {step === "upload" ? (
        <AdminPanel title="Upload file">
          <div className="dialog-body space-y-4">
            <p className="text-sm text-muted-foreground">
              Download the template, fill your data, then upload the file.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={downloadingTemplate || loading}
              onClick={() => void downloadTemplate()}
            >
              {downloadingTemplate ? "Downloading…" : "Download import template"}
            </Button>
            <div className="space-y-1.5">
              <Label htmlFor="import-file">File</Label>
              <Input
                id="import-file"
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <AdminPrimaryButton type="button" disabled={loading || !file} onClick={() => void runPreview()}>
              {loading ? "Validating…" : "Upload and review"}
            </AdminPrimaryButton>
          </div>
        </AdminPanel>
      ) : null}

      {step === "review" && preview ? (
        <AdminPanel
          className="flex min-h-0 flex-1 flex-col"
          contentClassName="flex min-h-0 flex-1 flex-col"
          title="Review import"
          description={`${preview.valid_rows} valid · ${preview.error_rows} with errors · ${preview.total_rows} rows`}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={importing}
                onClick={() => {
                  setStep("upload")
                  setPreview(null)
                  setSelectedRows(new Set())
                }}
              >
                Upload another file
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || importing}
                onClick={() => void revalidate()}
              >
                {loading && !importing ? "Validating…" : "Re-validate"}
              </Button>
              <AdminPrimaryButton
                type="button"
                disabled={loading || importing || !allValid}
                onClick={() => void confirmImport()}
              >
                {importing ? "Importing…" : "Submit import"}
              </AdminPrimaryButton>
            </div>
          }
        >
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4">
            {preview.error_rows > 0 ? (
              <p className="shrink-0 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                Cells with errors are highlighted in red. Edit or delete rows, then click{" "}
                <strong>Re-validate</strong>. Submit is enabled only when every row is valid.
              </p>
            ) : (
              <p className="shrink-0 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">
                All rows passed validation. Click <strong>Submit import</strong> to create assets.
              </p>
            )}
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <div className="relative min-w-[12rem] flex-1">
                <Input
                  value={rowSearch}
                  onChange={(e) => setRowSearch(e.target.value)}
                  placeholder="Filter by row, code, name, or RFID…"
                  className="h-8 text-sm"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={errorsOnly}
                  onCheckedChange={(v) => setErrorsOnly(Boolean(v))}
                />
                Errors only
              </label>
              {selectedRows.size > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-destructive hover:text-destructive"
                  disabled={loading || importing}
                  onClick={deleteSelectedRows}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  Delete selected ({selectedRows.size})
                </Button>
              ) : null}
              {preview.total_rows > 200 ? (
                <span className="text-xs text-muted-foreground">
                  {preview.total_rows.toLocaleString()} rows · virtual scroll
                </span>
              ) : null}
            </div>
            <AssetImportGrid
              rows={preview.rows}
              onCellChange={handleCellChange}
              columnSelectOptions={columnSelectOptions}
              selectedRowNumbers={selectedRows}
              onSelectedRowNumbersChange={setSelectedRows}
              errorsOnly={errorsOnly}
              search={rowSearch}
              fillContainer
            />
          </div>
        </AdminPanel>
      ) : null}

      {importProgress ? (
        <AssetImportProgressOverlay
          progress={importProgress}
          onCancel={() => void cancelImport()}
          cancelling={cancellingImport}
        />
      ) : null}

      {step === "done" && result ? (
        <AdminPanel title="Import complete">
          <div className="dialog-body space-y-3">
            <p className="text-sm">
              Created and activated <strong>{result.created_count}</strong> assets. They are ready
              to use immediately.
            </p>
            <AdminPrimaryButton type="button" onClick={() => navigate("/dashboard/assets")}>
              Go to assets
            </AdminPrimaryButton>
          </div>
        </AdminPanel>
      ) : null}
    </AdminPage>
  )
}
