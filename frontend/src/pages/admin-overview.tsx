import * as React from "react"
import { Link } from "react-router-dom"
import {
  ArrowRight,
  Factory,
  KeyRound,
  Link2,
  Mail,
  Network,
  Settings,
  Shield,
  Users,
  type LucideIcon,
} from "lucide-react"

import { AdminPage, AdminSection } from "@/components/layout/admin-page"
import { AdminPanel, adminPanelClass } from "@/components/layout/admin-ui"
import { getJson } from "@/lib/api"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type AdminSummary = {
  counts: {
    users_total: number | null
    users_active: number | null
    plants_total: number | null
    my_pending_tasks: number | null
  }
}

type QuickLink = {
  label: string
  description: string
  to: string
  icon: LucideIcon
  show: boolean
}

export function AdminOverviewPage() {
  const [summary, setSummary] = React.useState<AdminSummary | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await getJson<AdminSummary>("/admin/dashboard/summary")
        if (!cancelled) setSummary(data)
      } catch {
        if (!cancelled) setSummary(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const counts = summary?.counts

  const stats = [
    { label: "Users", value: counts?.users_total },
    { label: "Active users", value: counts?.users_active },
    { label: "Plants", value: counts?.plants_total },
    { label: "Your pending tasks", value: counts?.my_pending_tasks },
  ].filter((s) => s.value !== null && s.value !== undefined)

  const links: QuickLink[] = [
    {
      label: "Users",
      description: "Create and manage user accounts",
      to: "/admin/users",
      icon: Users,
      show: hasPermission("users.view"),
    },
    {
      label: "Plants",
      description: "Plants and plant codes",
      to: "/admin/plants",
      icon: Factory,
      show:
        hasPermission("org_units.view") ||
        hasPermission("org_units.create") ||
        hasPermission("org_units.update"),
    },
    {
      label: "Departments",
      description: "Departments under each plant",
      to: "/admin/departments",
      icon: Network,
      show:
        hasPermission("org_units.view") ||
        hasPermission("org_units.create") ||
        hasPermission("org_units.update"),
    },
    {
      label: "Roles",
      description: "Roles and plant access",
      to: "/admin/roles",
      icon: Shield,
      show: hasPermission("roles.view") || hasPermission("roles.update"),
    },
    {
      label: "Permissions",
      description: "Feature permissions catalog",
      to: "/admin/permissions",
      icon: KeyRound,
      show: hasPermission("permissions.view"),
    },
    {
      label: "Settings",
      description: "Email, password policy, and security",
      to: "/admin/settings",
      icon: Settings,
      show: hasPermission("settings.view") || hasPermission("settings.update"),
    },
    {
      label: "Workflows",
      description: "Approval workflows and levels",
      to: "/admin/workflow-assignment",
      icon: Link2,
      show: hasPermission("approval.manage"),
    },
    {
      label: "Email templates",
      description: "Notification templates",
      to: "/admin/email-templates",
      icon: Mail,
      show: hasPermission("email_templates.view"),
    },
  ].filter((l) => l.show)

  return (
    <AdminPage fullWidth description="Manage users, plants, roles, security, and system configuration from one place.">
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading summary…</p>
      ) : stats.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className={cn(adminPanelClass, "px-5 py-4 transition-shadow hover:shadow-md")}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {s.label}
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-primary">
                {s.value}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {links.length > 0 ? (
        <AdminSection title="Quick access" description="Jump to a section">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {links.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "group flex flex-col rounded-xl border border-border/80 bg-card p-4 shadow-sm transition-all",
                    "hover:border-primary/25 hover:bg-card hover:shadow-md",
                  )}
                >
                  <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">{item.label}</span>
                      <ArrowRight
                        className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden
                      />
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        </AdminSection>
      ) : (
        <AdminPanel
          description="Use the sidebar to open admin sections you have access to."
          contentClassName="px-5 py-5 text-sm text-muted-foreground"
        >
          No quick links are available for your account.
        </AdminPanel>
      )}
    </AdminPage>
  )
}
