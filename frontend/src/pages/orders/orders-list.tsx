import * as React from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminPanel,
  AdminTableCell,
  AdminTableEmptyRow,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminTabsListClass,
  adminTabsTriggerClass,
} from "@/components/layout/admin-ui"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
      <h1 className="app-page-heading">Physical verification orders</h1>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v)
          setPage(1)
        }}
      >
        <TabsList className={adminTabsListClass}>
          {ORDER_TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className={adminTabsTriggerClass}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {ORDER_TABS.map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-4">
            <AdminPanel className="min-h-0 flex-1 overflow-hidden p-0">
              <div className="overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
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
                      <AdminTableEmptyRow colSpan={8}>Loading…</AdminTableEmptyRow>
                    ) : items.length === 0 ? (
                      <AdminTableEmptyRow colSpan={8}>No orders in this tab.</AdminTableEmptyRow>
                    ) : (
                      items.map((row) => (
                        <tr
                          key={row.id}
                          className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40"
                          onClick={() => navigate(String(row.id))}
                        >
                          <AdminTableCell className="font-mono text-xs">{row.order_number}</AdminTableCell>
                          <AdminTableCell>{row.plant_name}</AdminTableCell>
                          <AdminTableCell>
                            {row.cost_center_code}
                            <span className="block text-xs text-muted-foreground">
                              {row.cost_center_description}
                            </span>
                          </AdminTableCell>
                          <AdminTableCell>{row.asset_count}</AdminTableCell>
                          <AdminTableCell>
                            <Badge variant="secondary">{orderStatusLabel(row.status)}</Badge>
                          </AdminTableCell>
                          <AdminTableCell>{row.assigned_to_name ?? "—"}</AdminTableCell>
                          <AdminTableCell>{row.created_by_name ?? "—"}</AdminTableCell>
                          <AdminTableCell>
                            {new Date(row.created_at).toLocaleDateString()}
                          </AdminTableCell>
                        </tr>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 ? (
                <div className="flex items-center justify-between border-t border-border/60 px-4 py-2 text-sm">
                  <span className="text-muted-foreground">
                    Page {page} of {totalPages} ({total} orders)
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-primary disabled:opacity-40"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="text-primary disabled:opacity-40"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </AdminPanel>
          </TabsContent>
        ))}
      </Tabs>
    </AdminPage>
  )
}
