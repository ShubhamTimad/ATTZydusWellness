import * as React from "react"

import { AssetDashboard } from "@/components/dashboard/asset-dashboard"
import { TaskDashboard, type TasksDashboardModule } from "@/components/dashboard/task-dashboard"
import { UserDashboard, type UsersDashboardModule } from "@/components/dashboard/user-dashboard"
import type { AssetsDashboardModule } from "@/lib/assets-types"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getJson } from "@/lib/api"
import { canAccessTasks, hasPermission } from "@/lib/permissions"

type DashboardSummary = {
  modules: {
    users?: UsersDashboardModule
    tasks?: TasksDashboardModule
    assets?: AssetsDashboardModule
    [k: string]: unknown
  }
}

export function DashboardPage() {
  const [summary, setSummary] = React.useState<DashboardSummary | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = await getJson<DashboardSummary>("/dashboard/summary")
        if (cancelled) return
        setSummary(s)
        setLoadError(null)
      } catch (e) {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : "Failed to load dashboard stats")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  const usersModule = summary?.modules?.users
  const tasksModule = summary?.modules?.tasks
  const assetsModule = summary?.modules?.assets

  return (
    <div className="app-page">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="app-page-heading">Dashboard</h1>
        <span className="app-brand-dot">•</span>
        <span className="text-sm font-medium text-muted-foreground">Workspace</span>
      </div>

      {loadError ? (
        <Card className="border-dashed border-primary/25">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Dashboard data unavailable</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {!usersModule && !tasksModule && !assetsModule && !loadError ? (
        <Card className="border-dashed border-primary/25">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">No modules available</CardTitle>
            <CardDescription>
              You don’t have access to any modules. Ask an admin to grant permissions like{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">users.view</code> or{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">task.view</code>, or{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">asset.view</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {usersModule && hasPermission("users.view") ? <UserDashboard data={usersModule} /> : null}
      {tasksModule && canAccessTasks() ? (
        <TaskDashboard data={tasksModule} />
      ) : null}
      {assetsModule && hasPermission("asset.view") ? (
        <AssetDashboard data={assetsModule} />
      ) : null}
    </div>
  )
}

