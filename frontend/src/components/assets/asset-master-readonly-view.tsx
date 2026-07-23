import * as React from "react"
import { ClipboardList, DollarSign, MapPin, Package } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { AssetDetailSectionPanel } from "@/components/assets/asset-detail-section-panel"
import type { AssetDetail } from "@/lib/assets-types"
import {
  ASSET_VIEW_SECTIONS,
  type AssetViewSectionConfig,
  type AssetViewSectionId,
} from "@/lib/asset-master-fields"
import { renderPhysicalOrderInventoryField } from "@/lib/asset-physical-order-display"
import { assetStatusLabel } from "@/lib/asset-lifecycle"
import { cn } from "@/lib/utils"

const SECTION_ICONS: Record<string, LucideIcon> = {
  information: Package,
  location: MapPin,
  financial: DollarSign,
  inventory: ClipboardList,
}

const noop = () => {}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { dateStyle: "medium" })
}

type SummaryItem = { label: string; value: React.ReactNode; mono?: boolean }

function SummaryStrip({ items }: { items: SummaryItem[] }) {
  return (
    <div className="app-panel overflow-x-auto overscroll-x-contain">
      <div className="flex min-w-full flex-nowrap divide-x divide-border/60">
        {items.map((item) => (
          <div
            key={item.label}
            className="min-w-0 flex-1 basis-0 px-3 py-2.5 first:pl-[var(--app-card-padding)] last:pr-[var(--app-card-padding)]"
          >
            <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {item.label}
            </p>
            <p
              className={cn(
                "mt-0.5 truncate text-sm font-medium text-foreground",
                item.mono && "font-mono text-xs",
              )}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function inventoryDisplayValue(key: string, asset: AssetDetail): React.ReactNode {
  const orderField = renderPhysicalOrderInventoryField(key, asset)
  if (orderField !== undefined) return orderField
  if (key === "inventory_count") return "1"
  if (key === "physical_count") {
    const v = asset.inventory?.physical_count
    return v != null ? String(v) : "0"
  }
  if (key === "last_verification_date") {
    const d = asset.inventory?.last_verification_date
    return d ? formatDate(d) : "—"
  }
  return "—"
}

const sectionsById = Object.fromEntries(
  ASSET_VIEW_SECTIONS.map((s) => [s.id, s]),
) as Record<AssetViewSectionId, AssetViewSectionConfig>

function renderSection(asset: AssetDetail, sectionId: AssetViewSectionId) {
  const sec = sectionsById[sectionId]
  const Icon = SECTION_ICONS[sec.id] ?? Package
  const inv = asset.inventory?.inventory_count
  const phys = asset.inventory?.physical_count
  const verified = Boolean(asset.inventory?.last_verification_date)
  const countMismatch = verified && inv != null && phys != null && inv !== phys

  return (
    <AssetDetailSectionPanel
      key={sec.id}
      className="!min-h-0"
      config={sec}
      title={sec.title}
      icon={Icon}
      editing={false}
      asset={asset}
      onSection={noop}
      plantCode={asset.plant_code}
      plantName={asset.plant_name}
      inventoryDisplay={inventoryDisplayValue}
      highlightMismatch={countMismatch}
      fieldLayout="stacked"
    />
  )
}

export function AssetMasterReadOnlyView({ asset }: { asset: AssetDetail }) {
  const summaryItems: SummaryItem[] = [
    { label: "Status", value: assetStatusLabel(asset.lifecycle_status, asset.approval_status) },
    { label: "Asset code", value: asset.asset_code, mono: true },
    { label: "Class / type", value: [asset.asset_class_name ?? asset.asset_class, asset.asset_type].filter(Boolean).join(" · ") || "—" },
    { label: "Category", value: asset.category_name ?? "—" },
    { label: "Plant", value: asset.plant_name ?? "—" },
    { label: "RFID", value: asset.rfid_code ?? "—", mono: true },
    {
      label: "Cost center",
      value: asset.financial?.cost_center_name ?? asset.financial?.cost_center ?? "—",
    },
  ]

  return (
    <div className="space-y-4">
      <header className="border-b border-border/60 pb-3">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">{asset.asset_name}</h3>
        {asset.information?.asset_description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {asset.information.asset_description}
          </p>
        ) : null}
      </header>

      <SummaryStrip items={summaryItems} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
        {ASSET_VIEW_SECTIONS.map((sec) => renderSection(asset, sec.id))}
      </div>
    </div>
  )
}
