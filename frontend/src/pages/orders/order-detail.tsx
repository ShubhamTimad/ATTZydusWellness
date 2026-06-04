import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { ChevronDown, CheckCircle2, Clock3, Lock, Package, ScanLine, XCircle } from "lucide-react"
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
} from "@/components/layout/admin-ui"
import {
  ListPageHeader,
  WorkspaceTabs,
  WorkspaceTabsContent,
  WorkspaceTabsList,
  WorkspaceTabsTrigger,
} from "@/components/layout/list-page-ui"
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
import { orderStatusLabel, type PhysicalOrderDetail, type PhysicalOrderItem } from "@/lib/orders-types"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type ItemFilter = "all" | "pending" | "verified" | "approved" | "rejected"

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


function statusPillTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "completed" || status === "approved") return "success"
  if (status === "rejected" || status === "cancelled") return "danger"
  if (status === "in_progress" || status === "pending_closure_approval") return "warning"
  return "neutral"
}

function matchesItemFilter(item: PhysicalOrderItem, filter: ItemFilter): boolean {
  if (filter === "pending") {
    return !item.physically_verified && item.verification_status !== "rejected"
  }
  if (filter === "verified") return item.physically_verified
  if (filter === "approved") {
    return item.physically_verified && item.verification_status !== "rejected"
  }
  if (filter === "rejected") return item.verification_status === "rejected"
  return true
}

function itemRowTone(item: PhysicalOrderItem): "approved" | "rejected" | "default" {
  if (item.verification_status === "rejected") return "rejected"
  if (item.physically_verified && item.verification_status !== "rejected") return "approved"
  return "default"
}

type StatTone = "neutral" | "warning" | "success" | "danger"

function OrderStatCard({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string
  value: number
  tone: StatTone
  icon: React.ComponentType<{ className?: string }>
}) {
  const toneStyles: Record<StatTone, string> = {
    neutral: "border-border/70 bg-muted/20 text-foreground",
    warning: "border-amber-200/80 bg-amber-50/80 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100",
    success: "border-emerald-200/80 bg-emerald-50/80 text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-100",
    danger: "border-red-200/80 bg-red-50/80 text-red-950 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-100",
  }
  const iconStyles: Record<StatTone, string> = {
    neutral: "bg-muted text-muted-foreground",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    danger: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  }

  return (
    <div className={cn("rounded-xl border p-3.5 shadow-sm", toneStyles[tone])}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] opacity-70">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums leading-none">{value}</p>
        </div>
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", iconStyles[tone])}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
    </div>
  )
}

export function OrderDetailPage() {
  const { id } = useParams()
  const [order, setOrder] = React.useState<PhysicalOrderDetail | null>(null)
  const [currentUserId, setCurrentUserId] = React.useState<number | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [itemFilter, setItemFilter] = React.useState<ItemFilter>("all")
  const [selectedScanItemId, setSelectedScanItemId] = React.useState<number | null>(null)
  const [scanValue, setScanValue] = React.useState("")
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [rejectReason, setRejectReason] = React.useState("")
  const [rejectMode, setRejectMode] = React.useState<"items" | "order" | "execution">("items")
  const [closureRejectConfirmOpen, setClosureRejectConfirmOpen] = React.useState(false)
  const [closureRejectVerifiedCodes, setClosureRejectVerifiedCodes] = React.useState<string[]>([])
  const [auditOpen, setAuditOpen] = React.useState(false)

  const canApprove = hasPermission("order.approve")
  const canExecute = hasPermission("order.execute")
  const canCreate = hasPermission("order.create")

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
    if (!order) return
    const stillVisible = order.items.some((item) => item.id === selectedScanItemId)
    if (!stillVisible) setSelectedScanItemId(null)
  }, [order, selectedScanItemId])

  async function runAction(path: string, body?: Record<string, unknown>) {
    if (!id) return
    setBusy(true)
    try {
      const res = await postJson<PhysicalOrderDetail>(
        `/admin/physical-orders/${id}${path}`,
        body ?? {},
      )
      setOrder(res)
      setSelected(new Set())
      toast.success("Updated.")
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed.")
    } finally {
      setBusy(false)
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

  const isPendingApproval = order.status === "pending_approval"
  const isPendingClosure = order.status === "pending_closure_approval"
  const isApproved = order.status === "approved"
  const isInProgress = order.status === "in_progress"
  const isRejected = order.status === "rejected"
  const isCreator = currentUserId != null && order.created_by === currentUserId
  const isAssignee = currentUserId != null && order.assigned_to === currentUserId
  const canReviewCreation = isPendingApproval && canApprove
  const canReviewClosure = isPendingClosure && (isCreator || canApprove)
  const canScan =
    isInProgress && canExecute && isAssignee
  const filteredItems = order.items.filter((item) => matchesItemFilter(item, itemFilter))
  const selectedScanItem = order.items.find((item) => item.id === selectedScanItemId) ?? null
  const approvedLineCount = order.items.filter(
    (item) => item.physically_verified && item.verification_status !== "rejected",
  ).length
  const showLineOutcomeFilters = isInProgress && (approvedLineCount > 0 || order.rejected_item_count > 0)

  const hasActions =
    (isRejected && canCreate && isCreator) ||
    (isApproved && canExecute && isAssignee) ||
    canScan ||
    canReviewCreation ||
    canReviewClosure

  function itemIsScannable(item: PhysicalOrderItem): boolean {
    return canScan && !item.physically_verified
  }

  function itemIsRejectableDuringExecution(item: PhysicalOrderItem): boolean {
    return canScan && !item.physically_verified && item.verification_status !== "rejected"
  }

  function itemIsRejectableAtClosure(item: PhysicalOrderItem): boolean {
    return canReviewClosure && !item.physically_verified
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
      toast.error("Cannot reject: all selected assets are physically verified.")
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

  const showRowSelection = canReviewClosure || canScan
  const selectableItems = filteredItems.filter((item) =>
    canReviewClosure ? itemIsRejectableAtClosure(item) : itemIsRejectableDuringExecution(item),
  )

  const showRejectColumn = order.rejected_item_count > 0 || canReviewClosure
  const tableColSpan = (showRowSelection ? 1 : 0) + 4 + (showRejectColumn ? 1 : 0)

  return (
    <AdminPage fullWidth actions={<AdminBackLink to="/dashboard/orders">Orders</AdminBackLink>}>
      <ListPageHeader
        title={order.order_number}
        description={`${order.plant_name} · ${order.cost_center_code}${order.assigned_to_name ? ` · ${order.assigned_to_name}` : ""}`}
        actions={<AdminPillBadge tone={statusPillTone(order.status)}>{orderStatusLabel(order.status)}</AdminPillBadge>}
      />

      {canReviewCreation && order.approval_notice?.message ? (
        <Alert className="border-amber-200/80 bg-amber-50/90 dark:border-amber-900/50 dark:bg-amber-950/30">
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

      <AdminPanel className="overflow-hidden p-0">
        <div className="border-b border-border/60 bg-muted/15 px-4 py-3 sm:px-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Order progress
          </p>
          <OrderLifecycleStepper
            compact
            steps={order.progress.steps}
            currentStepKey={order.progress.current_step_key}
            orderStatus={order.status}
          />
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
          <OrderStatCard label="Pending" value={order.pending_physical_count} tone="warning" icon={Clock3} />
          <OrderStatCard label="Verified" value={order.physically_verified_count} tone="success" icon={CheckCircle2} />
          <OrderStatCard label="Total assets" value={order.total_count} tone="neutral" icon={Package} />
          {order.rejected_item_count > 0 ? (
            <OrderStatCard label="Rejected" value={order.rejected_item_count} tone="danger" icon={XCircle} />
          ) : (
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5 shadow-sm text-foreground">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] opacity-70">Complete</p>
                  <p className="mt-1.5 text-2xl font-semibold tabular-nums leading-none">
                    {order.total_count > 0
                      ? `${Math.round((order.physically_verified_count / order.total_count) * 100)}%`
                      : "—"}
                  </p>
                </div>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <CheckCircle2 className="size-4" aria-hidden />
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border/60 px-4 py-3 text-sm sm:px-5">
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Created</span> {formatDt(order.created_at)}
          </p>
          {order.started_at ? (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Started</span> {formatDt(order.started_at)}
            </p>
          ) : null}
          {order.assigned_to_name ? (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Executor</span> {order.assigned_to_name}
            </p>
          ) : null}
        </div>
        {order.remarks ? (
          <p className="border-t border-border/60 px-4 py-3 text-sm leading-relaxed text-muted-foreground sm:px-5">
            {order.remarks}
          </p>
        ) : null}

        {hasActions ? (
          <div className="flex flex-wrap gap-2 border-t border-border/60 bg-muted/10 px-4 py-3 sm:px-5">
            {isRejected && canCreate && isCreator ? (
              <AdminPrimaryButton type="button" disabled={busy} onClick={() => void runAction("/submit")}>
                Resubmit
              </AdminPrimaryButton>
            ) : null}
            {isApproved && canExecute && isAssignee ? (
              <AdminPrimaryButton type="button" disabled={busy} onClick={() => void runAction("/start")}>
                Start order
              </AdminPrimaryButton>
            ) : null}
            {canScan ? (
              <>
                {selectedScanItem ? (
                  <div className="w-full space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
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
                ) : (
                  <p className="w-full text-sm text-muted-foreground">
                    Select a pending asset below to scan its RFID tag.
                  </p>
                )}
                <AdminPrimaryButton
                  type="button"
                  disabled={busy || order.pending_physical_count > 0}
                  onClick={() => void runAction("/submit-closure")}
                >
                  Submit for closure
                </AdminPrimaryButton>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || selected.size === 0}
                  onClick={() => {
                    setRejectMode("execution")
                    setRejectOpen(true)
                  }}
                >
                  Reject selected
                </Button>
              </>
            ) : null}
            {canReviewCreation ? (
              <>
                <AdminPrimaryButton
                  type="button"
                  disabled={busy}
                  onClick={() => void runAction("/approval/approve-order")}
                >
                  Approve order
                </AdminPrimaryButton>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    setRejectMode("order")
                    setRejectOpen(true)
                  }}
                >
                  Reject order
                </Button>
              </>
            ) : null}
            {canReviewClosure ? (
              <>
                <AdminPrimaryButton type="button" disabled={busy} onClick={() => void runAction("/approval/approve-all")}>
                  Approve all
                </AdminPrimaryButton>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || selected.size === 0}
                  onClick={() => void runAction("/approval/approve-items", { item_ids: [...selected] })}
                >
                  Approve selected
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || selected.size === 0}
                  onClick={beginClosureLineReject}
                >
                  Reject lines
                </Button>
                <AdminPrimaryButton type="button" disabled={busy} onClick={() => void runAction("/closure/approve-order")}>
                  Complete order
                </AdminPrimaryButton>
              </>
            ) : null}
          </div>
        ) : null}
      </AdminPanel>

      <AdminPanel className="mt-4 overflow-hidden p-0">
        <div className="border-b border-border/60 bg-muted/10 px-4 py-2.5 sm:px-5">
          <p className="text-sm font-medium">Assets</p>
        </div>
        <div className="border-b border-border/60 px-4 py-2 sm:px-5">
          <WorkspaceTabs value={itemFilter} onValueChange={(value) => setItemFilter(value as ItemFilter)}>
            <WorkspaceTabsList>
              <WorkspaceTabsTrigger value="all">All ({order.total_count})</WorkspaceTabsTrigger>
              <WorkspaceTabsTrigger value="pending">Pending ({order.pending_physical_count})</WorkspaceTabsTrigger>
              <WorkspaceTabsTrigger value="verified">Verified ({order.physically_verified_count})</WorkspaceTabsTrigger>
              {showLineOutcomeFilters ? (
                <>
                  <WorkspaceTabsTrigger value="approved">Approved ({approvedLineCount})</WorkspaceTabsTrigger>
                  <WorkspaceTabsTrigger value="rejected">Rejected ({order.rejected_item_count})</WorkspaceTabsTrigger>
                </>
              ) : null}
            </WorkspaceTabsList>
            <WorkspaceTabsContent value={itemFilter} />
          </WorkspaceTabs>
        </div>
        <Table>
          <TableHeader>
            <AdminTableHeaderRow>
              {showRowSelection ? (
                <AdminTableHeadCell className="w-10">
                  <Checkbox
                    checked={
                      selectableItems.length > 0 && selectableItems.every((item) => selected.has(item.id))
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
          </TableHeader>
          <TableBody>
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={tableColSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No assets in this view.
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => {
                const scannable = itemIsScannable(item)
                const isSelectedForScan = selectedScanItemId === item.id
                const rowTone = itemRowTone(item)
                return (
                  <tr
                    key={item.id}
                    className={cn(
                      "border-b border-border/60",
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
                            disabled={
                              canScan
                                ? !itemIsRejectableDuringExecution(item)
                                : !itemIsRejectableAtClosure(item)
                            }
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
                    <AdminTableCell>
                      <Link
                        to={`/dashboard/assets/${item.asset_id}`}
                        className="font-mono text-xs text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.asset_code}
                      </Link>
                      <p className="mt-0.5 text-sm">{item.asset_name}</p>
                    </AdminTableCell>
                    <AdminTableCell className="font-mono text-xs">{item.rfid_code ?? "—"}</AdminTableCell>
                    <AdminTableCell>
                      {item.verification_status === "rejected" && !item.physically_verified ? (
                        <Badge variant="destructive">Rejected</Badge>
                      ) : item.physically_verified ? (
                        <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                          <Lock className="size-3" aria-hidden />
                          {isInProgress ? "Approved" : "Verified"}
                        </Badge>
                      ) : scannable ? (
                        <Badge variant="secondary">Scan pending</Badge>
                      ) : (
                        <Badge variant="outline">{item.verification_status}</Badge>
                      )}
                    </AdminTableCell>
                    <AdminTableCell className="text-sm">
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
                      <AdminTableCell className="text-sm">
                        {item.rejection_reason ? (
                          <span className="text-destructive">{item.rejection_reason}</span>
                        ) : item.physically_verified ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          "—"
                        )}
                      </AdminTableCell>
                    ) : null}
                  </tr>
                )
              })
            )}
          </TableBody>
        </Table>
      </AdminPanel>

      {order.audit.length > 0 ? (
        <AdminPanel className="mt-4 overflow-hidden p-0">
          <button
            type="button"
            className="flex w-full items-center justify-between px-[var(--app-card-padding)] py-3 text-left text-sm font-medium hover:bg-muted/30"
            onClick={() => setAuditOpen((open) => !open)}
          >
            <span>Activity ({order.audit.length})</span>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", auditOpen && "rotate-180")} />
          </button>
          {auditOpen ? (
            <ul className="border-t border-border/60 px-[var(--app-card-padding)] py-2">
              {[...order.audit].reverse().map((ev) => (
                <li
                  key={ev.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border/40 py-2.5 text-sm last:border-0"
                >
                  <div className="min-w-0">
                    <span className="font-medium">{ev.label}</span>
                    {ev.actor_name ? <span className="text-muted-foreground"> · {ev.actor_name}</span> : null}
                    {ev.detail ? <p className="text-xs text-muted-foreground">{ev.detail}</p> : null}
                  </div>
                  <time className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatDt(ev.created_at)}
                  </time>
                </li>
              ))}
            </ul>
          ) : null}
        </AdminPanel>
      ) : null}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {rejectMode === "order"
                ? "Reject order"
                : rejectMode === "execution"
                  ? "Reject selected assets"
                  : "Reject selected assets"}
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
                  } else if (rejectMode === "execution") {
                    void runAction("/execution/reject-items", {
                      item_ids: [...selected],
                      rejection_reason: reason,
                    }).then(() => setRejectOpen(false))
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

      <Dialog open={closureRejectConfirmOpen} onOpenChange={setClosureRejectConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verified assets selected</DialogTitle>
            <DialogDescription>
              {closureRejectVerifiedCodes.length > 0 ? (
                <>
                  These assets are already physically verified and cannot be rejected:{" "}
                  <span className="font-medium text-foreground">
                    {closureRejectVerifiedCodes.join(", ")}
                  </span>
                  . Continue to reject only the non-verified assets?
                </>
              ) : (
                "Continue to reject only the non-verified assets?"
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
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
              Reject non-verified only
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}
