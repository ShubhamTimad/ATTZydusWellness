import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { ClipboardList, Clock, DollarSign, MapPin, Package } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"

import { AssetActionsMenu } from "@/components/assets/asset-actions-menu"
import { AssetAuditLog, type AssetAuditLogRow } from "@/components/assets/asset-audit-log"
import { renderPhysicalOrderInventoryField } from "@/lib/asset-physical-order-display"
import { AssetDetailSectionPanel } from "@/components/assets/asset-detail-section-panel"
import { RequiredFieldMark } from "@/components/assets/required-field-mark"
import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPrimaryButton,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, getJson, patchJson, postJson } from "@/lib/api"
import type { AssetAuditEvent, AssetDetail, AssetRfidAttachResult } from "@/lib/assets-types"
import {
  ASSET_VIEW_SECTIONS,
  type AssetViewSectionConfig,
  type AssetViewSectionId,
} from "@/lib/asset-master-fields"
import {
  categoryLabel,
  actualLocationLabel,
  functionalLocationLabel,
  costCenterLabel,
  profitCenterLabel,
  plantLabel,
  useAssetMasterLookups,
} from "@/lib/use-asset-masters"
import { buildAssetDetailActionItems } from "@/lib/asset-actions"
import { assetStatusLabel } from "@/lib/asset-lifecycle"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { AssetRfidDialog } from "@/components/assets/asset-rfid-dialog"

const SECTION_ICONS: Record<string, LucideIcon> = {
  information: Package,
  location: MapPin,
  financial: DollarSign,
  inventory: ClipboardList,
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { dateStyle: "medium" })
}

const INVENTORY_READONLY = new Set([
  "inventory_count",
  "physical_count",
  "last_verification_date",
])


function formatDateTime(iso: string | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
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
              title={typeof item.value === "string" ? item.value : undefined}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AssetDetailPage() {
  const { id } = useParams()
  const [asset, setAsset] = React.useState<AssetDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [auditRows, setAuditRows] = React.useState<AssetAuditLogRow[]>([])
  const [auditLoading, setAuditLoading] = React.useState(false)

  const [rfidDialogOpen, setRfidDialogOpen] = React.useState(false)
  const [rfidValue, setRfidValue] = React.useState("")
  const [rfidTagColorId, setRfidTagColorId] = React.useState("")
  const [rfidSaving, setRfidSaving] = React.useState(false)

  const canUpdate = hasPermission("asset.update") || hasPermission("asset.manage")

  const load = React.useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const a = await getJson<AssetDetail>(`/admin/assets/${id}`)
      setAsset(a)
    } finally {
      setLoading(false)
    }
  }, [id])

  React.useEffect(() => {
    void load().catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load asset"))
  }, [load])

  const plantId = asset?.location?.plant_id ?? null
  const costCenterCode = asset?.financial?.cost_center ?? null
  const masters = useAssetMasterLookups(
    plantId,
    costCenterCode,
    asset?.location?.functional_location ?? null,
  )

  const loadAudit = React.useCallback(async (assetId: number) => {
    setAuditLoading(true)
    try {
      const moduleEvents = await getJson<AssetAuditEvent[]>(`/admin/assets/${assetId}/audit`)
      setAuditRows(
        moduleEvents.map((e) => ({
          id: `m-${e.id}`,
          at: e.created_at,
          action: e.action,
          activityVerb: e.activity_verb,
          actorName: e.actor_name,
          summary: e.summary,
          changes: e.changes ?? [],
        })),
      )
    } catch {
      setAuditRows([])
    } finally {
      setAuditLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (asset?.id) void loadAudit(asset.id)
  }, [asset?.id, loadAudit])

  async function save() {
    if (!asset) return
    setSaving(true)
    try {
      const inventoryPayload = { ...(asset.inventory ?? {}) }
      for (const k of INVENTORY_READONLY) {
        delete inventoryPayload[k as keyof typeof inventoryPayload]
      }
      const updated = await patchJson<AssetDetail>(`/admin/assets/${asset.id}`, {
        asset_name: asset.asset_name,
        asset_code: asset.asset_code,
        rfid_code: asset.rfid_code,
        tag_color_id: asset.tag_color_id,
        serial_no: asset.serial_no,
        asset_class: asset.asset_class,
        asset_type: asset.asset_type,
        asset_category_id: asset.asset_category_id,
        ownership_type: asset.ownership_type,
        information: asset.information ?? {},
        location: asset.location ?? {},
        financial: asset.financial ?? {},
        inventory: inventoryPayload,
      })
      setAsset(updated)
      setEditing(false)
      void loadAudit(updated.id)
      toast.success("Asset saved.")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Save failed.")
    } finally {
      setSaving(false)
    }
  }

  async function saveRfid() {
    if (!asset) return

    try {
      setRfidSaving(true)

      const res = await postJson<AssetRfidAttachResult>(
        `/admin/assets/${asset.id}/rfid/attach`,
        {
          rfid_code: rfidValue.trim(),
          tag_color_id: rfidTagColorId ? Number(rfidTagColorId) : null,
        },
      )

      const updated = await getJson<AssetDetail>(`/admin/assets/${asset.id}`)
      setAsset(updated)

      toast.success(
        res.operation === "updated"
          ? `RFID updated on ${res.asset_code}.`
          : `RFID attached to ${res.asset_code}.`,
      )

      setRfidDialogOpen(false)

      void loadAudit(updated.id)

    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Failed to update RFID.",
      )
    } finally {
      setRfidSaving(false)
    }
  }

  const set = (patch: Partial<AssetDetail>) => setAsset((a) => (a ? { ...a, ...patch } : a))
  const setSection = (
    key: "information" | "location" | "financial" | "inventory",
    field: string,
    value: string | number | null,
  ) => {
    setAsset((a) => {
      if (!a) return a
      const sec = { ...(a[key] ?? {}), [field]: value }
      return { ...a, [key]: sec }
    })
  }

  const onLocationSection = (field: string, value: string | number | null) => {
    if (field === "plant_id") {
      setAsset((a) => {
        if (!a) return a
        return {
          ...a,
          location: {
            ...(a.location ?? {}),
            plant_id: value as number | null,
            functional_location: null,
            actual_location: null,
          },
          financial: {
            ...(a.financial ?? {}),
            cost_center: null,
            profit_center: null,
          },
        }
      })
      return
    }
    if (field === "functional_location") {
      setAsset((a) => {
        if (!a) return a
        return {
          ...a,
          location: {
            ...(a.location ?? {}),
            functional_location: value as string | null,
            actual_location: null,
          },
        }
      })
      return
    }
    setSection("location", field, value)
  }

  const onFinancialSection = (field: string, value: string | number | null) => {
    if (field === "cost_center") {
      setAsset((a) => {
        if (!a) return a
        return {
          ...a,
          financial: {
            ...(a.financial ?? {}),
            cost_center: value as string | null,
            profit_center: null,
          },
        }
      })
      return
    }
    if (field === "profit_center") {
      setSection("financial", field, value)
      return
    }
    setSection("financial", field, value)
  }

  const onInformationSection = (field: string, value: string | number | null) => {
    if (field === "asset_category_id") {
      set({ asset_category_id: value as number | null })
      return
    }
    if (field === "rfid_code") {
      const rfid = value as string | null
      if (!rfid?.trim()) {
        set({
          rfid_code: rfid,
          tag_color_id: null,
          tag_color_code: null,
          tag_color_name: null,
          tag_color_hex: null,
        })
        return
      }
      set({ rfid_code: rfid })
      return
    }
    if (field === "tag_color_id") {
      const id = value ? Number(value) : null
      const color = id ? masters.tagColors.find((c) => c.id === id) : null
      set({
        tag_color_id: id,
        tag_color_code: color?.code ?? null,
        tag_color_name: color?.name ?? null,
        tag_color_hex: color?.color_hex ?? null,
      })
      return
    }
    set({ [field]: value } as Partial<AssetDetail>)
  }

  const rfidDialogProps = {
    open: rfidDialogOpen,
    onOpenChange: setRfidDialogOpen,
    value: rfidValue,
    onChange: (v: string) => {
      setRfidValue(v)
      if (!v.trim()) setRfidTagColorId("")
    },
    onSave: () => void saveRfid(),
    saving: rfidSaving,
    tagColorId: rfidTagColorId,
    onTagColorChange: setRfidTagColorId,
    tagColors: masters.tagColors,
  }

  const inv = asset?.inventory?.inventory_count
  const phys = asset?.inventory?.physical_count
  const verified = Boolean(asset?.inventory?.last_verification_date)
  const countMismatch =
    verified && inv != null && phys != null && inv !== phys

  function inventoryDisplayValue(key: string, a: AssetDetail): React.ReactNode {
    const orderField = renderPhysicalOrderInventoryField(key, a)
    if (orderField !== undefined) return orderField
    if (key === "inventory_count") return "1"
    if (key === "physical_count") {
      const v = a.inventory?.physical_count
      return v != null ? String(v) : "0"
    }
    if (key === "last_verification_date") {
      const d = a.inventory?.last_verification_date
      return d ? formatDate(d) : "—"
    }
    if (key === "fy_verification_count") {
      const count = a.fy_verification_count ?? 0
      return a.financial_year_label ? `${count} (${a.financial_year_label})` : String(count)
    }
    return "—"
  }

  const canEdit = Boolean(asset && asset.approval_status !== "pending")
  const detailActions = React.useMemo(
    () =>
      buildAssetDetailActionItems({
        canUpdate,
        canEdit,
        editing,
      }),
    [canUpdate, canEdit, editing],
  )

  function handleDetailAction(actionId: string) {
    if (actionId === "update-rfid") {
      setRfidValue(asset?.rfid_code ?? "")
      setRfidTagColorId(asset?.tag_color_id != null ? String(asset.tag_color_id) : "")
      setRfidDialogOpen(true)
      return
    }

    if (actionId === "edit") {
      if (editing) setEditing(false)
      else setEditing(true)
    }
  }
  const toolbar = (
    <div className="flex flex-wrap items-center gap-1.5">
      <AdminBackLink to="/dashboard/assets">Assets</AdminBackLink>
      {asset && detailActions.length > 0 ? (
        <AssetActionsMenu
          actions={detailActions}
          busy={saving}
          onAction={handleDetailAction}
        />
      ) : null}
      {editing ? (
        <AdminPrimaryButton type="button" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save changes"}
        </AdminPrimaryButton>
      ) : null}
    </div>
  )

  if (loading) {
    return (
      <>
        <AdminPage fullWidth actions={toolbar} className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-14 w-full rounded-lg" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-52 rounded-lg" />
            <Skeleton className="h-52 rounded-lg" />
            <Skeleton className="h-52 rounded-lg" />
            <Skeleton className="h-52 rounded-lg" />
          </div>
        </AdminPage>

        <AssetRfidDialog {...rfidDialogProps} />
      </>
    )
  }

  if (!asset) {
    return (

      <>
        <AdminPage fullWidth actions={toolbar}>
          <Alert>
            <AlertTitle>Asset not found</AlertTitle>
            <AlertDescription>
              <Link to="/dashboard/assets" className="text-primary underline-offset-2 hover:underline">
                Return to assets
              </Link>
            </AlertDescription>
          </Alert>
        </AdminPage>

        <AssetRfidDialog {...rfidDialogProps} />

      </>
    )
  }

  const a: AssetDetail = asset

  const summaryItems: SummaryItem[] = [
    { label: "Status", value: assetStatusLabel(a.lifecycle_status, a.approval_status) },
    { label: "Asset code", value: a.asset_code, mono: true },
    { label: "Class / type", value: [a.asset_class, a.asset_type].filter(Boolean).join(" · ") || "—" },
    { label: "Category", value: a.category_name ?? "—" },
    { label: "Plant", value: a.plant_name ?? "—" },
    { label: "RFID", value: a.rfid_code ?? "—", mono: true },
    {
      label: "Cost center",
      value: a.financial?.cost_center_name ?? a.financial?.cost_center ?? "—",
    },
  ]

  const sectionsById = Object.fromEntries(
    ASSET_VIEW_SECTIONS.map((s) => [s.id, s]),
  ) as Record<AssetViewSectionId, AssetViewSectionConfig>

  const sectionPanelProps = {
    compact: !editing,
    fieldColumns: (sectionId: AssetViewSectionId) =>
      !editing && sectionId === "financial" ? (2 as const) : (1 as const),
  }

  function renderAssetViewSection(sectionId: AssetViewSectionId) {
    const sec = sectionsById[sectionId]
    const Icon = SECTION_ICONS[sec.id] ?? Package
    const panelCommon = {
      compact: sectionPanelProps.compact,
      fieldColumns: sectionPanelProps.fieldColumns(sectionId),
    }

    if (sec.id === "information") {
      const infoConfig: AssetViewSectionConfig = {
        ...sec,
        keys: sec.keys.filter(
          (k) => k !== "tag_color_id" || Boolean(a.rfid_code?.trim()),
        ),
      }
      return (
        <AssetDetailSectionPanel
          key={sec.id}
          config={infoConfig}
          title={sec.title}
          icon={Icon}
          editing={editing}
          asset={a}
          onSection={onInformationSection}
          {...panelCommon}
          selectOptions={{
            asset_category_id: masters.categories.map((c) => ({
              value: String(c.id),
              label: categoryLabel(c),
            })),
          }}
          tagColors={a.rfid_code?.trim() ? masters.tagColors : []}
        />
      )
    }
    if (sec.id === "location") {
      return (
        <AssetDetailSectionPanel
          key={sec.id}
          config={sec}
          title={sec.title}
          icon={Icon}
          editing={editing}
          asset={a}
          onSection={onLocationSection}
          {...panelCommon}
          plantName={a.plant_name}
          extra={
            editing ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="app-form-label">
                  Plant name
                  <RequiredFieldMark />
                </Label>
                <select
                  className={cn(adminSelectClass, "h-9")}
                  value={a.location?.plant_id ?? ""}
                  onChange={(e) =>
                    onLocationSection("plant_id", e.target.value ? Number(e.target.value) : null)
                  }
                >
                  <option value="">—</option>
                  {masters.plants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {plantLabel(p)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null
          }
          selectOptions={{
            functional_location: masters.functionalLocations.map((l) => ({
              value: l.code,
              label: functionalLocationLabel(l),
            })),
            actual_location: masters.actualLocations.map((l) => ({
              value: l.code,
              label: actualLocationLabel(l),
            })),
          }}
          selectPlaceholders={{
            functional_location: plantId ? "—" : "Select plant first",
            actual_location: a.location?.functional_location
              ? "—"
              : "Select functional location first",
          }}
          selectDisabled={{
            actual_location: !a.location?.functional_location,
          }}
        />
      )
    }
    if (sec.id === "financial") {
      return (
        <AssetDetailSectionPanel
          key={sec.id}
          config={sec}
          title={sec.title}
          icon={Icon}
          editing={editing}
          asset={a}
          onSection={onFinancialSection}
          {...panelCommon}
          selectOptions={{
            cost_center: masters.costCenters.map((m) => ({
              value: m.code,
              label: costCenterLabel(m),
            })),
            profit_center: masters.profitCenters.map((m) => ({
              value: m.code,
              label: profitCenterLabel(m),
            })),
          }}
          selectPlaceholders={{
            cost_center: plantId ? "—" : "Select plant first",
            profit_center: a.financial?.cost_center ? "—" : "Select cost center first",
          }}
          selectDisabled={{
            profit_center: !a.financial?.cost_center,
          }}
        />
      )
    }
    return (
      <AssetDetailSectionPanel
        key={sec.id}
        config={sec}
        title={sec.title}
        icon={Icon}
        editing={editing}
        asset={a}
        onSection={(field, value) => {
          if (INVENTORY_READONLY.has(field)) return
          setSection("inventory", field, value)
        }}
        inventoryDisplay={inventoryDisplayValue}
        highlightMismatch={countMismatch}
        {...panelCommon}
      />
    )
  }

  return (
    <>
      <AdminPage fullWidth dense actions={toolbar} className="w-full pb-6">
        <section aria-label="Asset details" className="flex shrink-0 flex-col gap-3">
          <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 pb-3">
            <div className="min-w-0">
              <h1 className="app-page-heading truncate">{a.asset_name}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {a.location?.functional_location_name ?? a.location?.functional_location ?? a.asset_code}
                {a.plant_name ? ` · ${a.plant_name}` : ""}
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5 shrink-0" aria-hidden />
              Updated {formatDateTime(a.updated_at)}
            </span>
          </header>

          <SummaryStrip items={summaryItems} />

          <div className="app-grid app-grid-2 items-start">
            {ASSET_VIEW_SECTIONS.map((sec) => renderAssetViewSection(sec.id))}
          </div>
        </section>

        <section aria-label="Audit trail" className="border-t border-border/60 pt-6">
          <AssetAuditLog rows={auditRows} loading={auditLoading} />
        </section>
      </AdminPage>

      <AssetRfidDialog {...rfidDialogProps} />
    </>
  )
}

