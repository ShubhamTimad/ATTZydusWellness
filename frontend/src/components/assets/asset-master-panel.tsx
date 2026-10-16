import * as React from "react"
import { Package } from "lucide-react"

import { AdminPanel, adminSelectClass, AutoGrowTextarea } from "@/components/layout/admin-ui"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { AssetDetail } from "@/lib/assets-types"
import {
  ASSET_MASTER_FIELDS,
  assetMasterFieldValue,
  blockNonNegativeNumberKeys,
  isAssetMasterDateField,
  isAssetMasterNumberField,
  isAssetNumberField,
  sanitizeAssetNumberInput,
  sanitizeNonNegativeNumericInput,
  type AssetMasterFieldDef,
} from "@/lib/asset-master-fields"
import type { CategoryMaster, CostCenterMaster, PlantOption } from "@/lib/masters-types"
import { categoryLabel, costCenterLabel, plantLabel } from "@/lib/use-asset-masters"
import { formatAppDate as formatDate } from "@/lib/dates"

function displayValue(def: AssetMasterFieldDef, asset: AssetDetail): React.ReactNode {
  if (def.key === "inventory_count") return "1"
  const raw = assetMasterFieldValue(asset, def)
  if (raw === null || raw === undefined || raw === "") return "—"
  if (isAssetMasterDateField(def.key)) return formatDate(String(raw))
  return String(raw)
}

type DetailRow = { label: string; value: React.ReactNode }

function DetailFieldList({ rows }: { rows: DetailRow[] }) {
  return (
    <dl className="divide-y divide-border/60">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid grid-cols-[minmax(9rem,34%)_1fr] items-baseline gap-x-4 px-5 py-2.5"
        >
          <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
          <dd className="text-sm font-medium leading-snug text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function AssetMasterPanel({
  asset,
  editing,
  onRoot,
  onLocation,
  onFinancial,
  categories,
  plants,
  costCenters,
  plantId,
}: {
  asset: AssetDetail
  editing: boolean
  onRoot: (key: string, value: string | number | null) => void
  onLocation: (key: string, value: string | number | null) => void
  onFinancial: (key: string, value: string | number | null) => void
  categories: CategoryMaster[]
  plants: PlantOption[]
  costCenters: CostCenterMaster[]
  plantId: number | null
}) {
  const viewRows = ASSET_MASTER_FIELDS.map((def) => ({
    label: def.label,
    value: displayValue(def, asset),
  }))

  return (
    <AdminPanel className="lg:col-span-2" contentClassName="p-0">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-5 py-3">
        <Package className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">Asset master</h3>
      </div>
      {editing ? (
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {ASSET_MASTER_FIELDS.map((def) => (
            <FieldEditor
              key={def.key}
              def={def}
              asset={asset}
              onRoot={onRoot}
              onLocation={onLocation}
              onFinancial={onFinancial}
              categories={categories}
              plants={plants}
              costCenters={costCenters}
              plantId={plantId}
            />
          ))}
        </div>
      ) : (
        <DetailFieldList rows={viewRows} />
      )}
    </AdminPanel>
  )
}

function FieldEditor({
  def,
  asset,
  onRoot,
  onLocation,
  onFinancial,
  categories,
  plants,
  costCenters,
  plantId,
}: {
  def: AssetMasterFieldDef
  asset: AssetDetail
  onRoot: (key: string, value: string | number | null) => void
  onLocation: (key: string, value: string | number | null) => void
  onFinancial: (key: string, value: string | number | null) => void
  categories: CategoryMaster[]
  plants: PlantOption[]
  costCenters: CostCenterMaster[]
  plantId: number | null
}) {
  const readonly = def.readonly || def.kind === "readonly"

  function sectionValue(): string {
    if (def.section === "root") {
      const v = (asset as Record<string, unknown>)[def.key]
      return v != null ? String(v) : ""
    }
    const sec = asset[def.section] as Record<string, unknown> | undefined
    const v = sec?.[def.key]
    return v != null ? String(v) : ""
  }

  function setValue(value: string | number | null) {
    if (def.section === "root") onRoot(def.key, value)
    else if (def.section === "location") onLocation(def.key, value)
    else onFinancial(def.key, value)
  }

  if (readonly) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{def.label}</Label>
        <Input className="h-9 bg-muted/40" value="1" readOnly disabled />
      </div>
    )
  }

  if (def.kind === "category") {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{def.label}</Label>
        <select
          className={cn(adminSelectClass, "h-9 text-sm")}
          value={asset.asset_category_id ?? ""}
          onChange={(e) =>
            onRoot("asset_category_id", e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (def.kind === "plant") {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{def.label}</Label>
        <select
          className={cn(adminSelectClass, "h-9 text-sm")}
          value={asset.location?.plant_id ?? ""}
          onChange={(e) =>
            onLocation("plant_id", e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">—</option>
          {plants.map((p) => (
            <option key={p.id} value={p.id}>
              {plantLabel(p)}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (def.kind === "cost_center") {
    const val = asset.financial?.cost_center ?? ""
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{def.label}</Label>
        <select
          className={cn(adminSelectClass, "h-9 text-sm")}
          value={val}
          onChange={(e) => onFinancial("cost_center", e.target.value || null)}
        >
          <option value="">{plantId ? "—" : "Select plant first"}</option>
          {costCenters.map((m) => (
            <option key={m.id} value={m.code}>
              {costCenterLabel(m)}
            </option>
          ))}
        </select>
      </div>
    )
  }

  const val = sectionValue()
  const dateField = def.kind === "date" || isAssetMasterDateField(def.key)
  const numberField = isAssetMasterNumberField(def.key)

  if (def.kind === "textarea") {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{def.label}</Label>
        <AutoGrowTextarea
          value={val}
          placeholder={
            def.key === "asset_description"
              ? "Detailed description of this asset…"
              : def.key === "remark"
                ? "Detailed remarks about this asset…"
                : undefined
          }
          onChange={(next) => setValue(next || null)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{def.label}</Label>
      <Input
        className={cn("h-9", def.key === "asset_code" || def.key === "rfid_code" ? "font-mono" : undefined)}
        type={dateField ? "date" : numberField ? "number" : "text"}
        min={numberField ? 0 : undefined}
        step={numberField ? (def.key === "life_span" ? "1" : "any") : undefined}
        inputMode={numberField ? (def.key === "life_span" ? "numeric" : "decimal") : undefined}
        value={dateField && val ? val.slice(0, 10) : val}
        onKeyDown={numberField ? blockNonNegativeNumberKeys : undefined}
        onChange={(e) =>
          setValue(
            numberField
              ? sanitizeNonNegativeNumericInput(e.target.value, def.key === "life_span") || null
              : isAssetNumberField(def.key)
                ? sanitizeAssetNumberInput(e.target.value) || null
                : e.target.value || null,
          )
        }
      />
    </div>
  )
}
