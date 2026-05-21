import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { AdminPanel, adminSelectClass } from "@/components/layout/admin-ui"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { AssetDetail } from "@/lib/assets-types"
import { ASSET_FIELD_LABELS, isAssetMasterDateField } from "@/lib/asset-master-fields"
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

function DetailFieldList({ rows, className }: { rows: DetailRow[]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-border/60", className)}>
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[minmax(9rem,34%)_1fr] items-baseline gap-x-4 px-5 py-2.5"
        >
          <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
          <dd
            className={cn(
              "text-sm font-medium leading-snug text-foreground",
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

  return (
    <AdminPanel className={cn(className)} contentClassName="p-0">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-5 py-3">
        <Icon className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {editing ? (
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 sm:content-start">
          {extra}
          {keys.map((k) => {
            const opts = selectOptions[k]
            const readonly = readOnlyKeys.includes(k)
            const rawVal = fieldValue(k)
            const val = readonly
              ? readOnlyDisplay(k)
              : k === "asset_category_id"
                ? String(asset.asset_category_id ?? "")
                : String(rawVal ?? "")
            const mono = k === "asset_code" || k === "rfid_code"
            return (
              <div key={k} className="space-y-1.5">
                <Label className="text-xs">{formatLabel(k)}</Label>
                {readonly ? (
                  <Input className="h-9 bg-muted/40" value={val} readOnly disabled />
                ) : opts && opts.length > 0 ? (
                  <select
                    className={cn(adminSelectClass, "h-9 text-sm")}
                    value={val}
                    onChange={(e) =>
                      onSection(
                        k,
                        k === "asset_category_id"
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
                    className="h-9"
                    type="date"
                    value={val ? val.slice(0, 10) : ""}
                    onChange={(e) => onSection(k, e.target.value || null)}
                  />
                ) : (
                  <Input
                    className={cn("h-9", mono && "font-mono")}
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
