import { AdminLayout } from "@/components/layout/admin-layout"
import { AppShellLayout } from "@/components/layout/app-shell-layout"
import { AppToaster } from "@/components/app-toaster"
import { RequirePermission } from "@/components/admin/require-permission"
import { AppLoginPage } from "@/pages/app-login"
import { AdminOverviewPage } from "@/pages/admin-overview"
import { DashboardPage } from "@/pages/dashboard"
import { LoginPage } from "@/pages/login"
import { PermissionsPage } from "@/pages/permissions"
import { PlantsPage } from "@/pages/plants"
import { RolesPage } from "@/pages/roles"
import { SettingsPage } from "@/pages/settings"
import { UsersPage } from "@/pages/users"
import { MyTasksPage } from "@/pages/my-tasks"
import { WorkflowAssignmentPage } from "@/pages/workflow-assignment"
import { EmailTemplatesPage } from "@/pages/email-templates"
import { UserCreatePage } from "@/pages/user-create"
import { UserEditPage } from "@/pages/user-edit"
import { UserViewPage } from "@/pages/user-view"
import { MyTaskDetailPage } from "@/pages/my-task-detail"
import { ForgotPasswordPage } from "@/pages/forgot-password"
import { ResetPasswordPage } from "@/pages/reset-password"
import { MfaSetupPage } from "@/pages/mfa-setup"
import { AssetCreatePage, AssetDetailPage, AssetImportPage, AssetsListPage } from "@/pages/assets"
import { MastersPage } from "@/pages/masters/masters-page"
import { OrderDetailPage, OrdersListPage } from "@/pages/orders"
import {
  TransferOrderCreatePage,
  TransferOrderDetailPage,
  TransferOrdersListPage,
} from "@/pages/transfers"
import { CapexCreatePage, CapexDetailPage, CapexListPage } from "@/pages/capex"
import { ReportsPage } from "@/pages/reports"
import * as React from "react"
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom"
import { getJson } from "@/lib/api"
import { AccessDenied } from "@/components/admin/access-denied"
import { SessionIdleWatcher } from "@/components/session-idle-watcher"
import {
  clearAuthProfile,
  hasAnyNonUsersRbacPermission,
  persistAuthFromMe,
  SETTINGS_ACCESS_PERMISSIONS,
  TASK_ACCESS_PERMISSIONS,
} from "@/lib/permissions"
import type { NavbarUser } from "@/lib/navbar-user"

function App() {
  return (
    <>
      <AppToaster />
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/mfa/setup" element={<MfaSetupPage />} />
        <Route path="/login" element={<AppLoginRoute />} />
        <Route path="/dashboard" element={<AppRoute />}>
          <Route index element={<DashboardPage />} />
          <Route path="reports" element={<ReportsPage />} />
          /*
            <Route
              path="performance"
              element={
                <RequireNonUsersWorkspace>
                  <WorkspacePlaceholder
                    title="Performance"
                    body="Connect plant KPIs and trends here. This area is reserved for operational analytics."
                  />
                </RequireNonUsersWorkspace>
              }
            />
          */
          /*
            <Route
              path="preferences"
              element={
                <RequireNonUsersWorkspace>
                  <WorkspacePlaceholder
                    title="Preferences"
                    body="Personal settings for this workspace will live here."
                  />
                </RequireNonUsersWorkspace>
              }
            />
          */
          <Route
            path="assets"
            element={
              <RequirePermission code="asset.view">
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<AssetsListPage />} />
            <Route
              path="new"
              element={
                <RequirePermission code="asset.create">
                  <AssetCreatePage />
                </RequirePermission>
              }
            />
            <Route
              path="import"
              element={
                <RequirePermission anyOf={["asset.import", "asset.manage"]}>
                  <AssetImportPage />
                </RequirePermission>
              }
            />
            <Route path=":id" element={<AssetDetailPage />} />
          </Route>

          <Route
            path="masters"
            element={
              <RequirePermission code="masters.view">
                <MastersPage />
              </RequirePermission>
            }
          />

          <Route
            path="orders"
            element={
              <RequirePermission code="order.view">
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<OrdersListPage />} />
            <Route path=":id" element={<OrderDetailPage />} />
          </Route>

          <Route
            path="transfer-orders"
            element={
              <RequirePermission code="transfer.view">
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<TransferOrdersListPage />} />
            <Route
              path="new"
              element={
                <RequirePermission code="transfer.create">
                  <TransferOrderCreatePage />
                </RequirePermission>
              }
            />
            <Route path=":id" element={<TransferOrderDetailPage />} />
          </Route>

          <Route
            path="capitalization"
            element={
              <RequirePermission code="capitalization.view">
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<CapexListPage />} />
            <Route
              path="new"
              element={
                <RequirePermission code="capitalization.create">
                  <CapexCreatePage />
                </RequirePermission>
              }
            />
            <Route path=":id" element={<CapexDetailPage />} />
          </Route>

          <Route
            path="users"
            element={
              <RequirePermission code="users.view">
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<UsersPage />} />
            <Route path="new" element={<UserCreatePage />} />
            <Route path=":id" element={<UserViewPage />} />
            <Route path=":id/edit" element={<UserEditPage />} />
          </Route>
          <Route
            path="tasks"
            element={
              <RequirePermission anyOf={[...TASK_ACCESS_PERMISSIONS]}>
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<MyTasksPage />} />
            <Route path=":taskId" element={<MyTaskDetailPage />} />
          </Route>
          <Route
            path="plants"
            element={
              <RequirePermission anyOf={["org_units.view", "org_units.create", "org_units.update", "org_units.delete"]}>
                <PlantsPage />
              </RequirePermission>
            }
          />
          <Route
            path="roles"
            element={
              <RequirePermission anyOf={["roles.view", "roles.update", "roles.create"]}>
                <RolesPage />
              </RequirePermission>
            }
          />
          <Route
            path="permissions"
            element={
              <RequirePermission anyOf={["permissions.view", "permissions.create"]}>
                <PermissionsPage />
              </RequirePermission>
            }
          />
          <Route
            path="system-settings"
            element={
              <RequirePermission anyOf={[...SETTINGS_ACCESS_PERMISSIONS]}>
                <SettingsPage />
              </RequirePermission>
            }
          />
        </Route>
        <Route path="/admin/login" element={<LoginRoute />} />
        <Route path="/admin" element={<AdminRoute />}>
          <Route index element={<AdminOverviewPage />} />
          <Route
            path="users"
            element={
              <RequirePermission code="users.view">
                <Outlet />
              </RequirePermission>
            }
          >
            <Route index element={<UsersPage />} />
            <Route path="new" element={<UserCreatePage />} />
            <Route path=":id" element={<UserViewPage />} />
            <Route path=":id/edit" element={<UserEditPage />} />
          </Route>
          <Route
            path="plants"
            element={
              <RequirePermission anyOf={["org_units.view", "org_units.create", "org_units.update", "org_units.delete"]}>
                <PlantsPage />
              </RequirePermission>
            }
          />
          <Route
            path="roles"
            element={
              <RequirePermission anyOf={["roles.view", "roles.update", "roles.create"]}>
                <RolesPage />
              </RequirePermission>
            }
          />
          <Route
            path="permissions"
            element={
              <RequirePermission anyOf={["permissions.view", "permissions.create"]}>
                <PermissionsPage />
              </RequirePermission>
            }
          />
          <Route
            path="settings"
            element={
              <RequirePermission anyOf={[...SETTINGS_ACCESS_PERMISSIONS]}>
                <SettingsPage />
              </RequirePermission>
            }
          />
          <Route
            path="workflow-assignment"
            element={
              <RequirePermission code="approval.manage">
                <WorkflowAssignmentPage />
              </RequirePermission>
            }
          />
          <Route
            path="email-templates"
            element={
              <RequirePermission anyOf={["email_templates.view", "email_templates.create", "email_templates.update", "email_templates.delete"]}>
                <EmailTemplatesPage />
              </RequirePermission>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  )
}

export default App

function WorkspacePlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-lg space-y-2">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  )
}

function RequireNonUsersWorkspace({ children }: { children: React.ReactNode }) {
  if (!hasAnyNonUsersRbacPermission()) {
    return (
      <AccessDenied message="This area is available when your role includes permissions beyond user management (for example roles, permissions, or settings)." />
    )
  }
  return <>{children}</>
}

function hasToken() {
  const t = localStorage.getItem("access_token")
  return !!(t && t.length > 0)
}

function clearTokens() {
  localStorage.removeItem("access_token")
  localStorage.removeItem("refresh_token")
  clearAuthProfile()
}

function LoginRoute() {
  const navigate = useNavigate()
  if (hasToken()) return <Navigate to="/admin" replace />
  return (
    <LoginPage
      onLoggedIn={() => {
        navigate("/admin", { replace: true })
      }}
    />
  )
}

function AppLoginRoute() {
  const navigate = useNavigate()
  const [checking, setChecking] = React.useState(hasToken())

  React.useEffect(() => {
    let cancelled = false
    if (!hasToken()) return
    ;(async () => {
      try {
        const me = await getJson<{ is_superuser?: boolean; permissions?: string[] }>("/me")
        if (cancelled) return
        persistAuthFromMe(me)
        const isSuper = me?.is_superuser === true
        navigate(isSuper ? "/admin" : "/dashboard", { replace: true })
      } catch {
        if (cancelled) return
        clearTokens()
        setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (checking) return null
  return <AppLoginPage />
}

function AppRoute() {
  const navigate = useNavigate()
  const [checking, setChecking] = React.useState(true)
  const [navbarUser, setNavbarUser] = React.useState<NavbarUser | null>(null)
  const [profileTick, setProfileTick] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasToken()) {
        setChecking(false)
        navigate("/login", { replace: true })
        return
      }
      try {
        const me = await getJson<{
          full_name?: string
          email?: string
          role?: string | null
          is_superuser?: boolean
          permissions?: string[]
        }>("/me")
        if (cancelled) return
        persistAuthFromMe(me)
        if (me?.is_superuser === true) {
          navigate("/admin", { replace: true })
          return
        }
        setNavbarUser({
          fullName: typeof me.full_name === "string" ? me.full_name : null,
          email: typeof me.email === "string" ? me.email : null,
          role: typeof me.role === "string" ? me.role : null,
        })
        setProfileTick((t) => t + 1)
        setChecking(false)
      } catch {
        if (cancelled) return
        clearTokens()
        navigate("/login", { replace: true })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (checking) return null
  return (
    <SessionIdleWatcher loginPath="/login">
      <AppShellLayout
        user={navbarUser}
        onSignOut={() => {
          clearTokens()
          navigate("/login", { replace: true })
        }}
      >
        <Outlet key={profileTick} />
      </AppShellLayout>
    </SessionIdleWatcher>
  )
}

function AdminRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  const [activeId, setActiveId] = React.useState<
    | "overview"
    | "users"
    | "plants"
    | "roles"
    | "permissions"
    | "settings"
    | "workflow-assignment"
    | "email-templates"
  >("overview")
  const [navbarUser, setNavbarUser] = React.useState<NavbarUser | null>(null)
  const [profileTick, setProfileTick] = React.useState(0)
  const [superGate, setSuperGate] = React.useState<"pending" | "ok">("pending")

  React.useEffect(() => {
    const p = location.pathname
    if (p.startsWith("/admin/users")) setActiveId("users")
    else if (p.startsWith("/admin/plants")) setActiveId("plants")
    else if (p.startsWith("/admin/roles")) setActiveId("roles")
    else if (p.startsWith("/admin/permissions")) setActiveId("permissions")
    else if (p.startsWith("/admin/workflow-assignment")) setActiveId("workflow-assignment")
    else if (p.startsWith("/admin/email-templates")) setActiveId("email-templates")
    else if (p.startsWith("/admin/settings")) setActiveId("settings")
    else setActiveId("overview")
  }, [location.pathname])

  if (!hasToken()) return <Navigate to="/admin/login" replace />

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const me = await getJson<{
          full_name?: string
          email?: string
          role?: string | null
          is_superuser?: boolean
          permissions?: string[]
        }>("/me")
        if (cancelled) return
        persistAuthFromMe(me)
        if (me?.is_superuser !== true) {
          navigate("/dashboard", { replace: true })
          return
        }
        setNavbarUser({
          fullName: typeof me.full_name === "string" ? me.full_name : null,
          email: typeof me.email === "string" ? me.email : null,
          role:
            typeof me.role === "string" && me.role.trim()
              ? me.role
              : me.is_superuser
                ? "Superuser"
                : null,
        })
        setProfileTick((t) => t + 1)
        setSuperGate("ok")
      } catch {
        if (!cancelled) {
          clearTokens()
          navigate("/admin/login", { replace: true })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  const pageTitle = React.useMemo(() => {
    const p = location.pathname
    if (/\/admin\/users\/new\/?$/.test(p)) return "Create user"
    if (/\/admin\/users\/\d+\/edit\/?$/.test(p)) return "Edit user"
    if (/\/admin\/users\/\d+\/?$/.test(p)) return "User details"
    return undefined
  }, [location.pathname])

  if (superGate !== "ok") return null

  return (
    <SessionIdleWatcher loginPath="/admin/login">
      <AdminLayout
        pageTitle={pageTitle}
        activeId={activeId}
        onNavigate={(id) => {
          if (id === "overview") navigate("/admin")
          if (id === "users") navigate("/admin/users")
          if (id === "plants") navigate("/admin/plants")
          if (id === "roles") navigate("/admin/roles")
          if (id === "permissions") navigate("/admin/permissions")
          if (id === "workflow-assignment") navigate("/admin/workflow-assignment")
          if (id === "email-templates") navigate("/admin/email-templates")
          if (id === "settings") navigate("/admin/settings")
        }}
        user={navbarUser}
        onSignOut={() => {
          clearTokens()
          navigate("/admin/login", { replace: true })
        }}
      >
        <Outlet key={profileTick} />
      </AdminLayout>
    </SessionIdleWatcher>
  )
}

