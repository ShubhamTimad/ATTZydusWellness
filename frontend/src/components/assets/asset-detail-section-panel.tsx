import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { TagColorPicker, TagColorSwatch } from "@/components/assets/tag-color-select"
import { AdminPanel, adminSelectClass, AutoGrowTextarea } from "@/components/layout/admin-ui"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { AssetDetail } from "@/lib/assets-types"
import type { TagColorMaster } from "@/lib/masters-types"
import { RequiredFieldMark } from "@/components/assets/required-field-mark"
import {
  ASSET_FIELD_LABELS,
  ASSET_MASTER_FIELDS,
  ASSET_VIEW_PANEL_MIN_HEIGHT,
  blockNonNegativeNumberKeys,
  isAssetMasterDateField,
  isAssetMasterNumberField,
  isAssetNumberField,
  sanitizeAssetNumberInput,
  sanitizeNonNegativeNumericInput,
} from "@/lib/asset-master-fields"
import type { AssetViewSectionConfig } from "@/lib/asset-master-fields"
import { useAssetFieldConfig } from "@/lib/use-asset-field-config"

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { dateStyle: "medium" })
}

export function AssetDetailSectionPanel({
  config,
  title,
  icon: Icon,
  editing,
  asset,
  onSection,
  extra,
  extraAfterFirst,
  extraAfterKeys,
  extraEnd,
  plantCode,
  plantName,
  selectOptions = {},
  selectPlaceholders = {},
  selectDisabled = {},
  tagColors = [],
  inventoryDisplay,
  highlightMismatch,
  compact = false,
  className,
}: {
  config: AssetViewSectionConfig
  title: string
  icon: LucideIcon
  editing: boolean
  asset: AssetDetail
  onSection: (field: string, value: string | number | null) => void
  extra?: React.ReactNode
  extraAfterFirst?: React.ReactNode
  /** Inserted immediately after the named field (e.g. CapEx after custodian). */
  extraAfterKeys?: Record<string, React.ReactNode>
  /** Rendered after all section fields. */
  extraEnd?: React.ReactNode
  plantCode?: string | null
  plantName?: string | null
  selectOptions?: Record<string, { value: string; label: string }[]>
  selectPlaceholders?: Record<string, string>
  selectDisabled?: Record<string, boolean>
  tagColors?: TagColorMaster[]
  inventoryDisplay?: (key: string, asset: AssetDetail) => React.ReactNode
  highlightMismatch?: boolean
  /** @deprecated View mode always uses stacked form layout. */
  fieldLayout?: "inline" | "stacked"
  compact?: boolean
  /** @deprecated View mode always uses 2-column form grid. */
  fieldColumns?: 1 | 2
  className?: string
}) {
  const { getLabel, isRequired, filterVisibleKeys, isVisible } = useAssetFieldConfig()
  const dateFields = config.dateFields ?? []
  const readOnlyKeys = config.readOnlyKeys ?? []
  const keys = filterVisibleKeys(config.keys)
  const textareaKeys = React.useMemo(
    () =>
      new Set(
        ASSET_MASTER_FIELDS.filter((f) => f.kind === "textarea").map((f) => f.key),
      ),
    [],
  )

  function formatFieldLabel(key: string) {
    return getLabel(key, ASSET_FIELD_LABELS[key] ?? key.replace(/_/g, " "))
  }

  function storageFor(k: string): keyof AssetDetail {
    if (config.rootFields) return "id" // unused; root handled below
    return (config.fieldStorage?.[k] ?? config.id) as keyof AssetDetail
  }

  function fieldValue(k: string): unknown {
    if (k === "asset_category_id") return asset.category_name ?? asset.asset_category_id
    const storageOverride = config.fieldStorage?.[k]
    if (storageOverride) {
      const sec = asset[storageOverride as "information" | "location" | "financial" | "inventory"]
      return (sec as Record<string, unknown> | undefined)?.[k]
    }
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
      if (!asset.tag_color_id && !asset.tag_color_hex) return "—"
      return <TagColorSwatch colorHex={asset.tag_color_hex} />
    }
    if (k === "asset_custodian_id") {
      return asset.asset_custodian_name ?? asset.asset_custodian_code ?? "—"
    }
    if (k === "asset_condition_id") {
      return asset.asset_condition_name ?? asset.asset_condition_code ?? "—"
    }
    if (k === "asset_class_id") {
      return asset.asset_class_name ?? asset.asset_class_code ?? asset.asset_class ?? "—"
    }
    if (k === "functional_location") {
      return asset.location?.functional_location_name ?? String(raw)
    }
    if (k === "actual_location") {
      return asset.location?.actual_location_name ?? String(raw)
    }
    if (k === "cost_center") {
      return String(raw)
    }
    if (k === "cost_center_name") {
      return asset.financial?.cost_center_name ?? "—"
    }
    if (k === "profit_center") {
      return asset.financial?.profit_center_name ?? String(raw)
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
    if (k === "fy_verification_count") {
      const count = asset.fy_verification_count ?? 0
      return asset.financial_year_label ? `${count} (${asset.financial_year_label})` : String(count)
    }
    if (k === "cost_center_name") {
      return asset.financial?.cost_center_name ?? "—"
    }
    const raw = fieldValue(k)
    if (raw === null || raw === undefined || raw === "") return "—"
    if (dateFields.includes(k)) return formatDate(String(raw))
    return String(raw)
  }

  const panelMinHeight = compact ? "min-h-0" : ASSET_VIEW_PANEL_MIN_HEIGHT
  const gridKeys = keys.filter((k) => !textareaKeys.has(k))
  const multilineKeys = keys.filter((k) => textareaKeys.has(k))

  const cellProps = {
    asset,
    formatFieldLabel,
    isRequired,
    readOnlyKeys,
    dateFields,
    selectOptions,
    selectPlaceholders,
    selectDisabled,
    tagColors,
    inventoryDisplay,
    configId: config.id,
    fieldValue,
    readOnlyDisplay,
    onSection,
    textareaKeys,
  } as const

  return (
    <AdminPanel
      className={cn(
        // Side-by-side Financial|Location: h-full fills the grid row.
        // Information is full-width — grow with content (no h-full / min-h squeeze).
        "flex flex-col overflow-visible",
        config.id !== "information" && "h-full",
        config.id !== "information" && panelMinHeight,
        className,
      )}
      contentClassName="overflow-visible p-0"
    >
      <div
        className={cn(
          "app-panel-header shrink-0 justify-start border-b border-border/70 bg-muted/20",
          compact ? "py-2" : "py-3",
        )}
      >
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-primary" aria-hidden />
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
        </div>
      </div>
      {editing ? (
        <div className="overflow-visible">
          <div
            className={cn(
              "grid gap-[var(--app-form-gap)] p-[var(--app-card-padding)] sm:grid-cols-2 sm:content-start",
              config.id === "information" && "lg:grid-cols-3",
              multilineKeys.length > 0 && "pb-0",
            )}
          >
            {extra}
            {gridKeys.map((k, index) => {
              // Already rendered on the previous field's CapEx (etc.) trio row.
              if (extraAfterKeys?.[k] && index > 0) {
                return null
              }

              const nextKey = gridKeys[index + 1]
              const afterOnNext = nextKey ? extraAfterKeys?.[nextKey] : undefined
              // Condition + Custodian + CapEx on one row when CapEx is attached to custodian.
              if (afterOnNext && nextKey) {
                return (
                  <div
                    key={`${k}-${nextKey}`}
                    className={cn(
                      "grid gap-[var(--app-form-gap)] sm:col-span-2 sm:grid-cols-2",
                      config.id === "information" && "lg:col-span-3 lg:grid-cols-3",
                    )}
                  >
                    <EditFieldCell fieldKey={k} {...cellProps} />
                    <EditFieldCell fieldKey={nextKey} {...cellProps} />
                    {afterOnNext}
                  </div>
                )
              }

              const after = extraAfterKeys?.[k]
              if (after) {
                return (
                  <div
                    key={k}
                    className={cn(
                      "grid gap-[var(--app-form-gap)] sm:col-span-2 sm:grid-cols-2",
                      config.id === "information" && "lg:col-span-3",
                    )}
                  >
                    <EditFieldCell fieldKey={k} {...cellProps} />
                    {after}
                  </div>
                )
              }

              return (
                <React.Fragment key={k}>
                  <EditFieldCell fieldKey={k} {...cellProps} />
                  {index === 0 ? extraAfterFirst : null}
                </React.Fragment>
              )
            })}
            {extraEnd}
          </div>
          {multilineKeys.length > 0 ? (
            <div
              className={cn(
                "grid gap-[var(--app-form-gap)] px-[var(--app-card-padding)] pb-[var(--app-card-padding)] pt-[var(--app-form-gap)] sm:grid-cols-2",
              )}
            >
              {multilineKeys.map((gk) => (
                <EditFieldCell key={gk} fieldKey={gk} {...cellProps} />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div
          className={cn(
            "grid content-start gap-x-6 gap-y-0 px-4 py-2 sm:grid-cols-2",
            config.id === "information" && "lg:grid-cols-3",
          )}
        >
          {extra}
          {config.showPlant && plantCode && isVisible("plant_code") ? (
            <div className="min-w-0 border-b border-border/60 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-foreground">
                Plant Code
              </p>
              <p className="mt-1 font-mono text-xs font-normal leading-snug break-words text-foreground">
                {plantCode}
              </p>
            </div>
          ) : null}
          {keys.map((k, index) => {
            const raw = fieldValue(k)
            const isCount = k === "inventory_count" || k === "physical_count"
            const mono = k === "asset_code" || k === "combined_asset_number" || k === "rfid_code"
            const multiline = textareaKeys.has(k)
            const display = displayValue(k, raw)
            return (
              <React.Fragment key={k}>
                <div className="min-w-0 border-b border-border/60 py-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-foreground">
                    {formatFieldLabel(k)}
                  </p>
                  <div
                    className={cn(
                      "mt-1 text-sm font-normal leading-snug break-words text-foreground",
                      mono && "font-mono text-xs",
                      isCount && "tabular-nums",
                      multiline && "whitespace-pre-wrap",
                      highlightMismatch && isCount && k === "physical_count" && "text-primary",
                    )}
                  >
                    {inventoryDisplay && config.id === "inventory"
                      ? inventoryDisplay(k, asset)
                      : display}
                  </div>
                </div>
                {index === 0 && config.showPlant && plantName && isVisible("plant_id") ? (
                  <div className="min-w-0 border-b border-border/60 py-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-foreground">
                      Plant Name
                    </p>
                    <p className="mt-1 text-sm font-normal leading-snug break-words text-foreground">
                      {plantName}
                    </p>
                  </div>
                ) : null}
                {extraAfterKeys?.[k] ?? null}
              </React.Fragment>
            )
          })}
          {extraEnd}
        </div>
      )}
    </AdminPanel>
  )
}

function EditFieldCell({
  fieldKey: k,
  asset,
  formatFieldLabel,
  isRequired,
  readOnlyKeys,
  dateFields,
  selectOptions,
  selectPlaceholders,
  selectDisabled,
  tagColors,
  inventoryDisplay,
  configId,
  fieldValue,
  readOnlyDisplay,
  onSection,
  textareaKeys,
}: {
  fieldKey: string
  asset: AssetDetail
  formatFieldLabel: (key: string) => string
  isRequired: (key: string) => boolean
  readOnlyKeys: string[]
  dateFields: string[]
  selectOptions: Record<string, { value: string; label: string }[]>
  selectPlaceholders: Record<string, string>
  selectDisabled: Record<string, boolean>
  tagColors: TagColorMaster[]
  inventoryDisplay?: (key: string, asset: AssetDetail) => React.ReactNode
  configId: string
  fieldValue: (k: string) => unknown
  readOnlyDisplay: (k: string) => string
  onSection: (field: string, value: string | number | null) => void
  textareaKeys: Set<string>
}) {
  const opts = selectOptions[k]
  const hasSelect = Object.prototype.hasOwnProperty.call(selectOptions, k)
  const readonly = readOnlyKeys.includes(k)
  const rawVal = fieldValue(k)
  const val = readonly
    ? readOnlyDisplay(k)
    : k === "asset_category_id"
      ? String(asset.asset_category_id ?? "")
      : k === "tag_color_id"
        ? String(asset.tag_color_id ?? "")
        : k === "asset_custodian_id"
          ? String(asset.asset_custodian_id ?? "")
          : k === "asset_condition_id"
            ? String(asset.asset_condition_id ?? "")
            : k === "asset_class_id"
              ? String(asset.asset_class_id ?? "")
              : k === "cost_center_name" && hasSelect
                ? String(asset.financial?.cost_center ?? "")
                : String(rawVal ?? "")
  const mono = k === "asset_code" || k === "combined_asset_number" || k === "rfid_code"
  const multiline = textareaKeys.has(k)
  const fullWidth = k === "asset_name"

  return (
    <div className={cn("app-form-field", fullWidth && "sm:col-span-2")}>
      <Label className="app-form-label">
        {formatFieldLabel(k)}
        {isRequired(k) ? <RequiredFieldMark /> : null}
      </Label>
      {readonly ? (
        inventoryDisplay && configId === "inventory" ? (
          <div className="flex min-h-9 items-center rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">
            {inventoryDisplay(k, asset)}
          </div>
        ) : (
          <Input className="bg-muted/40" value={val} readOnly disabled />
        )
      ) : k === "tag_color_id" && tagColors.length > 0 ? (
        <TagColorPicker
          id={`asset-field-${k}`}
          value={val}
          tagColors={tagColors}
          onChange={(next) => onSection(k, next ? Number(next) : null)}
        />
      ) : hasSelect ? (
        <select
          className={adminSelectClass}
          value={val}
          disabled={Boolean(selectDisabled[k])}
          onChange={(e) =>
            onSection(
              k,
              k === "asset_category_id" ||
                k === "tag_color_id" ||
                k === "asset_custodian_id" ||
                k === "asset_condition_id" ||
                k === "asset_class_id"
                ? e.target.value
                  ? Number(e.target.value)
                  : null
                : e.target.value || null,
            )
          }
        >
          <option value="">{selectPlaceholders[k] ?? "—"}</option>
          {(opts ?? []).map((o) => (
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
      ) : isAssetMasterNumberField(k) ? (
        <Input
          type="number"
          min={0}
          step={k === "life_span" ? "1" : "any"}
          inputMode={k === "life_span" ? "numeric" : "decimal"}
          value={val}
          onKeyDown={blockNonNegativeNumberKeys}
          onChange={(e) =>
            onSection(
              k,
              sanitizeNonNegativeNumericInput(e.target.value, k === "life_span") || null,
            )
          }
        />
      ) : multiline ? (
        <AutoGrowTextarea
          id={`asset-field-${k}`}
          value={val}
          placeholder={
            k === "asset_description"
              ? "Detailed description of this asset…"
              : k === "remark"
                ? "Detailed remarks about this asset…"
                : undefined
          }
          onChange={(next) => onSection(k, next || null)}
        />
      ) : (
        <Input
          className={cn(mono && "font-mono", isAssetNumberField(k) && "uppercase")}
          value={val}
          onChange={(e) =>
            onSection(
              k,
              isAssetNumberField(k)
                ? sanitizeAssetNumberInput(e.target.value) || null
                : e.target.value || null,
            )
          }
        />
      )}
    </div>
  )
}
