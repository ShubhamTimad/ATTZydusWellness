import * as React from "react"
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
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
} from "@/components/layout/admin-ui"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { getJson } from "@/lib/api"
import {
  DISPOSAL_STATUS_TABS,
  disposalStatusLabel,
  disposalStatusPillTone,
  type DisposalOrderListResponse,
} from "@/lib/disposal-types"

export function DisposalOrdersListPage() {
  const navigate = useNavigate()
  const [tab, setTab] = React.useState<string>(DISPOSAL_STATUS_TABS[0].key)
  const [page, setPage] = React.useState(1)
  const [data, setData] = React.useState<DisposalOrderListResponse | null>(null)
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams({ tab, page: String(page), page_size: "25" })
      setData(await getJson<DisposalOrderListResponse>(`/admin/disposal-orders?${q}`))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load disposal orders")
    } finally {
      setLoading(false)
    }
  }, [tab, page])

  React.useEffect(() => {
    void load()
  }, [load])

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageSize = data?.page_size ?? 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <AdminPage fullWidth dense className="w-full">
      <ListPageHeader title="Asset Disposal Orders" description="" />

      <WorkspaceTabs
        value={tab}
        onValueChange={(v) => {
          setTab(v)
          setPage(1)
        }}
      >
        <WorkspaceTabsList>
          {DISPOSAL_STATUS_TABS.map((t) => (
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
                  <AdminTableHeadCell>Assets</AdminTableHeadCell>
                  <AdminTableHeadCell>Eng?</AdminTableHeadCell>
                  <AdminTableHeadCell>Assignee</AdminTableHeadCell>
                  <AdminTableHeadCell>Status</AdminTableHeadCell>
                  <AdminTableHeadCell>Created</AdminTableHeadCell>
                </AdminTableHeaderRow>
              </TableHeader>
              <TableBody>
                {loading && items.length === 0 ? (
                  <AdminTableEmptyRow colSpan={8}>Loading…</AdminTableEmptyRow>
                ) : items.length === 0 ? (
                  <AdminTableEmptyRow colSpan={8}>No disposal orders.</AdminTableEmptyRow>
                ) : (
                  items.map((row) => (
                    <AdminTableBodyRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/dashboard/disposal-orders/${row.id}`)}
                    >
                      <AdminTableCell className="font-medium">{row.order_number}</AdminTableCell>
                      <AdminTableCell>{row.plant_name}</AdminTableCell>
                      <AdminTableCell>{row.from_cost_center_code ?? "—"}</AdminTableCell>
                      <AdminTableCell className="tabular-nums">{row.asset_count}</AdminTableCell>
                      <AdminTableCell>{row.requires_engineering ? "Yes" : "No"}</AdminTableCell>
                      <AdminTableCell>{row.assigned_to_name ?? "—"}</AdminTableCell>
                      <AdminTableCell>
                        <AdminPillBadge tone={disposalStatusPillTone(row.status)}>
                          {disposalStatusLabel(row.status)}
                        </AdminPillBadge>
                      </AdminTableCell>
                      <AdminTableCell className="text-muted-foreground">
                        {new Date(row.created_at).toLocaleDateString()}
                      </AdminTableCell>
                    </AdminTableBodyRow>
                  ))
                )}
              </TableBody>
            </Table>
          </AdminDataTable>
        </WorkspaceTabsContent>
      </WorkspaceTabs>
    </AdminPage>
  )
}
