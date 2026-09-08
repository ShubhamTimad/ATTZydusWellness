import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { AdminPage } from "@/components/layout/admin-page"
import { PageLoader } from "@/components/ui/page-loader"
import {
  AdminDataTable,
  AdminTableBodyRow,
  AdminTableEmptyRow,
  AdminTableLoadingRow,
} from "@/components/layout/list-page-ui"
import {
  AdminPanel,
  AdminPrimaryButton,
  AdminStatusBadge,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
  adminSwitchRowClass,
  adminTextareaClass,
} from "@/components/layout/admin-ui"
import { ApiError, deleteJson, getJson, patchJson, postJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type EmailTemplate = {
  id: number
  name: string
  event_code: string
  subject: string
  body_html: string
  body_text: string | null
  is_active: boolean
}

type VarsResp = { event_code: string; variables: string[]; allowed_event_codes?: string[] }

type PreviewResp = { subject: string; body_html: string; missing_variables: string[] }

const EVENT_CODES = [
  "USER_CREATED",
  "FORGOT_PASSWORD",
  "PASSWORD_RESET",
  "TASK_ASSIGNED",
  "TASK_APPROVED",
  "TASK_REJECTED",
  "TASK_REWORK_REQUIRED",
  "TASK_RESUBMITTED",
  "ORDER_ASSIGNED",
  "ORDER_REJECTED",
  "ORDER_COMPLETED",
  "ORDER_RETURNED_FOR_EXECUTION",
] as const

export function EmailTemplatesPage() {
  const [templates, setTemplates] = React.useState<EmailTemplate[]>([])
  const [loading, setLoading] = React.useState(true)

  const [view, setView] = React.useState<"list" | "edit">("list")
  const [selectedId, setSelectedId] = React.useState<string>("")
  const [createOpen, setCreateOpen] = React.useState(false)
  const [creating, setCreating] = React.useState(false)

  const [createName, setCreateName] = React.useState("")
  const [createEvent, setCreateEvent] = React.useState<(typeof EVENT_CODES)[number]>("USER_CREATED")
  const [createSubject, setCreateSubject] = React.useState("")
  const [createBody, setCreateBody] = React.useState("")

  const [editLoading, setEditLoading] = React.useState(false)
  const [tpl, setTpl] = React.useState<EmailTemplate | null>(null)
  const [vars, setVars] = React.useState<string[]>([])
  const [name, setName] = React.useState("")
  const [eventCode, setEventCode] = React.useState<string>("USER_CREATED")
  const [subject, setSubject] = React.useState("")
  const [bodyHtml, setBodyHtml] = React.useState("")
  const [isActive, setIsActive] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [preview, setPreview] = React.useState<PreviewResp | null>(null)
  const [previewPayload, setPreviewPayload] = React.useState(
    '{"user_name":"A","email":"a@example.com"}',
  )

  const canCreate = hasPermission("email_templates.create")
  const canUpdate = hasPermission("email_templates.update")
  const canDelete = hasPermission("email_templates.delete")

  const loadList = React.useCallback(async () => {
    setLoading(true)
    try {
      const t = await getJson<EmailTemplate[]>("/admin/email-templates")
      setTemplates(t)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not load email templates."
      toast.error(msg)
      setTemplates([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadList()
  }, [loadList])

  const sortedTemplates = React.useMemo(
    () => [...templates].sort((a, b) => a.name.localeCompare(b.name)),
    [templates],
  )

  const loadTemplate = React.useCallback(async (id: number) => {
    setEditLoading(true)
    try {
      const t = await getJson<EmailTemplate>(`/admin/email-templates/${id}`)
      setTpl(t)
      setName(t.name)
      setEventCode(t.event_code)
      setSubject(t.subject)
      setBodyHtml(t.body_html)
      setIsActive(Boolean(t.is_active))
      setPreview(null)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Could not load template."
      toast.error(msg)
      setTpl(null)
    } finally {
      setEditLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (view !== "edit") return
    const id = Number(selectedId)
    if (!Number.isFinite(id) || id < 1) return
    void loadTemplate(id)
  }, [view, selectedId, loadTemplate])

  React.useEffect(() => {
    if (view !== "edit") return
    const code = (eventCode || "").trim().toUpperCase()
    if (!code) return
    void (async () => {
      try {
        const r = await getJson<VarsResp>(
          `/admin/email-templates/variables/${encodeURIComponent(code)}`,
        )
        setVars(Array.isArray(r.variables) ? r.variables : [])
      } catch {
        setVars([])
      }
    })()
  }, [view, eventCode])

  function openTemplate(id: number) {
    setSelectedId(String(id))
    setView("edit")
  }

  function backToList() {
    setView("list")
    setSelectedId("")
    setTpl(null)
    setPreview(null)
  }

  async function onCreateTemplate() {
    if (!canCreate) return
    const trimmedName = createName.trim()
    if (!trimmedName) {
      toast.error("Name is required.")
      return
    }
    if (!createSubject.trim() || !createBody.trim()) {
      toast.error("Subject and body are required.")
      return
    }
    setCreating(true)
    try {
      const created = await postJson<EmailTemplate>("/admin/email-templates", {
        name: trimmedName,
        event_code: createEvent,
        subject: createSubject.trim(),
        body_html: createBody.trim(),
        body_text: null,
        is_active: true,
      })
      toast.success("Template created.")
      setCreateOpen(false)
      setCreateName("")
      setCreateSubject("")
      setCreateBody("")
      await loadList()
      openTemplate(created.id)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Create failed."
      toast.error(msg)
    } finally {
      setCreating(false)
    }
  }

  async function onSave() {
    if (!canUpdate || !tpl) return
    setSaving(true)
    try {
      await patchJson<EmailTemplate>(`/admin/email-templates/${tpl.id}`, {
        name: name.trim(),
        event_code: eventCode.trim().toUpperCase(),
        subject,
        body_html: bodyHtml,
        is_active: isActive,
      })
      toast.success("Saved.")
      await loadTemplate(tpl.id)
      await loadList()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Save failed."
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  async function onDelete() {
    if (!canDelete || !tpl) return
    try {
      await deleteJson(`/admin/email-templates/${tpl.id}`)
      toast.success("Deleted.")
      await loadList()
      backToList()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Delete failed."
      toast.error(msg)
    }
  }

  async function runPreview() {
    try {
      const parsed = JSON.parse(previewPayload || "{}") as Record<string, unknown>
      const res = await postJson<PreviewResp>("/admin/email-templates/preview", {
        subject,
        body_html: bodyHtml,
        payload: parsed,
      })
      setPreview(res)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Preview failed (invalid JSON payload?)."
      toast.error(msg)
    }
  }

  if (view === "edit") {
    if (editLoading) {
      return (
        <AdminPage fullWidth viewportFill>
          <PageLoader label="Loading template" />
        </AdminPage>
      )
    }
    if (!tpl) {
      return (
        <AdminPage fullWidth className="space-y-4">
          <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={backToList}>
            ← Back to templates
          </Button>
          <p className="text-sm text-muted-foreground">Template not found.</p>
        </AdminPage>
      )
    }

    return (
      <AdminPage fullWidth className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={backToList}>
            ← Back to templates
          </Button>
          <div className="flex flex-wrap gap-2">
            <AdminPrimaryButton type="button" onClick={() => void onSave()} disabled={!canUpdate || saving}>
              {saving ? "Saving…" : "Save"}
            </AdminPrimaryButton>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void onDelete()}
              disabled={!canDelete}
            >
              Delete
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
          <AdminPanel
            className="lg:col-span-2"
            title={tpl.name}
            description={`Use variables like {{user_name}} in subject and body.`}
            contentClassName="space-y-4 px-5 py-5"
          >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canUpdate} />
                </div>
                <div className="space-y-1.5">
                  <Label>Event</Label>
                  <select
                    className={adminSelectClass}
                    value={eventCode}
                    onChange={(e) => setEventCode(e.target.value)}
                    disabled={!canUpdate}
                  >
                    {EVENT_CODES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Subject</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!canUpdate} />
              </div>

              <div className="space-y-1.5">
                <Label>Body (HTML)</Label>
                <textarea
                  className={cn(adminTextareaClass, "min-h-[260px]")}
                  value={bodyHtml}
                  onChange={(e) => setBodyHtml(e.target.value)}
                  disabled={!canUpdate}
                />
              </div>

              <div className={adminSwitchRowClass}>
                <div>
                  <div className="text-sm font-medium">Active</div>
                  <div className="text-xs text-muted-foreground">Inactive templates are not used.</div>
                </div>
                <Switch checked={isActive} onCheckedChange={setIsActive} disabled={!canUpdate} />
              </div>
          </AdminPanel>

          <div className="space-y-4">
            <AdminPanel
              title="Variables"
              description={`For ${eventCode}`}
              contentClassName="px-5 py-5"
            >
                {vars.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No variables for this event.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {vars.map((v) => (
                      <li key={v} className="font-mono">{`{{${v}}}`}</li>
                    ))}
                  </ul>
                )}
            </AdminPanel>

            <AdminPanel
              title="Preview"
              description="Render with sample JSON payload."
              contentClassName="space-y-4 px-5 py-5"
            >
                <div className="space-y-1.5">
                  <Label>Payload (JSON)</Label>
                  <textarea
                    className={cn(adminTextareaClass, "min-h-[120px] font-mono")}
                    value={previewPayload}
                    onChange={(e) => setPreviewPayload(e.target.value)}
                  />
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => void runPreview()}>
                  Render preview
                </Button>
                {preview ? (
                  <>
                    <Separator />
                    {preview.missing_variables?.length ? (
                      <p className="text-xs text-amber-800 dark:text-amber-200">
                        Missing: {preview.missing_variables.join(", ")}
                      </p>
                    ) : null}
                    <div className="space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground">Subject</div>
                      <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">{preview.subject}</div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground">Body</div>
                      <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm whitespace-pre-wrap">
                        {preview.body_html}
                      </div>
                    </div>
                  </>
                ) : null}
            </AdminPanel>
          </div>
        </div>
      </AdminPage>
    )
  }

  return (
    <AdminPage
      fullWidth
      description="Notification templates for system events. Click a row to edit."
      actions={
        canCreate ? (
          <AdminPrimaryButton
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={loading}
          >
            <Plus className="size-4" aria-hidden />
            Create template
          </AdminPrimaryButton>
        ) : undefined
      }
    >
      <AdminDataTable>
        <Table className="app-table-head-sticky">
          <TableHeader>
            <AdminTableHeaderRow>
              <AdminTableHeadCell>Name</AdminTableHeadCell>
              <AdminTableHeadCell>Event</AdminTableHeadCell>
              <AdminTableHeadCell>Status</AdminTableHeadCell>
              <AdminTableHeadCell>Subject</AdminTableHeadCell>
            </AdminTableHeaderRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <AdminTableLoadingRow colSpan={4} label="Loading templates" />
            ) : sortedTemplates.length === 0 ? (
              <AdminTableEmptyRow colSpan={4}>
                No templates yet. Click Create template.
              </AdminTableEmptyRow>
            ) : (
              sortedTemplates.map((t) => (
                <AdminTableBodyRow key={t.id} onClick={() => openTemplate(t.id)}>
                  <AdminTableCell className="font-medium">{t.name}</AdminTableCell>
                  <AdminTableCell className="font-mono text-xs text-muted-foreground">
                    {t.event_code}
                  </AdminTableCell>
                  <AdminTableCell>
                    <AdminStatusBadge active={t.is_active} />
                  </AdminTableCell>
                  <AdminTableCell className="max-w-md truncate text-muted-foreground">
                    {t.subject}
                  </AdminTableCell>
                </AdminTableBodyRow>
              ))
            )}
          </TableBody>
        </Table>
      </AdminDataTable>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create template</DialogTitle>
            <DialogDescription>Add a new email template, then edit details on the next screen.</DialogDescription>
          </DialogHeader>
          <div className="dialog-body">
            <div className="space-y-1.5">
              <Label htmlFor="create-tpl-name">Name</Label>
              <Input
                id="create-tpl-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="User created v1"
                disabled={!canCreate}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-tpl-event">Event</Label>
              <select
                id="create-tpl-event"
                className={adminSelectClass}
                value={createEvent}
                onChange={(e) => setCreateEvent(e.target.value as (typeof EVENT_CODES)[number])}
                disabled={!canCreate}
              >
                {EVENT_CODES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-tpl-subject">Subject</Label>
              <Input
                id="create-tpl-subject"
                value={createSubject}
                onChange={(e) => setCreateSubject(e.target.value)}
                placeholder="Welcome to the platform"
                disabled={!canCreate}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-tpl-body">Body (HTML)</Label>
              <textarea
                id="create-tpl-body"
                className={adminTextareaClass}
                value={createBody}
                onChange={(e) => setCreateBody(e.target.value)}
                placeholder="<p>Hello {{user_name}}</p>"
                disabled={!canCreate}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <AdminPrimaryButton
                type="button"
                disabled={creating || !canCreate}
                onClick={() => void onCreateTemplate()}
              >
                {creating ? "Creating…" : "Create"}
              </AdminPrimaryButton>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}
