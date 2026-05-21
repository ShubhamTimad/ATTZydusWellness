import * as React from "react"
import { Link, useParams } from "react-router-dom"
import {
  ClipboardList,
  Clock,
  DollarSign,
  MapPin,
  Package,
  Pencil,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPanel,
  AdminPrimaryButton,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { ApiError, getJson, patchJson } from "@/lib/api"
import type { AssetAuditEvent, AssetCategory, AssetDetail } from "@/lib/assets-types"
import { canListOrgUnitsForAssignments } from "@/lib/permissions"
import { hasPermission } from "@/lib/permissions"

type TimelineEvent = {
  type: string
  user?: string | null
  step?: number | null
  action?: string | null
  timestamp?: string | null
  details?: Record<string, unknown>
}

type AuditLogRow = {
  id: string
  at: string
  action: string
  section: string | null
  detail: string
  actor?: string | null
}

function formatChangesDetail(changes: Record<string, { from?: unknown; to?: unknown }>): string {
  const parts = Object.entries(changes).map(
    ([k, v]) => `${k}: ${String(v?.from ?? "—")} → ${String(v?.to ?? "—")}`,
  )
  return parts.length ? parts.join(" · ") : "Updated"
}

function formatAuditDetail(ev: AssetAuditEvent): string {
  const nv = ev.new_value
  if (!nv || typeof nv !== "object") return "—"
  if ("pending_approval" in nv) {
    return nv.pending_approval ? "Submitted for approval" : "Activated immediately"
  }
  const changes = (nv as { changes?: Record<string, { from?: unknown; to?: unknown }> }).changes
  if (changes && typeof changes === "object") return formatChangesDetail(changes)
  const keys = Object.keys(nv)
  if (keys.length === 0) return "—"
  if (keys.length <= 2) {
    return keys.map((k) => `${k}: ${String((nv as Record<string, unknown>)[k])}`).join(" · ")
  }
  return `${keys.length} fields updated`
}

function timelineToRows(events: TimelineEvent[]): AuditLogRow[] {
  return events.map((ev, i) => {
    let detail = ""
    if (ev.type === "created") detail = `Created by ${ev.user ?? "system"}`
    else if (ev.type === "approval_step") {
      if (ev.action === "pending") {
        detail = `Awaiting approval (step ${ev.step ?? "—"})`
      } else {
        detail = `Step ${ev.step ?? "—"}: ${ev.action ?? "—"} by ${ev.user ?? "—"}`
      }
      const comment = ev.details?.comment
      if (typeof comment === "string" && comment.trim()) detail += ` — ${comment.trim()}`
    } else if (ev.type === "entity_updated" && ev.details?.changes) {
      detail = formatChangesDetail(
        ev.details.changes as Record<string, { from?: unknown; to?: unknown }>,
      )
    } else detail = ev.type.replace(/_/g, " ")

    return {
      id: `tl-${i}-${ev.timestamp ?? ""}`,
      at: ev.timestamp ?? new Date(0).toISOString(),
      action: ev.type.replace(/_/g, " "),
      section: "approval",
      detail,
      actor: ev.user ?? null,
    }
  })
}

const FIELD_LABELS: Record<string, string> = {
  inventory_no: "Inventory no.",
  asset_description: "Description",
  engineering_description: "Engineering",
  qa_description: "QA",
  pm_equipment_id: "PM equipment ID",
  functional_location: "Functional location",
  actual_location: "Actual location",
  building: "Building",
  floor: "Floor",
  room: "Room",
  zone: "Zone",
  cost_center: "Cost center",
  profit_center: "Profit center",
  vendor_name: "Vendor",
  po_number: "PO number",
  currency: "Currency",
  inventory_count: "Inventory count",
  physical_count: "Physical count",
  verification_status: "Verification status",
  verification_remarks: "Remarks",
}

function formatLabel(key: string) {
  return FIELD_LABELS[key] ?? key.replace(/_/g, " ")
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { dateStyle: "medium" })
}

function formatDateTime(iso: string | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function displayValue(key: string, raw: unknown): React.ReactNode {
  if (raw === null || raw === undefined || raw === "") return "—"
  if (key === "last_verification_date") return formatDate(String(raw))
  return String(raw)
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

type DetailRow = {
  label: string
  value: React.ReactNode
  highlight?: boolean
}

function DetailFieldList({ rows }: { rows: DetailRow[] }) {
  return (
    <dl className="divide-y divide-border/60">
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
  const [categories, setCategories] = React.useState<AssetCategory[]>([])
  const [plants, setPlants] = React.useState<{ id: number; name: string }[]>([])
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [auditRows, setAuditRows] = React.useState<AuditLogRow[]>([])
  const [auditLoading, setAuditLoading] = React.useState(false)

  const canUpdate = hasPermission("asset.update") || hasPermission("asset.manage")
  const canViewApprovalAudit = hasPermission("approval.view")

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

  React.useEffect(() => {
    void getJson<AssetCategory[]>("/admin/assets/categories").then(setCategories).catch(() => {})
    if (canListOrgUnitsForAssignments()) {
      void getJson<{ id: number; name: string }[]>("/admin/org-units?type=PLANT").then(setPlants).catch(() => {})
    }
  }, [])

  const loadAudit = React.useCallback(async (assetId: number) => {
    setAuditLoading(true)
    try {
      const rows: AuditLogRow[] = []
      const moduleEvents = await getJson<AssetAuditEvent[]>(`/admin/assets/${assetId}/audit`)
      for (const e of moduleEvents) {
        rows.push({
          id: `m-${e.id}`,
          at: e.created_at,
          action: e.action.replace(/_/g, " "),
          section: e.section,
          detail: formatAuditDetail(e),
          actor: e.actor_user_id ? `User #${e.actor_user_id}` : null,
        })
      }
      if (canViewApprovalAudit) {
        try {
          const tl = await getJson<TimelineEvent[]>(`/audit/entity/asset/${assetId}`)
          rows.push(...timelineToRows(tl))
        } catch {
          // no approval timeline
        }
      }
      rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      setAuditRows(rows)
    } catch {
      setAuditRows([])
    } finally {
      setAuditLoading(false)
    }
  }, [canViewApprovalAudit])

  React.useEffect(() => {
    if (asset?.id) void loadAudit(asset.id)
  }, [asset?.id, loadAudit])

  async function save() {
    if (!asset) return
    setSaving(true)
    try {
      const updated = await patchJson<AssetDetail>(`/admin/assets/${asset.id}`, {
        asset_name: asset.asset_name,
        asset_code: asset.asset_code,
        rfid_code: asset.rfid_code,
        serial_no: asset.serial_no,
        asset_category_id: asset.asset_category_id,
        ownership_type: asset.ownership_type,
        information: asset.information ?? {},
        location: asset.location ?? {},
        financial: asset.financial ?? {},
        inventory: asset.inventory ?? {},
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

  const inv = asset.inventory?.inventory_count
  const phys = asset.inventory?.physical_count
  const countMismatch =
    inv != null && phys != null && inv !== phys

  const summaryItems: SummaryItem[] = [
    { label: "Asset code", value: asset.asset_code, mono: true },
    { label: "Category", value: asset.category_name ?? "—" },
    { label: "Plant", value: asset.plant_name ?? "—" },
    { label: "RFID", value: asset.rfid_code ?? "—", mono: true },
    { label: "Serial", value: asset.serial_no ?? "—", mono: true },
    {
      label: "Cost center",
      value: asset.financial?.cost_center ?? "—",
      mono: true,
    },
  ]

  return (
    <AdminPage fullWidth actions={toolbar} className="w-full space-y-4 pb-8">
      {statusBanner(asset)}

      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border/50 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
            {asset.asset_name}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {asset.location?.functional_location ?? asset.asset_code}
            {asset.plant_name ? ` · ${asset.plant_name}` : ""}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0" aria-hidden />
          Updated {formatDateTime(asset.updated_at)}
        </span>
      </header>

      <SummaryStrip items={summaryItems} />

      {editing ? (
        <AdminPanel title="Edit identity" description="Core identifiers">
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Asset name</Label>
              <Input className="h-9" value={asset.asset_name} onChange={(e) => set({ asset_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Asset code</Label>
              <Input className="h-9 font-mono" value={asset.asset_code} onChange={(e) => set({ asset_code: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <select
                className={cn(adminSelectClass, "h-9")}
                value={asset.asset_category_id ?? ""}
                onChange={(e) =>
                  set({ asset_category_id: e.target.value ? Number(e.target.value) : null })
                }
              >
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">RFID</Label>
              <Input className="h-9 font-mono" value={asset.rfid_code ?? ""} onChange={(e) => set({ rfid_code: e.target.value || null })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Serial no.</Label>
              <Input className="h-9 font-mono" value={asset.serial_no ?? ""} onChange={(e) => set({ serial_no: e.target.value || null })} />
            </div>
          </div>
        </AdminPanel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionPanel
          title="Asset information"
          icon={Package}
          editing={editing}
          asset={asset}
          onSection={setSection}
          keys={["inventory_no", "asset_description", "engineering_description", "qa_description", "pm_equipment_id"]}
          section="information"
          wideKeys={["asset_description", "engineering_description", "qa_description"]}
        />
        <SectionPanel
          title="Location"
          icon={MapPin}
          editing={editing}
          asset={asset}
          onSection={setSection}
          keys={["functional_location", "actual_location", "building", "floor", "room", "zone"]}
          section="location"
          extra={
            editing ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Plant</Label>
                <select
                  className={cn(adminSelectClass, "h-8")}
                  value={asset.location?.plant_id ?? ""}
                  onChange={(e) =>
                    setSection("location", "plant_id", e.target.value ? Number(e.target.value) : null)
                  }
                >
                  <option value="">—</option>
                  {plants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null
          }
          plantName={asset.plant_name}
        />
        <SectionPanel
          title="Financial"
          icon={DollarSign}
          editing={editing}
          asset={asset}
          onSection={setSection}
          keys={["cost_center", "profit_center", "vendor_name", "po_number", "currency"]}
          section="financial"
        />
        <SectionPanel
          title="Inventory"
          icon={ClipboardList}
          editing={editing}
          asset={asset}
          onSection={setSection}
          keys={["inventory_count", "physical_count", "verification_status", "verification_remarks"]}
          section="inventory"
          highlightMismatch={countMismatch}
          lastVerified={asset.inventory?.last_verification_date}
        />
      </div>

      <AssetAuditLog rows={auditRows} loading={auditLoading} showApprovalNote={canViewApprovalAudit} />
    </AdminPage>
  )
}

function AssetAuditLog({
  rows,
  loading,
  showApprovalNote,
}: {
  rows: AuditLogRow[]
  loading: boolean
  showApprovalNote: boolean
}) {
  return (
    <AdminPanel
      title="Audit log"
      description={
        showApprovalNote
          ? "Asset changes and approval workflow events."
          : "Asset field-level change history."
      }
      className="mt-2"
      contentClassName="p-0"
    >
      <div className="max-h-80 overflow-auto">
        {loading ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Loading audit log…</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No audit events recorded yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-[1] border-b border-border/60 bg-muted/25">
              <tr>
                <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">When</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Action</th>
                <th className="hidden px-4 py-2.5 text-xs font-semibold text-muted-foreground sm:table-cell">
                  Section
                </th>
                <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Details</th>
                <th className="hidden px-4 py-2.5 text-xs font-semibold text-muted-foreground md:table-cell">
                  Actor
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/15">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(row.at)}
                  </td>
                  <td className="px-4 py-2.5 font-medium capitalize text-foreground">{row.action}</td>
                  <td className="hidden px-4 py-2.5 text-xs capitalize text-muted-foreground sm:table-cell">
                    {row.section ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-foreground">{row.detail}</td>
                  <td className="hidden px-4 py-2.5 text-xs text-muted-foreground md:table-cell">
                    {row.actor ?? "—"}
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

function SectionPanel({
  title,
  icon: Icon,
  editing,
  asset,
  onSection,
  keys,
  section,
  extra,
  wideKeys = [],
  highlightMismatch,
  lastVerified,
  plantName,
}: {
  title: string
  icon: LucideIcon
  editing: boolean
  asset: AssetDetail
  onSection: (
    key: "information" | "location" | "financial" | "inventory",
    field: string,
    value: string | number | null,
  ) => void
  keys: string[]
  section: "information" | "location" | "financial" | "inventory"
  extra?: React.ReactNode
  wideKeys?: string[]
  highlightMismatch?: boolean
  lastVerified?: string | null
  plantName?: string | null
}) {
  const data = asset[section] ?? {}

  return (
    <AdminPanel contentClassName="p-0">
      <div className="flex items-center gap-2 border-b border-border/60 px-5 py-3">
        <Icon className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {editing ? (
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
          {extra}
          {keys.map((k) => (
            <div key={k} className={cn("space-y-1.5", wideKeys.includes(k) && "sm:col-span-2")}>
              <Label className="text-xs">{formatLabel(k)}</Label>
              <Input
                className="h-9"
                value={String((data as Record<string, unknown>)[k] ?? "")}
                onChange={(e) =>
                  onSection(
                    section,
                    k,
                    k.includes("count") ? Number(e.target.value) || null : e.target.value || null,
                  )
                }
              />
            </div>
          ))}
        </div>
      ) : (
        <DetailFieldList
          rows={[
            ...(section === "location" && plantName
              ? [{ label: "Plant", value: plantName }]
              : []),
            ...keys.map((k) => {
              const raw = (data as Record<string, unknown>)[k]
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
            ...(lastVerified
              ? [{ label: "Last verified", value: formatDate(lastVerified) }]
              : []),
          ]}
        />
      )}
    </AdminPanel>
  )
}
