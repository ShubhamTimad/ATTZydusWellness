import * as React from "react"
import { PlusIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminDataTable,
  AdminTableBodyRow,
  AdminTableEmptyRow,
  AdminTablePagination,
  ListPageHeader,
  WorkspaceTabs,
  WorkspaceTabsContent,
  WorkspaceTabsList,
  WorkspaceTabsTrigger,
} from "@/components/layout/list-page-ui"
import {
  AdminPillBadge,
  AdminPrimaryButton,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
} from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { ApiError, deleteJson, getJson, postJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import {
  TRANSFER_STATUS_TABS,
  transferStatusLabel,
  transferStatusPillTone,
  type TransferOrderListItem,
  type TransferOrderListResponse,
} from "@/lib/transfer-types"

export function TransferOrdersListPage() {
  const navigate = useNavigate()
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()
  const [tab, setTab] = React.useState<string>(TRANSFER_STATUS_TABS[0]?.key ?? "draft")
  const [page, setPage] = React.useState(1)
  const [data, setData] = React.useState<TransferOrderListResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busyId, setBusyId] = React.useState<number | null>(null)
  const canCreate = hasPermission("transfer.create")

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams({ tab, page: String(page), page_size: "25" })
      const res = await getJson<TransferOrderListResponse>(`/admin/transfer-orders?${q}`)
      setData(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load transfer orders")
    } finally {
      setLoading(false)
    }
  }, [tab, page])

  React.useEffect(() => {
    void load()
  }, [load])

  async function discardRow(row: TransferOrderListItem) {
    if (row.can_delete) {
      const ok = await confirmAsk({
        title: "Delete draft transfer?",
        description: `Permanently delete draft ${row.order_number}? This cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      })
      if (!ok) return
      setBusyId(row.id)
      try {
        await deleteJson(`/admin/transfer-orders/${row.id}`)
        toast.success("Draft transfer order deleted.")
        await load()
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Could not delete transfer order")
      } finally {
        setBusyId(null)
      }
      return
    }
    if (row.can_archive) {
      const ok = await confirmAsk({
        title: "Archive transfer order?",
        description: `Archive ${row.order_number}? It will be cancelled and kept in the audit trail.`,
        confirmLabel: "Archive",
      })
      if (!ok) return
      setBusyId(row.id)
      try {
        await postJson(`/admin/transfer-orders/${row.id}/archive`, {})
        toast.success("Transfer order archived.")
        await load()
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Could not archive transfer order")
      } finally {
        setBusyId(null)
      }
    }
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageSize = data?.page_size ?? 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const showActions = items.some((r) => r.can_delete || r.can_archive)

  return (
    <AdminPage fullWidth dense className="w-full">
      <ListPageHeader
        title="Asset Transfer Orders"
        description=""
        actions={
          canCreate ? (
            <AdminPrimaryButton
              type="button"
              onClick={() => navigate("/dashboard/transfer-orders/new")}
            >
              <PlusIcon className="h-4 w-4" />
              Create transfer
            </AdminPrimaryButton>
          ) : null
        }
      />

      <WorkspaceTabs
        value={tab}
        onValueChange={(v) => {
          setTab(v)
          setPage(1)
        }}
      >
        <WorkspaceTabsList>
          {TRANSFER_STATUS_TABS.map((t) => (
            <WorkspaceTabsTrigger key={t.key} value={t.key}>
              {t.label}
            </WorkspaceTabsTrigger>
          ))}
        </WorkspaceTabsList>
        <WorkspaceTabsContent value={tab} className="mt-4">
          <AdminDataTable
            footer={
              <AdminTablePagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                loading={loading}
                itemLabel="orders"
                onPageChange={setPage}
              />
            }
          >
            <Table className="app-table-head-sticky">
              <TableHeader>
                <AdminTableHeaderRow>
                  <AdminTableHeadCell>Order</AdminTableHeadCell>
                  <AdminTableHeadCell>Plant</AdminTableHeadCell>
                  <AdminTableHeadCell>From CC</AdminTableHeadCell>
                  <AdminTableHeadCell>To CC</AdminTableHeadCell>
                  <AdminTableHeadCell>Assets</AdminTableHeadCell>
                  <AdminTableHeadCell>Assignee</AdminTableHeadCell>
                  <AdminTableHeadCell>Status</AdminTableHeadCell>
                  <AdminTableHeadCell>Created</AdminTableHeadCell>
                  {showActions ? <AdminTableHeadCell className="text-right">Actions</AdminTableHeadCell> : null}
                </AdminTableHeaderRow>
              </TableHeader>
              <TableBody>
                {loading && items.length === 0 ? (
                  <AdminTableEmptyRow colSpan={showActions ? 9 : 8}>Loading…</AdminTableEmptyRow>
                ) : items.length === 0 ? (
                  <AdminTableEmptyRow colSpan={showActions ? 9 : 8}>No transfer orders.</AdminTableEmptyRow>
                ) : (
                  items.map((row) => (
                    <AdminTableBodyRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/dashboard/transfer-orders/${row.id}`)}
                    >
                      <AdminTableCell className="font-medium">{row.order_number}</AdminTableCell>
                      <AdminTableCell>{row.plant_name}</AdminTableCell>
                      <AdminTableCell>{row.from_cost_center_code ?? "—"}</AdminTableCell>
                      <AdminTableCell>{row.to_cost_center_code}</AdminTableCell>
                      <AdminTableCell className="tabular-nums">{row.asset_count}</AdminTableCell>
                      <AdminTableCell>{row.assigned_to_name ?? "—"}</AdminTableCell>
                      <AdminTableCell>
                        <AdminPillBadge tone={transferStatusPillTone(row.status)}>
                          {transferStatusLabel(row.status)}
                        </AdminPillBadge>
                      </AdminTableCell>
                      <AdminTableCell className="text-muted-foreground">
                        {new Date(row.created_at).toLocaleDateString()}
                      </AdminTableCell>
                      {showActions ? (
                        <AdminTableCell className="text-right">
                          {row.can_delete || row.can_archive ? (
                            <Button
                              type="button"
                              variant={row.can_delete ? "destructive" : "outline"}
                              size="sm"
                              className="h-8"
                              disabled={busyId === row.id}
                              onClick={(e) => {
                                e.stopPropagation()
                                void discardRow(row)
                              }}
                            >
                              {row.can_delete ? "Delete" : "Archive"}
                            </Button>
                          ) : null}
                        </AdminTableCell>
                      ) : null}
                    </AdminTableBodyRow>
                  ))
                )}
              </TableBody>
            </Table>
          </AdminDataTable>
        </WorkspaceTabsContent>
      </WorkspaceTabs>
      {confirmDialog}
    </AdminPage>
  )
}
