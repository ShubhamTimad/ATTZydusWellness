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
  ShoppingCart,
  PanelLeft,
  Settings,
  Shield,
  User2,
  Users,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import { ProfileDialog } from "@/components/profile-dialog"
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

const shellNavItems: ShellNavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, to: "/dashboard", permission: null },
  /*
  {
    id: "performance",
    label: "Performance",
    icon: BarChart3,
    to: "/dashboard/performance",
    permission: null,
    hideWhenOnlyUsersModule: true,
  },

  {
    id: "preferences",
    label: "Preferences",
    icon: Settings2,
    to: "/dashboard/preferences",
    permission: null,
    hideWhenOnlyUsersModule: true,
  },
  */
  { id: "users", label: "Users", icon: Users, to: "/dashboard/users", permission: "users.view" },

  {
    id: "assets",
    label: "Assets",
    icon: Package,
    to: "/dashboard/assets",
    permission: "asset.view",
  },
  {
    id: "masters",
    label: "Masters",
    icon: Database,
    to: "/dashboard/masters",
    permission: "masters.view",
  },

  {
    id: "orders",
    label: "Orders",
    icon: ShoppingCart,
    to: "/dashboard/orders",
    permission: "order.view",
  },

  {
    id: "tasks",
    label: "My tasks",
    icon: ClipboardList,
    to: "/dashboard/tasks",
    permission: [...TASK_ACCESS_PERMISSIONS],
  },
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
  const visibleNav = shellNavItems.filter(navItemVisible)

  const activeItem = visibleNav.find((item) => pathMatchesNav(location.pathname, item.to))
  const title = activeItem?.label ?? "Dashboard"
  const isAssetsWorkspace = location.pathname.startsWith("/dashboard/assets")
  const isAssetDetailPage = /^\/dashboard\/assets\/\d+/.test(location.pathname)

  const [profileOpen, setProfileOpen] = React.useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false)
  React.useEffect(() => {
    try {
      setIsSidebarCollapsed(localStorage.getItem("ui.sidebarCollapsed") === "1")
    } catch {
      // ignore
    }
  }, [])
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

  return (
    <div className="flex h-svh min-h-0 w-full bg-gray-50 text-foreground">
      <aside
        className={cn(
          "hidden min-h-0 shrink-0 flex-col border-r bg-white transition-[width] duration-200 lg:flex",
          isSidebarCollapsed ? "w-16" : "w-64"
        )}
      >
        <div
          className={cn(
            "flex h-16 shrink-0 items-center justify-center border-b",
            isSidebarCollapsed ? "px-2" : "px-4"
          )}
        >
          <img
            src="/logo.png"
            alt="Takeda"
            className={cn(
              "object-contain transition-all duration-200",
              isSidebarCollapsed ? "h-8 w-8" : "h-12 w-auto"
            )}
          />
        </div>
        <Separator className="shrink-0" />
        <div className="flex min-h-0 flex-1 flex-col">
          <nav className={cn("flex flex-col gap-0.5", isSidebarCollapsed ? "p-2" : "p-2")} aria-label="Workspace">
            {visibleNav.map((item) => {
              const Icon = item.icon
              const isActive = pathMatchesNav(location.pathname, item.to)
              return (
                <Button
                  key={item.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  title={isSidebarCollapsed ? item.label : undefined}
                  className={cn(
                    "h-9 w-full text-left font-normal",
                    isSidebarCollapsed ? "justify-center px-0" : "justify-start gap-2",
                    "hover:bg-muted hover:text-foreground",
                    isActive && "bg-muted text-foreground hover:bg-muted"
                  )}
                  asChild
                >
                  <Link to={item.to}>
                    <Icon className="size-4 shrink-0 opacity-70" aria-hidden />
                    {!isSidebarCollapsed ? <span className="truncate">{item.label}</span> : null}
                  </Link>
                </Button>
              )
            })}
          </nav>
          {!isSidebarCollapsed ? (
            <div className="mt-auto border-t border-border/60 p-3">
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5 text-[11px] leading-snug text-muted-foreground">
                Master data and admin tasks appear here when your role allows.
              </div>
            </div>
          ) : null}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border/80 bg-white/95 px-5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/80 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
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
            <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{title}</h1>
          </div>

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
        </header>

        <main
          className={cn(
            "min-h-0 flex-1 overflow-auto",
            isAssetDetailPage && "px-4 py-3 sm:px-6",
            isAssetsWorkspace && !isAssetDetailPage && "p-1.5 sm:p-2",
            !isAssetsWorkspace && "px-4 py-5 sm:px-5 lg:px-8 lg:py-6",
          )}
        >
          <div className="w-full">{children}</div>
        </main>
      </div>

      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </div>
  )
}
