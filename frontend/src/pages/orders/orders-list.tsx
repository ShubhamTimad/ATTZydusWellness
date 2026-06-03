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
  ORDER_TABS,
  orderStatusLabel,
  type PhysicalOrderListResponse,
} from "@/lib/orders-types"

export function OrdersListPage() {
  const navigate = useNavigate()
  const [tab, setTab] = React.useState<string>("pending_approval")
  const [page, setPage] = React.useState(1)
  const [data, setData] = React.useState<PhysicalOrderListResponse | null>(null)
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams({ tab, page: String(page), page_size: "25" })
      const res = await getJson<PhysicalOrderListResponse>(`/admin/physical-orders?${q}`)
      setData(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load orders")
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
    <AdminPage fullWidth>
      <ListPageHeader
        title="Physical verification orders"
        description="Track verification assignments from approval through completion."
      />

      <WorkspaceTabs
        value={tab}
        onValueChange={(v) => {
          setTab(v)
          setPage(1)
        }}
      >
        <WorkspaceTabsList>
          {ORDER_TABS.map((t) => (
            <WorkspaceTabsTrigger key={t.key} value={t.key}>
              {t.label}
            </WorkspaceTabsTrigger>
          ))}
        </WorkspaceTabsList>

        {ORDER_TABS.map((t) => (
          <WorkspaceTabsContent key={t.key} value={t.key}>
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
                    <AdminTableHeadCell>Order number</AdminTableHeadCell>
                    <AdminTableHeadCell>Plant</AdminTableHeadCell>
                    <AdminTableHeadCell>Cost center</AdminTableHeadCell>
                    <AdminTableHeadCell>Assets</AdminTableHeadCell>
                    <AdminTableHeadCell>Status</AdminTableHeadCell>
                    <AdminTableHeadCell>Assigned to</AdminTableHeadCell>
                    <AdminTableHeadCell>Created by</AdminTableHeadCell>
                    <AdminTableHeadCell>Created</AdminTableHeadCell>
                  </AdminTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <AdminTableEmptyRow colSpan={8}>Loading orders…</AdminTableEmptyRow>
                  ) : items.length === 0 ? (
                    <AdminTableEmptyRow colSpan={8}>No orders in this tab.</AdminTableEmptyRow>
                  ) : (
                    items.map((row) => (
                      <AdminTableBodyRow
                        key={row.id}
                        onClick={() => navigate(String(row.id))}
                      >
                        <AdminTableCell className="font-mono text-xs font-medium">
                          {row.order_number}
                        </AdminTableCell>
                        <AdminTableCell>{row.plant_name}</AdminTableCell>
                        <AdminTableCell>
                          {row.cost_center_code}
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {row.cost_center_description}
                          </span>
                        </AdminTableCell>
                        <AdminTableCell className="tabular-nums">{row.asset_count}</AdminTableCell>
                        <AdminTableCell>
                          <AdminPillBadge tone="neutral" className="font-normal">
                            {orderStatusLabel(row.status)}
                          </AdminPillBadge>
                        </AdminTableCell>
                        <AdminTableCell>{row.assigned_to_name ?? "—"}</AdminTableCell>
                        <AdminTableCell>{row.created_by_name ?? "—"}</AdminTableCell>
                        <AdminTableCell>
                          {new Date(row.created_at).toLocaleDateString()}
                        </AdminTableCell>
                      </AdminTableBodyRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </AdminDataTable>
          </WorkspaceTabsContent>
        ))}
      </WorkspaceTabs>
    </AdminPage>
  )
}
