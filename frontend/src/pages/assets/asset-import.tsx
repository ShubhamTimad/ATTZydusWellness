import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { AssetImportGrid, type ImportGridRow } from "@/components/assets/asset-import-grid"
import { AdminPage } from "@/components/layout/admin-page"
import { AdminPanel, AdminPrimaryButton } from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { API_BASE_URL, postJson } from "@/lib/api"
import { ASSET_IMPORT_HEADERS } from "@/lib/asset-master-fields"

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

export function AssetImportPage() {
  const navigate = useNavigate()
  const [file, setFile] = React.useState<File | null>(null)
  const [preview, setPreview] = React.useState<PreviewResponse | null>(null)
  const [step, setStep] = React.useState<"upload" | "review" | "done">("upload")
  const [loading, setLoading] = React.useState(false)
  const [result, setResult] = React.useState<{ created_count: number; pending_approval: boolean } | null>(
    null,
  )
  const [errorsOnly, setErrorsOnly] = React.useState(false)
  const [rowSearch, setRowSearch] = React.useState("")

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
    setLoading(true)
    const token = getToken()
    try {
      const res = await fetch(`${API_BASE_URL}/admin/assets/import/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          rows: rowsForValidate(preview.rows),
          filename: preview.filename,
          initiate_approval: false,
        }),
      })
      const text = await res.text()
      const data = text ? JSON.parse(text) : {}
      if (res.status === 422 && data.detail?.rows) {
        const normalized = normalizePreview(data.detail as PreviewResponse)
        setPreview(normalized)
        setStep("review")
        toast.error("Validation failed on submit. Correct highlighted cells and re-validate.")
        return
      }
      if (!res.ok) throw new Error(data.detail ?? "Import failed")
      setResult({ created_count: data.created_count, pending_approval: data.pending_approval })
      setStep("done")
      toast.success(`Imported ${data.created_count} assets.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed")
    } finally {
      setLoading(false)
    }
  }

  const allValid = preview ? preview.error_rows === 0 && preview.valid_rows > 0 : false

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

  return (
    <AdminPage
      fullWidth
      dense
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
              <span className="font-medium text-foreground">Asset code</span> must be unique for every
              asset. <span className="font-medium text-foreground">RFID code</span> is optional but must be
              unique when provided. Rows with errors are shown in an Excel-style grid; fix highlighted
              cells and re-validate before submit.
            </p>
            <p className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {ASSET_IMPORT_HEADERS.join(" · ")}
            </p>
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
          title="Review import"
          description={`${preview.valid_rows} valid · ${preview.error_rows} with errors · ${preview.total_rows} rows`}
        >
          <div className="space-y-3 px-4 pb-4">
            {preview.error_rows > 0 ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                Cells with errors are highlighted in red. Edit values below, then click{" "}
                <strong>Re-validate</strong>. Submit is enabled only when every row is valid.
              </p>
            ) : (
              <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">
                All rows passed validation. Click <strong>Submit import</strong> to create assets.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
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
              {preview.total_rows > 200 ? (
                <span className="text-xs text-muted-foreground">
                  {preview.total_rows.toLocaleString()} rows · virtual scroll
                </span>
              ) : null}
            </div>
            <AssetImportGrid
              rows={preview.rows}
              onCellChange={handleCellChange}
              errorsOnly={errorsOnly}
              search={rowSearch}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 px-4 py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setStep("upload")
                setPreview(null)
              }}
            >
              Upload another file
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void revalidate()}>
              {loading ? "Validating…" : "Re-validate"}
            </Button>
            <AdminPrimaryButton
              type="button"
              disabled={loading || !allValid}
              onClick={() => void confirmImport()}
            >
              {loading ? "Importing…" : "Submit import"}
            </AdminPrimaryButton>
          </div>
        </AdminPanel>
      ) : null}

      {step === "done" && result ? (
        <AdminPanel title="Import complete">
          <div className="dialog-body space-y-3">
            <p className="text-sm">
              Created <strong>{result.created_count}</strong> assets as inactive. Submit them for
              approval from the asset list or each asset detail page when ready.
            </p>
            <AdminPrimaryButton type="button" onClick={() => navigate("/dashboard/assets")}>
              Go to asset list
            </AdminPrimaryButton>
          </div>
        </AdminPanel>
      ) : null}
    </AdminPage>
  )
}
