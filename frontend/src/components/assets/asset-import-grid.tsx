import * as React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { AlertCircle } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { adminSelectClass } from "@/components/layout/admin-ui"
import type { AssetImportColumn } from "@/lib/asset-master-fields"
import { isAssetNumberField, sanitizeAssetNumberInput } from "@/lib/asset-master-fields"
import { buildImportGridColumns, useAssetFieldConfig } from "@/lib/use-asset-field-config"

export type ImportGridRow = {
  row_number: number
  valid: boolean
  errors: string[]
  field_errors: Record<string, string>
  duplicate_asset_code: boolean
  duplicate_rfid_code: boolean
  data: Record<string, unknown>
}

const ROW_HEIGHT = 34
const SELECT_WIDTH = 40
const ISSUES_WIDTH = 160

function cellDisplayValue(key: string, data: Record<string, unknown>): string {
  if (key === "inventory_count") return "1"
  const v = data[key]
  if (v === null || v === undefined) return ""
  if (typeof v === "string") return v
  if (typeof v === "number") return String(v)
  return String(v).slice(0, 10)
}

type ImportCellProps = {
  colKey: string
  colKind?: "text" | "date" | "readonly" | "select"
  value: string
  error?: string
  selectOptions?: { value: string; label: string }[]
  onChange: (value: string) => void
}

const ImportCell = React.memo(function ImportCell({
  colKey,
  colKind,
  value,
  error,
  selectOptions = [],
  onChange,
}: ImportCellProps) {
  if (colKind === "readonly") {
    return (
      <div
        className={cn(
          "flex h-8 items-center rounded-sm bg-muted/30 px-2 text-muted-foreground",
          error && "ring-2 ring-destructive/60",
        )}
        title={error}
      >
        {value || "1"}
      </div>
    )
  }

  if (colKind === "select" && selectOptions.length > 0) {
    return (
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          title={error}
          className={cn(
            adminSelectClass,
            "h-8 min-w-[7rem] px-2 text-xs",
            error &&
              "border-destructive/70 bg-destructive/10 text-destructive focus:border-destructive focus:ring-destructive/30",
          )}
        >
          <option value="">—</option>
          {selectOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {error ? (
          <span
            className="pointer-events-none absolute top-0.5 right-0.5 text-destructive"
            title={error}
          >
            <AlertCircle className="size-3" aria-hidden />
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        type={colKind === "date" ? "date" : "text"}
        value={value}
        onChange={(e) =>
          onChange(
            isAssetNumberField(colKey) ? sanitizeAssetNumberInput(e.target.value) : e.target.value,
          )
        }
        title={error}
        className={cn(
          "h-8 w-full min-w-[7rem] rounded-sm border border-transparent bg-background px-2 text-foreground shadow-none outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/30",
          error &&
            "border-destructive/70 bg-destructive/10 text-destructive focus:border-destructive focus:ring-destructive/30",
          (colKey === "asset_code" || colKey === "combined_asset_number" || colKey === "rfid_code") &&
            "font-mono",
          isAssetNumberField(colKey) && "uppercase",
        )}
      />
      {error ? (
        <span
          className="pointer-events-none absolute top-0.5 right-0.5 text-destructive"
          title={error}
        >
          <AlertCircle className="size-3" aria-hidden />
        </span>
      ) : null}
    </div>
  )
})

type VirtualRowProps = {
  row: ImportGridRow
  rowIndex: number
  showSelection: boolean
  selected: boolean
  onSelectChange: (on: boolean) => void
  onCellChange: (rowIndex: number, key: string, value: string) => void
  columnSelectOptions?: Record<string, { value: string; label: string }[]>
  columns: AssetImportColumn[]
  style: React.CSSProperties
}

const VirtualImportRow = React.memo(function VirtualImportRow({
  row,
  rowIndex,
  showSelection,
  selected,
  onSelectChange,
  onCellChange,
  columnSelectOptions,
  columns,
  style,
}: VirtualRowProps) {
  const rowHasError = !row.valid
  const issuesText = row.errors.length > 0 ? row.errors.join(" · ") : row.valid ? "—" : ""

  return (
    <div
      role="row"
      style={style}
      className={cn(
        "absolute left-0 flex w-max min-w-full border-b border-border/40 text-xs",
        rowHasError ? "bg-destructive/[0.04]" : "hover:bg-muted/20",
      )}
    >
      {showSelection ? (
        <div
          className={cn(
            "sticky left-0 z-[2] flex h-[34px] shrink-0 items-center justify-center border-r border-border/50 bg-card",
            rowHasError && "bg-destructive/[0.06]",
          )}
          style={{ width: SELECT_WIDTH }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="presentation"
        >
          <Checkbox
            checked={selected}
            onCheckedChange={(on) => onSelectChange(Boolean(on))}
            aria-label={`Select row ${row.row_number}`}
          />
        </div>
      ) : null}
      <div
        className={cn(
          "sticky z-[1] flex h-[34px] w-10 shrink-0 items-center border-r border-border/50 bg-card px-2 tabular-nums text-muted-foreground",
          rowHasError && "bg-destructive/[0.06]",
        )}
        style={showSelection ? { left: SELECT_WIDTH } : undefined}
      >
        {row.row_number}
      </div>
      {columns.map((col) => (
        <div
          key={col.key}
          className="shrink-0 px-0.5 py-0.5"
          style={{ width: col.kind === "date" ? 128 : 120 }}
        >
          <ImportCell
            colKey={col.key}
            colKind={col.kind}
            value={cellDisplayValue(col.key, row.data)}
            error={row.field_errors[col.key]}
            selectOptions={columnSelectOptions?.[col.key]}
            onChange={(v) => onCellChange(rowIndex, col.key, v)}
          />
        </div>
      ))}
      <div
        className="flex h-[34px] shrink-0 items-center px-2 text-[11px] text-destructive"
        style={{ width: ISSUES_WIDTH }}
        title={issuesText}
      >
        <span className="line-clamp-2">{issuesText}</span>
      </div>
    </div>
  )
})

export type AssetImportGridProps = {
  rows: ImportGridRow[]
  onCellChange: (rowIndex: number, key: string, value: string) => void
  columnSelectOptions?: Record<string, { value: string; label: string }[]>
  selectedRowNumbers?: Set<number>
  onSelectedRowNumbersChange?: (next: Set<number>) => void
  errorsOnly?: boolean
  search?: string
  /** Fill parent flex area instead of a fixed viewport height. */
  fillContainer?: boolean
  className?: string
}

export function AssetImportGrid({
  rows,
  onCellChange,
  columnSelectOptions,
  selectedRowNumbers,
  onSelectedRowNumbersChange,
  errorsOnly = false,
  search = "",
  fillContainer = false,
  className,
}: AssetImportGridProps) {
  const parentRef = React.useRef<HTMLDivElement>(null)
  const deferredRows = React.useDeferredValue(rows)
  const { config } = useAssetFieldConfig()
  const columns = React.useMemo(() => buildImportGridColumns(config), [config])

  const filteredIndices = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const out: number[] = []
    for (let i = 0; i < deferredRows.length; i += 1) {
      const row = deferredRows[i]
      if (errorsOnly && row.valid) continue
      if (q) {
        const code = String(row.data.asset_code ?? "").toLowerCase()
        const name = String(row.data.asset_name ?? "").toLowerCase()
        const rfid = String(row.data.rfid_code ?? "").toLowerCase()
        const num = String(row.row_number)
        if (!code.includes(q) && !name.includes(q) && !rfid.includes(q) && !num.includes(q)) {
          continue
        }
      }
      out.push(i)
    }
    return out
  }, [deferredRows, errorsOnly, search])

  const rowVirtualizer = useVirtualizer({
    count: filteredIndices.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const onCellChangeStable = React.useCallback(
    (rowIndex: number, key: string, value: string) => {
      onCellChange(rowIndex, key, value)
    },
    [onCellChange],
  )

  const showSelection = selectedRowNumbers != null && onSelectedRowNumbersChange != null
  const visibleRowNumbers = React.useMemo(
    () => filteredIndices.map((i) => deferredRows[i]?.row_number).filter((n): n is number => n != null),
    [filteredIndices, deferredRows],
  )
  const allVisibleSelected =
    showSelection &&
    visibleRowNumbers.length > 0 &&
    visibleRowNumbers.every((n) => selectedRowNumbers!.has(n))

  function toggleVisibleRows(on: boolean) {
    if (!onSelectedRowNumbersChange || !selectedRowNumbers) return
    const next = new Set(selectedRowNumbers)
    for (const rowNumber of visibleRowNumbers) {
      if (on) next.add(rowNumber)
      else next.delete(rowNumber)
    }
    onSelectedRowNumbersChange(next)
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col rounded-md border border-border/80 bg-card",
        fillContainer && "flex-1",
        className,
      )}
    >
      <div
        ref={parentRef}
        className={cn(
          "min-h-0 overflow-auto overscroll-contain",
          fillContainer ? "flex-1" : "h-[min(70vh,720px)]",
        )}
      >
        <div className="sticky top-0 z-[2] flex w-max min-w-full border-b border-border/60 bg-muted">
          {showSelection ? (
            <div
              className="sticky left-0 z-[4] flex h-9 shrink-0 items-center justify-center border-r border-border/60 bg-muted"
              style={{ width: SELECT_WIDTH }}
            >
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={(on) => toggleVisibleRows(Boolean(on))}
                aria-label="Select all visible rows"
              />
            </div>
          ) : null}
          <div
            className="sticky z-[3] flex h-9 w-10 shrink-0 items-center border-r border-border/60 bg-muted px-2 text-xs font-semibold text-muted-foreground"
            style={{ left: showSelection ? SELECT_WIDTH : 0 }}
          >
            #
          </div>
          {columns.map((col) => (
            <div
              key={col.key}
              className="flex h-9 shrink-0 items-center px-2 text-xs font-semibold text-foreground"
              style={{ width: col.kind === "date" ? 128 : 120 }}
            >
              {col.required ? (
                <>
                  {col.label}
                  <span className="text-destructive"> *</span>
                </>
              ) : (
                col.label
              )}
            </div>
          ))}
          <div
            className="flex h-9 shrink-0 items-center px-2 text-xs font-semibold text-muted-foreground"
            style={{ width: ISSUES_WIDTH }}
          >
            Issues
          </div>
        </div>

        <div
          className="relative w-max min-w-full"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const rowIndex = filteredIndices[virtualRow.index]
            const row = deferredRows[rowIndex]
            if (!row) return null
            return (
              <VirtualImportRow
                key={row.row_number}
                row={row}
                rowIndex={rowIndex}
                showSelection={showSelection}
                selected={showSelection ? selectedRowNumbers!.has(row.row_number) : false}
                onSelectChange={(on) => {
                  if (!onSelectedRowNumbersChange || !selectedRowNumbers) return
                  const next = new Set(selectedRowNumbers)
                  if (on) next.add(row.row_number)
                  else next.delete(row.row_number)
                  onSelectedRowNumbersChange(next)
                }}
                onCellChange={onCellChangeStable}
                columnSelectOptions={columnSelectOptions}
                columns={columns}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              />
            )
          })}
        </div>

        {filteredIndices.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No rows match the current filter.
          </p>
        ) : null}
      </div>
    </div>
  )
}
