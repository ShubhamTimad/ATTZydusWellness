import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { ClipboardList, Clock, DollarSign, MapPin, Package } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"

import { AssetActionsMenu } from "@/components/assets/asset-actions-menu"
import { AssetImage, validateAssetImageFile } from "@/components/assets/asset-image"
import { AssetAuditLog, type AssetAuditLogRow } from "@/components/assets/asset-audit-log"
import { CapexFormSearchSelect } from "@/components/assets/capex-form-search-select"
import { renderPhysicalOrderInventoryField } from "@/lib/asset-physical-order-display"
import { AssetDetailSectionPanel } from "@/components/assets/asset-detail-section-panel"
import { RequiredFieldMark } from "@/components/assets/required-field-mark"
import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPillBadge,
  AdminPrimaryButton,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ApiError,
  deleteJson,
  getBlob,
  getJson,
  patchJson,
  postJson,
  putFormData,
} from "@/lib/api"
import type {
  AssetAuditEvent,
  AssetDetail,
  AssetRfidAttachResult,
  SubmitForApprovalResult,
} from "@/lib/assets-types"
import { formatRfidAttachError, formatRfidAttachSuccess, formatSubmitForApprovalError, formatSubmitForApprovalSuccess } from "@/lib/assets-types"
import {
  ASSET_VIEW_SECTIONS,
  type AssetViewSectionConfig,
  type AssetViewSectionId,
} from "@/lib/asset-master-fields"
import { useAssetFieldConfig } from "@/lib/use-asset-field-config"
import {
  assetClassLabel,
  assetConditionLabel,
  assetCustodianLabel,
  categoryLabel,
  actualLocationLabel,
  functionalLocationLabel,
  profitCenterLabel,
  plantLabel,
  useAssetMasterLookups,
} from "@/lib/use-asset-masters"
import { buildAssetDetailActionItems } from "@/lib/asset-actions"
import {
  assetStatusLabel,
  assetStatusPillTone,
  buildAssetProgress,
  canDeactivateAsset,
  canReactivateAsset,
  canSubmitForApproval,
} from "@/lib/asset-lifecycle"
import { hasPermission, persistAuthFromMe } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { AssetRfidDialog } from "@/components/assets/asset-rfid-dialog"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"
import { CapexAssigneePickerDialog } from "@/pages/capex/capex-assignee-picker-dialog"
import { CapexDecisionDialog } from "@/pages/capex/capex-decision-dialog"
import { CapexProcessFlow } from "@/pages/capex/capex-process-flow"

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


function formatDateTime(iso: string | null | undefined) {
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
            className="min-w-0 flex-1 basis-0 px-3 py-2 first:pl-4 last:pr-4"
          >
            <p className="truncate text-[10px] font-bold uppercase tracking-wider text-foreground">
              {item.label}
            </p>
            <p
              className={cn(
                "mt-0.5 truncate text-sm font-normal text-foreground",
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
  const [imageUrl, setImageUrl] = React.useState<string | null>(null)
  const [pendingImageFile, setPendingImageFile] = React.useState<File | null>(null)
  const [removeImage, setRemoveImage] = React.useState(false)
  const [imageRevision, setImageRevision] = React.useState(0)
  const [auditRows, setAuditRows] = React.useState<AssetAuditLogRow[]>([])
  const [auditLoading, setAuditLoading] = React.useState(false)

  const [rfidDialogOpen, setRfidDialogOpen] = React.useState(false)
  const [rfidDialogIsUpdate, setRfidDialogIsUpdate] = React.useState(false)
  const [rfidValue, setRfidValue] = React.useState("")
  const [rfidTagColorId, setRfidTagColorId] = React.useState("")
  const [rfidSaving, setRfidSaving] = React.useState(false)
  const [acting, setActing] = React.useState(false)
  const [decisionOpen, setDecisionOpen] = React.useState(false)
  const [decisionMode, setDecisionMode] = React.useState<"approve" | "reject">("approve")
  const [submitAssignOpen, setSubmitAssignOpen] = React.useState(false)
  const [reassignOpen, setReassignOpen] = React.useState(false)
  const [reassigning, setReassigning] = React.useState(false)

  const canUpdate = hasPermission("asset.update") || hasPermission("asset.manage")
  const canCreate = hasPermission("asset.create") || hasPermission("asset.manage")
  const canDeactivatePerm = hasPermission("asset.deactivate")
  const canReactivatePerm = hasPermission("asset.reactivate")
  const canViewCapex = hasPermission("capitalization.view")
  const canApprovalAct = hasPermission("approval.act")
  const canReassignPerm = hasPermission("asset.reassign") || hasPermission("asset.manage")
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()
  const fieldConfig = useAssetFieldConfig()

  const load = React.useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      try {
        const me = await getJson<{ id: number; is_superuser?: boolean; permissions?: string[] }>("/me")
        persistAuthFromMe(me)
      } catch {
        // ignore
      }
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
    if (!asset?.id || !asset.has_image) {
      setImageUrl(null)
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    void getBlob(`/admin/assets/${asset.id}/image`)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setImageUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setImageUrl(null)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [asset?.id, asset?.has_image, imageRevision])

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
        combined_asset_number: asset.combined_asset_number,
        remark: asset.remark ?? null,
        sub_no: asset.sub_no ?? null,
        rfid_code: (asset.rfid_code ?? "").trim() || null,
        tag_color_id: (asset.rfid_code ?? "").trim() ? asset.tag_color_id : null,
        asset_custodian_id: asset.asset_custodian_id,
        asset_condition_id: asset.asset_condition_id,
        serial_no: asset.serial_no,
        asset_class_id: asset.asset_class_id,
        asset_type: asset.asset_type,
        asset_category_id: asset.asset_category_id,
        ownership_type: asset.ownership_type,
        capitalization_form_id: asset.capitalization_form_id ?? null,
        information: asset.information ?? {},
        location: asset.location ?? {},
        financial: asset.financial ?? {},
        inventory: inventoryPayload,
      })
      if (pendingImageFile) {
        const body = new FormData()
        body.append("file", pendingImageFile)
        await putFormData(`/admin/assets/${asset.id}/image`, body)
      } else if (removeImage && asset.has_image) {
        await deleteJson(`/admin/assets/${asset.id}/image`)
      }
      const refreshed =
        pendingImageFile || removeImage
          ? await getJson<AssetDetail>(`/admin/assets/${asset.id}`)
          : updated
      setAsset(refreshed)
      setPendingImageFile(null)
      setRemoveImage(false)
      if (pendingImageFile || removeImage) setImageRevision((revision) => revision + 1)
      setEditing(false)
      void loadAudit(refreshed.id)
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

      toast.success(formatRfidAttachSuccess(res))

      setRfidDialogOpen(false)

      void loadAudit(updated.id)

    } catch (e) {
      toast.error(formatRfidAttachError(e, "Failed to update RFID."))
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
    if (field === "pm_equipment_id") {
      setSection("information", field, value)
      return
    }
    if (field === "cost_center" || field === "cost_center_name") {
      const code = ((value as string) || "").trim() || null
      const name = code
        ? masters.costCenters.find((m) => m.code === code)?.name?.trim() || null
        : null
      setAsset((a) => {
        if (!a) return a
        return {
          ...a,
          asset_custodian_id: null,
          asset_custodian_code: null,
          asset_custodian_name: null,
          financial: {
            ...(a.financial ?? {}),
            cost_center: code,
            cost_center_name: name,
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
    if (field === "asset_description") {
      setSection("information", field, value)
      return
    }
    if (field === "asset_category_id") {
      set({ asset_category_id: value as number | null })
      return
    }
    if (field === "rfid_code") {
      const rfid = ((value as string | null) ?? "").trim() || null
      if (!rfid) {
        set({
          rfid_code: null,
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
    if (field === "asset_custodian_id") {
      const id = value ? Number(value) : null
      const row = id ? masters.custodianUsers.find((c) => c.id === id) : null
      set({
        asset_custodian_id: id,
        asset_custodian_code: row?.username ?? null,
        asset_custodian_name: row?.full_name ?? null,
      })
      return
    }
    if (field === "asset_condition_id") {
      const id = value ? Number(value) : null
      const row = id ? masters.assetConditions.find((c) => c.id === id) : null
      set({
        asset_condition_id: id,
        asset_condition_code: row?.code ?? null,
        asset_condition_name: row?.name ?? null,
      })
      return
    }
    if (field === "asset_class_id") {
      const id = value ? Number(value) : null
      const row = id ? masters.assetClasses.find((c) => c.id === id) : null
      set({
        asset_class_id: id,
        asset_class_code: row?.code ?? null,
        asset_class_name: row?.name ?? null,
        asset_class: row?.name ?? null,
      })
      return
    }
    set({ [field]: value } as Partial<AssetDetail>)
  }

  const rfidDialogProps = {
    open: rfidDialogOpen,
    onOpenChange: setRfidDialogOpen,
    isUpdate: rfidDialogIsUpdate,
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

  const canEdit = Boolean(
    asset && asset.action_allowed !== false && asset.approval_status !== "pending",
  )
  const canSubmit = Boolean(
    asset &&
      asset.action_allowed !== false &&
      canSubmitForApproval(asset.lifecycle_status, asset.approval_status) &&
      canCreate,
  )
  const pendingTaskId = asset?.approval_panel?.my_pending_task_id ?? null
  const canActOnAsset = Boolean(pendingTaskId && canApprovalAct)
  const canReassign = Boolean(
    asset &&
      asset.approval_status === "pending" &&
      asset.approval_panel?.pending_task_id &&
      canReassignPerm,
  )
  const reassignRoleName = asset?.approval_panel?.current_step_role_name ?? "Approver"
  const progress = asset ? buildAssetProgress(asset) : null

  async function submitWithAssignee(userId: number) {
    if (!asset) return
    setSaving(true)
    try {
      const res = await postJson<SubmitForApprovalResult>(
        `/admin/assets/${asset.id}/submit-for-approval`,
        { assignee_user_id: userId },
      )
      if (res.errors?.length) {
        toast.error(formatSubmitForApprovalError(res.errors[0]))
        return
      }
      setSubmitAssignOpen(false)
      const success = formatSubmitForApprovalSuccess(res, {
        assetCode: asset.asset_code,
        assetName: asset.asset_name,
      })
      toast.success(
        success ??
          (res.activated_count > 0
            ? `Asset ${asset.asset_code} activated — no approval workflow is configured.`
            : `Asset ${asset.asset_code} submitted for approval.`),
      )
      await load()
      if (asset.id) void loadAudit(asset.id)
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Could not submit this asset for approval. Please try again.",
      )
    } finally {
      setSaving(false)
    }
  }

  async function reassignApprover(userId: number) {
    if (!asset) return
    setReassigning(true)
    try {
      const updated = await postJson<AssetDetail>(`/admin/assets/${asset.id}/reassign`, {
        assignee_user_id: userId,
      })
      setAsset(updated)
      setReassignOpen(false)
      toast.success("Approver reassigned.")
      void loadAudit(asset.id)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Reassign failed.")
    } finally {
      setReassigning(false)
    }
  }

  async function confirmDecision(payload: {
    comment: string | null
    nextAssignedUserId: number | null
  }) {
    if (!pendingTaskId) return
    if (decisionMode === "reject" && !(payload.comment || "").trim()) {
      toast.error("Reason is required when rejecting.")
      return
    }
    setActing(true)
    try {
      await postJson(`/approvals/tasks/${pendingTaskId}/action`, {
        action: decisionMode,
        comment: payload.comment,
      })
      setDecisionOpen(false)
      toast.success(decisionMode === "approve" ? "Approved." : "Rejected.")
      await load()
      if (asset?.id) void loadAudit(asset.id)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed.")
    } finally {
      setActing(false)
    }
  }

  function openDecision(mode: "approve" | "reject") {
    setDecisionMode(mode)
    setDecisionOpen(true)
  }

  const detailActions = React.useMemo(
    () =>
      buildAssetDetailActionItems({
        canUpdate: canUpdate && asset?.action_allowed !== false,
        canEdit,
        editing,
        canDeactivate: Boolean(
          canDeactivatePerm &&
            asset &&
            asset.action_allowed !== false &&
            canDeactivateAsset(
              asset.lifecycle_status,
              asset.approval_status,
              asset.active_physical_order,
            ),
        ),
        canReactivate: Boolean(
          canReactivatePerm &&
            asset &&
            asset.action_allowed !== false &&
            canReactivateAsset(asset.lifecycle_status),
        ),
        canSubmit,
      }),
    [canUpdate, canDeactivatePerm, canReactivatePerm, canEdit, editing, asset, canSubmit],
  )

  async function toggleLifecycle(action: "deactivate" | "reactivate") {
    if (!asset) return
    const ok = await confirmAsk({
      title: action === "deactivate" ? "Deactivate asset?" : "Reactivate asset?",
      description:
        action === "deactivate"
          ? `Deactivate “${asset.asset_name}”? It will be marked inactive until reactivated.`
          : `Reactivate “${asset.asset_name}”?`,
      confirmLabel: action === "deactivate" ? "Deactivate" : "Reactivate",
      destructive: action === "deactivate",
    })
    if (!ok) return
    setSaving(true)
    try {
      const updated = await postJson<AssetDetail>(`/admin/assets/${asset.id}/${action}`, {})
      setAsset(updated)
      toast.success(action === "deactivate" ? "Asset deactivated." : "Asset reactivated.")
      void loadAudit(asset.id)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed.")
    } finally {
      setSaving(false)
    }
  }

  function handleDetailAction(actionId: string) {
    if (actionId === "update-rfid") {
      setRfidValue(asset?.rfid_code ?? "")
      setRfidTagColorId(asset?.tag_color_id != null ? String(asset.tag_color_id) : "")
      setRfidDialogIsUpdate(Boolean(asset?.rfid_code?.trim()))
      setRfidDialogOpen(true)
      return
    }

    if (actionId === "edit") {
      if (editing) {
        setPendingImageFile(null)
        setRemoveImage(false)
        setEditing(false)
      } else {
        setEditing(true)
      }
      return
    }

    if (actionId === "submit") {
      setSubmitAssignOpen(true)
      return
    }

    if (actionId === "deactivate") {
      void toggleLifecycle("deactivate")
      return
    }
    if (actionId === "reactivate") {
      void toggleLifecycle("reactivate")
    }
  }
  const toolbar = (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {asset ? (
        <AdminPillBadge
          tone={assetStatusPillTone(asset.lifecycle_status, asset.approval_status)}
          className="h-9 px-3.5 text-sm font-semibold"
        >
          {assetStatusLabel(asset.lifecycle_status, asset.approval_status)}
        </AdminPillBadge>
      ) : null}
      {editing ? (
        <AdminPrimaryButton type="button" disabled={saving || acting} onClick={() => void save()}>
          {saving ? "Saving…" : "Save changes"}
        </AdminPrimaryButton>
      ) : null}
      {!editing && canReassign ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={saving || acting || reassigning}
          onClick={() => setReassignOpen(true)}
        >
          Reassign
        </Button>
      ) : null}
      {!editing && canActOnAsset ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            disabled={saving || acting || reassigning}
            onClick={() => openDecision("reject")}
          >
            Reject
          </Button>
          <AdminPrimaryButton
            type="button"
            disabled={saving || acting || reassigning}
            onClick={() => openDecision("approve")}
          >
            Approve
          </AdminPrimaryButton>
        </>
      ) : null}
      {asset && detailActions.length > 0 ? (
        <AssetActionsMenu
          actions={detailActions}
          busy={saving || acting || reassigning}
          onAction={handleDetailAction}
        />
      ) : null}
      <AdminBackLink to="/dashboard/assets">Assets</AdminBackLink>
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
    ...(fieldConfig.isVisible("combined_asset_number")
      ? [
          {
            label: fieldConfig.getLabel("combined_asset_number", "Combined Asset No"),
            value: a.combined_asset_number,
            mono: true,
          },
        ]
      : []),
    ...(fieldConfig.isVisible("asset_code")
      ? [{ label: fieldConfig.getLabel("asset_code", "Asset Number"), value: a.asset_code, mono: true }]
      : []),
    ...(fieldConfig.isVisible("asset_condition_id")
      ? [
          {
            label: fieldConfig.getLabel("asset_condition_id", "Asset Physical Condition"),
            value: a.asset_condition_name ?? a.asset_condition_code ?? "—",
          },
        ]
      : []),
    ...(fieldConfig.isVisible("asset_category_id")
      ? [{ label: fieldConfig.getLabel("asset_category_id", "Category"), value: a.category_name ?? "—" }]
      : []),
    ...(fieldConfig.isVisible("rfid_code")
      ? [{ label: fieldConfig.getLabel("rfid_code", "RFID"), value: a.rfid_code ?? "—", mono: true }]
      : []),
  ]

  const sectionsById = Object.fromEntries(
    ASSET_VIEW_SECTIONS.map((s) => [s.id, s]),
  ) as Record<AssetViewSectionId, AssetViewSectionConfig>

  const sectionPanelProps = {
    compact: !editing,
    fieldColumns: (_sectionId: AssetViewSectionId) => 2 as const,
  }

  function renderAssetViewSection(sectionId: AssetViewSectionId) {
    const sec = sectionsById[sectionId]
    const Icon = SECTION_ICONS[sec.id] ?? Package
    const panelCommon = {
      compact: sectionPanelProps.compact,
      fieldColumns: sectionPanelProps.fieldColumns(sectionId),
    }

    if (sec.id === "information") {
      const summaryFieldKeys = new Set([
        "asset_code",
        "combined_asset_number",
        "rfid_code",
        "asset_category_id",
        "asset_condition_id",
      ])
      const infoConfig: AssetViewSectionConfig = {
        ...sec,
        keys: sec.keys.filter(
          (k) =>
            (editing || !summaryFieldKeys.has(k)) &&
            (k !== "tag_color_id" || Boolean(a.rfid_code?.trim())),
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
          extraAfterKeys={
            canViewCapex
              ? {
                  asset_custodian_id:
                    editing && canUpdate ? (
                      <div className="app-form-field">
                        <Label htmlFor="asset_capex_form" className="app-form-label">
                          CapEx form number
                        </Label>
                        <CapexFormSearchSelect
                          id="asset_capex_form"
                          value={a.capitalization_form_id ? String(a.capitalization_form_id) : ""}
                          forAssetId={a.id}
                          disabled={saving}
                          onChange={(formId, option) =>
                            setAsset((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    capitalization_form_id: formId ? Number(formId) : null,
                                    capitalization_form_number: option?.form_number ?? null,
                                    capitalization_form_asset_name: option?.asset_name ?? null,
                                  }
                                : prev,
                            )
                          }
                        />
                      </div>
                    ) : (
                      <div className="min-w-0 border-b border-border/60 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-foreground">
                          CapEx form number
                        </p>
                        <p className="mt-1 text-sm font-normal leading-snug break-words text-foreground">
                          {a.capitalization_form_id && a.capitalization_form_number ? (
                            <>
                              <Link
                                className="font-medium text-primary hover:underline"
                                to={`/dashboard/capitalization/${a.capitalization_form_id}`}
                              >
                                {a.capitalization_form_number}
                              </Link>
                              {a.capitalization_form_asset_name ? (
                                <span className="text-muted-foreground">
                                  {" "}
                                  — {a.capitalization_form_asset_name}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            "—"
                          )}
                        </p>
                      </div>
                    ),
                }
              : undefined
          }
          selectOptions={{
            asset_category_id: masters.categories.map((c) => ({
              value: String(c.id),
              label: categoryLabel(c),
            })),
            asset_custodian_id: masters.custodianUsers.map((c) => ({
              value: String(c.id),
              label: assetCustodianLabel(c),
            })),
            asset_condition_id: masters.assetConditions
              .filter((c) => c.is_active || c.id === a.asset_condition_id)
              .map((c) => ({
              value: String(c.id),
              label: assetConditionLabel(c),
            })),
            asset_class_id: masters.assetClasses
              .filter((c) => c.is_active || c.id === a.asset_class_id)
              .map((c) => ({
              value: String(c.id),
              label: assetClassLabel(c),
            })),
          }}
          selectPlaceholders={{
            asset_custodian_id: a.financial?.cost_center
              ? "—"
              : "Select cost center first",
          }}
          selectDisabled={{
            asset_custodian_id: !a.financial?.cost_center,
          }}
          tagColors={a.rfid_code?.trim() ? masters.tagColors : []}
        />
      )
    }
    if (sec.id === "location") {
      const locationConfig: AssetViewSectionConfig = {
        ...sec,
        showPlant: Boolean(sec.showPlant && fieldConfig.isVisible("plant_id")),
      }
      return (
        <AssetDetailSectionPanel
          key={sec.id}
          config={locationConfig}
          title={sec.title}
          icon={Icon}
          editing={editing}
          asset={a}
          onSection={onLocationSection}
          {...panelCommon}
          plantCode={a.plant_code}
          plantName={a.plant_name}
          extra={
            editing && fieldConfig.isVisible("plant_code") ? (
              <div className="space-y-1.5">
                <Label className="app-form-label">Plant Code</Label>
                <Input value={a.plant_code ?? ""} readOnly className="font-mono" />
              </div>
            ) : null
          }
          extraAfterFirst={
            editing && fieldConfig.isVisible("plant_id") ? (
              <div className="space-y-1.5">
                <Label className="app-form-label">
                  Plant Name
                  {fieldConfig.isRequired("plant_id") ? <RequiredFieldMark /> : null}
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
              label: m.code,
            })),
            cost_center_name: masters.costCenters.map((m) => ({
              value: m.code,
              label: m.name?.trim() || m.code,
            })),
            profit_center: masters.profitCenters.map((m) => ({
              value: m.code,
              label: profitCenterLabel(m),
            })),
          }}
          selectPlaceholders={{
            cost_center: plantId ? "—" : "Select plant first",
            cost_center_name: plantId ? "—" : "Select plant first",
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
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
            <div className="min-w-0">
              <h1 className="app-page-heading truncate">{a.asset_name}</h1>
              {a.information?.asset_description ? (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {a.information.asset_description}
                </p>
              ) : null}
            </div>
            <div className="ml-auto flex flex-col items-end gap-1.5">
              <AssetImage
                imageUrl={removeImage ? null : imageUrl}
                file={pendingImageFile}
                editable={editing && canUpdate}
                busy={saving}
                onFileChange={(file) => {
                  const error = validateAssetImageFile(file)
                  if (error) {
                    toast.error(error)
                    return
                  }
                  setPendingImageFile(file)
                  setRemoveImage(false)
                }}
                onRemove={() => {
                  setPendingImageFile(null)
                  setRemoveImage(true)
                }}
              />
            </div>
          </header>

          {progress ? (
            <div className="rounded-[var(--app-radius-surface)] border border-border/70 bg-card px-3 py-4 sm:px-4">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-black">
                Progress
              </p>
              <CapexProcessFlow steps={progress.steps} currentStepKey={progress.currentStepKey} />
            </div>
          ) : null}

          {!editing ? <SummaryStrip items={summaryItems} /> : null}

          {editing ? (
            <div className="flex flex-col gap-[var(--app-grid-gap)]">
              {renderAssetViewSection("information")}
              <div className="grid grid-cols-1 gap-[var(--app-grid-gap)] lg:grid-cols-2">
                {renderAssetViewSection("financial")}
                {renderAssetViewSection("location")}
              </div>
              {renderAssetViewSection("inventory")}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {renderAssetViewSection("information")}
              <div className="border-t-2 border-border/70" role="separator" />
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {renderAssetViewSection("financial")}
                {renderAssetViewSection("location")}
              </div>
              {renderAssetViewSection("inventory")}
            </div>
          )}
          <div className="flex justify-end border-t border-border/60 pt-3">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5 shrink-0" aria-hidden />
              Updated {formatDateTime(a.updated_at)}
            </span>
          </div>
        </section>

        <section aria-label="Audit Trail" className="border-t border-border/60 pt-4">
          <AssetAuditLog rows={auditRows} loading={auditLoading} />
        </section>
      </AdminPage>

      <AssetRfidDialog {...rfidDialogProps} />

      <CapexAssigneePickerDialog
        open={submitAssignOpen}
        onOpenChange={setSubmitAssignOpen}
        assigneesUrl={asset ? `/admin/assets/${asset.id}/assignees` : undefined}
        roleLabel="Approver"
        confirmLabel="Submit"
        busy={saving}
        onConfirm={submitWithAssignee}
      />

      <CapexAssigneePickerDialog
        open={reassignOpen}
        onOpenChange={setReassignOpen}
        assigneesUrl={asset ? `/admin/assets/${asset.id}/assignees` : undefined}
        roleLabel={reassignRoleName}
        confirmLabel="Reassign"
        busy={reassigning}
        onConfirm={reassignApprover}
      />

      <CapexDecisionDialog
        open={decisionOpen}
        onOpenChange={setDecisionOpen}
        mode={decisionMode}
        busy={acting}
        needsNextAssignee={false}
        onConfirm={confirmDecision}
      />

      {confirmDialog}
    </>
  )
}

