import * as React from "react"
import type { LucideIcon } from "lucide-react"
import {
  ChevronDown,
  Factory,
  KeyRound,
  LayoutDashboard,
  Link2,
  LogOut,
  Mail,
  Settings,
  Shield,
  Users,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SessionIdleNavbarBadge } from "@/components/session-idle-navbar-badge"
import { hasPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type NavPerm = string | string[] | null

export type AdminNavId =
  | "overview"
  | "users"
  | "plants"
  | "roles"
  | "permissions"
  | "settings"
  | "workflow-assignment"
  | "email-templates"

type NavItem = {
  id: AdminNavId
  label: string
  icon: LucideIcon
  permission: NavPerm
}

type NavGroup = {
  label: string
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [{ id: "overview", label: "Overview", icon: LayoutDashboard, permission: null }],
  },
  {
    label: "Organization",
    items: [
      {
        id: "plants",
        label: "Plants",
        icon: Factory,
        permission: ["org_units.view", "org_units.create", "org_units.update", "org_units.delete"],
      },
      { id: "users", label: "Users", icon: Users, permission: "users.view" },
    ],
  },
  {
    label: "Access control",
    items: [
      {
        id: "roles",
        label: "Roles",
        icon: Shield,
        permission: ["roles.view", "roles.update", "roles.create"],
      },
      {
        id: "permissions",
        label: "Permissions",
        icon: KeyRound,
        permission: ["permissions.view", "permissions.create"],
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        id: "workflow-assignment",
        label: "Workflows",
        icon: Link2,
        permission: "approval.manage",
      },
      {
        id: "email-templates",
        label: "Email templates",
        icon: Mail,
        permission: [
          "email_templates.view",
          "email_templates.create",
          "email_templates.update",
          "email_templates.delete",
        ],
      },
      { id: "settings", label: "Settings", icon: Settings, permission: "settings.update" },
    ],
  },
]

function canSeeItem(permission: NavPerm): boolean {
  if (permission === null) return true
  if (Array.isArray(permission)) return permission.some((c) => hasPermission(c))
  return hasPermission(permission)
}

export type AdminLayoutProps = {
  children: React.ReactNode
  pageTitle?: string
  activeId: AdminNavId
  onNavigate: (id: AdminNavId) => void
  userEmail?: string | null
  onSignOut?: () => void
}

export function AdminLayout({
  children,
  pageTitle,
  activeId,
  onNavigate,
  userEmail,
  onSignOut,
}: AdminLayoutProps) {
  const allItems = navGroups.flatMap((g) => g.items)
  const activeLabel = allItems.find((i) => i.id === activeId)?.label ?? "Overview"
  const title = pageTitle ?? activeLabel
  const email = userEmail ?? "—"

  const initials = React.useMemo(() => {
    const raw = (userEmail ?? "").trim()
    if (!raw) return "?"
    const left = raw.split("@")[0] ?? raw
    const parts = left.split(/[.\-_ ]+/).filter(Boolean)
    const a = (parts[0]?.[0] ?? left[0] ?? "?").toUpperCase()
    const b = (parts[1]?.[0] ?? left[1] ?? "").toUpperCase()
    return `${a}${b}`.slice(0, 2)
  }, [userEmail])

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canSeeItem(item.permission)),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <div className="admin-shell flex h-svh min-h-0 w-full bg-background text-foreground">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm">
        <div className="flex h-[4.25rem] items-center gap-3 border-b border-sidebar-border px-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent ring-1 ring-sidebar-border">
            <img src="/logo.svg" alt="" className="h-7 w-auto object-contain" />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold text-sidebar-foreground">Admin Console</p>
            <p className="truncate text-xs text-sidebar-foreground/65">Superadmin</p>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <nav className="space-y-5 p-3">
            {visibleGroups.map((group) => (
              <div key={group.label} className="space-y-1">
                <p className="px-2 text-[11px] font-semibold tracking-wider text-sidebar-foreground/50 uppercase">
                  {group.label}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const isActive = activeId === item.id
                    return (
                      <li key={item.id}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-9 w-full justify-start gap-2.5 rounded-lg border border-transparent px-2.5 text-left text-sm font-medium text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                            isActive &&
                              "border-sidebar-primary/30 bg-sidebar-primary/15 text-sidebar-primary-foreground shadow-sm hover:bg-sidebar-primary/20",
                          )}
                          onClick={() => onNavigate(item.id)}
                        >
                          <Icon
                            className={cn(
                              "size-4 shrink-0",
                              isActive ? "text-primary" : "text-sidebar-foreground/55",
                            )}
                            aria-hidden
                          />
                          <span className="truncate">{item.label}</span>
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </ScrollArea>

        <div className="border-t border-sidebar-border p-3">
          <p className="px-2 text-[11px] text-sidebar-foreground/45">Workspace template</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col admin-canvas">
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border/80 bg-background/95 px-6 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{title}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <SessionIdleNavbarBadge />
            <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-2.5 rounded-full border-border bg-card py-1.5 pr-3 pl-1.5 shadow-sm hover:bg-muted/40"
              >
                <Avatar className="size-9 ring-2 ring-primary/15">
                  <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden max-w-[160px] truncate text-sm font-medium md:inline">{email}</span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-xl p-3 shadow-lg" sideOffset={8}>
              <DropdownMenuLabel className="space-y-1 px-1 pb-3 font-normal">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Signed in as
                </span>
                <div className="truncate text-sm font-semibold text-foreground">{email}</div>
              </DropdownMenuLabel>
              <DropdownMenuItem
                className="h-10 cursor-pointer justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground focus:bg-primary/90 focus:text-primary-foreground"
                onSelect={(e) => {
                  e.preventDefault()
                  onSignOut?.()
                }}
              >
                <LogOut className="size-4" aria-hidden />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto px-6 py-8">{children}</main>
      </div>
    </div>
  )
}
