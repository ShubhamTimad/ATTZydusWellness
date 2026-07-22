import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
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
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { getJson } from "@/lib/api"
import {
  CAPEX_STATUS_TABS,
  capexStatusLabel,
  capexStatusPillTone,
  type CapexFormListResponse,
} from "@/lib/capex-types"
import { hasPermission } from "@/lib/permissions"
import { PlusIcon } from "lucide-react"

export function CapexListPage() {
  const navigate = useNavigate()
  const [tab, setTab] = React.useState("all")
  const [page, setPage] = React.useState(1)
  const [data, setData] = React.useState<CapexFormListResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const canCreate = hasPermission("capitalization.create")

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const q = new URLSearchParams({ tab, page: String(page), page_size: "25" })
      const res = await getJson<CapexFormListResponse>(`/admin/capitalization-forms?${q}`)
      setData(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load forms")
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
        title="Capitalization forms"
        description="Request and track asset capitalization approvals."
        actions={
          canCreate ? (
            <AdminPrimaryButton type="button" onClick={() => navigate("/dashboard/capitalization/new")}>
              <PlusIcon className="w-4 h-4" /> New Form
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
          {CAPEX_STATUS_TABS.map((t) => (
            <WorkspaceTabsTrigger key={t.key} value={t.key}>
              {t.label}
            </WorkspaceTabsTrigger>
          ))}
        </WorkspaceTabsList>

        {CAPEX_STATUS_TABS.map((t) => (
          <WorkspaceTabsContent key={t.key} value={t.key}>
            <AdminDataTable
              footer={
                <AdminTablePagination
                  page={page}
                  totalPages={totalPages}
                  total={total}
                  pageSize={pageSize}
                  loading={loading}
                  itemLabel="forms"
                  onPageChange={setPage}
                />
              }
            >
              <Table>
                <TableHeader>
                  <AdminTableHeaderRow>
                    <AdminTableHeadCell>Form number</AdminTableHeadCell>
                    <AdminTableHeadCell>Asset name</AdminTableHeadCell>
                    <AdminTableHeadCell>Department</AdminTableHeadCell>
                    <AdminTableHeadCell>Status</AdminTableHeadCell>
                    <AdminTableHeadCell>Created by</AdminTableHeadCell>
                  </AdminTableHeaderRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <AdminTableEmptyRow colSpan={5}>Loading forms…</AdminTableEmptyRow>
                  ) : items.length === 0 ? (
                    <AdminTableEmptyRow colSpan={5}>No forms in this tab.</AdminTableEmptyRow>
                  ) : (
                    items.map((row) => (
                      <AdminTableBodyRow
                        key={row.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/dashboard/capitalization/${row.id}`)}
                      >
                        <AdminTableCell>
                          <Link
                            to={`/dashboard/capitalization/${row.id}`}
                            className="font-medium text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row.form_number}
                          </Link>
                        </AdminTableCell>
                        <AdminTableCell>{row.asset_name}</AdminTableCell>
                        <AdminTableCell>{row.department ?? "—"}</AdminTableCell>
                        <AdminTableCell>
                          <AdminPillBadge tone={capexStatusPillTone(row.status)}>
                            {capexStatusLabel(row.status)}
                          </AdminPillBadge>
                        </AdminTableCell>
                        <AdminTableCell>{row.created_by_name ?? "—"}</AdminTableCell>
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
