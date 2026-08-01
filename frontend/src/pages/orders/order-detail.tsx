import * as React from "react"
import { Link, useParams } from "react-router-dom"
import {
  ListFilter,
  Loader2,
  Lock,
  ScanLine,
  Search,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPanel,
  AdminPillBadge,
  AdminPrimaryButton,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import {
  AdminTableBodyRow,
  AdminTableEmptyRow,
  AdminTablePagination,
} from "@/components/layout/list-page-ui"
import { OrderAuditLog } from "@/components/orders/order-audit-log"
import { OrderLifecycleStepper } from "@/components/orders/order-lifecycle-stepper"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ApiError, getJson, postJson } from "@/lib/api"
import {
  orderStatusLabel,
  orderStatusPillTone,
  type ExecutorListResponse,
  type ExecutorUser,
  type PhysicalOrderDetail,
  type PhysicalOrderItem,
} from "@/lib/orders-types"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type AssetColumnFilters = {
  asset: string
  rfid: string
  status: "" | "pending" | "verified" | "rejected"
  verified_by: string
}

const DEFAULT_ASSET_COLUMN_FILTERS: AssetColumnFilters = {
  asset: "",
  rfid: "",
  status: "",
  verified_by: "",
}

const ORDER_ASSETS_PAGE_SIZE = 25
const columnFilterControlClass = "h-8 w-full min-w-[6rem] text-xs"
const listToolbarBtnClass = "h-9 shrink-0 gap-1.5 px-3"

const ORDER_ACTION_BUSY_LABELS: Record<string, string> = {
  "/submit-closure": "Completing order…",
  "/approval/approve-all": "Approving…",
  "/approval/approve-order": "Approving…",
  "/approval/approve-items": "Approving…",
  "/close": "Closing order…",
  "/start": "Starting…",
  "/submit": "Submitting…",
  "/reassign": "Reassigning…",
}

function formatDt(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: "medium" })
}


function matchesAssetSearch(item: PhysicalOrderItem, search: string): boolean {
  const q = search.trim().toLowerCase()
  if (!q) return true
  return [item.asset_code, item.asset_name, item.rfid_code, item.verified_by_name]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q))
}

function matchesAssetColumnFilters(item: PhysicalOrderItem, filters: AssetColumnFilters): boolean {
  const assetQ = filters.asset.trim().toLowerCase()
  if (
    assetQ &&
    !item.asset_code.toLowerCase().includes(assetQ) &&
    !item.asset_name.toLowerCase().includes(assetQ)
  ) {
    return false
  }
  const rfidQ = filters.rfid.trim().toLowerCase()
  if (rfidQ && !(item.rfid_code || "").toLowerCase().includes(rfidQ)) return false
  if (filters.status === "pending") {
    if (item.physically_verified || item.verification_status === "rejected") return false
  } else if (filters.status === "verified") {
    if (!item.physically_verified) return false
  } else if (filters.status === "rejected") {
    if (item.verification_status !== "rejected") return false
  }
  const byQ = filters.verified_by.trim().toLowerCase()
  if (byQ && !(item.verified_by_name || "").toLowerCase().includes(byQ)) return false
  return true
}

function itemRowTone(item: PhysicalOrderItem): "approved" | "rejected" | "default" {
  if (item.verification_status === "rejected") return "rejected"
  if (item.physically_verified && item.verification_status !== "rejected") return "approved"
  return "default"
}

function OrderSummaryField({
  label,
  value,
  tone,
}: {
  label: string
  value: React.ReactNode
  tone?: "warning" | "success"
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md px-2.5 py-1.5",
        tone === "warning" && "bg-amber-50/90 dark:bg-amber-950/25",
        tone === "success" && "bg-emerald-50/90 dark:bg-emerald-950/25",
        !tone && "bg-muted/35",
      )}
    >
      <p
        className={cn(
          "text-[10px] font-medium uppercase tracking-[0.06em]",
          tone === "warning" && "text-amber-800/80 dark:text-amber-200/80",
          tone === "success" && "text-emerald-800/80 dark:text-emerald-200/80",
          !tone && "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 truncate text-sm font-semibold tabular-nums leading-snug",
          tone === "warning" && "text-amber-950 dark:text-amber-50",
          tone === "success" && "text-emerald-950 dark:text-emerald-50",
          !tone && "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  )
}

const orderPanelPad = "px-[var(--app-card-padding)]"

export function OrderDetailPage() {
  const { id } = useParams()
  const [order, setOrder] = React.useState<PhysicalOrderDetail | null>(null)
  const [currentUserId, setCurrentUserId] = React.useState<number | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [busyAction, setBusyAction] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [assetSearchInput, setAssetSearchInput] = React.useState("")
  const [assetSearch, setAssetSearch] = React.useState("")
  const [assetColumnFiltersOpen, setAssetColumnFiltersOpen] = React.useState(false)
  const [assetColumnFilterInputs, setAssetColumnFilterInputs] = React.useState<AssetColumnFilters>(
    DEFAULT_ASSET_COLUMN_FILTERS,
  )
  const [assetColumnFilters, setAssetColumnFilters] = React.useState<AssetColumnFilters>(
    DEFAULT_ASSET_COLUMN_FILTERS,
  )
  const [assetPage, setAssetPage] = React.useState(1)
  const [selectedScanItemId, setSelectedScanItemId] = React.useState<number | null>(null)
  const [scanValue, setScanValue] = React.useState("")
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [rejectReason, setRejectReason] = React.useState("")
  const [rejectMode, setRejectMode] = React.useState<"items" | "order">("items")
  const [closureRejectConfirmOpen, setClosureRejectConfirmOpen] = React.useState(false)
  const [closureRejectBlockedOpen, setClosureRejectBlockedOpen] = React.useState(false)
  const [closureRejectVerifiedCodes, setClosureRejectVerifiedCodes] = React.useState<string[]>([])
  const [reassignOpen, setReassignOpen] = React.useState(false)
  const [assignOpen, setAssignOpen] = React.useState(false)
  const [executors, setExecutors] = React.useState<ExecutorUser[]>([])
  const [executorRoleName, setExecutorRoleName] = React.useState<string | null>(null)
  const [reassignTo, setReassignTo] = React.useState("")
  const [assignTo, setAssignTo] = React.useState("")
  const canApprove = hasPermission("order.approve")
  const canExecute = hasPermission("order.execute")
  const canCreate = hasPermission("order.create")
  const canUpdate = hasPermission("order.update")
  const canReassignOrder =
    hasPermission("order.reassign") ||
    hasPermission("order.create") ||
    hasPermission("order.manage")

  const load = React.useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [res, me] = await Promise.all([
        getJson<PhysicalOrderDetail>(`/admin/physical-orders/${id}`),
        getJson<{ id: number }>("/me"),
      ])
      setOrder(res)
      setCurrentUserId(me.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load order")
    } finally {
      setLoading(false)
    }
  }, [id])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setAssetSearch(assetSearchInput)
      setAssetPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [assetSearchInput])

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setAssetColumnFilters((prev) => {
        const changed = Object.entries(assetColumnFilterInputs).some(
          ([k, v]) => prev[k as keyof AssetColumnFilters] !== v,
        )
        if (!changed) return prev
        setAssetPage(1)
        return { ...assetColumnFilterInputs }
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [assetColumnFilterInputs])

  React.useEffect(() => {
    setAssetPage(1)
    setAssetSearchInput("")
    setAssetSearch("")
    setAssetColumnFilterInputs({ ...DEFAULT_ASSET_COLUMN_FILTERS })
    setAssetColumnFilters({ ...DEFAULT_ASSET_COLUMN_FILTERS })
  }, [id])

  React.useEffect(() => {
    if (!order) return
    const stillVisible = order.items.some((item) => item.id === selectedScanItemId)
    if (!stillVisible) setSelectedScanItemId(null)
  }, [order, selectedScanItemId])

  React.useEffect(() => {
    if ((!reassignOpen && !assignOpen) || !order) return
    void getJson<ExecutorListResponse>(`/admin/physical-orders/executors?plant_id=${order.plant_id}`)
      .then((res) => {
        setExecutors(res.items)
        setExecutorRoleName(res.role_name)
      })
      .catch((e) => {
        setExecutors([])
        setExecutorRoleName(null)
        toast.error(e instanceof ApiError ? e.message : "Could not load executors from workflow.")
      })
  }, [reassignOpen, assignOpen, order?.plant_id])

  async function runAction(path: string, body?: Record<string, unknown>): Promise<boolean> {
    if (!id) return false
    setBusy(true)
    setBusyAction(path)
    try {
      const res = await postJson<PhysicalOrderDetail>(
        `/admin/physical-orders/${id}${path}`,
        body ?? {},
      )
      setOrder(res)
      setSelected(new Set())
      if (
        path === "/approval/approve-order" &&
        (res.status === "approved" || res.status === "assigned")
      ) {
        toast.success("Order approved.")
      } else if (
        (path === "/approval/approve-all" ||
          path === "/closure/approve-order" ||
          path === "/approval/approve-items") &&
        res.status === "approved"
      ) {
        toast.success("Order approved.")
      } else if (path === "/approval/approve-items" && res.status === "completed") {
        toast.success("Selected lines approved.")
      } else if (path === "/approval/approve-items" && res.status === "pending_closure_approval") {
        toast.success("Selected lines approved.")
      } else if (path === "/approval/reject-items" && res.status === "in_progress") {
        toast.success(
          res.assigned_to_name
            ? `Order returned to ${res.assigned_to_name} for rework.`
            : "Order returned to executor for rework.",
        )
      } else if (path === "/submit-closure") {
        toast.success("Order completed.")
      } else if (path === "/submit") {
        toast.success(
          res.assigned_to_name
            ? `Order assigned to ${res.assigned_to_name}.`
            : "Order assigned.",
        )
      } else {
        toast.success("Updated.")
      }
      return true
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed.")
      return false
    } finally {
      setBusy(false)
      setBusyAction(null)
    }
  }

  async function scan() {
    if (!id || !scanValue.trim() || selectedScanItemId == null) return
    setBusy(true)
    try {
      const res = await postJson<{
        item: PhysicalOrderItem
        verified_count: number
        total_count: number
      }>(`/admin/physical-orders/${id}/scan`, {
        scan_value: scanValue.trim(),
        item_id: selectedScanItemId,
      })
      setScanValue("")
      setSelectedScanItemId(null)
      await load()
      toast.success(`Asset verified (${res.verified_count}/${res.total_count}).`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Scan failed.")
    } finally {
      setBusy(false)
    }
  }

  if (loading || !order) {
    return (
      <AdminPage>
        <p className="text-muted-foreground">{loading ? "Loading…" : "Order not found."}</p>
      </AdminPage>
    )
  }

  const hasClosureWorkflow = order.progress.closure_workflow != null
  const isDraft = order.status === "draft"
  const isPendingApproval = order.status === "pending_approval"
  const isAssigned = order.status === "assigned"
  const isInProgress = order.status === "in_progress"
  const isCompleted = order.status === "completed"
  const isClosureApproved = order.status === "approved"
  const isClosed = order.status === "closed"
  const isRejected = order.status === "rejected"
  const isCreator = currentUserId != null && order.created_by === currentUserId
  const isAssignee = currentUserId != null && order.assigned_to === currentUserId
  const canReviewCreation = isPendingApproval && canApprove
  const canReviewClosure = isCompleted && hasClosureWorkflow && canApprove
  const canAssignSubmit = (isDraft || isRejected) && canCreate && isCreator
  const canScan =
    isInProgress && canExecute && isAssignee
  const filteredItems = order.items.filter(
    (item) =>
      matchesAssetSearch(item, assetSearch) && matchesAssetColumnFilters(item, assetColumnFilters),
  )
  const assetTotal = filteredItems.length
  const assetTotalPages = Math.max(1, Math.ceil(assetTotal / ORDER_ASSETS_PAGE_SIZE))
  const safeAssetPage = Math.min(assetPage, assetTotalPages)
  const pagedItems = filteredItems.slice(
    (safeAssetPage - 1) * ORDER_ASSETS_PAGE_SIZE,
    safeAssetPage * ORDER_ASSETS_PAGE_SIZE,
  )
  const selectedScanItem = order.items.find((item) => item.id === selectedScanItemId) ?? null
  const busyLabel = busyAction ? ORDER_ACTION_BUSY_LABELS[busyAction] ?? "Working…" : null
  const activeAssetColumnFilterCount = Object.values(assetColumnFilters).filter((value) =>
    Boolean(value.trim()),
  ).length
  const showStatusRejectedOption = order.rejected_item_count > 0

  const canReassign = isAssigned && canReassignOrder && !isClosed
  const canClose =
    (isClosureApproved || (isCompleted && !hasClosureWorkflow)) &&
    (canApprove || canUpdate || (canCreate && isCreator))

  function clearAssetFilters() {
    setAssetSearchInput("")
    setAssetSearch("")
    setAssetColumnFilterInputs({ ...DEFAULT_ASSET_COLUMN_FILTERS })
    setAssetColumnFilters({ ...DEFAULT_ASSET_COLUMN_FILTERS })
    setAssetPage(1)
  }

  function itemIsScannable(item: PhysicalOrderItem): boolean {
    return canScan && !item.physically_verified
  }

  function itemIsSelectableAtClosure(_item: PhysicalOrderItem): boolean {
    return canReviewClosure
  }

  function beginClosureLineReject() {
    if (!order) return
    const selectedItems = order.items.filter((item) => selected.has(item.id))
    const verified = selectedItems.filter((item) => item.physically_verified)
    const nonVerified = selectedItems.filter((item) => !item.physically_verified)

    if (selectedItems.length === 0) {
      toast.error("Select at least one asset to reject.")
      return
    }
    if (verified.length > 0 && nonVerified.length === 0) {
      setClosureRejectVerifiedCodes(verified.map((item) => item.asset_code))
      setClosureRejectBlockedOpen(true)
      return
    }
    if (verified.length > 0) {
      setClosureRejectVerifiedCodes(verified.map((item) => item.asset_code))
      setSelected(new Set(nonVerified.map((item) => item.id)))
      setClosureRejectConfirmOpen(true)
      return
    }
    setRejectMode("items")
    setRejectOpen(true)
  }

  function beginClosureLineApprove() {
    if (!order || selected.size === 0) return
    void runAction("/approval/approve-items", { item_ids: [...selected] })
  }

  const showRowSelection = canReviewClosure
  const selectableItems = filteredItems.filter((item) => itemIsSelectableAtClosure(item))

  const showRejectColumn = order.rejected_item_count > 0 || canReviewClosure
  const tableColSpan = (showRowSelection ? 1 : 0) + 4 + (showRejectColumn ? 1 : 0)
  const activeProgressStep =
    order.progress.steps.find((step) => step.key === order.progress.current_step_key) ??
    order.progress.steps.find((step) => step.status === "active")

  const canStart = isAssigned && canExecute && isAssignee

  return (
    <AdminPage
      fullWidth
      dense
      className="w-full pb-6"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AdminPillBadge
            tone={orderStatusPillTone(order.status)}
            className="h-9 px-3.5 text-sm font-semibold"
          >
            {orderStatusLabel(order.status)}
          </AdminPillBadge>
          {canReassign ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={() => {
                setReassignTo("")
                setReassignOpen(true)
              }}
            >
              Reassign
            </Button>
          ) : null}
          {canReviewCreation ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                disabled={busy}
                onClick={() => {
                  setRejectMode("order")
                  setRejectOpen(true)
                }}
              >
                Reject
              </Button>
              <AdminPrimaryButton
                type="button"
                disabled={busy}
                onClick={() => void runAction("/approval/approve-order")}
              >
                Approve
              </AdminPrimaryButton>
            </>
          ) : null}
          {canReviewClosure ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                disabled={busy || selected.size === 0}
                onClick={beginClosureLineReject}
              >
                Reject selected
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                disabled={busy || selected.size === 0}
                onClick={beginClosureLineApprove}
              >
                Approve selected
              </Button>
              <AdminPrimaryButton
                type="button"
                disabled={busy}
                onClick={() => void runAction("/approval/approve-all")}
              >
                Approve
              </AdminPrimaryButton>
            </>
          ) : null}
          {canAssignSubmit ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => {
                setAssignTo(order.assigned_to ? String(order.assigned_to) : "")
                setAssignOpen(true)
              }}
            >
              {isRejected ? "Reassign & submit" : "Assign & submit"}
            </AdminPrimaryButton>
          ) : null}
          {canStart ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => void runAction("/start")}
            >
              Start
            </AdminPrimaryButton>
          ) : null}
          {canScan ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => void runAction("/submit-closure")}
            >
              Complete
            </AdminPrimaryButton>
          ) : null}
          {canClose ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => void runAction("/close")}
            >
              Close
            </AdminPrimaryButton>
          ) : null}
          <AdminBackLink to="/dashboard/orders">Orders</AdminBackLink>
        </div>
      }
    >
      <div className="space-y-[var(--app-grid-gap)]">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {order.order_number}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {order.plant_name} · {order.cost_center_code}
          {order.assigned_to_name ? ` · ${order.assigned_to_name}` : ""}
        </p>
      </div>
      {canReviewCreation && order.approval_notice?.message ? (
        <Alert className="shrink-0 border-amber-200/80 bg-amber-50/90 dark:border-amber-900/50 dark:bg-amber-950/30">
          <AlertTitle>Financial year verification</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{order.approval_notice.message}</p>
            {order.approval_notice.reset_on_approval_asset_codes.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Reset on approval:{" "}
                <span className="font-mono text-foreground">
                  {order.approval_notice.reset_on_approval_asset_codes.join(", ")}
                </span>
              </p>
            ) : null}
            {order.approval_notice.fy_verified_asset_codes.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Already verified in {order.approval_notice.financial_year_label ?? "this FY"}:{" "}
                <span className="font-mono text-foreground">
                  {order.approval_notice.fy_verified_asset_codes.join(", ")}
                </span>
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <AdminPanel className="shrink-0 overflow-hidden p-0">
        <div className={cn("border-b border-border/60 bg-muted/15 py-3", orderPanelPad)}>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Progress
          </p>
          <OrderLifecycleStepper
            steps={order.progress.steps}
            currentStepKey={order.progress.current_step_key}
            orderStatus={order.status}
          />
          {activeProgressStep?.detail ? (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{activeProgressStep.detail}</p>
          ) : null}
        </div>
      </AdminPanel>

      <AdminPanel className="shrink-0 overflow-hidden p-0">
        <div className={cn("space-y-2 py-3", orderPanelPad)}>
          <h3 className="text-sm font-semibold text-foreground">Order summary</h3>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
            <OrderSummaryField
              label="Pending"
              value={order.pending_physical_count}
              tone="warning"
            />
            <OrderSummaryField
              label="Verified"
              value={order.physically_verified_count}
              tone="success"
            />
            <OrderSummaryField label="Created" value={formatDt(order.created_at)} />
            <OrderSummaryField
              label="Started"
              value={order.started_at ? formatDt(order.started_at) : "—"}
            />
            <OrderSummaryField
              label="Executor"
              value={order.assigned_to_name || "—"}
            />
          </div>
        </div>

        {canScan ? (
          <div className={cn("relative space-y-3 border-t border-border/60 py-4", orderPanelPad)}>
            {busy && busyLabel ? (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/75 backdrop-blur-[1px]"
                aria-live="polite"
                aria-busy="true"
              >
                <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
                <span className="text-sm font-medium text-foreground">{busyLabel}</span>
              </div>
            ) : null}
            {selectedScanItem ? (
              <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <ScanLine className="size-4 text-primary" aria-hidden />
                      Scan {selectedScanItem.asset_code}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Expected RFID: {selectedScanItem.rfid_code ?? "—"}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedScanItemId(null)}>
                    Cancel
                  </Button>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[12rem] flex-1 space-y-1">
                    <Label htmlFor="scan" className="sr-only">
                      Scan RFID
                    </Label>
                    <Input
                      id="scan"
                      autoFocus
                      value={scanValue}
                      onChange={(e) => setScanValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void scan()
                      }}
                      placeholder="Scan RFID tag…"
                      className="h-10"
                    />
                  </div>
                  <Button type="button" disabled={busy || !scanValue.trim()} onClick={() => void scan()}>
                    Verify
                  </Button>
                </div>
              </div>
            ) : order.pending_physical_count > 0 ? (
              <p className="text-sm text-muted-foreground">
                Select a pending asset below to scan its RFID tag, or use Complete when ready.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                All assets scanned. Use Complete when ready.
              </p>
            )}
          </div>
        ) : null}
      </AdminPanel>

      <AdminPanel className="shrink-0 overflow-hidden p-0">
        <div className={cn("flex flex-wrap items-center gap-2 border-b border-border/60 py-3", orderPanelPad)}>
          <p className="mr-auto text-sm font-medium text-foreground">
            Assets
            <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
              ({order.total_count})
            </span>
          </p>
          <div className="relative min-w-[14rem] flex-1 sm:max-w-md">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="order-asset-search"
              value={assetSearchInput}
              onChange={(e) => setAssetSearchInput(e.target.value)}
              placeholder="Search asset code, name, RFID, or verifier…"
              className="h-9 w-full pl-9"
              aria-label="Search order assets"
            />
            {assetSearchInput ? (
              <button
                type="button"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
                onClick={() => setAssetSearchInput("")}
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              listToolbarBtnClass,
              assetColumnFiltersOpen && "border-primary/40 bg-primary/5",
            )}
            aria-expanded={assetColumnFiltersOpen}
            onClick={() => setAssetColumnFiltersOpen((open) => !open)}
          >
            <ListFilter className="size-4" aria-hidden />
            Filter
            {activeAssetColumnFilterCount > 0 ? (
              <Badge variant="secondary" className="h-5 min-w-5 rounded-full px-1.5 text-[10px]">
                {activeAssetColumnFilterCount}
              </Badge>
            ) : null}
          </Button>

          {activeAssetColumnFilterCount > 0 || assetSearch.trim() ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={listToolbarBtnClass}
              onClick={clearAssetFilters}
            >
              Clear
            </Button>
          ) : null}
        </div>
        <div className="app-data-table-wrap min-h-0">
          <Table className="app-table-head-sticky">
            <TableHeader>
              <AdminTableHeaderRow>
                {showRowSelection ? (
                  <AdminTableHeadCell className="w-10">
                    <Checkbox
                      checked={
                        selectableItems.length > 0 &&
                        selectableItems.every((item) => selected.has(item.id))
                      }
                      disabled={selectableItems.length === 0}
                      onCheckedChange={(on) => {
                        if (on) setSelected(new Set(selectableItems.map((item) => item.id)))
                        else setSelected(new Set())
                      }}
                    />
                  </AdminTableHeadCell>
                ) : null}
                <AdminTableHeadCell>Asset</AdminTableHeadCell>
                <AdminTableHeadCell>RFID</AdminTableHeadCell>
                <AdminTableHeadCell>Status</AdminTableHeadCell>
                <AdminTableHeadCell>Verified</AdminTableHeadCell>
                {showRejectColumn ? <AdminTableHeadCell>Rejection</AdminTableHeadCell> : null}
              </AdminTableHeaderRow>
              {assetColumnFiltersOpen ? (
                <AdminTableHeaderRow>
                  {showRowSelection ? (
                    <AdminTableHeadCell className="px-2 py-1.5">{"\u00a0"}</AdminTableHeadCell>
                  ) : null}
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <Input
                      value={assetColumnFilterInputs.asset}
                      onChange={(e) =>
                        setAssetColumnFilterInputs((f) => ({ ...f, asset: e.target.value }))
                      }
                      aria-label="Filter asset code or name"
                      placeholder="Code / name"
                      className={columnFilterControlClass}
                    />
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <Input
                      value={assetColumnFilterInputs.rfid}
                      onChange={(e) =>
                        setAssetColumnFilterInputs((f) => ({ ...f, rfid: e.target.value }))
                      }
                      aria-label="Filter RFID"
                      placeholder="RFID"
                      className={columnFilterControlClass}
                    />
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <select
                      value={assetColumnFilterInputs.status}
                      onChange={(e) =>
                        setAssetColumnFilterInputs((f) => ({
                          ...f,
                          status: e.target.value as AssetColumnFilters["status"],
                        }))
                      }
                      aria-label="Filter status"
                      className={cn(adminSelectClass, columnFilterControlClass)}
                    >
                      <option value="">All statuses</option>
                      <option value="pending">Pending</option>
                      <option value="verified">Verified</option>
                      {showStatusRejectedOption || assetColumnFilterInputs.status === "rejected" ? (
                        <option value="rejected">Rejected</option>
                      ) : null}
                    </select>
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <Input
                      value={assetColumnFilterInputs.verified_by}
                      onChange={(e) =>
                        setAssetColumnFilterInputs((f) => ({ ...f, verified_by: e.target.value }))
                      }
                      aria-label="Filter verified by"
                      placeholder="Verified by"
                      className={columnFilterControlClass}
                    />
                  </AdminTableHeadCell>
                  {showRejectColumn ? (
                    <AdminTableHeadCell className="px-2 py-1.5">{"\u00a0"}</AdminTableHeadCell>
                  ) : null}
                </AdminTableHeaderRow>
              ) : null}
            </TableHeader>
            <TableBody>
              {pagedItems.length === 0 ? (
                <AdminTableEmptyRow colSpan={tableColSpan}>
                  {assetTotal === 0 && (assetSearch.trim() || activeAssetColumnFilterCount > 0)
                    ? "No assets match your search or filters."
                    : "No assets in this view."}
                </AdminTableEmptyRow>
              ) : (
                pagedItems.map((item) => {
                  const scannable = itemIsScannable(item)
                  const isSelectedForScan = selectedScanItemId === item.id
                  const rowTone = itemRowTone(item)
                  return (
                    <AdminTableBodyRow
                      key={item.id}
                      interactive={scannable}
                      className={cn(
                        rowTone === "approved" && "bg-emerald-50/70 dark:bg-emerald-950/20",
                        rowTone === "rejected" && "bg-red-50/80 dark:bg-red-950/25",
                        scannable && "cursor-pointer hover:bg-muted/30",
                        isSelectedForScan && "bg-primary/5 ring-1 ring-inset ring-primary/20",
                      )}
                      onClick={() => {
                        if (!scannable) return
                        setSelectedScanItemId(item.id)
                        setScanValue("")
                      }}
                    >
                      {showRowSelection ? (
                        <AdminTableCell>
                          <div onClick={(e: React.MouseEvent) => e.stopPropagation()} role="presentation">
                            <Checkbox
                              checked={selected.has(item.id)}
                              disabled={!itemIsSelectableAtClosure(item)}
                              onCheckedChange={(on) => {
                                setSelected((prev) => {
                                  const next = new Set(prev)
                                  if (on) next.add(item.id)
                                  else next.delete(item.id)
                                  return next
                                })
                              }}
                            />
                          </div>
                        </AdminTableCell>
                      ) : null}
                      <AdminTableCell className="whitespace-normal">
                        <Link
                          to={`/dashboard/assets/${item.asset_id}`}
                          className="font-mono text-xs text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {item.asset_code}
                        </Link>
                        <p className="mt-0.5 text-sm text-foreground">{item.asset_name}</p>
                      </AdminTableCell>
                      <AdminTableCell className="font-mono text-xs text-foreground">
                        {item.rfid_code ?? "—"}
                      </AdminTableCell>
                      <AdminTableCell>
                        {item.verification_status === "rejected" && !item.physically_verified ? (
                          <AdminPillBadge tone="danger">Rejected</AdminPillBadge>
                        ) : item.physically_verified ? (
                          <AdminPillBadge tone="success" className="gap-1">
                            <Lock className="size-3" aria-hidden />
                            Verified
                          </AdminPillBadge>
                        ) : scannable ? (
                          <AdminPillBadge tone="warning">Scan pending</AdminPillBadge>
                        ) : (item.verification_status || "").toLowerCase() === "pending" ? (
                          <AdminPillBadge tone="warning">Pending</AdminPillBadge>
                        ) : (
                          <AdminPillBadge tone="neutral">
                            {item.verification_status || "Pending"}
                          </AdminPillBadge>
                        )}
                      </AdminTableCell>
                      <AdminTableCell className="whitespace-normal text-sm text-foreground">
                        {item.physically_verified ? (
                          <>
                            <div>{formatDate(item.last_verification_date)}</div>
                            {item.verified_by_name ? (
                              <div className="text-xs text-muted-foreground">{item.verified_by_name}</div>
                            ) : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </AdminTableCell>
                      {showRejectColumn ? (
                        <AdminTableCell className="whitespace-normal text-sm text-foreground">
                          {item.rejection_reason ? (
                            <span className="text-destructive">{item.rejection_reason}</span>
                          ) : item.physically_verified ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            "—"
                          )}
                        </AdminTableCell>
                      ) : null}
                    </AdminTableBodyRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
        <AdminTablePagination
          page={safeAssetPage}
          totalPages={assetTotalPages}
          total={assetTotal}
          pageSize={ORDER_ASSETS_PAGE_SIZE}
          itemLabel="assets"
          onPageChange={setAssetPage}
        />
      </AdminPanel>

      <OrderAuditLog rows={order.audit} />
      </div>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isRejected ? "Reassign & submit" : "Assign & submit"}</DialogTitle>
            <DialogDescription>
              {executorRoleName
                ? `Select a user from the "${executorRoleName}" role defined in the physical order assignment workflow. The order moves to Assigned so they can start work.`
                : "Select an executor from the role defined in the physical order assignment workflow. The order moves to Assigned so they can start work."}
            </DialogDescription>
          </DialogHeader>
          <div className="dialog-body space-y-4">
            <div className="space-y-2">
              <Label htmlFor="assign-to">
                {executorRoleName ? `${executorRoleName} *` : "Executor *"}
              </Label>
              <select
                id="assign-to"
                className={adminSelectClass}
                value={assignTo}
                onChange={(e) => setAssignTo(e.target.value)}
              >
                <option value="">
                  {executorRoleName ? `Select ${executorRoleName}…` : "Select executor…"}
                </option>
                {executors.map((e) => (
                  <option key={e.id} value={String(e.id)}>
                    {e.full_name}
                    {e.email ? ` (${e.email})` : ""}
                  </option>
                ))}
              </select>
              {executors.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {executorRoleName
                    ? `No users in the "${executorRoleName}" role for this plant. Assign that role to users scoped to this plant.`
                    : "Configure the physical order assignment workflow (order.create) and ensure its first-step role has users for this plant."}
                </p>
              ) : null}
            </div>
          </div>
          <div className="dialog-footer-actions">
            <Button type="button" variant="outline" onClick={() => setAssignOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <AdminPrimaryButton
              type="button"
              disabled={busy || !assignTo}
              onClick={() => {
                if (!assignTo) {
                  toast.error("Select an executor.")
                  return
                }
                void runAction("/submit", { assigned_to: Number(assignTo) }).then((ok) => {
                  if (ok) setAssignOpen(false)
                })
              }}
            >
              {busyAction === "/submit" ? "Submitting…" : "Submit"}
            </AdminPrimaryButton>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={reassignOpen} onOpenChange={setReassignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign order</DialogTitle>
            <DialogDescription>
              {executorRoleName
                ? `Select a different user from the "${executorRoleName}" workflow role. Work has not started yet.`
                : "Select a new executor. Work has not started yet, so reassignment is allowed."}
            </DialogDescription>
          </DialogHeader>
          <div className="dialog-body space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reassign-to">
                {executorRoleName ? executorRoleName : "Executor"}
              </Label>
              <select
                id="reassign-to"
                className={adminSelectClass}
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
              >
                <option value="">Select executor…</option>
                {executors
                  .filter((e) => e.id !== order.assigned_to)
                  .map((e) => (
                  <option key={e.id} value={String(e.id)}>
                    {e.full_name}
                    {e.email ? ` (${e.email})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setReassignOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!reassignTo || busy}
                onClick={() => {
                  void runAction("/reassign", { assigned_to: Number(reassignTo) }).then(() => {
                    setReassignOpen(false)
                    toast.success("Order reassigned.")
                  })
                }}
              >
                Reassign
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {rejectMode === "order" ? "Reject order" : "Reject selected assets"}
            </DialogTitle>
            <DialogDescription>A reason is required.</DialogDescription>
          </DialogHeader>
          <div className="dialog-body space-y-4">
            <textarea
              className={cn("w-full rounded-md border border-input bg-background px-3 py-2 text-sm")}
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRejectOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!rejectReason.trim() || busy}
                onClick={() => {
                  const reason = rejectReason.trim()
                  if (rejectMode === "order") {
                    void runAction("/approval/reject-order", { reason }).then(() => setRejectOpen(false))
                  } else {
                    void runAction("/approval/reject-items", {
                      item_ids: [...selected],
                      rejection_reason: reason,
                    }).then(() => setRejectOpen(false))
                  }
                }}
              >
                Confirm
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={closureRejectBlockedOpen} onOpenChange={setClosureRejectBlockedOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cannot reject verified assets</DialogTitle>
            <DialogDescription>
              Physically verified assets cannot be rejected.
            </DialogDescription>
          </DialogHeader>
          <div className="dialog-body">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Verified
            </p>
            <p className="font-mono text-sm font-medium text-foreground">
              {closureRejectVerifiedCodes.join(", ")}
            </p>
          </div>
          <div className="dialog-footer-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => setClosureRejectBlockedOpen(false)}
            >
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={closureRejectConfirmOpen} onOpenChange={setClosureRejectConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Verified assets selected</DialogTitle>
            <DialogDescription>
              Verified assets will be skipped. Reject the rest?
            </DialogDescription>
          </DialogHeader>
          {closureRejectVerifiedCodes.length > 0 ? (
            <div className="dialog-body">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Skipped
              </p>
              <p className="font-mono text-sm font-medium text-foreground">
                {closureRejectVerifiedCodes.join(", ")}
              </p>
            </div>
          ) : null}
          <div className="dialog-footer-actions">
            <Button type="button" variant="outline" onClick={() => setClosureRejectConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setClosureRejectConfirmOpen(false)
                setRejectMode("items")
                setRejectOpen(true)
              }}
            >
              Reject others
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}
