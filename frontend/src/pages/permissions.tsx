import * as React from "react"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminPanel,
  AdminPrimaryButton,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
} from "@/components/layout/admin-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table"
import { getJson, postJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"

type CatalogPermission = {
  id: number | null
  action: string
  code: string
  description: string | null
}

type CatalogTab = {
  key: string
  title: string
  actions: string[]
  permissions: CatalogPermission[]
}

type CatalogModule = {
  key: string
  title: string
  tabs: CatalogTab[]
}

type PermissionCatalog = {
  modules: CatalogModule[]
}

type PermissionCatalogSyncResult = {
  features_created: number
  permissions_created: number
  permission_codes_updated: number
}

const ACTION_COLUMNS = ["view", "view_all", "create", "update", "delete"] as const
const ACTION_LABEL: Record<string, string> = {
  view: "View",
  view_all: "View all",
  create: "Create",
  update: "Edit",
  delete: "Delete",
  access: "Access",
  scan: "Scan",
  execute: "Execute",
  bulk_verify: "Bulk verify",
  export: "Export",
  deactivate: "Deactivate",
  reactivate: "Reactivate",
}

function orderedActionColumns(actions: string[]): string[] {
  const uniq = new Set<string>(actions.map((a) => a.trim()).filter(Boolean))
  const out: string[] = []
  for (const a of ACTION_COLUMNS) {
    if (uniq.has(a)) out.push(a)
  }
  for (const a of ["access", "act", "manage", "scan", "execute", "bulk_verify", "export"]) {
    if (uniq.has(a)) out.push(a)
  }
  const rest = Array.from(uniq)
    .filter((a) => !out.includes(a))
    .sort((a, b) => a.localeCompare(b))
  out.push(...rest)
  return out
}

export function PermissionsPage() {
  const [catalog, setCatalog] = React.useState<PermissionCatalog | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [syncing, setSyncing] = React.useState(false)

  const canSync = hasPermission("permissions.create") || hasPermission("roles.update")

  async function load() {
    setError(null)
    try {
      const cat = await getJson<PermissionCatalog>("/admin/permissions/catalog")
      setCatalog(cat)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load permissions")
      setCatalog({ modules: [] })
    }
  }

  React.useEffect(() => {
    void load()
  }, [])

  async function syncCatalog() {
    setSyncing(true)
    toast.loading("Syncing permissions from config…", { id: "sync-perms-page" })
    try {
      const result = await postJson<PermissionCatalogSyncResult>("/admin/permissions/sync", {})
      toast.success(
        `Synced ${result.features_created + result.permissions_created + result.permission_codes_updated} change(s)`,
        { id: "sync-perms-page" },
      )
      await load()
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to sync permissions"
      toast.error(message, { id: "sync-perms-page" })
      setError(message)
    } finally {
      setSyncing(false)
    }
  }

  const hasMissing = React.useMemo(
    () =>
      (catalog?.modules ?? []).some((mod) =>
        mod.tabs.some((tab) => tab.permissions.some((perm) => perm.id == null)),
      ),
    [catalog],
  )

  return (
    <AdminPage
      fullWidth
      // description="Read-only permission catalog from the backend. Permissions are defined in application config and synced to the database."
      actions={
        canSync ? (
          <AdminPrimaryButton type="button" disabled={syncing} onClick={() => void syncCatalog()}>
            {syncing ? "Syncing…" : "Sync from config"}
          </AdminPrimaryButton>
        ) : undefined
      }
    >
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {hasMissing ? (
        <Alert>
          <AlertTitle>Missing permission rows</AlertTitle>
          <AlertDescription>
            Some permissions exist in config but not in the database yet.
            {canSync ? " Click Sync from config to create them." : " Ask an administrator to run sync."}
          </AlertDescription>
        </Alert>
      ) : null}

      <AdminPanel
        title="Permission catalog"
        description="Module → tab → action matrix loaded from GET /admin/permissions/catalog"
        className="flex max-h-[calc(100dvh-11rem)] min-h-0 flex-col"
        contentClassName="min-h-0 flex-1 overflow-y-auto"
      >
        {catalog === null ? (
          <p className="px-5 py-12 text-center text-sm text-muted-foreground">Loading…</p>
        ) : catalog.modules.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-muted-foreground">No modules in catalog.</p>
        ) : (
          <div className="space-y-8 px-2 py-4">
            {catalog.modules.map((mod) => {
              const moduleActions = orderedActionColumns(
                mod.tabs.flatMap((t) => (Array.isArray(t.actions) ? t.actions : [])),
              )
              return (
                <div key={mod.key} className="space-y-2">
                  <div className="px-3 text-sm font-semibold text-foreground">{mod.title}</div>
                  <div className="overflow-x-auto">
                    <Table className="min-w-[720px]">
                      <TableHeader>
                        <AdminTableHeaderRow>
                          <AdminTableHeadCell className="min-w-[160px]">Tab</AdminTableHeadCell>
                          {moduleActions.map((act) => (
                            <AdminTableHeadCell key={act} className="min-w-[140px] text-center">
                              {ACTION_LABEL[act] ?? act}
                            </AdminTableHeadCell>
                          ))}
                        </AdminTableHeaderRow>
                      </TableHeader>
                      <TableBody>
                        {mod.tabs.map((tab) => (
                          <TableRow key={`${mod.key}.${tab.key}`} className="border-b border-border/40">
                            <AdminTableCell className="align-top font-medium text-muted-foreground">
                              {tab.title}
                            </AdminTableCell>
                            {moduleActions.map((act) => {
                              const cell = tab.permissions.find((p) => p.action === act)
                              if (!cell) {
                                return (
                                  <TableCell key={act} className="px-3 py-3 text-center align-top">
                                    <span className="text-xs text-muted-foreground">—</span>
                                  </TableCell>
                                )
                              }

                              const synced = cell.id != null
                              return (
                                <TableCell key={act} className="px-3 py-3 align-top">
                                  <div className="flex flex-col items-center gap-1.5 text-center">
                                    <Checkbox
                                      checked={synced}
                                      disabled
                                      className="pointer-events-none data-[state=checked]:border-primary data-[state=checked]:bg-primary"
                                      aria-label={
                                        synced
                                          ? `Permission ${cell.code} exists in database`
                                          : `Permission ${cell.code} missing — sync from config`
                                      }
                                    />
                                    <code className="block max-w-[200px] whitespace-normal break-all font-mono text-[11px] leading-snug text-foreground">
                                      {cell.code}
                                    </code>
                                    {cell.description ? (
                                      <span className="block max-w-[200px] whitespace-normal text-[11px] leading-snug text-muted-foreground">
                                        {cell.description}
                                      </span>
                                    ) : !synced ? (
                                      <span className="text-[11px] text-amber-700 dark:text-amber-400">
                                        Not synced
                                      </span>
                                    ) : null}
                                  </div>
                                </TableCell>
                              )
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </AdminPanel>
    </AdminPage>
  )
}
