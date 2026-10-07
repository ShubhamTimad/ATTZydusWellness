import * as React from "react"
import { ListFilter, Search, X } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

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
} from "@/components/layout/admin-ui"
import { AdminTableBodyRow, AdminTablePagination } from "@/components/layout/list-page-ui"
import { OrderAuditLog } from "@/components/orders/order-audit-log"
import { OrderLifecycleStepper } from "@/components/orders/order-lifecycle-stepper"
import { Button } from "@/components/ui/button"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { asAssetListItem, clearAssetMasterSelection, writeAssetMasterSelection } from "@/lib/asset-master-selection"
import { ApiError, postJson } from "@/lib/api"
import { formatAppDate, formatAppDateTime } from "@/lib/dates"
import { invalidateAssetLists, invalidateOrderLists } from "@/lib/query-client"
import { listReturnTo } from "@/lib/use-url-tab"
import type { OrderLifecycleStep, PhysicalOrderDetail } from "@/lib/orders-types"
import {
  PHYSICAL_ORDER_PREVIEW_KEY,
  type PhysicalOrderPreview,
  type PhysicalOrderPreviewAsset,
} from "@/lib/physical-order-preview"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 20
const listToolbarBtnClass = "h-9 shrink-0 gap-1.5 px-3"
const orderPanelPad = "px-[var(--app-card-padding)]"

const DRAFT_STEPS: OrderLifecycleStep[] = [
  { key: "order_created", label: "Draft", status: "active", approver_slots: [] },
  { key: "assigned", label: "Assigned", status: "pending", approver_slots: [] },
  { key: "in_progress", label: "In Progress", status: "pending", approver_slots: [] },
  { key: "completed", label: "Completed", status: "pending", approver_slots: [] },
  { key: "approved", label: "Approved", status: "pending", approver_slots: [] },
  { key: "closed", label: "Closed", status: "pending", approver_slots: [] },
]

function previewSelectionRows(preview: PhysicalOrderPreview) {
  if (preview.selection?.length) return preview.selection.map((row) => asAssetListItem(row))
  const assets: PhysicalOrderPreviewAsset[] = preview.assets.length
    ? preview.assets
    : preview.asset_ids.map((id) => ({ id, asset_code: String(id), asset_name: "" }))
  return assets.map((asset) =>
    asAssetListItem({
      id: asset.id,
      asset_code: asset.asset_code,
      asset_name: asset.asset_name,
      rfid_code: asset.rfid_code ?? null,
      cost_center: asset.cost_center ?? null,
      plant_name: asset.plant_name ?? null,
      inventory_count: asset.inventory_count ?? null,
      physical_count: asset.physical_count ?? null,
      last_verification_date: asset.last_verification_date ?? null,
    }),
  )
}

function persistPreviewSelection(preview: PhysicalOrderPreview) {
  writeAssetMasterSelection(previewSelectionRows(preview))
}

function readPreview(): PhysicalOrderPreview | null {
  try {
    const raw = sessionStorage.getItem(PHYSICAL_ORDER_PREVIEW_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PhysicalOrderPreview
    if (!parsed || !Array.isArray(parsed.asset_ids) || parsed.asset_ids.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

function SummaryField({
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
      <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-black">{label}</p>
      <p className="mt-0.5 truncate text-sm font-normal tabular-nums leading-snug text-black">{value}</p>
    </div>
  )
}

export function PhysicalOrderCreatePage() {
  const navigate = useNavigate()
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()
  const [preview] = React.useState(() => readPreview())
  const [busy, setBusy] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(1)

  React.useEffect(() => {
    if (!preview) {
      navigate(listReturnTo("/dashboard/assets"), { replace: true })
      return
    }
    const rows = previewSelectionRows(preview)
    // Asset Master clears the handoff when this page opens. Put it back for the return trip.
    const id = window.setTimeout(() => writeAssetMasterSelection(rows), 0)
    return () => {
      window.clearTimeout(id)
      window.setTimeout(() => {
        if (window.location.pathname === "/dashboard/orders/new") return
        if (window.location.pathname === "/dashboard/assets") {
          writeAssetMasterSelection(rows)
          return
        }
        clearAssetMasterSelection()
      }, 0)
    }
  }, [navigate, preview])

  const assets: PhysicalOrderPreviewAsset[] = preview?.assets.length
    ? preview.assets
    : (preview?.asset_ids ?? []).map((id) => ({
        id,
        asset_code: String(id),
        asset_name: "",
      }))

  const q = search.trim().toLowerCase()
  const filtered = q
    ? assets.filter((asset) =>
        [asset.asset_name, asset.asset_code, asset.rfid_code, asset.cost_center]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q)),
      )
    : assets
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  async function saveDraft() {
    if (!preview) return
    const ok = await confirmAsk({
      title: "Do you want to create order?",
      description: "",
      confirmLabel: "Yes",
      cancelLabel: "Cancel",
    })
    if (!ok) return
    setBusy(true)
    try {
      const order = await postJson<PhysicalOrderDetail>("/admin/physical-orders", {
        asset_ids: preview.asset_ids,
        submit: false,
        reset_verification_asset_ids: preview.reset_verification_asset_ids,
      })
      try {
        sessionStorage.removeItem(PHYSICAL_ORDER_PREVIEW_KEY)
      } catch {
        /* ignore */
      }
      toast.success(`Draft ${order.order_number} saved.`)
      void invalidateAssetLists()
      void invalidateOrderLists()
      navigate(`/dashboard/orders/${order.id}`, { replace: true })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to save draft.")
    } finally {
      setBusy(false)
    }
  }

  if (!preview) return null

  return (
    <AdminPage
      fullWidth
      dense
      viewportFill
      description=""
      className="w-full gap-3 pb-6"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AdminPrimaryButton type="button" disabled={busy} onClick={() => void saveDraft()}>
            {busy ? "Saving…" : "Create Order"}
          </AdminPrimaryButton>
          <AdminBackLink to={listReturnTo("/dashboard/assets")} onClick={() => persistPreviewSelection(preview)} />
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <div className="shrink-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Order Number : -
          </h1>
        </div>

        <AdminPanel className="shrink-0 overflow-hidden p-0">
          <div className={cn("border-b border-border/60 bg-muted/15 py-3", orderPanelPad)}>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Progress
            </p>
            <OrderLifecycleStepper
              steps={DRAFT_STEPS}
              currentStepKey="order_created"
              orderStatus="draft"
            />
          </div>
        </AdminPanel>

        <AdminPanel className="shrink-0 overflow-hidden p-0">
          <div className={cn("space-y-2 py-3", orderPanelPad)}>
            <h3 className="text-sm font-semibold text-foreground">Order Summary</h3>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
              <SummaryField label="Pending Asset" value={assets.length} tone="warning" />
              <SummaryField label="Verified Asset" value={0} tone="success" />
              <SummaryField label="Created On" value={formatAppDateTime(new Date())} />
              <SummaryField label="Started On" value="-" />
              <SummaryField label="Executor" value="-" />
            </div>
            <div className="mt-2 min-w-0 rounded-md bg-muted/35 px-2.5 py-1.5">
              <p className="text-xs font-bold uppercase tracking-[0.06em] text-black">Order Description</p>
              <p className="mt-1.5 text-sm font-normal leading-snug text-black">-</p>
            </div>
          </div>
        </AdminPanel>

        <AdminPanel className="shrink-0 overflow-hidden p-0">
          <div className={cn("flex flex-nowrap items-center gap-2 border-b border-border/60 py-3", orderPanelPad)}>
            <p className="shrink-0 text-sm font-medium text-foreground">
              Asset List
            </p>
            <div className="ml-auto flex min-w-0 flex-nowrap items-center justify-end gap-2">
              <div className="relative min-w-0 w-56 flex-1 sm:w-64 sm:flex-none lg:w-80">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setPage(1)
                  }}
                  placeholder="Search by Name, Code, RFID Code"
                  className="h-9 w-full pl-9"
                  aria-label="Search Assets"
                />
                {search ? (
                  <button
                    type="button"
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                    onClick={() => {
                      setSearch("")
                      setPage(1)
                    }}
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
              <Button type="button" variant="outline" size="sm" className={listToolbarBtnClass} disabled>
                <ListFilter className="size-4" aria-hidden />
                Filter
              </Button>
            </div>
          </div>
          <div className="app-data-table-wrap min-h-0">
            <Table className="app-table-head-sticky">
              <TableHeader>
                <AdminTableHeaderRow>
                  <AdminTableHeadCell className="!text-black">Asset Name</AdminTableHeadCell>
                  <AdminTableHeadCell className="!text-black">Asset Code</AdminTableHeadCell>
                  <AdminTableHeadCell className="!text-black">RFID Code</AdminTableHeadCell>
                  <AdminTableHeadCell className="!text-black">Cost Center</AdminTableHeadCell>
                  <AdminTableHeadCell className="!text-black">Inventory Count</AdminTableHeadCell>
                  <AdminTableHeadCell className="!text-black">Physical Count</AdminTableHeadCell>
                  <AdminTableHeadCell className="!text-black">Phy. Verification Date</AdminTableHeadCell>
                  <AdminTableHeadCell className="!text-black">Order Remark</AdminTableHeadCell>
                  <AdminTableHeadCell className="!text-black">Status</AdminTableHeadCell>
                  <AdminTableHeadCell className="!text-black">Verified By</AdminTableHeadCell>
                </AdminTableHeaderRow>
              </TableHeader>
              <TableBody>
                {pageRows.length === 0 ? (
                  <AdminTableEmptyRow colSpan={10}>
                    {q ? "No assets found matching the search or filters." : "No Assets in this view."}
                  </AdminTableEmptyRow>
                ) : (
                  pageRows.map((asset) => (
                    <AdminTableBodyRow key={asset.id} interactive={false}>
                      <AdminTableCell className="whitespace-normal">
                        <p className="mt-0.5 text-sm text-foreground">{asset.asset_name || "-"}</p>
                      </AdminTableCell>
                      <AdminTableCell className="font-mono text-xs text-foreground">
                        {asset.asset_code || "-"}
                      </AdminTableCell>
                      <AdminTableCell className="font-mono text-xs text-foreground">
                        {asset.rfid_code?.trim() || "-"}
                      </AdminTableCell>
                      <AdminTableCell className="font-mono text-xs text-foreground">
                        {asset.cost_center?.trim() || "-"}
                      </AdminTableCell>
                      <AdminTableCell className="tabular-nums text-foreground">
                        {asset.inventory_count ?? 1}
                      </AdminTableCell>
                      <AdminTableCell className="tabular-nums text-foreground">
                        {asset.physical_count ?? 0}
                      </AdminTableCell>
                      <AdminTableCell className="whitespace-nowrap text-sm text-foreground">
                        {asset.last_verification_date ? formatAppDate(asset.last_verification_date) : "-"}
                      </AdminTableCell>
                      <AdminTableCell className="text-sm text-foreground">-</AdminTableCell>
                      <AdminTableCell>
                        <AdminPillBadge tone="warning">Pending</AdminPillBadge>
                      </AdminTableCell>
                      <AdminTableCell className="text-sm text-foreground">-</AdminTableCell>
                    </AdminTableBodyRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <AdminTablePagination
            page={safePage}
            totalPages={totalPages}
            total={filtered.length}
            pageSize={PAGE_SIZE}
            itemLabel={filtered.length === 1 ? "Asset" : "Assets"}
            onPageChange={setPage}
          />
        </AdminPanel>

        <OrderAuditLog rows={[]} fillHeight />
      </div>
      {confirmDialog}
    </AdminPage>
  )
}
