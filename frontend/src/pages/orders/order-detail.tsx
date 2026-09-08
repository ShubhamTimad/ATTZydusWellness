import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  ListFilter,
  Loader2,
  Lock,
  ScanLine,
  Search,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { RequiredFieldMark } from "@/components/assets/required-field-mark"
import { AdminPage } from "@/components/layout/admin-page"
import { PageLoader } from "@/components/ui/page-loader"
import {
  AdminBackLink,
  AdminPanel,
  AdminPillBadge,
  AdminPrimaryButton,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
  adminTextareaClass,
} from "@/components/layout/admin-ui"
import {
  AdminTableBodyRow,
  AdminTableEmptyRow,
  AdminTablePagination,
} from "@/components/layout/list-page-ui"
import { OrderAuditLog } from "@/components/orders/order-audit-log"
import { OrderLifecycleStepper } from "@/components/orders/order-lifecycle-stepper"
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
import { useConfirmDialog } from "@/components/ui/confirm-dialog"
import { ApiError, deleteJson, getJson, patchJson, postJson } from "@/lib/api"
import { invalidateAssetLists, invalidateOrderLists } from "@/lib/query-client"
import {
  orderStatusLabel,
  orderStatusPillTone,
  type ExecutorListResponse,
  type ExecutorUser,
  type PhysicalOrderDetail,
  type PhysicalOrderItem,
} from "@/lib/orders-types"
import { hasPermission } from "@/lib/permissions"
import { formatAppDate as formatDate, formatAppDateTime as formatDt } from "@/lib/dates"
import { cn } from "@/lib/utils"
import { CapexAssigneePickerDialog } from "@/pages/capex/capex-assignee-picker-dialog"

type AssetColumnFilters = {
  asset_name: string
  asset_code: string
  rfid: string
  cost_center: string
  verified_on: string
  inventory_count: string
  physical_count: string
  order_remark: string
  status: "" | "pending" | "verified" | "approved" | "rejected"
  verified_by: string
}

const DEFAULT_ASSET_COLUMN_FILTERS: AssetColumnFilters = {
  asset_name: "",
  asset_code: "",
  rfid: "",
  cost_center: "",
  verified_on: "",
  inventory_count: "",
  physical_count: "",
  order_remark: "",
  status: "",
  verified_by: "",
}

const ORDER_ASSETS_PAGE_SIZE = 25
const columnFilterControlClass = "h-8 w-full min-w-[6rem] text-xs"
const listToolbarBtnClass = "h-9 shrink-0 gap-1.5 px-3"

function orderAssigneesUrl(order: PhysicalOrderDetail, roleId?: number | null): string {
  const params = new URLSearchParams({ plant_id: String(order.plant_id) })
  const ccIds = order.cost_center_ids?.length
    ? order.cost_center_ids
    : order.cost_center_id != null
      ? [order.cost_center_id]
      : []
  for (const id of ccIds) params.append("cost_center_id", String(id))
  if (roleId != null) params.set("role_id", String(roleId))
  return `/admin/physical-orders/assignees?${params}`
}

const ORDER_ACTION_BUSY_LABELS: Record<string, string> = {
  "/submit-closure": "Completing order…",
  "/approval/approve-all": "Approving…",
  "/approval/approve-order": "Approving…",
  "/approval/approve-items": "Approving…",
  "/approval/reject-items": "Rejecting…",
  "/close": "Closing order…",
  "/start": "Starting…",
  "/restart": "Restarting…",
  "/submit": "Assigning…",
  "/reassign": "Reassigning…",
}

type ClosureLineDecision = {
  choice: "approve" | "reject" | null
}

function matchesAssetSearch(item: PhysicalOrderItem, search: string): boolean {
  const q = search.trim().toLowerCase()
  if (!q) return true
  return [item.asset_code, item.asset_name, item.rfid_code, item.verified_by_name]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q))
}

function matchesAssetColumnFilters(item: PhysicalOrderItem, filters: AssetColumnFilters): boolean {
  const assetNameQ = filters.asset_name.trim().toLowerCase()
  if (assetNameQ && !item.asset_name.toLowerCase().includes(assetNameQ)) {
    return false
  }
  const assetCodeQ = filters.asset_code.trim().toLowerCase()
  if (assetCodeQ && !item.asset_code.toLowerCase().includes(assetCodeQ)) {
    return false
  }
  const rfidQ = filters.rfid.trim().toLowerCase()
  if (rfidQ && !(item.rfid_code || "").toLowerCase().includes(rfidQ)) return false
  const costCenterQ = filters.cost_center.trim().toLowerCase()
  if (costCenterQ && !(item.cost_center_code || "").toLowerCase().includes(costCenterQ)) return false
  const verifiedOnQ = filters.verified_on.trim().toLowerCase()
  if (
    verifiedOnQ &&
    !String(item.last_verification_date ? formatDate(item.last_verification_date) : "—")
      .toLowerCase()
      .includes(verifiedOnQ)
  ) {
    return false
  }
  const inventoryCountQ = filters.inventory_count.trim().toLowerCase()
  if (inventoryCountQ && !String(item.inventory_count ?? 1).toLowerCase().includes(inventoryCountQ)) {
    return false
  }
  const physicalCountQ = filters.physical_count.trim().toLowerCase()
  if (physicalCountQ && !String(item.physical_count ?? 0).toLowerCase().includes(physicalCountQ)) {
    return false
  }
  const orderRemarkQ = filters.order_remark.trim().toLowerCase()
  if (orderRemarkQ && !(item.remark || "").toLowerCase().includes(orderRemarkQ)) return false
  if (filters.status === "pending") {
    if (item.physically_verified || item.verification_status === "rejected") return false
  } else if (filters.status === "verified") {
    if (!item.physically_verified) return false
    if ((item.verification_status || "").toLowerCase() === "approved") return false
    if ((item.verification_status || "").toLowerCase() === "rejected") return false
  } else if (filters.status === "approved") {
    if ((item.verification_status || "").toLowerCase() !== "approved") return false
  } else if (filters.status === "rejected") {
    if (item.verification_status !== "rejected") return false
  }
  const byQ = filters.verified_by.trim().toLowerCase()
  if (byQ && !(item.verified_by_name || "").toLowerCase().includes(byQ)) return false
  return true
}

function itemRowTone(item: PhysicalOrderItem): "approved" | "rejected" | "default" {
  if (item.verification_status === "rejected") return "rejected"
  if ((item.verification_status || "").toLowerCase() === "approved") return "approved"
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
      <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-black">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-normal tabular-nums leading-snug text-black">
        {value}
      </p>
    </div>
  )
}

const orderPanelPad = "px-[var(--app-card-padding)]"

export function OrderDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = React.useState<PhysicalOrderDetail | null>(null)
  const [currentUserId, setCurrentUserId] = React.useState<number | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [busyAction, setBusyAction] = React.useState<string | null>(null)
  const [closureDecisions, setClosureDecisions] = React.useState<
    Record<number, ClosureLineDecision>
  >({})
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
  const [remarkDrafts, setRemarkDrafts] = React.useState<Record<number, string>>({})
  const [savingRemarkItemId, setSavingRemarkItemId] = React.useState<number | null>(null)
  const [remarkFocusItemId, setRemarkFocusItemId] = React.useState<number | null>(null)
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [rejectReason, setRejectReason] = React.useState("")
  const [reassignOpen, setReassignOpen] = React.useState(false)
  const [assignOpen, setAssignOpen] = React.useState(false)
  const [closureAssignOpen, setClosureAssignOpen] = React.useState(false)
  const [closureNextOpen, setClosureNextOpen] = React.useState(false)
  const [executors, setExecutors] = React.useState<ExecutorUser[]>([])
  const [executorRoleName, setExecutorRoleName] = React.useState<string | null>(null)
  const [reassignTo, setReassignTo] = React.useState("")
  const [assignTo, setAssignTo] = React.useState("")
  const [assignRemarks, setAssignRemarks] = React.useState("")
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()
  const canApprove = hasPermission("order.approve")
  const canExecute = hasPermission("order.execute")
  const canCreate = hasPermission("order.create")
  const canReassignOrder = hasPermission("order.reassign")

  const load = React.useCallback(async (opts?: { quiet?: boolean }) => {
    if (!id) return
    const quiet = Boolean(opts?.quiet)
    if (!quiet) setLoading(true)
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
      if (!quiet) setLoading(false)
    }
  }, [id])

  React.useEffect(() => {
    void load()
  }, [load])

  // Asset Master RFID is live on the API; refresh when returning to this tab/page
  // so Expected RFID / the items table are not stuck on a stale client copy.
  React.useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load({ quiet: true })
    }
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void load({ quiet: true })
    }
    document.addEventListener("visibilitychange", refresh)
    window.addEventListener("focus", refresh)
    window.addEventListener("pageshow", onPageShow)
    return () => {
      document.removeEventListener("visibilitychange", refresh)
      window.removeEventListener("focus", refresh)
      window.removeEventListener("pageshow", onPageShow)
    }
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
    setRemarkDrafts((prev) => {
      const next: Record<number, string> = {}
      for (const item of order.items) {
        const keepLocal =
          (savingRemarkItemId === item.id || remarkFocusItemId === item.id) &&
          prev[item.id] != null
        next[item.id] = keepLocal ? prev[item.id] : (item.remark ?? "")
      }
      return next
    })
  }, [order, savingRemarkItemId, remarkFocusItemId])

  React.useEffect(() => {
    if (!order) return
    setClosureDecisions((prev) => {
      const next: Record<number, ClosureLineDecision> = {}
      for (const item of order.items) {
        const status = (item.verification_status || "").toLowerCase()
        const existing = prev[item.id]
        if (status === "approved") {
          next[item.id] = { choice: "approve" }
        } else if (status === "rejected") {
          next[item.id] = { choice: "reject" }
        } else if (existing?.choice === "approve" || existing?.choice === "reject") {
          next[item.id] = existing
        } else {
          next[item.id] = { choice: null }
        }
      }
      return next
    })
  }, [order])

  React.useEffect(() => {
    if (!order) return
    const stillVisible = order.items.some((item) => item.id === selectedScanItemId)
    if (!stillVisible) setSelectedScanItemId(null)
  }, [order, selectedScanItemId])

  React.useEffect(() => {
    if ((!reassignOpen && !assignOpen) || !order) return
    const params = new URLSearchParams({ plant_id: String(order.plant_id) })
    const ccIds = order.cost_center_ids?.length
      ? order.cost_center_ids
      : order.cost_center_id != null
        ? [order.cost_center_id]
        : []
    for (const id of ccIds) params.append("cost_center_id", String(id))
    void getJson<ExecutorListResponse>(`/admin/physical-orders/executors?${params}`)
      .then((res) => {
        setExecutors(res.items)
        setExecutorRoleName(res.role_name)
      })
      .catch((e) => {
        setExecutors([])
        setExecutorRoleName(null)
        toast.error(e instanceof ApiError ? e.message : "Could not load executors from workflow.")
      })
  }, [reassignOpen, assignOpen, order?.plant_id, order?.cost_center_id, order?.cost_center_ids])

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
      if (
        path === "/approval/approve-order" &&
        (res.status === "approved" || res.status === "assigned")
      ) {
        toast.success("Order approved successfully.")
      } else if (
        (path === "/approval/approve-all" ||
          path === "/closure/approve-order" ||
          path === "/approval/approve-items") &&
        res.status === "approved"
      ) {
        toast.success("Order approved successfully.")
      } else if (path === "/approval/approve-items" && res.status === "completed") {
        toast.success("Order approved successfully.")
      } else if (path === "/approval/approve-items" && res.status === "pending_closure_approval") {
        toast.success("Selected Assets approved successfully.")
      } else if (path === "/approval/reject-items") {
        toast.success(
          res.status === "in_progress"
            ? res.assigned_to_name
              ? `Order returned to ${res.assigned_to_name} for rework.`
              : "Order returned to executor for rework."
            : res.status === "rejected"
              ? res.assigned_to_name
                ? `Order Rejected. ${res.assigned_to_name} can start verification again on rejected assets.`
                : "Order Rejected."
              : "Assets marked rejected.",
        )
      } else if (path === "/approval/reject-order") {
        toast.success(
          res.assigned_to_name
            ? `Order Rejected. ${res.assigned_to_name} can start verification again on rejected assets.`
            : "Order Rejected.",
        )
      } else if (path === "/approval/approve-all" && res.status === "rejected") {
        toast.success(
          res.assigned_to_name
            ? `Order rejected and returned to ${res.assigned_to_name} for rework.`
            : `Order rejected and returned for rework.`,
        )
      } else if (path === "/approval/approve-all" && res.status === "completed") {
        toast.success(
          res.assigned_to_name
            ? `Approved. Assigned next to ${res.assigned_to_name}.`
            : "Approved.",
        )
      } else if (path === "/start" && res.status === "in_progress") {
        toast.success("Verification started successfully.")
      } else if (path === "/submit-closure") {
        toast.success("Order completed successfully.")
      } else if (path === "/submit") {
        toast.success(
          res.assigned_to_name
            ? `Order assigned to ${res.assigned_to_name} successfully.`
            : "Order assigned successfully.",
        )
      } else {
        toast.success("Changes saved successfully.")
      }
      void invalidateOrderLists()
      void invalidateAssetLists()
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
    if (!id || !scanValue.trim() || selectedScanItemId == null || !order) return
    const scanItem = order.items.find((item) => item.id === selectedScanItemId)
    setBusy(true)
    try {
      if (scanItem) await saveOrderRemark(scanItem)
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
      void invalidateOrderLists()
      void invalidateAssetLists()
      toast.success(`Asset verified (${res.verified_count}/${res.total_count}).`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Scan failed.")
    } finally {
      setBusy(false)
    }
  }

  async function saveOrderRemark(item: PhysicalOrderItem) {
    if (!id || !order) return
    if (order.status !== "in_progress") return
    if (!canExecute || currentUserId == null || order.assigned_to !== currentUserId) return
    const draft = (remarkDrafts[item.id] ?? "").trim()
    const saved = (item.remark ?? "").trim()
    if (draft === saved) return
    setSavingRemarkItemId(item.id)
    try {
      await patchJson<{ asset_id: number; remark: string | null }>(
        `/admin/physical-orders/${id}/assets/${item.asset_id}/remark`,
        { remark: draft || null },
      )
      setOrder((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          items: prev.items.map((row) =>
            row.id === item.id ? { ...row, remark: draft || null } : row,
          ),
        }
      })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to save order remark.")
      setRemarkDrafts((prev) => ({ ...prev, [item.id]: item.remark ?? "" }))
    } finally {
      setSavingRemarkItemId(null)
    }
  }

  if (loading || !order) {
    return (
      <AdminPage viewportFill>
        {loading ? <PageLoader label="Loading order" /> : <p className="text-muted-foreground">Order not found.</p>}
      </AdminPage>
    )
  }

  const hasClosureWorkflow = order.progress.closure_workflow != null
  const isDraft = order.status === "draft"
  const isAssigned = order.status === "assigned"
  const isInProgress = order.status === "in_progress"
  const isCompleted = order.status === "completed"
  const isClosureApproved = order.status === "approved"
  const isClosed = order.status === "closed"
  const isRejected = order.status === "rejected"
  const isCreator = currentUserId != null && order.created_by === currentUserId
  const isAssignee = currentUserId != null && order.assigned_to === currentUserId
  const executionSideReject =
    isRejected &&
    Boolean(order.assigned_at || order.started_at || order.completed_at)
  const executorName =
    order.started_by_name?.trim() || order.assigned_to_name?.trim() || null
  const canReviewCreation = Boolean(order.can_review_creation) && canApprove
  const canReviewClosure = Boolean(order.can_review_closure) && canApprove
  const canAssignSubmit =
    (isDraft || (isRejected && !executionSideReject)) && canCreate && isCreator
  const orderDescription = (order.remarks ?? "").trim()
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
  const showStatusApprovedOption = order.items.some(
    (item) => (item.verification_status || "").toLowerCase() === "approved",
  )

  const canReassign = isAssigned && canReassignOrder && !isClosed
  const canClose =
    (isClosureApproved || (isCompleted && !hasClosureWorkflow)) && canApprove

  async function completeOrder() {
    if (!order) return
    const pending = order.pending_physical_count
    if (pending > 0) {
      const ok = await confirmAsk({
        title: "Warning",
        description: "Few assets are not scanned. Do you want to complete the order?",
        confirmLabel: "Complete",
        cancelLabel: "Cancel",
        destructive: true,
      })
      if (!ok) return
    }
    if (hasClosureWorkflow) {
      setClosureAssignOpen(true)
      return
    }
    await runAction("/submit-closure")
  }

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

  function itemStatus(item: PhysicalOrderItem): string {
    return (item.verification_status || "").toLowerCase()
  }

  function itemDecisionLocked(item: PhysicalOrderItem): boolean {
    const status = itemStatus(item)
    return status === "approved" || status === "rejected"
  }

  function setClosureChoice(item: PhysicalOrderItem, choice: "approve" | "reject" | null) {
    if (itemDecisionLocked(item)) return
    setClosureDecisions((prev) => ({
      ...prev,
      [item.id]: { choice },
    }))
  }

  const closureHasRejectChoice =
    canReviewClosure &&
    order.items.some((item) => {
      const status = itemStatus(item)
      if (status === "rejected") return true
      return (closureDecisions[item.id]?.choice ?? null) === "reject"
    })

  /** Every line must be Approve or Reject before header Approve/Reject can run. */
  const closureAllLinesChosen =
    canReviewClosure &&
    order.items.every((item) => {
      if (itemDecisionLocked(item)) return true
      const choice = closureDecisions[item.id]?.choice ?? null
      return choice === "approve" || choice === "reject"
    })
  const closureAllApproved = closureAllLinesChosen && !closureHasRejectChoice

  async function submitClosureLineDecisions(
    rejectionReason: string,
    nextAssignedUserId?: number | null,
  ): Promise<boolean> {
    if (!order || !id) return false
    const reason = rejectionReason.trim()
    if (!reason) {
      toast.error("Enter a reason for rejection.")
      return false
    }
    const pending = order.items.filter((item) => itemStatus(item) === "pending")
    const toReject = pending.filter((item) => closureDecisions[item.id]?.choice !== "approve")

    setBusy(true)
    setBusyAction("/approval/reject-items")
    try {
      let latest = order
      if (toReject.length > 0) {
        latest = await postJson<PhysicalOrderDetail>(
          `/admin/physical-orders/${id}/approval/reject-items`,
          { item_ids: toReject.map((item) => item.id), rejection_reason: reason },
        )
      }
      // Approve remaining pending + finalize mixed or full approval.
      latest = await postJson<PhysicalOrderDetail>(
        `/admin/physical-orders/${id}/approval/approve-all`,
        nextAssignedUserId != null ? { next_assigned_user_id: nextAssignedUserId } : {},
      )
      setOrder(latest)
      if (latest.status === "approved") {
        toast.success("Order approved successfully.")
      } else if (latest.status === "rejected") {
        toast.success(
          latest.assigned_to_name
            ? `Review completed. Rejected assets have been returned for rework.`
            : "Review completed. Rejected assets have been returned for rework.",
        )
      } else {
        toast.success("Review updated successfully.")
      }
      void invalidateOrderLists()
      void invalidateAssetLists()
      return true
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed.")
      return false
    } finally {
      setBusy(false)
      setBusyAction(null)
    }
  }

  async function beginClosureApproveAll() {
    if (!order) return
    if (!closureAllLinesChosen) {
      toast.error("Please select Approve or Reject for all assets.")
      return
    }
    if (closureHasRejectChoice) {
      toast.error("Rejected assets found. Please use Reject to complete the review.")
      return
    }
    if (order.needs_next_closure_assignee) {
      setClosureNextOpen(true)
      return
    }
    await runAction("/approval/approve-all")
  }

  const showClosureDecisionCols = canReviewClosure
  const tableColSpan = 10 + (showClosureDecisionCols ? 2 : 0)

  const canStart =
    ((isAssigned && order.completed_at == null) || executionSideReject) &&
    canExecute &&
    isAssignee

  const activeProgressDetail =
    order.progress.steps
      .find((step) => step.key === order.progress.current_step_key)
      ?.detail?.trim() || null

  return (
    <AdminPage
      fullWidth
      dense
      viewportFill
      description=""
      className="w-full gap-3 pb-6"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AdminPillBadge
            tone={orderStatusPillTone(order.status)}
            className="h-9 px-3.5 text-sm font-semibold"
          >
            {orderStatusLabel(order.status)}
          </AdminPillBadge>
          {order.can_delete ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={async () => {
                const ok = await confirmAsk({
                  title: "Delete Draft Order?",
                  description: "Delete this draft order? This action cannot be undone.",
                  confirmLabel: "Delete",
                  destructive: true,
                })
                if (!ok) return
                setBusy(true)
                try {
                  await deleteJson(`/admin/physical-orders/${order.id}`)
                  toast.success("Draft physical order deleted.")
                  void invalidateOrderLists()
                  void invalidateAssetLists()
                  navigate("/dashboard/orders")
                } catch (e) {
                  toast.error(
                    e instanceof ApiError ? e.message : "Could not delete physical order",
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              Delete Draft
            </Button>
          ) : null}
          {order.can_archive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={async () => {
                const ok = await confirmAsk({
                  title: "Archive Physical Order?",
                  description:
                    "Archive this physical order",
                  confirmLabel: "Archive",
                })
                if (!ok) return
                setBusy(true)
                try {
                  setOrder(
                    await postJson(`/admin/physical-orders/${order.id}/archive`, {}),
                  )
                  toast.success("Physical order archived.")
                  void invalidateOrderLists()
                  void invalidateAssetLists()
                  navigate("/dashboard/orders")
                } catch (e) {
                  toast.error(
                    e instanceof ApiError ? e.message : "Could not archive physical order",
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              Archive
            </Button>
          ) : null}
          {order.can_unarchive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={async () => {
                const ok = await confirmAsk({
                  title: "Unarchive Physical Order?",
                  description:
                    "Restore this physical order so you can edit and resubmit it.",
                  confirmLabel: "Unarchive",
                })
                if (!ok) return
                setBusy(true)
                try {
                  setOrder(
                    await postJson(`/admin/physical-orders/${order.id}/unarchive`, {}),
                  )
                  toast.success("Physical order unarchived.")
                  void invalidateOrderLists()
                  void invalidateAssetLists()
                } catch (e) {
                  toast.error(
                    e instanceof ApiError ? e.message : "Could not unarchive physical order",
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              Unarchive
            </Button>
          ) : null}
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
                  setRejectReason("")
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
              {!closureAllApproved ? (
                <span
                  className="inline-flex"
                  title={
                    !closureAllLinesChosen
                      ? "Select Approve or Reject for every asset before you can reject this order."
                      : undefined
                  }
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9"
                    disabled={busy || !closureAllLinesChosen}
                    onClick={() => {
                      setRejectReason("")
                      setRejectOpen(true)
                    }}
                  >
                    Reject
                  </Button>
                </span>
              ) : null}
              {!closureHasRejectChoice ? (
                <span
                  className="inline-flex"
                  title={
                    !closureAllLinesChosen
                      ? "Select Approve or Reject for every asset before you can approve this order."
                      : undefined
                  }
                >
                  <AdminPrimaryButton
                    type="button"
                    disabled={busy || !closureAllLinesChosen}
                    onClick={() => void beginClosureApproveAll()}
                  >
                    Approve{order.needs_next_closure_assignee ? " & assign next" : ""}
                  </AdminPrimaryButton>
                </span>
              ) : null}
            </>
          ) : null}
          {canAssignSubmit ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => {
                setAssignTo(order.assigned_to ? String(order.assigned_to) : "")
                setAssignRemarks(order.remarks ?? "")
                setAssignOpen(true)
              }}
            >
              {isRejected ? "Reassign" : "Assign"}
            </AdminPrimaryButton>
          ) : null}
          {canStart ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => void runAction("/start")}
            >
              {isRejected ? "Restart" : "Start"}
            </AdminPrimaryButton>
          ) : null}
          {canScan ? (
            <AdminPrimaryButton
              type="button"
              disabled={busy}
              onClick={() => void completeOrder()}
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
          <AdminBackLink to="/dashboard/orders">Order</AdminBackLink>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <div className="shrink-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {order.order_number}
        </h1>
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
          {activeProgressDetail ? (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{activeProgressDetail}</p>
          ) : null}
        </div>
      </AdminPanel>

      <AdminPanel className="shrink-0 overflow-hidden p-0">
        <div className={cn("space-y-2 py-3", orderPanelPad)}>
          <h3 className="text-sm font-semibold text-foreground">Order Summary</h3>
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
              value={executorName || "—"}
            />
          </div>
          <div className="min-w-0 rounded-md bg-muted/35 px-2.5 py-1.5">
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-black">
              Order Description
            </p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-sm font-medium leading-snug text-black">
              {orderDescription || "—"}
            </p>
          </div>
          {isRejected && (order.rejection_reason || "").trim() ? (
            <div className="min-w-0 overflow-hidden rounded-lg border border-red-200 bg-red-50/70 px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-red-700">
                Rejected Reason
              </p>
              <p className="mt-1 whitespace-pre-wrap break-all text-sm leading-relaxed text-red-700">
                {order.rejection_reason}
              </p>
            </div>
          ) : null}
        </div>

        {canScan && selectedScanItem ? (
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
            <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-3 border-b border-border/60 pb-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <ScanLine className="size-4" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        Verify `{selectedScanItem.asset_code}`
                      </p>
                      <p className="mt-0.5 truncate text-sm text-foreground">{selectedScanItem.asset_name}</p>
                      {/* <p className="mt-1 text-xs text-muted-foreground">
                        Expected RFID:{" "}
                        <span className="font-mono text-foreground">
                          {selectedScanItem.rfid_code ?? "—"}
                        </span>
                      </p> */}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() => {
                        void saveOrderRemark(selectedScanItem)
                        setSelectedScanItemId(null)
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 min-w-24"
                      disabled={busy || !scanValue.trim()}
                      onClick={() => void scan()}
                    >
                      Verify
                    </Button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                  <div className="rounded-lg border border-border/60 bg-background p-3">
                    <Label htmlFor="scan" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Scan RFID Tag
                    </Label>
                    <Input
                      id="scan"
                      autoFocus
                      value={scanValue}
                      onChange={(e) => setScanValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void scan()
                      }}
                      placeholder="Scan or Enter RFID"
                      className="mt-2 h-10"
                    />
                  </div>
                  <div className="rounded-lg border border-border/60 bg-background p-3">
                    <Label htmlFor="order-remark" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Order Remark
                    </Label>
                    <Input
                      id="order-remark"
                      value={remarkDrafts[selectedScanItem.id] ?? selectedScanItem.remark ?? ""}
                      onChange={(e) =>
                        setRemarkDrafts((prev) => ({
                          ...prev,
                          [selectedScanItem.id]: e.target.value,
                        }))
                      }
                      onFocus={() => setRemarkFocusItemId(selectedScanItem.id)}
                      onBlur={() => {
                        void saveOrderRemark(selectedScanItem).finally(() =>
                          setRemarkFocusItemId((cur) =>
                            cur === selectedScanItem.id ? null : cur,
                          ),
                        )
                      }}
                      disabled={busy || savingRemarkItemId === selectedScanItem.id}
                      placeholder="Optional Remark"
                      className="mt-2 h-10"
                    />
                  </div>
                </div>
              </div>
          </div>
        ) : null}
      </AdminPanel>

      <AdminPanel className="shrink-0 overflow-hidden p-0">
        <div className={cn("flex flex-nowrap items-center gap-2 border-b border-border/60 py-3", orderPanelPad)}>
          <p className="shrink-0 text-sm font-medium text-foreground">
            Asset
            <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
              ({order.total_count})
            </span>
          </p>
          <div className="ml-auto flex min-w-0 flex-nowrap items-center justify-end gap-2">
            <div className="relative min-w-0 w-56 flex-1 sm:w-64 sm:flex-none lg:w-80">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="order-asset-search"
                value={assetSearchInput}
                onChange={(e) => setAssetSearchInput(e.target.value)}
                placeholder="Search Asset"
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
              <span className="inline-flex items-center gap-0.5">
                Filter
                {activeAssetColumnFilterCount > 0 ? (
                  <span className="text-xs font-medium text-red-600">
                    ({activeAssetColumnFilterCount})
                  </span>
                ) : null}
              </span>
            </Button>
            {activeAssetColumnFilterCount > 0 || assetSearch.trim() ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={listToolbarBtnClass}
                onClick={clearAssetFilters}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>
        <div className="app-data-table-wrap min-h-0">
          <Table className="app-table-head-sticky">
            <TableHeader>
              <AdminTableHeaderRow>
                <AdminTableHeadCell className="!text-black">Asset Name</AdminTableHeadCell>
                <AdminTableHeadCell className="!text-black">Asset Code</AdminTableHeadCell>
                <AdminTableHeadCell className="!text-black">RFID</AdminTableHeadCell>
                <AdminTableHeadCell className="!text-black">Cost Center</AdminTableHeadCell>
                <AdminTableHeadCell className="!text-black">Inventory Count</AdminTableHeadCell>
                <AdminTableHeadCell className="!text-black">Physical Count</AdminTableHeadCell>
                <AdminTableHeadCell className="!text-black">Phy. Verification Date</AdminTableHeadCell>
                <AdminTableHeadCell className="!text-black">Order Remark</AdminTableHeadCell>
                <AdminTableHeadCell className="!text-black">Status</AdminTableHeadCell>
                <AdminTableHeadCell className="!text-black">Verified By</AdminTableHeadCell>
                {showClosureDecisionCols ? (
                  <>
                    <AdminTableHeadCell className="w-20 text-center !text-black">
                      Approve
                    </AdminTableHeadCell>
                    <AdminTableHeadCell className="w-20 text-center !text-black">
                      Reject
                    </AdminTableHeadCell>
                  </>
                ) : null}
              </AdminTableHeaderRow>
              {assetColumnFiltersOpen ? (
                <AdminTableHeaderRow>
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <Input
                      value={assetColumnFilterInputs.asset_name}
                      onChange={(e) =>
                        setAssetColumnFilterInputs((f) => ({ ...f, asset_name: e.target.value }))
                      }
                      aria-label="Filter asset name"
                      placeholder="Asset Name"
                      className={columnFilterControlClass}
                    />
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <Input
                      value={assetColumnFilterInputs.asset_code}
                      onChange={(e) =>
                        setAssetColumnFilterInputs((f) => ({ ...f, asset_code: e.target.value }))
                      }
                      aria-label="Filter asset code"
                      placeholder="Asset Code"
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
                    <Input
                      value={assetColumnFilterInputs.cost_center}
                      onChange={(e) =>
                        setAssetColumnFilterInputs((f) => ({ ...f, cost_center: e.target.value }))
                      }
                      aria-label="Filter cost center"
                      placeholder="Cost Center"
                      className={columnFilterControlClass}
                    />
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <Input
                      value={assetColumnFilterInputs.inventory_count}
                      onChange={(e) =>
                        setAssetColumnFilterInputs((f) => ({ ...f, inventory_count: e.target.value }))
                      }
                      aria-label="Filter inventory count"
                      placeholder="Inventory Count"
                      className={columnFilterControlClass}
                    />
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <Input
                      value={assetColumnFilterInputs.physical_count}
                      onChange={(e) =>
                        setAssetColumnFilterInputs((f) => ({ ...f, physical_count: e.target.value }))
                      }
                      aria-label="Filter physical count"
                      placeholder="Physical Count"
                      className={columnFilterControlClass}
                    />
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <Input
                      value={assetColumnFilterInputs.verified_on}
                      onChange={(e) =>
                        setAssetColumnFilterInputs((f) => ({ ...f, verified_on: e.target.value }))
                      }
                      aria-label="Filter physical verification date"
                      placeholder="Phy. Verification Date"
                      className={columnFilterControlClass}
                    />
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <Input
                      value={assetColumnFilterInputs.order_remark}
                      onChange={(e) =>
                        setAssetColumnFilterInputs((f) => ({ ...f, order_remark: e.target.value }))
                      }
                      aria-label="Filter order remark"
                      placeholder="Order Remark"
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
                      <option value="">All</option>
                      <option value="pending">Pending</option>
                      <option value="verified">Verified</option>
                      {showStatusApprovedOption || assetColumnFilterInputs.status === "approved" ? (
                        <option value="approved">Approved</option>
                      ) : null}
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
                      placeholder="Verified By"
                      className={columnFilterControlClass}
                    />
                  </AdminTableHeadCell>
                  {showClosureDecisionCols ? (
                    <>
                      <AdminTableHeadCell className="px-2 py-1.5">{"\u00a0"}</AdminTableHeadCell>
                      <AdminTableHeadCell className="px-2 py-1.5">{"\u00a0"}</AdminTableHeadCell>
                    </>
                  ) : null}
                </AdminTableHeaderRow>
              ) : null}
            </TableHeader>
            <TableBody>
              {pagedItems.length === 0 ? (
                <AdminTableEmptyRow colSpan={tableColSpan}>
                  {assetTotal === 0 && (assetSearch.trim() || activeAssetColumnFilterCount > 0)
                    ? "No Assets match your search or filters."
                    : "No Assets in this view."}
                </AdminTableEmptyRow>
              ) : (
                pagedItems.map((item) => {
                  const scannable = itemIsScannable(item)
                  const isSelectedForScan = selectedScanItemId === item.id
                  const rowTone = itemRowTone(item)
                  const decision = closureDecisions[item.id] ?? { choice: null }
                  const locked = itemDecisionLocked(item)
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
                        if (selectedScanItemId != null && selectedScanItemId !== item.id) {
                          const previous = order.items.find((i) => i.id === selectedScanItemId)
                          if (previous) void saveOrderRemark(previous)
                        }
                        setSelectedScanItemId(item.id)
                        setScanValue("")
                        void load({ quiet: true })
                      }}
                    >
                      <AdminTableCell className="whitespace-normal">
                        <p className="mt-0.5 text-sm text-foreground">{item.asset_name}</p>
                      </AdminTableCell>
                      <AdminTableCell className="font-mono text-xs text-foreground">
                        {item.asset_code}
                      </AdminTableCell>
                      <AdminTableCell className="font-mono text-xs text-foreground">
                        {item.rfid_code ?? "—"}
                      </AdminTableCell>
                      <AdminTableCell className="font-mono text-xs text-foreground">
                        {item.cost_center_code?.trim() ? item.cost_center_code : "—"}
                      </AdminTableCell>
                      <AdminTableCell className="tabular-nums text-foreground">
                        {item.inventory_count ?? 1}
                      </AdminTableCell>
                      <AdminTableCell className="tabular-nums text-foreground">
                        {item.physical_count ?? 0}
                      </AdminTableCell>
                      <AdminTableCell className="whitespace-nowrap text-sm text-foreground">
                        {item.last_verification_date ? formatDate(item.last_verification_date) : "—"}
                      </AdminTableCell>
                      <AdminTableCell className="max-w-[14rem] text-sm text-foreground">
                        <span className="block truncate" title={item.remark ?? undefined}>
                          {item.remark?.trim() ? item.remark : "—"}
                        </span>
                      </AdminTableCell>
                      <AdminTableCell>
                        {item.verification_status === "rejected" ? (
                          <AdminPillBadge tone="danger">Rejected</AdminPillBadge>
                        ) : (item.verification_status || "").toLowerCase() === "approved" ? (
                          <AdminPillBadge tone="success">Approved</AdminPillBadge>
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
                          item.verified_by_name ? (
                            <div className="text-xs">{item.verified_by_name}</div>
                          ) : (
                            "—"
                          )
                        ) : (
                          "—"
                        )}
                      </AdminTableCell>
                      {showClosureDecisionCols ? (
                        <>
                          <AdminTableCell className="text-center align-middle">
                            <div
                              className="flex justify-center"
                              onClick={(e: React.MouseEvent) => e.stopPropagation()}
                              role="presentation"
                            >
                              <Checkbox
                                checked={decision.choice === "approve"}
                                disabled={locked || busy}
                                aria-label={`Approve ${item.asset_code}`}
                                onCheckedChange={(on) =>
                                  setClosureChoice(item, on ? "approve" : null)
                                }
                              />
                            </div>
                          </AdminTableCell>
                          <AdminTableCell className="text-center align-middle">
                            <div
                              className="flex justify-center"
                              onClick={(e: React.MouseEvent) => e.stopPropagation()}
                              role="presentation"
                            >
                              <Checkbox
                                checked={decision.choice === "reject"}
                                disabled={locked || busy}
                                aria-label={`Reject ${item.asset_code}`}
                                onCheckedChange={(on) =>
                                  setClosureChoice(item, on ? "reject" : null)
                                }
                              />
                            </div>
                          </AdminTableCell>
                        </>
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
          itemLabel="Asset"
          onPageChange={setAssetPage}
        />
      </AdminPanel>

      <OrderAuditLog rows={order.audit} fillHeight />
      </div>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isRejected ? "Reassign" : "Assign"}</DialogTitle>
            {/* <DialogDescription>
              {executorRoleName
                ? `Select a user from the "${executorRoleName}" role (Assign step of the Physical order workflow). The order moves to Assigned so they can start work.`
                : "Select an operator from the Physical order workflow Assign step. The order moves to Assigned so they can start work."}
            </DialogDescription> */}
          </DialogHeader>
          <div className="dialog-body space-y-4">
            <div className="space-y-2">
              <Label htmlFor="assign-to">
                {executorRoleName ? `Select ${executorRoleName}` : "Select executor"}{" "}
                <span className="text-destructive" aria-hidden>
                  *
                </span>
              </Label>
              <select
                id="assign-to"
                className={adminSelectClass}
                value={assignTo}
                onChange={(e) => setAssignTo(e.target.value)}
              >
                <option value="">
                  {executorRoleName ? `Select ${executorRoleName}` : "Select executor"}
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
                    ? `No users in the "${executorRoleName}" role with access to all cost centers on this order. Assign that role to users scoped to every selected cost center.`
                    : "Configure the Physical order workflow (order.complete) with an Assign step and ensure that role has users who cover all cost centers on this order."}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="assign-order-description" className="text-sm font-medium">
                Order Description
                <RequiredFieldMark />
              </Label>
              <textarea
                id="assign-order-description"
                className={cn(adminTextareaClass, "min-h-[72px] resize-y")}
                value={assignRemarks}
                onChange={(e) => setAssignRemarks(e.target.value)}
                rows={2}
                placeholder="Enter the order description"
                disabled={busy}
              />
            </div>
          </div>
          <div className="dialog-footer-actions">
            <Button type="button" variant="outline" onClick={() => setAssignOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <AdminPrimaryButton
              type="button"
              disabled={busy || !assignTo || !assignRemarks.trim()}
              onClick={() => {
                if (!assignTo) {
                  toast.error("Select an executor.")
                  return
                }
                if (!assignRemarks.trim()) {
                  toast.error("Enter the order description.")
                  return
                }
                void runAction("/submit", {
                  assigned_to: Number(assignTo),
                  remarks: assignRemarks.trim(),
                }).then((ok) => {
                  if (ok) setAssignOpen(false)
                })
              }}
            >
              {busyAction === "/submit" ? "Assigning…" : isRejected ? "Reassign" : "Assign"}
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
                {executorRoleName ? `Select ${executorRoleName}` : "Select executor"}
              </Label>
              <select
                id="reassign-to"
                className={adminSelectClass}
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
              >
                <option value="">
                  {executorRoleName ? `Select ${executorRoleName}` : "Select executor"}
                </option>
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
            <DialogTitle>Reject Reason</DialogTitle>
          </DialogHeader>
          <div className="dialog-body space-y-4">
            <div className="app-form-field">
              <Label htmlFor="reject-reason" className="text-sm font-medium text-foreground">
                Reject Reason <span className="text-destructive">*</span>
              </Label>
            <textarea
              id="reject-reason"
              className={cn("w-full rounded-md border border-input bg-background px-3 py-2 text-sm")}
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reject Reason (Required)"
              aria-label="Reject Reason"
            />
            </div>
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
                  if (!reason) return
                  if (canReviewClosure) {
                    if (!closureAllLinesChosen) {
                      toast.error("Select Approve or Reject for every asset before continuing.")
                      return
                    }
                    if (closureHasRejectChoice) {
                      if (order.needs_next_closure_assignee) {
                        setRejectOpen(false)
                        setClosureNextOpen(true)
                        return
                      }
                      void submitClosureLineDecisions(reason).then((ok) => {
                        if (ok) setRejectOpen(false)
                      })
                      return
                    }
                  }
                  void runAction("/approval/reject-order", { reason }).then((ok) => {
                    if (ok) setRejectOpen(false)
                  })
                }}
              >
                Confirm
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialog}
      <CapexAssigneePickerDialog
        open={closureAssignOpen}
        onOpenChange={setClosureAssignOpen}
        assigneesUrl={order ? orderAssigneesUrl(order) : undefined}
        roleLabel={order?.closure_approver_role_name || "Approver"}
        confirmLabel="Complete"
        busy={busy}
        onConfirm={async (userId) => {
          const ok = await runAction("/submit-closure", { assignee_user_id: userId })
          if (ok) setClosureAssignOpen(false)
        }}
      />
      <CapexAssigneePickerDialog
        open={closureNextOpen}
        onOpenChange={setClosureNextOpen}
        assigneesUrl={
          order ? orderAssigneesUrl(order, order.next_closure_role_id) : undefined
        }
        roleLabel={order?.next_closure_role_name || "Next Approver"}
        confirmLabel="Assign & approve"
        busy={busy}
        onConfirm={async (userId) => {
          if (closureHasRejectChoice) {
            await submitClosureLineDecisions(rejectReason, userId)
            setClosureNextOpen(false)
            return
          }
          const ok = await runAction("/approval/approve-all", {
            next_assigned_user_id: userId,
          })
          if (ok) setClosureNextOpen(false)
        }}
      />
    </AdminPage>
  )
}
