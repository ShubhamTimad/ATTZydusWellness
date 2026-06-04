import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { AdminPanel, adminSelectClass } from "@/components/layout/admin-ui"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { AssetDetail } from "@/lib/assets-types"
import {
  ASSET_FIELD_LABELS,
  ASSET_VIEW_PANEL_MIN_HEIGHT,
  isAssetMasterDateField,
} from "@/lib/asset-master-fields"
import type { AssetViewSectionConfig } from "@/lib/asset-master-fields"

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { dateStyle: "medium" })
}

function formatLabel(key: string) {
  return ASSET_FIELD_LABELS[key] ?? key.replace(/_/g, " ")
}

type DetailRow = { label: string; value: React.ReactNode; highlight?: boolean }

function DetailFieldList({
  rows,
  className,
  layout = "inline",
  columns = 1,
  compact = false,
}: {
  rows: DetailRow[]
  className?: string
  layout?: "inline" | "stacked"
  columns?: 1 | 2
  compact?: boolean
}) {
  const rowPadding = compact ? "py-2" : "py-3"
  const cellClass = cn(
    "px-[var(--app-card-padding)]",
    rowPadding,
    layout === "stacked"
      ? "space-y-0.5"
      : "grid grid-cols-1 items-baseline gap-x-3 gap-y-0.5 sm:grid-cols-[minmax(7rem,34%)_1fr]",
  )

  if (columns === 2) {
    return (
      <div
        className={cn(
          "grid grid-cols-1 divide-y divide-border/60 sm:grid-cols-2 sm:divide-y-0",
          className,
        )}
      >
        {rows.map((row) => (
          <div key={row.label} className={cn(cellClass, "border-b border-border/60")}>
            <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
            <dd
              className={cn(
                "text-sm font-medium leading-snug break-words text-foreground",
                row.highlight && "text-primary",
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </div>
    )
  }

  return (
    <dl className={cn("divide-y divide-border/60", className)}>
      {rows.map((row) => (
        <div key={row.label} className={cellClass}>
          <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
          <dd
            className={cn(
              "text-sm font-medium leading-snug break-words text-foreground",
              row.highlight && "text-primary",
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function AssetDetailSectionPanel({
  config,
  title,
  icon: Icon,
  editing,
  asset,
  onSection,
  extra,
  plantName,
  selectOptions = {},
  selectPlaceholders = {},
  inventoryDisplay,
  highlightMismatch,
  fieldLayout = "inline",
  compact = false,
  fieldColumns = 1,
  className,
}: {
  config: AssetViewSectionConfig
  title: string
  icon: LucideIcon
  editing: boolean
  asset: AssetDetail
  onSection: (field: string, value: string | number | null) => void
  extra?: React.ReactNode
  plantName?: string | null
  selectOptions?: Record<string, { value: string; label: string }[]>
  selectPlaceholders?: Record<string, string>
  inventoryDisplay?: (key: string, asset: AssetDetail) => React.ReactNode
  highlightMismatch?: boolean
  /** Stacked label/value rows — better in narrow containers (e.g. approval dialog). */
  fieldLayout?: "inline" | "stacked"
  /** Tighter rows for asset detail viewport layout. */
  compact?: boolean
  /** Two-column field grid in view mode (e.g. financial panel). */
  fieldColumns?: 1 | 2
  className?: string
}) {
  const dateFields = config.dateFields ?? []
  const readOnlyKeys = config.readOnlyKeys ?? []
  const keys = config.keys

  function storageFor(k: string): keyof AssetDetail {
    if (config.rootFields) return "id" // unused; root handled below
    return (config.fieldStorage?.[k] ?? config.id) as keyof AssetDetail
  }

  function fieldValue(k: string): unknown {
    if (k === "asset_category_id") return asset.category_name ?? asset.asset_category_id
    if (config.rootFields) return (asset as Record<string, unknown>)[k]
    const storage = storageFor(k)
    const sec = asset[storage as "information" | "location" | "financial" | "inventory"]
    return (sec as Record<string, unknown> | undefined)?.[k]
  }

  function displayValue(k: string, raw: unknown): React.ReactNode {
    if (inventoryDisplay && config.id === "inventory") {
      return inventoryDisplay(k, asset)
    }
    if (raw === null || raw === undefined || raw === "") return "—"
    if (dateFields.includes(k) || isAssetMasterDateField(k)) return formatDate(String(raw))
    if (k === "asset_category_id") return asset.category_name ?? String(raw)
    if (k === "tag_color_id") {
      return asset.tag_color_name ?? asset.tag_color_code ?? "—"
    }
    return String(raw)
  }

  function readOnlyDisplay(k: string): string {
    if (inventoryDisplay && config.id === "inventory") {
      const node = inventoryDisplay(k, asset)
      return typeof node === "string" ? node : String(node ?? "—")
    }
    if (k === "inventory_count") return "1"
    if (k === "physical_count") {
      const v = asset.inventory?.physical_count
      return v != null ? String(v) : "0"
    }
    if (k === "last_verification_date") {
      const d = asset.inventory?.last_verification_date
      return d ? formatDate(d) : "—"
    }
    const raw = fieldValue(k)
    if (raw === null || raw === undefined || raw === "") return "—"
    if (dateFields.includes(k)) return formatDate(String(raw))
    return String(raw)
  }

  const panelMinHeight = compact ? "min-h-0" : ASSET_VIEW_PANEL_MIN_HEIGHT

  return (
    <AdminPanel
      className={cn("flex h-full flex-col", panelMinHeight, className)}
      contentClassName="flex flex-1 flex-col p-0"
    >
      <div
        className={cn(
          "app-panel-header shrink-0 border-b border-border/60",
          compact ? "py-2" : "py-3",
        )}
      >
        <Icon className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {editing ? (
        <div className="grid gap-[var(--app-form-gap)] p-[var(--app-card-padding)] sm:grid-cols-2 sm:content-start">
          {extra}
          {keys.map((k) => {
            const opts = selectOptions[k]
            const readonly = readOnlyKeys.includes(k)
            const rawVal = fieldValue(k)
            const val = readonly
              ? readOnlyDisplay(k)
              : k === "asset_category_id"
                ? String(asset.asset_category_id ?? "")
                : k === "tag_color_id"
                  ? String(asset.tag_color_id ?? "")
                  : String(rawVal ?? "")
            const mono = k === "asset_code" || k === "rfid_code"
            return (
              <div key={k} className="app-form-field">
                <Label className="app-form-label">{formatLabel(k)}</Label>
                {readonly ? (
                  <Input className="bg-muted/40" value={val} readOnly disabled />
                ) : opts && opts.length > 0 ? (
                  <select
                    className={adminSelectClass}
                    value={val}
                    onChange={(e) =>
                      onSection(
                        k,
                        k === "asset_category_id" || k === "tag_color_id"
                          ? e.target.value
                            ? Number(e.target.value)
                            : null
                          : e.target.value || null,
                      )
                    }
                  >
                    <option value="">{selectPlaceholders[k] ?? "—"}</option>
                    {opts.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : dateFields.includes(k) || isAssetMasterDateField(k) ? (
                  <Input
                    type="date"
                    value={val ? val.slice(0, 10) : ""}
                    onChange={(e) => onSection(k, e.target.value || null)}
                  />
                ) : (
                  <Input
                    className={cn(mono && "font-mono")}
                    value={val}
                    onChange={(e) => onSection(k, e.target.value || null)}
                  />
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <DetailFieldList
          className="flex-1"
          layout={fieldLayout}
          compact={compact}
          columns={fieldColumns}
          rows={[
            ...(config.showPlant && plantName
              ? [{ label: "Plant name", value: plantName }]
              : []),
            ...keys.map((k) => {
              const raw = fieldValue(k)
              const isCount = k === "inventory_count" || k === "physical_count"
              const mismatch = highlightMismatch && isCount && k === "physical_count"
              return {
                label: formatLabel(k),
                value: (
                  <span className={cn(isCount && "tabular-nums")}>{displayValue(k, raw)}</span>
                ),
                highlight: mismatch,
              }
            }),
          ]}
        />
      )}
    </AdminPanel>
  )
}
