import * as React from "react"
import {
  ChevronDown,
  ClipboardList,
  Database,
  Factory,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Package,
  FileBarChart,
  ShoppingCart,
  Menu,
  PanelLeft,
  Settings,
  Shield,
  User2,
  Users,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import { ProfileDialog } from "@/components/profile-dialog"
import { AppBrandMark } from "@/components/layout/app-brand-mark"
import { MobileNavDrawer } from "@/components/layout/mobile-nav-drawer"
import { SessionIdleNavbarBadge } from "@/components/session-idle-navbar-badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import {
  canAccessTasks,
  hasAnyNonUsersRbacPermission,
  hasPermission,
  TASK_ACCESS_PERMISSIONS,
} from "@/lib/permissions"
import { cn } from "@/lib/utils"

type NavPerm = string | string[] | null

type ShellNavItem = {
  id: string
  label: string
  icon: LucideIcon
  to: string
  permission: NavPerm
  /**
   * When true, hide this item unless the user has at least one RBAC grant outside ``users.*``
   * (so roles with only user-management permissions do not see generic workspace tabs).
   */
  hideWhenOnlyUsersModule?: boolean
}

type ShellNavGroup = {
  label: string
  items: ShellNavItem[]
}

/** Enterprise nav order: overview → operations → reference data → administration. */
const shellNavGroups: ShellNavGroup[] = [
  {
    label: "Overview",
    items: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, to: "/dashboard", permission: null },
      { id: "reports", label: "Reports", icon: FileBarChart, to: "/dashboard/reports", permission: null },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        id: "orders",
        label: "Orders",
        icon: ShoppingCart,
        to: "/dashboard/orders",
        permission: "order.view",
      },
      {
        id: "assets",
        label: "Assets",
        icon: Package,
        to: "/dashboard/assets",
        permission: "asset.view",
      },
      {
        id: "tasks",
        label: "My tasks",
        icon: ClipboardList,
        to: "/dashboard/tasks",
        permission: [...TASK_ACCESS_PERMISSIONS],
      },
    ],
  },
  {
    label: "Reference data",
    items: [
      {
        id: "masters",
        label: "Masters",
        icon: Database,
        to: "/dashboard/masters",
        permission: "masters.view",
      },
    ],
  },
  {
    label: "Administration",
    items: [
      { id: "users", label: "Users", icon: Users, to: "/dashboard/users", permission: "users.view" },
      {
        id: "plants",
        label: "Plants",
        icon: Factory,
        to: "/dashboard/plants",
        permission: ["org_units.view", "org_units.create", "org_units.update", "org_units.delete"],
      },
      {
        id: "roles",
        label: "Roles",
        icon: Shield,
        to: "/dashboard/roles",
        permission: ["roles.view", "roles.update", "roles.create"],
      },
      {
        id: "permissions",
        label: "Permissions",
        icon: KeyRound,
        to: "/dashboard/permissions",
        permission: ["permissions.view", "permissions.create"],
      },
      {
        id: "admin-settings",
        label: "System settings",
        icon: Settings,
        to: "/dashboard/system-settings",
        permission: "settings.update",
      },
    ],
  },
]

function navItemVisible(item: ShellNavItem): boolean {
  if (item.hideWhenOnlyUsersModule && !hasAnyNonUsersRbacPermission()) return false
  if (item.id === "tasks") return canAccessTasks()
  const p = item.permission
  if (p === null) return true
  if (Array.isArray(p)) return p.some((c) => hasPermission(c))
  return hasPermission(p)
}

function pathMatchesNav(pathname: string, to: string): boolean {
  if (to === "/dashboard") return pathname === "/dashboard" || pathname === "/dashboard/"
  return pathname === to || pathname.startsWith(`${to}/`)
}

export type AppShellLayoutProps = {
  children: React.ReactNode
  userEmail?: string | null
  onSignOut?: () => void
}

export function AppShellLayout({ children, userEmail, onSignOut }: AppShellLayoutProps) {
  const location = useLocation()
  const visibleGroups = shellNavGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(navItemVisible),
    }))
    .filter((group) => group.items.length > 0)
  const visibleNav = visibleGroups.flatMap((group) => group.items)

  const activeItem = visibleNav.find((item) => pathMatchesNav(location.pathname, item.to))
  const title = activeItem?.label ?? "Dashboard"
  const [profileOpen, setProfileOpen] = React.useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false)
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false)
  React.useEffect(() => {
    try {
      setIsSidebarCollapsed(localStorage.getItem("ui.sidebarCollapsed") === "1")
    } catch {
      // ignore
    }
  }, [])
  React.useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])
  function toggleSidebar() {
    setIsSidebarCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem("ui.sidebarCollapsed", next ? "1" : "0")
      } catch {
        // ignore
      }
      return next
    })
  }

  const initials = React.useMemo(() => {
    const raw = (userEmail ?? "").trim()
    if (!raw) return "?"
    const left = raw.split("@")[0] ?? raw
    const parts = left.split(/[.\-_ ]+/).filter(Boolean)
    const a = (parts[0]?.[0] ?? left[0] ?? "?").toUpperCase()
    const b = (parts[1]?.[0] ?? left[1] ?? "").toUpperCase()
    return `${a}${b}`.slice(0, 2)
  }, [userEmail])

  const navContent = (collapsed: boolean, onNavigate?: () => void) => (
    <nav
      className={cn("flex flex-col gap-3 px-2 py-3", collapsed && "px-1.5 gap-2")}
      aria-label="Workspace"
    >
      {visibleGroups.map((group) => (
        <div key={group.label} className="space-y-1">
          {!collapsed ? (
            <p className="px-3 pb-0.5 text-[10px] font-semibold tracking-[0.08em] text-foreground uppercase">
              {group.label}
            </p>
          ) : null}
          {group.items.map((item) => {
            const Icon = item.icon
            const isActive = pathMatchesNav(location.pathname, item.to)
            return (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                size="sm"
                title={collapsed ? item.label : undefined}
                className={cn(
                  "relative h-9 w-full rounded-[calc(var(--app-radius-surface)-2px)] text-left font-medium",
                  collapsed ? "justify-center px-0" : "justify-start gap-2.5 pl-3",
                  "text-foreground hover:bg-muted/70",
                  isActive &&
                    "border-l-2 border-primary bg-primary/8 pl-[calc(0.75rem-2px)] text-primary hover:bg-primary/10 hover:text-primary",
                  isActive && collapsed && "border-l-0 bg-primary/10 pl-0 text-primary",
                )}
                asChild
              >
                <Link to={item.to} onClick={onNavigate}>
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      isActive ? "text-primary opacity-100" : "opacity-70",
                    )}
                    aria-hidden
                  />
                  {!collapsed ? <span className="truncate">{item.label}</span> : null}
                </Link>
              </Button>
            )
          })}
        </div>
      ))}
    </nav>
  )

  return (
    <div className="flex h-svh min-h-0 w-full app-canvas text-foreground">
      <aside
        className={cn(
          "hidden min-h-0 shrink-0 flex-col border-r border-border/80 bg-card shadow-[var(--app-shadow-surface)] transition-[width] duration-200 lg:flex",
          isSidebarCollapsed ? "w-16" : "w-60"
        )}
      >
        <Link
          to="/dashboard"
          className={cn(
            "group flex w-full shrink-0 items-center border-b border-border/70 bg-gradient-to-br from-card via-card to-[color-mix(in_srgb,var(--brand)_6%,var(--card))] transition-colors hover:to-[color-mix(in_srgb,var(--brand)_10%,var(--card))]",
            isSidebarCollapsed ? "h-16 justify-center px-2" : "h-[4.75rem] justify-center px-4 py-3",
          )}
        >
          <AppBrandMark collapsed={isSidebarCollapsed} size="md" />
        </Link>
        <Separator className="shrink-0" />
        <div className="flex min-h-0 flex-1 flex-col">
          {navContent(isSidebarCollapsed)}
          {!isSidebarCollapsed ? (
            <div className="mt-auto border-t border-border/60 p-3" />
          ) : null}
        </div>
      </aside>

      <MobileNavDrawer
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        header={<AppBrandMark size="sm" showSubtitle={false} />}
      >
        {navContent(false, () => setMobileNavOpen(false))}
      </MobileNavDrawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border/80 bg-card/95 px-[var(--app-page-padding)] shadow-[var(--app-shadow-surface)] backdrop-blur supports-[backdrop-filter]:bg-card/90">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 lg:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu className="size-4 opacity-80" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="hidden shrink-0 lg:inline-flex"
              onClick={toggleSidebar}
              aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <PanelLeft className="size-4 opacity-80" aria-hidden />
            </Button>
            <h1 className="truncate text-base font-semibold tracking-tight text-foreground">{title}</h1>
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
                <span className="hidden max-w-[160px] truncate text-sm font-medium md:inline">
                  {userEmail ?? "Account"}
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-xl p-3 shadow-lg" sideOffset={8}>
              <DropdownMenuLabel className="space-y-1 px-1 pb-3 font-normal">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Signed in as
                </span>
                <div className="truncate text-sm font-semibold text-foreground">{userEmail ?? "—"}</div>
              </DropdownMenuLabel>
              <DropdownMenuItem
                className="h-10 cursor-pointer gap-2 rounded-lg px-2 text-sm font-medium"
                onSelect={(e) => {
                  e.preventDefault()
                  setProfileOpen(true)
                }}
              >
                <User2 className="size-4 text-muted-foreground" aria-hidden />
                Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-2" />
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

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-[var(--app-page-padding)]">
          <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">{children}</div>
        </main>
      </div>

      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </div>
  )
}
