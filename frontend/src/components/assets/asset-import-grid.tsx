import { AlertCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import { ASSET_IMPORT_GRID_COLUMNS } from "@/lib/asset-master-fields"

export type ImportGridRow = {
  row_number: number
  valid: boolean
  errors: string[]
  field_errors: Record<string, string>
  duplicate_asset_code: boolean
  duplicate_rfid_code: boolean
  data: Record<string, unknown>
}

function cellDisplayValue(key: string, data: Record<string, unknown>): string {
  if (key === "inventory_count") return "1"
  const v = data[key]
  if (v === null || v === undefined) return ""
  if (typeof v === "string") return v
  if (typeof v === "number") return String(v)
  return String(v).slice(0, 10)
}

function cellEditValue(key: string, data: Record<string, unknown>): string {
  if (key === "inventory_count") return "1"
  return cellDisplayValue(key, data)
}

export function AssetImportGrid({
  rows,
  onChange,
}: {
  rows: ImportGridRow[]
  onChange: (rows: ImportGridRow[]) => void
}) {
  const updateCell = (rowIndex: number, key: string, value: string) => {
    onChange(
      rows.map((row, i) => {
        if (i !== rowIndex) return row
        const next = { ...row.data }
        if (!value.trim()) {
          delete next[key]
        } else {
          next[key] = value
        }
        return {
          ...row,
          valid: false,
          errors: [],
          field_errors: {},
          data: next,
        }
      }),
    )
  }

  return (
    <div className="overflow-auto rounded-md border border-border/80 bg-card">
      <table className="min-w-max border-collapse text-left text-xs">
        <thead className="sticky top-0 z-[2] bg-muted/90 backdrop-blur-sm">
          <tr>
            <th className="sticky left-0 z-[3] min-w-[2.5rem] border-b border-r border-border/60 bg-muted/95 px-2 py-2 font-semibold text-muted-foreground">
              #
            </th>
            {ASSET_IMPORT_GRID_COLUMNS.map((col) => (
              <th
                key={col.key}
                className="min-w-[7.5rem] whitespace-nowrap border-b border-border/60 px-2 py-2 font-semibold text-foreground"
              >
                {col.label}
              </th>
            ))}
            <th className="min-w-[10rem] border-b border-border/60 px-2 py-2 font-semibold text-muted-foreground">
              Issues
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const rowHasError = !row.valid
            return (
              <tr
                key={row.row_number}
                className={cn(
                  "border-b border-border/40",
                  rowHasError ? "bg-destructive/[0.04]" : "hover:bg-muted/20",
                )}
              >
                <td
                  className={cn(
                    "sticky left-0 z-[1] border-r border-border/50 bg-card px-2 py-1 tabular-nums text-muted-foreground",
                    rowHasError && "bg-destructive/[0.06]",
                  )}
                >
                  {row.row_number}
                </td>
                {ASSET_IMPORT_GRID_COLUMNS.map((col) => {
                  const err = row.field_errors[col.key]
                  const readonly = col.kind === "readonly"
                  const val = cellEditValue(col.key, row.data)
                  return (
                    <td key={col.key} className="p-0 align-top">
                      <div className="relative px-0.5 py-0.5">
                        {readonly ? (
                          <div
                            className={cn(
                              "flex h-8 items-center rounded-sm bg-muted/30 px-2 text-muted-foreground",
                              err && "ring-2 ring-destructive/60",
                            )}
                            title={err}
                          >
                            {val || "1"}
                          </div>
                        ) : (
                          <input
                            type={col.kind === "date" ? "date" : "text"}
                            value={val}
                            onChange={(e) => updateCell(rowIndex, col.key, e.target.value)}
                            title={err ?? undefined}
                            className={cn(
                              "h-8 w-full min-w-[7rem] rounded-sm border border-transparent bg-background px-2 text-foreground shadow-none outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/30",
                              err &&
                                "border-destructive/70 bg-destructive/10 text-destructive focus:border-destructive focus:ring-destructive/30",
                              col.key === "asset_code" || col.key === "rfid_code"
                                ? "font-mono"
                                : undefined,
                            )}
                          />
                        )}
                        {err ? (
                          <span
                            className="pointer-events-none absolute top-0.5 right-0.5 text-destructive"
                            title={err}
                          >
                            <AlertCircle className="size-3" aria-hidden />
                          </span>
                        ) : null}
                      </div>
                    </td>
                  )
                })}
                <td className="px-2 py-1.5 align-top text-[11px] text-destructive">
                  {row.errors.length > 0 ? row.errors.join(" · ") : row.valid ? "—" : ""}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
