import * as React from "react"
import { toast } from "sonner"
import { useNavigate } from "react-router-dom"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminDataTable,
  AdminTableBodyRow,
  AdminTableEmptyRow,
  ListPageHeader,
  WorkspaceTabs,
  WorkspaceTabsContent,
  WorkspaceTabsList,
  WorkspaceTabsTrigger,
} from "@/components/layout/list-page-ui"
import {
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
} from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { ApiError, getJson } from "@/lib/api"
import { canAccessTasks, persistAuthFromMe } from "@/lib/permissions"
import { useUrlTab } from "@/lib/use-url-tab"

type UnifiedTaskRow = {
  id: number
  task_type: "approval" | "manual" | "rework"
  title: string | null
  priority: string | null
  status: string
}

type InboxTableProps = {
  rows: UnifiedTaskRow[] | null
  loading: boolean
  canView: boolean
  emptyMessage: string
  onOpen: (taskId: number) => void
}

function InboxTable({ rows, loading, canView, emptyMessage, onOpen }: InboxTableProps) {
  return (
    <AdminDataTable
      title="Inbox"
      description=""
    >
      <Table className="app-table-head-sticky">
        <TableHeader>
          <AdminTableHeaderRow>
            <AdminTableHeadCell>Title</AdminTableHeadCell>
            <AdminTableHeadCell>Type</AdminTableHeadCell>
            <AdminTableHeadCell>Priority</AdminTableHeadCell>
            <AdminTableHeadCell>Status</AdminTableHeadCell>
            <AdminTableHeadCell className="text-right">Actions</AdminTableHeadCell>
          </AdminTableHeaderRow>
        </TableHeader>
        <TableBody>
          {(rows ?? []).length === 0 ? (
            <AdminTableEmptyRow colSpan={5}>
              {!canView
                ? "Missing permission: task.view (or related task access)"
                : loading
                  ? "Loading tasks…"
                  : emptyMessage}
            </AdminTableEmptyRow>
          ) : (
            (rows ?? []).map((r) => (
              <AdminTableBodyRow key={r.id}>
                <AdminTableCell className="font-medium">{r.title ?? "(untitled)"}</AdminTableCell>
                <AdminTableCell className="capitalize">{r.task_type}</AdminTableCell>
                <AdminTableCell className="capitalize">{r.priority ?? "—"}</AdminTableCell>
                <AdminTableCell className="capitalize">{r.status}</AdminTableCell>
                <AdminTableCell className="text-right">
                  <Button type="button" size="sm" variant="outline" onClick={() => onOpen(r.id)}>
                    View
                  </Button>
                </AdminTableCell>
              </AdminTableBodyRow>
            ))
          )}
        </TableBody>
      </Table>
    </AdminDataTable>
  )
}

export function MyTasksPage() {
  const [rows, setRows] = React.useState<UnifiedTaskRow[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [inbox, setInbox] = useUrlTab(["active", "done"] as const, "active", "inbox")
  const navigate = useNavigate()

  const [, forcePermRefresh] = React.useReducer((x: number) => x + 1, 0)
  const canView = canAccessTasks()

  const syncMe = React.useCallback(async () => {
    try {
      const me = await getJson<{ is_superuser?: boolean; permissions?: string[] }>("/me")
      persistAuthFromMe(me)
      forcePermRefresh()
    } catch {
      // ignore; load() will surface auth errors if needed
    }
  }, [])

  const load = React.useCallback(async () => {
    setLoading(true)
    setRows(null)
    try {
      const data = await getJson<UnifiedTaskRow[]>(`/tasks/my-tasks?inbox=${inbox}`)
      setRows(data)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not load tasks."
      toast.error(msg)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [inbox])

  React.useEffect(() => {
    void (async () => {
      await syncMe()
      await load()
    })()
  }, [load, syncMe])

  return (
    <AdminPage fullWidth>
      <ListPageHeader
        title="My tasks"
        description=""
      />

      <WorkspaceTabs value={inbox} onValueChange={setInbox}>
        <WorkspaceTabsList>
          <WorkspaceTabsTrigger value="active">Active</WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="done">Done</WorkspaceTabsTrigger>
        </WorkspaceTabsList>

        <WorkspaceTabsContent value="active">
          <InboxTable
            rows={rows}
            loading={loading}
            canView={canView}
            onOpen={(id) => void navigate(String(id))}
            emptyMessage="No active tasks. Approvals and manual items that need you appear here."
          />
        </WorkspaceTabsContent>
        <WorkspaceTabsContent value="done">
          <InboxTable
            rows={rows}
            loading={loading}
            canView={canView}
            onOpen={(id) => void navigate(String(id))}
            emptyMessage="No completed items yet. Finished approvals, rejections, and closed manual tasks show here."
          />
        </WorkspaceTabsContent>
      </WorkspaceTabs>
    </AdminPage>
  )
}
