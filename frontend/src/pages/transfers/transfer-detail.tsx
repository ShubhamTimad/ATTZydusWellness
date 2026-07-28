import * as React from "react"
import { ArrowRightLeft, Package } from "lucide-react"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { RequiredFieldMark } from "@/components/assets/required-field-mark"
import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPanel,
  AdminPillBadge,
  AdminPrimaryButton,
  AdminTableCell,
  AdminTableEmptyRow,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
  adminTextareaClass,
} from "@/components/layout/admin-ui"
import { AdminTableBodyRow } from "@/components/layout/list-page-ui"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { ApiError, getJson, patchJson, postJson } from "@/lib/api"
import {
  buildTransferProgress,
  transferStatusLabel,
  transferStatusPillTone,
  type TransferAssigneeListResponse,
  type TransferAssigneeOption,
  type TransferDestinationCostCenter,
  type TransferOrderDetail,
} from "@/lib/transfer-types"
import {
  actualLocationLabel,
  costCenterLabel,
  functionalLocationLabel,
  useAssetMasterLookups,
} from "@/lib/use-asset-masters"
import { cn } from "@/lib/utils"
import { CapexAssigneePickerDialog } from "@/pages/capex/capex-assignee-picker-dialog"
import { CapexProcessFlow } from "@/pages/capex/capex-process-flow"
import { TransferAuditLog } from "@/pages/transfers/transfer-audit-log"

type PickerMode = "submit" | "cc2_assign" | null

function FormField({
  id,
  labelText,
  required,
  className,
  children,
}: {
  id?: string
  labelText: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("app-form-field", className)}>
      <Label htmlFor={id} className="app-form-label">
        {labelText}
        {required ? <RequiredFieldMark /> : null}
      </Label>
      {children}
    </div>
  )
}

export function TransferOrderDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const orderId = Number(id)
  const [order, setOrder] = React.useState<TransferOrderDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [pickerMode, setPickerMode] = React.useState<PickerMode>(null)
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [rejectReason, setRejectReason] = React.useState("")
  const [toCostCenterId, setToCostCenterId] = React.useState("")
  const [toAssetCustodianId, setToAssetCustodianId] = React.useState<number | null>(null)
  const [custodianOptions, setCustodianOptions] = React.useState<TransferAssigneeOption[]>([])
  const [custodiansLoading, setCustodiansLoading] = React.useState(false)
  const [toFunctionalLocation, setToFunctionalLocation] = React.useState("")
  const [toActualLocation, setToActualLocation] = React.useState("")
  const [plantCostCenters, setPlantCostCenters] = React.useState<TransferDestinationCostCenter[]>([])

  const masters = useAssetMasterLookups(
    order?.plant_id ?? null,
    null,
    toFunctionalLocation || null,
  )

  const draftEditable = Boolean(order?.can_edit)
  const receiveEditable = Boolean(order?.can_cc2_assign)
  const showLocations =
    receiveEditable ||
    Boolean(
      order &&
        (order.to_functional_location ||
          order.to_actual_location ||
          ["received_by_cc2", "confirmed_by_cf", "closed"].includes(order.status)),
    )

  const load = React.useCallback(async () => {
    if (!Number.isFinite(orderId)) return
    setLoading(true)
    try {
      const res = await getJson<TransferOrderDetail>(`/admin/transfer-orders/${orderId}`)
      setOrder(res)
      setToCostCenterId(String(res.to_cost_center_id))
      setToAssetCustodianId(res.to_asset_custodian_id)
      setToFunctionalLocation(res.to_functional_location ?? "")
      setToActualLocation(res.to_actual_location ?? "")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to load transfer order")
      navigate("/dashboard/transfer-orders")
    } finally {
      setLoading(false)
    }
  }, [orderId, navigate])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    const plantId = order?.plant_id
    if (plantId == null) {
      setPlantCostCenters([])
      return
    }
    let cancelled = false
    void getJson<TransferDestinationCostCenter[]>(
      `/admin/transfer-orders/destination-cost-centers?plant_id=${plantId}`,
    )
      .then((rows) => {
        if (!cancelled) setPlantCostCenters(rows)
      })
      .catch(() => {
        if (!cancelled) setPlantCostCenters([])
      })
    return () => {
      cancelled = true
    }
  }, [order?.plant_id])

  React.useEffect(() => {
    if (!toCostCenterId || !draftEditable) {
      setCustodianOptions([])
      return
    }
    let cancelled = false
    setCustodiansLoading(true)
    void getJson<TransferAssigneeListResponse>(
      `/admin/transfer-orders/cost-center-users?cost_center_id=${toCostCenterId}`,
    )
      .then((res) => {
        if (cancelled) return
        setCustodianOptions(res.items)
        setToAssetCustodianId((prev) => {
          if (prev != null && res.items.some((u) => u.id === prev)) return prev
          if (res.items.length === 1) return res.items[0]!.id
          return prev
        })
      })
      .catch(() => {
        if (!cancelled) setCustodianOptions([])
      })
      .finally(() => {
        if (!cancelled) setCustodiansLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [toCostCenterId, draftEditable])

  async function run(action: () => Promise<TransferOrderDetail>, okMessage: string) {
    setBusy(true)
    try {
      const res = await action()
      setOrder(res)
      setToCostCenterId(String(res.to_cost_center_id))
      setToAssetCustodianId(res.to_asset_custodian_id)
      setToFunctionalLocation(res.to_functional_location ?? "")
      setToActualLocation(res.to_actual_location ?? "")
      toast.success(okMessage)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed")
    } finally {
      setBusy(false)
      setPickerMode(null)
    }
  }

  const sourceCostCenterCodes = React.useMemo(() => {
    const codes = new Set<string>()
    if (!order) return codes
    for (const item of order.items) {
      const code = item.from_cost_center_code?.trim()
      if (code) codes.add(code)
    }
    if (order.from_cost_center_code?.trim()) {
      codes.add(order.from_cost_center_code.trim())
    }
    return codes
  }, [order])
  const destinationCostCenters = React.useMemo(
    () => plantCostCenters.filter((cc) => !sourceCostCenterCodes.has(cc.code)),
    [plantCostCenters, sourceCostCenterCodes],
  )

  const assetCodeById = React.useMemo(() => {
    const map = new Map<number, string>()
    for (const item of order?.items ?? []) {
      if (item.asset_id != null && item.asset_code) {
        map.set(item.asset_id, item.asset_code)
      }
    }
    return map
  }, [order?.items])

  // Clear destination if it matches a line item's current cost center (legacy drafts).
  React.useEffect(() => {
    if (!draftEditable || !toCostCenterId) return
    const selected = plantCostCenters.find((cc) => String(cc.id) === toCostCenterId)
    if (selected && sourceCostCenterCodes.has(selected.code)) {
      setToCostCenterId("")
      setToAssetCustodianId(null)
    }
  }, [draftEditable, toCostCenterId, sourceCostCenterCodes, plantCostCenters])

  async function saveDraftChanges() {
    if (!order) return
    if (!toCostCenterId) {
      toast.error("Select destination cost center.")
      return
    }
    const destCc = plantCostCenters.find((cc) => String(cc.id) === toCostCenterId)
    if (destCc && sourceCostCenterCodes.has(destCc.code)) {
      toast.error("Destination cost center must be different from the assets' current cost center.")
      return
    }
    if (toAssetCustodianId == null) {
      toast.error("Select the destination asset custodian.")
      return
    }
    await run(
      () =>
        patchJson(`/admin/transfer-orders/${order.id}`, {
          to_cost_center_id: Number(toCostCenterId),
          to_asset_custodian_id: toAssetCustodianId,
          to_functional_location: null,
          to_actual_location: null,
        }),
      "Transfer details saved.",
    )
  }

  if (loading || !order) {
    return (
      <AdminPage fullWidth dense description="" className="w-full pb-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AdminPage>
    )
  }

  const selectedCc = plantCostCenters.find((cc) => String(cc.id) === toCostCenterId)
  const selectedCustodian =
    custodianOptions.find((u) => u.id === toAssetCustodianId) ??
    (order.to_asset_custodian_id != null && order.to_asset_custodian_name
      ? {
          id: order.to_asset_custodian_id,
          full_name: order.to_asset_custodian_name,
          email: null,
        }
      : null)

  const pickerUrl = "/admin/transfer-orders/assignees?level=central_finance"

  const pickerLabel = "Central Finance"

  const destinationDescription = receiveEditable
    ? "Set Actual Location 1 and 2, then receive the assets. Cost center, locations, and custodian update on receive."
    : draftEditable
      ? "Update destination cost center and asset custodian. Locations are set when the destination custodian receives."
      : "Destination details for this transfer order."

  const progress = buildTransferProgress(order.status, order.assigned_to_name)

  return (
    <AdminPage
      fullWidth
      dense
      description=""
      className="w-full pb-6"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AdminPillBadge
            tone={transferStatusPillTone(order.status)}
            className="h-9 px-3.5 text-sm font-semibold"
          >
            {transferStatusLabel(order.status)}
          </AdminPillBadge>
          {draftEditable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={() => void saveDraftChanges()}
            >
              {busy ? "Saving…" : "Save changes"}
            </Button>
          ) : null}
          {order.can_submit ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => {
                if (toAssetCustodianId == null) {
                  toast.error("Select the destination asset custodian before submitting.")
                  return
                }
                setPickerMode("submit")
              }}
            >
              Submit to Central Finance
            </AdminPrimaryButton>
          ) : null}
          {order.can_cf_reject ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={() => setRejectOpen(true)}
            >
              Reject
            </Button>
          ) : null}
          {order.can_cf_decide ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    postJson(`/admin/transfer-orders/${order.id}/cf/approve`, {
                      to_cost_center_id: toCostCenterId ? Number(toCostCenterId) : null,
                    }),
                  "Approved. Assigned to the destination asset custodian for receive.",
                )
              }
            >
              Approve
            </AdminPrimaryButton>
          ) : null}
          {order.can_cc2_assign ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => {
                if (!toFunctionalLocation.trim() || !toActualLocation.trim()) {
                  toast.error("Select Actual Location 1 and 2 before receiving.")
                  return
                }
                setPickerMode("cc2_assign")
              }}
            >
              Receive
            </AdminPrimaryButton>
          ) : null}
          {order.can_cf_confirm ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () => postJson(`/admin/transfer-orders/${order.id}/cf/confirm`, {}),
                  "Receive confirmed. Close the transfer order when ready.",
                )
              }
            >
              Confirm
            </AdminPrimaryButton>
          ) : null}
          {order.can_cf_close ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () => postJson(`/admin/transfer-orders/${order.id}/cf/close`, {}),
                  "Transfer order closed.",
                )
              }
            >
              Close
            </AdminPrimaryButton>
          ) : null}
          <AdminBackLink to="/dashboard/transfer-orders">Transfer orders</AdminBackLink>
        </div>
      }
    >
      <div className="space-y-[var(--app-grid-gap)]">
        <div className="shrink-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {order.order_number}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.plant_name}
            {order.from_cost_center_code || order.to_cost_center_code
              ? ` · ${order.from_cost_center_code ?? "—"} → ${order.to_cost_center_code}`
              : null}
            {order.assigned_to_name
              ? ` · ${order.assigned_to_name}`
              : order.created_by_name
                ? ` · ${order.created_by_name}`
                : null}
          </p>
        </div>

        <AdminPanel className="shrink-0 overflow-hidden p-0">
          <div className="border-b border-border/60 bg-muted/15 px-4 py-3 sm:px-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Progress
            </p>
            <CapexProcessFlow steps={progress.steps} currentStepKey={progress.currentStepKey} />
          </div>
        </AdminPanel>

        {order.rejection_reason ? (
          <AdminPanel className="border-destructive/30 bg-destructive/5" contentClassName="px-5 py-4">
            <p className="text-sm font-medium text-destructive">Rejection reason</p>
            <p className="mt-1 text-sm">{order.rejection_reason}</p>
          </AdminPanel>
        ) : null}

        <div className="grid gap-[var(--app-grid-gap)] lg:grid-cols-2">
          <AdminPanel
            title="Transfer destination"
            description={destinationDescription}
            headerActions={<ArrowRightLeft className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="px-5 py-5"
          >
            <div className="grid grid-cols-1 gap-4">
              <FormField id="to_cc" labelText="Destination cost center" required={draftEditable}>
                {draftEditable ? (
                  <select
                    id="to_cc"
                    className={adminSelectClass}
                    value={toCostCenterId}
                    onChange={(e) => {
                      setToCostCenterId(e.target.value)
                      setToAssetCustodianId(null)
                    }}
                  >
                    <option value="">Select cost center</option>
                    {destinationCostCenters.map((cc) => (
                      <option key={cc.id} value={String(cc.id)}>
                        {costCenterLabel(cc)}
                        {cc.code ? ` (${cc.code})` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm">
                    {selectedCc
                      ? `${costCenterLabel(selectedCc)}${selectedCc.code ? ` (${selectedCc.code})` : ""}`
                      : `${order.to_cost_center_code}${
                          order.to_cost_center_description
                            ? ` — ${order.to_cost_center_description}`
                            : ""
                        }`}
                  </p>
                )}
              </FormField>

              <FormField id="to_custodian" labelText="Asset custodian" required={draftEditable}>
                {draftEditable ? (
                  custodiansLoading ? (
                    <p className="text-sm text-muted-foreground">Loading custodians…</p>
                  ) : custodianOptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No asset custodians are assigned to this cost center. Add them under Asset
                      masters → CC custodians.
                    </p>
                  ) : (
                    <select
                      id="to_custodian"
                      className={adminSelectClass}
                      value={toAssetCustodianId != null ? String(toAssetCustodianId) : ""}
                      onChange={(e) =>
                        setToAssetCustodianId(e.target.value ? Number(e.target.value) : null)
                      }
                    >
                      <option value="">Select asset custodian</option>
                      {custodianOptions.map((u) => (
                        <option key={u.id} value={String(u.id)}>
                          {u.full_name}
                          {u.email ? ` — ${u.email}` : ""}
                        </option>
                      ))}
                    </select>
                  )
                ) : (
                  <p className="text-sm">{selectedCustodian?.full_name ?? order.to_asset_custodian_name ?? "—"}</p>
                )}
              </FormField>

              {showLocations ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField id="loc1" labelText="Actual Location 1" required={receiveEditable}>
                    {receiveEditable ? (
                      <select
                        id="loc1"
                        className={adminSelectClass}
                        value={toFunctionalLocation}
                        onChange={(e) => {
                          setToFunctionalLocation(e.target.value)
                          setToActualLocation("")
                        }}
                      >
                        <option value="">Select location</option>
                        {masters.functionalLocations.map((l) => (
                          <option key={l.id} value={l.code}>
                            {functionalLocationLabel(l)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-sm">{order.to_functional_location ?? "—"}</p>
                    )}
                  </FormField>
                  <FormField id="loc2" labelText="Actual Location 2" required={receiveEditable}>
                    {receiveEditable ? (
                      <select
                        id="loc2"
                        className={adminSelectClass}
                        value={toActualLocation}
                        onChange={(e) => setToActualLocation(e.target.value)}
                        disabled={!toFunctionalLocation}
                      >
                        <option value="">
                          {toFunctionalLocation ? "Select location" : "Select Actual Location 1 first"}
                        </option>
                        {masters.actualLocations.map((l) => (
                          <option key={l.id} value={l.code}>
                            {actualLocationLabel(l)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-sm">{order.to_actual_location ?? "—"}</p>
                    )}
                  </FormField>
                </div>
              ) : null}
            </div>
          </AdminPanel>

          <AdminPanel
            title={`Assets (${order.items.length})`}
            description="Assets included on this transfer order."
            headerActions={<Package className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="px-5 py-5"
          >
            <div className="-mx-5 -mb-5 overflow-x-auto">
              <Table>
                <TableHeader>
                  <AdminTableHeaderRow>
                    <AdminTableHeadCell>Asset</AdminTableHeadCell>
                    <AdminTableHeadCell>From CC</AdminTableHeadCell>
                    <AdminTableHeadCell>From Loc 1</AdminTableHeadCell>
                  </AdminTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {order.items.length === 0 ? (
                    <AdminTableEmptyRow colSpan={3}>No assets</AdminTableEmptyRow>
                  ) : (
                    order.items.map((item) => (
                      <AdminTableBodyRow key={item.id}>
                        <AdminTableCell>
                          <div className="font-medium">{item.asset_code}</div>
                          <div className="text-xs text-muted-foreground">{item.asset_name || "—"}</div>
                        </AdminTableCell>
                        <AdminTableCell>{item.from_cost_center_code ?? "—"}</AdminTableCell>
                        <AdminTableCell>{item.from_functional_location ?? "—"}</AdminTableCell>
                      </AdminTableBodyRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </AdminPanel>
        </div>

        <TransferAuditLog events={order.audit} assetCodeById={assetCodeById} />
      </div>

      <CapexAssigneePickerDialog
        open={pickerMode != null}
        onOpenChange={(open) => {
          if (!open) setPickerMode(null)
        }}
        assigneesUrl={pickerUrl}
        roleLabel={pickerLabel}
        confirmLabel={pickerMode === "submit" ? "Submit" : "Receive & assign CF"}
        busy={busy}
        onConfirm={async (userId) => {
          if (pickerMode === "submit") {
            setBusy(true)
            try {
              if (order.can_edit) {
                if (toAssetCustodianId == null) {
                  toast.error("Select the destination asset custodian.")
                  setBusy(false)
                  setPickerMode(null)
                  return
                }
                await patchJson(`/admin/transfer-orders/${order.id}`, {
                  to_cost_center_id: toCostCenterId ? Number(toCostCenterId) : undefined,
                  to_asset_custodian_id: toAssetCustodianId,
                  to_functional_location: null,
                  to_actual_location: null,
                })
              }
              const res = await postJson<TransferOrderDetail>(
                `/admin/transfer-orders/${order.id}/submit`,
                { assigned_to: userId },
              )
              setOrder(res)
              setToAssetCustodianId(res.to_asset_custodian_id)
              toast.success("Submitted to Central Finance.")
            } catch (e) {
              toast.error(e instanceof ApiError ? e.message : "Action failed")
            } finally {
              setBusy(false)
              setPickerMode(null)
            }
            return
          }
          if (pickerMode === "cc2_assign") {
            await run(
              () =>
                postJson(`/admin/transfer-orders/${order.id}/cc2/assign`, {
                  assigned_to: userId,
                  to_functional_location: toFunctionalLocation.trim(),
                  to_actual_location: toActualLocation.trim(),
                }),
              "Assets received. Cost center, locations, and custodian updated. Assigned to CF for confirmation.",
            )
          }
        }}
      />

      {rejectOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <AdminPanel
            title="Reject transfer"
            className="w-full max-w-md"
            contentClassName="space-y-3 px-5 py-5"
          >
            <textarea
              className={cn(adminTextareaClass, "min-h-24 w-full")}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Rejection reason"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRejectOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy || !rejectReason.trim()}
                onClick={() => {
                  setRejectOpen(false)
                  void run(
                    () =>
                      postJson(`/admin/transfer-orders/${order.id}/cf/reject`, {
                        reason: rejectReason.trim(),
                      }),
                    "Transfer rejected. Creator can edit and submit again.",
                  )
                }}
              >
                Reject
              </Button>
            </div>
          </AdminPanel>
        </div>
      ) : null}
    </AdminPage>
  )
}
