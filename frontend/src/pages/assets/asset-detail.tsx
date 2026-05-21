import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { ClipboardList, Clock, DollarSign, MapPin, Package, Pencil } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"

import { AssetDetailSectionPanel } from "@/components/assets/asset-detail-section-panel"
import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPanel,
  AdminPrimaryButton,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError, getJson, patchJson } from "@/lib/api"
import type { AssetAuditEvent, AssetDetail } from "@/lib/assets-types"
import {
  ASSET_VIEW_COLUMNS,
  ASSET_VIEW_SECTIONS,
  type AssetViewSectionConfig,
  type AssetViewSectionId,
} from "@/lib/asset-master-fields"
import {
  categoryLabel,
  functionalChildLabel,
  plantChildLabel,
  plantLabel,
  useAssetMasterLookups,
} from "@/lib/use-asset-masters"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

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

type AuditLogRow = {
  id: string
  at: string
  activityVerb: string
  actorName: string | null
  summary: string
  changes: { field_label: string; from_value: string; to_value: string }[]
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

function statusBanner(asset: AssetDetail) {
  if (asset.approval_status === "pending") {
    return (
      <Alert className="rounded-lg border-amber-300/50 bg-amber-50/90 px-4 py-3">
        <AlertTitle className="text-sm">Pending approval</AlertTitle>
        <AlertDescription className="text-sm">
          This asset is not active until the workflow is completed.
        </AlertDescription>
      </Alert>
    )
  }
  if (asset.approval_status === "rejected") {
    return (
      <Alert variant="destructive" className="rounded-lg px-4 py-3">
        <AlertTitle className="text-sm">Rejected</AlertTitle>
        <AlertDescription className="text-sm">
          Approval was rejected. Contact your process owner to resubmit.
        </AlertDescription>
      </Alert>
    )
  }
  return null
}

type SummaryItem = { label: string; value: React.ReactNode; mono?: boolean }

function SummaryStrip({ items }: { items: SummaryItem[] }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-border/60 overflow-hidden rounded-lg border border-border/80 bg-card shadow-sm sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
  )
}

export function AssetDetailPage() {
  const { id } = useParams()
  const [asset, setAsset] = React.useState<AssetDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [auditRows, setAuditRows] = React.useState<AuditLogRow[]>([])
  const [auditLoading, setAuditLoading] = React.useState(false)

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
    set({ [field]: value } as Partial<AssetDetail>)
  }

  const inv = asset?.inventory?.inventory_count
  const phys = asset?.inventory?.physical_count
  const verified = Boolean(asset?.inventory?.last_verification_date)
  const countMismatch =
    verified && inv != null && phys != null && inv !== phys

  function inventoryDisplayValue(key: string, a: AssetDetail): React.ReactNode {
    if (key === "inventory_count") return "1"
    if (key === "physical_count") {
      const v = a.inventory?.physical_count
      return v != null ? String(v) : "0"
    }
    if (key === "last_verification_date") {
      const d = a.inventory?.last_verification_date
      return d ? formatDate(d) : "—"
    }
    return "—"
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-1.5">
      <AdminBackLink to="/dashboard/assets">Assets</AdminBackLink>
      {asset && canUpdate && asset.approval_status !== "pending" ? (
        editing ? (
          <>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <AdminPrimaryButton type="button" className="h-8" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save changes"}
            </AdminPrimaryButton>
          </>
        ) : (
          <AdminPrimaryButton type="button" className="h-8 gap-1.5" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" aria-hidden />
            Edit
          </AdminPrimaryButton>
        )
      ) : null}
    </div>
  )

  if (loading) {
    return (
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
    )
  }

  if (!asset) {
    return (
      <AdminPage fullWidth actions={toolbar}>
        <Alert>
          <AlertTitle>Asset not found</AlertTitle>
          <AlertDescription>
            <Link to="/dashboard/assets" className="text-primary underline-offset-2 hover:underline">
              Return to the asset list
            </Link>
          </AlertDescription>
        </Alert>
      </AdminPage>
    )
  }

  const a: AssetDetail = asset

  const summaryItems: SummaryItem[] = [
    { label: "Asset code", value: a.asset_code, mono: true },
    { label: "Class / type", value: [a.asset_class, a.asset_type].filter(Boolean).join(" · ") || "—" },
    { label: "Category", value: a.category_name ?? "—" },
    { label: "Plant", value: a.plant_name ?? "—" },
    { label: "RFID", value: a.rfid_code ?? "—", mono: true },
    {
      label: "Cost center",
      value: a.financial?.cost_center ?? "—",
      mono: true,
    },
  ]

  const sectionsById = Object.fromEntries(
    ASSET_VIEW_SECTIONS.map((s) => [s.id, s]),
  ) as Record<AssetViewSectionId, AssetViewSectionConfig>

  function renderAssetViewSection(sectionId: AssetViewSectionId) {
    const sec = sectionsById[sectionId]
    const Icon = SECTION_ICONS[sec.id] ?? Package

    if (sec.id === "information") {
      return (
        <AssetDetailSectionPanel
          key={sec.id}
          config={sec}
          title={sec.title}
          icon={Icon}
          editing={editing}
          asset={a}
          onSection={onInformationSection}
          selectOptions={{
            asset_category_id: masters.categories.map((c) => ({
              value: String(c.id),
              label: categoryLabel(c),
            })),
          }}
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
          plantName={a.plant_name}
          extra={
            editing ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Plant name</Label>
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
              label: plantChildLabel(l),
            })),
            actual_location: masters.actualLocations.map((l) => ({
              value: l.code,
              label: functionalChildLabel(l),
            })),
          }}
          selectPlaceholders={{
            functional_location: plantId ? "—" : "Select plant first",
            actual_location: a.location?.functional_location
              ? "—"
              : "Select functional location first",
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
          selectOptions={{
            cost_center: masters.costCenters.map((m) => ({
              value: m.code,
              label: plantChildLabel(m),
            })),
          }}
          selectPlaceholders={{
            cost_center: plantId ? "—" : "Select plant first",
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
          const storage = sec.fieldStorage?.[field] ?? "inventory"
          if (storage === "financial") {
            onFinancialSection(field, value)
            return
          }
          setSection("inventory", field, value)
        }}
        inventoryDisplay={inventoryDisplayValue}
        highlightMismatch={countMismatch}
      />
    )
  }

  return (
    <AdminPage fullWidth actions={toolbar} className="w-full space-y-4 pb-8">
      {statusBanner(a)}

      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/50 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
            {a.asset_name}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {a.location?.functional_location ?? a.asset_code}
            {a.plant_name ? ` · ${a.plant_name}` : ""}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0" aria-hidden />
          Updated {formatDateTime(a.updated_at)}
        </span>
      </header>

      <SummaryStrip items={summaryItems} />

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {ASSET_VIEW_COLUMNS.map((columnIds, colIdx) => (
          <div key={colIdx} className="flex flex-col gap-4">
            {columnIds.map((sectionId) => renderAssetViewSection(sectionId))}
          </div>
        ))}
      </div>

      <AssetAuditLog rows={auditRows} loading={auditLoading} />
    </AdminPage>
  )
}

function auditActionLabel(verb: string) {
  return verb.replace(/\s+by\s*$/i, "").trim() || verb
}

function AuditActivityCell({ row }: { row: AuditLogRow }) {
  if (row.changes.length > 0) {
    return (
      <div className="space-y-1">
        <p className="text-sm text-foreground">{auditActionLabel(row.activityVerb)}</p>
        <ul className="space-y-1">
        {row.changes.map((change) => (
          <li key={`${change.field_label}-${change.from_value}-${change.to_value}`} className="text-sm">
            <span className="text-muted-foreground">{change.field_label} :</span>{" "}
            <span className="text-foreground">{change.from_value}</span>
            <span className="mx-1 text-muted-foreground" aria-hidden>
              →
            </span>
            <span className="font-semibold text-foreground">{change.to_value}</span>
          </li>
        ))}
        </ul>
      </div>
    )
  }

  return <p className="text-sm text-foreground">{auditActionLabel(row.activityVerb)}</p>
}

function AssetAuditLog({ rows, loading }: { rows: AuditLogRow[]; loading: boolean }) {
  return (
    <AdminPanel
      title="Audit trail"
      description="Creation, import, edits, and approvals for this asset."
      className="mt-2"
      contentClassName="p-0"
    >
      <div className="max-h-80 overflow-auto">
        {loading ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Loading audit trail…</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No audit events recorded yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-[1] border-b border-border/60 bg-muted/25">
              <tr>
                <th className="w-40 px-4 py-2.5 text-xs font-semibold text-muted-foreground">When</th>
                <th className="w-36 px-4 py-2.5 text-xs font-semibold text-muted-foreground">By</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/15">
                  <td className="whitespace-nowrap px-4 py-2.5 align-top text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(row.at)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 align-top text-sm font-semibold text-foreground">
                    {row.actorName?.trim() || "System"}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <AuditActivityCell row={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminPanel>
  )
}
