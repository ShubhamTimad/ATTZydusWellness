import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPanel,
  AdminPrimaryButton,
  adminSelectClass,
  adminTextareaClass,
} from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, postJson } from "@/lib/api"
import type { TransferOrderDetail } from "@/lib/transfer-types"
import { useAssetMasterLookups } from "@/lib/use-asset-masters"
import { cn } from "@/lib/utils"
import { CapexAssigneePickerDialog } from "@/pages/capex/capex-assignee-picker-dialog"

export function TransferOrderCreatePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fromAssets = Boolean(searchParams.get("asset_ids")?.trim())
  const [plantId, setPlantId] = React.useState<number | null>(() => {
    const raw = searchParams.get("plant_id")
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  })
  const masters = useAssetMasterLookups(plantId)
  const [assetIdsText, setAssetIdsText] = React.useState(
    () => searchParams.get("asset_ids")?.replace(/,/g, ", ") ?? "",
  )
  const [toCostCenterId, setToCostCenterId] = React.useState("")
  const [toFunctionalLocation, setToFunctionalLocation] = React.useState("")
  const [toActualLocation, setToActualLocation] = React.useState("")
  const [remarks, setRemarks] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [pickerOpen, setPickerOpen] = React.useState(false)

  React.useEffect(() => {
    if (!fromAssets) {
      toast.error("Select assets in Assets, then use Actions → Create transfer order.")
      navigate("/dashboard/assets", { replace: true })
    }
  }, [fromAssets, navigate])

  if (!fromAssets) {
    return (
      <AdminPage>
        <p className="text-sm text-muted-foreground">Redirecting to Assets…</p>
      </AdminPage>
    )
  }

  function parseAssetIds(): number[] {
    return assetIdsText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0)
  }

  async function create(submit: boolean, assignedTo?: number) {
    const assetIds = parseAssetIds()
    if (assetIds.length === 0) {
      toast.error("Select at least one asset.")
      return
    }
    if (!toCostCenterId) {
      toast.error("Select destination cost center.")
      return
    }
    if (submit && assignedTo == null) {
      setPickerOpen(true)
      return
    }
    setBusy(true)
    try {
      const order = await postJson<TransferOrderDetail>("/admin/transfer-orders", {
        asset_ids: assetIds,
        to_cost_center_id: Number(toCostCenterId),
        to_functional_location: toFunctionalLocation.trim() || null,
        to_actual_location: toActualLocation.trim() || null,
        remarks: remarks.trim() || null,
        assigned_to: assignedTo ?? null,
        submit,
      })
      toast.success(
        submit ? `Transfer ${order.order_number} submitted to CF.` : `Draft ${order.order_number} saved.`,
      )
      navigate(`/dashboard/transfer-orders/${order.id}`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to create transfer order.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminPage>
      <AdminBackLink to="/dashboard/transfer-orders">Transfer orders</AdminBackLink>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">New asset transfer</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Cost Center User (CC1) creates the order and assigns it to Central Finance.
      </p>

      <AdminPanel className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="plant">Plant</Label>
          <select
            id="plant"
            className={cn(adminSelectClass, "w-full")}
            value={plantId != null ? String(plantId) : ""}
            onChange={(e) => {
              const next = e.target.value ? Number(e.target.value) : null
              setPlantId(next)
              setToCostCenterId("")
            }}
          >
            <option value="">Select plant</option>
            {masters.plants.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.code ? `${p.code} — ${p.name}` : p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="asset_ids">Selected assets</Label>
          <Input
            id="asset_ids"
            value={assetIdsText}
            onChange={(e) => setAssetIdsText(e.target.value)}
            readOnly={fromAssets}
            placeholder="Asset ids"
          />
          <p className="text-xs text-muted-foreground">
            {parseAssetIds().length} asset(s) from Assets list (same plant required).
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to_cc">Destination cost center</Label>
          <select
            id="to_cc"
            className={cn(adminSelectClass, "w-full")}
            value={toCostCenterId}
            onChange={(e) => setToCostCenterId(e.target.value)}
            disabled={plantId == null}
          >
            <option value="">Select cost center</option>
            {masters.costCenters.map((cc) => (
              <option key={cc.id} value={String(cc.id)}>
                {cc.code}
                {cc.description ? ` — ${cc.description}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fl">Actual Location 1</Label>
            <Input
              id="fl"
              value={toFunctionalLocation}
              onChange={(e) => setToFunctionalLocation(e.target.value)}
              placeholder="Functional location"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="al">Actual Location 2</Label>
            <Input
              id="al"
              value={toActualLocation}
              onChange={(e) => setToActualLocation(e.target.value)}
              placeholder="Actual location"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="remarks">Remarks</Label>
          <textarea
            id="remarks"
            className={cn(adminTextareaClass, "min-h-20 w-full")}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void create(false)}>
            Save draft
          </Button>
          <AdminPrimaryButton type="button" disabled={busy} onClick={() => void create(true)}>
            Submit to Central Finance
          </AdminPrimaryButton>
        </div>
      </AdminPanel>

      <CapexAssigneePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        assigneesUrl="/admin/transfer-orders/assignees?level=central_finance"
        roleLabel="Central Finance"
        confirmLabel="Submit"
        busy={busy}
        onConfirm={async (userId) => {
          setPickerOpen(false)
          await create(true, userId)
        }}
      />
    </AdminPage>
  )
}
