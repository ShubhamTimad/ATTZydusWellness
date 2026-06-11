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
  ORDER_STATUS_TABS,
  orderStatusLabel,
  type OrdersDashboardModule,
  type PhysicalOrderListResponse,
} from "@/lib/orders-types"

function tabCount(
  module: OrdersDashboardModule | null,
  tab: (typeof ORDER_STATUS_TABS)[number],
): number {
  if (!module) return 0
  if (tab.key === "pending_approval") {
    return (module.pending_approval ?? 0) + (module.pending_closure_approval ?? 0)
  }
  if (tab.key === "assigned") {
    return (module.assigned ?? 0) + (module.approved ?? 0)
  }
  if (!tab.countKey) return 0
  const value = module[tab.countKey]
  return typeof value === "number" ? value : 0
}

export function OrdersListPage() {
  const navigate = useNavigate()
  const [tab, setTab] = React.useState("in_progress")
  const [page, setPage] = React.useState(1)
  const [data, setData] = React.useState<PhysicalOrderListResponse | null>(null)
  const [counts, setCounts] = React.useState<OrdersDashboardModule | null>(null)
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

  React.useEffect(() => {
    void getJson<{ modules: { orders: OrdersDashboardModule } }>("/dashboard/summary")
      .then((res) => setCounts(res.modules.orders))
      .catch(() => setCounts(null))
  }, [tab, data?.total])

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageSize = data?.page_size ?? 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <AdminPage fullWidth>
      <ListPageHeader
        title="Physical verification orders"
        description=""
      />

      <WorkspaceTabs
        value={tab}
        onValueChange={(v) => {
          setTab(v)
          setPage(1)
        }}
      >
        <WorkspaceTabsList>
          {ORDER_STATUS_TABS.map((t) => {
            const count = tabCount(counts, t)
            return (
              <WorkspaceTabsTrigger key={t.key} value={t.key}>
                {t.label}
                {count > 0 ? (
                  <span className="ml-1.5 tabular-nums text-muted-foreground">({count})</span>
                ) : null}
              </WorkspaceTabsTrigger>
            )
          })}
        </WorkspaceTabsList>

        {ORDER_STATUS_TABS.map((t) => (
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
