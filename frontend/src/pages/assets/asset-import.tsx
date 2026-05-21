import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import { AdminPanel, AdminPrimaryButton } from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { API_BASE_URL } from "@/lib/api"

type PreviewRow = {
  row_number: number
  valid: boolean
  errors: string[]
  duplicate_asset_code: boolean
  data: Record<string, unknown>
}

type PreviewResponse = {
  filename: string | null
  total_rows: number
  valid_rows: number
  error_rows: number
  rows: PreviewRow[]
}

function getToken() {
  try {
    return localStorage.getItem("access_token")
  } catch {
    return null
  }
}

export function AssetImportPage() {
  const navigate = useNavigate()
  const [file, setFile] = React.useState<File | null>(null)
  const [preview, setPreview] = React.useState<PreviewResponse | null>(null)
  const [step, setStep] = React.useState<"upload" | "preview" | "done">("upload")
  const [loading, setLoading] = React.useState(false)
  const [result, setResult] = React.useState<{ created_count: number; pending_approval: boolean } | null>(null)

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
      if (!res.ok) throw new Error((data as { detail?: string })?.detail ?? "Preview failed")
      setPreview(data)
      setStep("preview")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed")
    } finally {
      setLoading(false)
    }
  }

  async function confirmImport() {
    if (!preview) return
    const validRows = preview.rows.filter((r) => r.valid).map((r) => r.data)
    if (validRows.length === 0) {
      toast.error("No valid rows to import.")
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
          rows: validRows,
          filename: preview.filename,
          initiate_approval: true,
        }),
      })
      const text = await res.text()
      const data = text ? JSON.parse(text) : {}
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
              {loading ? "Validating…" : "Preview import"}
            </AdminPrimaryButton>
          </div>
        </AdminPanel>
      ) : null}

      {step === "preview" && preview ? (
        <AdminPanel
          title="Preview"
          description={`${preview.valid_rows} valid · ${preview.error_rows} errors · ${preview.total_rows} total`}
        >
          <div className="max-h-96 overflow-auto px-2 pb-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((r) => (
                  <TableRow key={r.row_number}>
                    <TableCell>{r.row_number}</TableCell>
                    <TableCell className="font-mono text-xs">{String(r.data.asset_code ?? "")}</TableCell>
                    <TableCell>{String(r.data.asset_name ?? "")}</TableCell>
                    <TableCell className="text-xs">
                      {r.valid ? (
                        <span className="text-primary">Valid</span>
                      ) : (
                        <span className="text-destructive">{r.errors.join("; ")}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-end gap-2 border-t border-border/60 px-4 py-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setStep("upload")}>
              Back
            </Button>
            <AdminPrimaryButton type="button" disabled={loading} onClick={() => void confirmImport()}>
              {loading ? "Importing…" : "Confirm import"}
            </AdminPrimaryButton>
          </div>
        </AdminPanel>
      ) : null}

      {step === "done" && result ? (
        <AdminPanel title="Import complete">
          <div className="dialog-body space-y-3">
            <p className="text-sm">
              Created <strong>{result.created_count}</strong> assets.
              {result.pending_approval ? " They are pending approval." : " They are active."}
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
