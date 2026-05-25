import * as React from "react"
import { toast } from "sonner"
import { useNavigate } from "react-router-dom"

import {
  AdminPanel,
  AdminTableEmptyRow,
  adminTabsListClass,
  adminTabsTriggerClass,
} from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiError, getJson } from "@/lib/api"
import { canAccessTasks, persistAuthFromMe } from "@/lib/permissions"

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
    <AdminPanel
      title="Inbox"
      description="Tasks you are assigned to or that you created — open a row for details, comments, and history."
      contentClassName="p-0"
    >
      <Table className="app-table-head-sticky">
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows ?? []).length === 0 ? (
            <AdminTableEmptyRow colSpan={5}>
              {!canView
                ? "Missing permission: task.view (or related task access)"
                : loading
                  ? "Loading…"
                  : emptyMessage}
            </AdminTableEmptyRow>
          ) : (
              (rows ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.title ?? "(untitled)"}</TableCell>
                  <TableCell className="text-sm capitalize">{r.task_type}</TableCell>
                  <TableCell className="text-sm capitalize">{r.priority ?? "—"}</TableCell>
                  <TableCell className="text-sm capitalize">{r.status}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => onOpen(r.id)}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
        </TableBody>
      </Table>
    </AdminPanel>
  )
}

export function MyTasksPage() {
  const [rows, setRows] = React.useState<UnifiedTaskRow[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [inbox, setInbox] = React.useState<"active" | "done">("active")
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
    <div className="app-page w-full">
      <div className="space-y-1">
        <h1 className="app-page-heading">My tasks</h1>
        <p className="app-page-subheading">
          Open items that need you, and a <strong>Done</strong> list for things you or others already finished
          (approvals, rejections, completed manual work).
        </p>
      </div>

      <Tabs value={inbox} onValueChange={(v) => setInbox(v as "active" | "done")} className="gap-[var(--app-section-gap)]">
        <TabsList className={adminTabsListClass}>
          <TabsTrigger value="active" className={adminTabsTriggerClass}>
            Active
          </TabsTrigger>
          <TabsTrigger value="done" className={adminTabsTriggerClass}>
            Done
          </TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="mt-0">
          <InboxTable
            rows={rows}
            loading={loading}
            canView={canView}
            onOpen={(id) => void navigate(String(id))}
            emptyMessage="No active tasks. Approvals and manual items that need you appear here."
          />
        </TabsContent>
        <TabsContent value="done" className="mt-0">
          <InboxTable
            rows={rows}
            loading={loading}
            canView={canView}
            onOpen={(id) => void navigate(String(id))}
            emptyMessage="No completed items yet. Finished approvals, rejections, and closed manual tasks show here."
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
