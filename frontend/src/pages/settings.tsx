import * as React from "react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { TAKEDA_LOGO_SRC } from "@/components/layout/app-brand-mark"
import { AdminPage } from "@/components/layout/admin-page"
import { AdminPanel, AdminPrimaryButton, adminSwitchRowClass } from "@/components/layout/admin-ui"
import {
  WorkspaceTabs,
  WorkspaceTabsContent,
  WorkspaceTabsList,
  WorkspaceTabsTrigger,
} from "@/components/layout/list-page-ui"
import { getJson, postBlob, postJson, putJson } from "@/lib/api"
import { formatAppDate } from "@/lib/dates"
import { hasPermission } from "@/lib/permissions"
import { useUrlTab } from "@/lib/use-url-tab"

export type PasswordPolicy = {
  min_length: number
  require_uppercase: boolean
  require_lowercase: boolean
  require_digit: boolean
  require_special: boolean
  max_age_days: number
}

type AuthPolicy = {
  password_enabled: boolean
  mfa_enabled: boolean
  captcha_enabled: boolean
  mfa_enforced: boolean
}

type SessionIdleSettings = {
  idle_timeout_minutes: number
}

type AppVersionSettings = {
  version: string
}

type EmailDelivery = {
  delivery_enabled: boolean
  smtp_host: string
  smtp_port: number
  smtp_username: string
  smtp_password: string
  password_configured: boolean
  smtp_use_tls: boolean
  smtp_from_email: string
  smtp_from_name: string
}

type FinancialYearSettings = {
  start_month: number
  start_day: number
  period_label: string
  period_start: string
  period_end: string
}

type DocumentFormatSettings = {
  org_name: string
  product_name?: string
  confidential_line: string
  excel_include_title: boolean
  signatures: {
    capex: boolean
    reports: boolean
    transfer: boolean
    disposal: boolean
  }
}

const DEFAULT_DOCUMENT_FORMAT: DocumentFormatSettings = {
  org_name: "Takeda",
  confidential_line: "Confidential — internal use only",
  excel_include_title: true,
  signatures: { capex: true, reports: false, transfer: false, disposal: false },
}

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
]

export function SettingsPage() {
  const canWriteSettings = hasPermission("settings.update")
  const canWriteAuth = canWriteSettings || hasPermission("auth_policy.update")
  const [policy, setPolicy] = React.useState<PasswordPolicy | null>(null)
  const [authPolicy, setAuthPolicy] = React.useState<AuthPolicy | null>(null)
  const [sessionIdle, setSessionIdle] = React.useState<SessionIdleSettings | null>(null)
  const [savingSessionIdle, setSavingSessionIdle] = React.useState(false)
  const [appVersion, setAppVersion] = React.useState<AppVersionSettings | null>(null)
  const [savingAppVersion, setSavingAppVersion] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [savingAuth, setSavingAuth] = React.useState(false)
  const [emailDelivery, setEmailDelivery] = React.useState<EmailDelivery | null>(null)
  const [savingEmail, setSavingEmail] = React.useState(false)
  const [testingEmail, setTestingEmail] = React.useState(false)
  const [testToEmail, setTestToEmail] = React.useState("")
  const [tab, setTab] = useUrlTab(
    ["auth", "password", "email", "financial", "documents"] as const,
    "auth",
  )
  const [financialYear, setFinancialYear] = React.useState<FinancialYearSettings | null>(null)
  const [savingFinancialYear, setSavingFinancialYear] = React.useState(false)
  const [documentFormat, setDocumentFormat] = React.useState<DocumentFormatSettings | null>(null)
  const [savingDocuments, setSavingDocuments] = React.useState(false)
  const [previewing, setPreviewing] = React.useState<"pdf" | "xlsx" | null>(null)
  const [preview, setPreview] = React.useState<
    { kind: "pdf"; url: string } | { kind: "xlsx"; blob: Blob } | null
  >(null)

  async function load() {
    setLoadError(null)
    try {
      const [data, auth, email, fy, idle, docs, ver] = await Promise.all([
        getJson<PasswordPolicy>("/admin/settings/password-policy"),
        getJson<AuthPolicy>("/admin/settings/auth-policy").catch(() => null),
        getJson<EmailDelivery>("/admin/settings/email-delivery").catch(() => null),
        getJson<FinancialYearSettings>("/admin/settings/financial-year").catch(() => null),
        getJson<SessionIdleSettings>("/admin/settings/session-idle").catch(() => ({
          idle_timeout_minutes: 10,
        })),
        getJson<DocumentFormatSettings>("/admin/settings/document-format").catch(
          () => DEFAULT_DOCUMENT_FORMAT,
        ),
        getJson<AppVersionSettings>("/admin/settings/app-version").catch(() => ({
          version: "1.0.0",
        })),
      ])
      setPolicy(data)
      setAuthPolicy(auth)
      setEmailDelivery(email)
      setFinancialYear(fy)
      setSessionIdle(idle)
      setDocumentFormat(docs)
      setAppVersion(ver)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load settings")
      setPolicy(null)
      setAuthPolicy(null)
    }
  }

  React.useEffect(() => {
    void load()
  }, [])

  async function save() {
    if (!policy) return
    setSaving(true)
    toast.loading("Saving…", { id: "settings-save" })
    try {
      const updated = await putJson<PasswordPolicy>(
        "/admin/settings/password-policy",
        policy as unknown as Record<string, unknown>
      )
      setPolicy(updated)
      toast.success("Saved", { id: "settings-save" })
    } catch (e) {
      const message = e instanceof Error ? e.message : "Save failed"
      toast.error(message, { id: "settings-save" })
    } finally {
      setSaving(false)
    }
  }

  function closeFormatPreview() {
    setPreview((current) => {
      if (current?.kind === "pdf") URL.revokeObjectURL(current.url)
      return null
    })
  }

  async function previewDocumentFormat(fmt: "pdf" | "xlsx") {
    if (!documentFormat) return
    setPreviewing(fmt)
    try {
      const blob = await postBlob(`/admin/settings/document-format/preview?fmt=${fmt}`, documentFormat)
      setPreview((current) => {
        if (current?.kind === "pdf") URL.revokeObjectURL(current.url)
        return fmt === "pdf" ? { kind: "pdf", url: URL.createObjectURL(blob) } : { kind: "xlsx", blob }
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview failed")
    } finally {
      setPreviewing(null)
    }
  }

  async function saveDocumentFormat() {
    if (!documentFormat) return
    setSavingDocuments(true)
    toast.loading("Saving…", { id: "docs-save" })
    try {
      const updated = await putJson<DocumentFormatSettings>(
        "/admin/settings/document-format",
        documentFormat,
      )
      setDocumentFormat(updated)
      toast.success("Saved", { id: "docs-save" })
      closeFormatPreview()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed", { id: "docs-save" })
    } finally {
      setSavingDocuments(false)
    }
  }

  if (!policy && loadError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load settings</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    )
  }

  if (!policy) {
    return (
      <AdminPage fullWidth description="Loading settings…">
        <p className="text-sm text-muted-foreground">Please wait.</p>
      </AdminPage>
    )
  }

  return (
    <AdminPage fullWidth>
      <WorkspaceTabs value={tab} onValueChange={setTab}>
        <WorkspaceTabsList>
          <WorkspaceTabsTrigger value="auth">Authentication</WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="password">Password policy</WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="email">Email delivery</WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="financial">Financial year</WorkspaceTabsTrigger>
          <WorkspaceTabsTrigger value="documents">PDF & Excel</WorkspaceTabsTrigger>
        </WorkspaceTabsList>

        <WorkspaceTabsContent value="auth" className="space-y-4">
          <AdminPanel
            title="Authentication policy"
            // description="Org-wide controls for password login, MFA, and captcha. Superusers are not affected."
            contentClassName="space-y-4 px-5 py-5"
          >
              {!authPolicy ? (
                <Alert variant="destructive">
                  <AlertTitle>Auth policy unavailable</AlertTitle>
                  <AlertDescription>Missing permission: auth_policy.view</AlertDescription>
                </Alert>
              ) : (
                <>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className={adminSwitchRowClass}>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">Password sign-in</div>
                        <div className="text-xs text-muted-foreground">Allow email/phone + password.</div>
                      </div>
                      <Switch
                        checked={authPolicy.password_enabled}
                        onCheckedChange={(v) => setAuthPolicy((p) => (p ? { ...p, password_enabled: Boolean(v) } : p))}
                      />
                    </div>
                    <div className={adminSwitchRowClass}>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">Captcha</div>
                        <div className="text-xs text-muted-foreground">Require captcha token on login.</div>
                      </div>
                      <Switch
                        checked={authPolicy.captcha_enabled}
                        onCheckedChange={(v) => setAuthPolicy((p) => (p ? { ...p, captcha_enabled: Boolean(v) } : p))}
                      />
                    </div>
                    <div className={adminSwitchRowClass}>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">MFA (TOTP)</div>
                        <div className="text-xs text-muted-foreground">Require authenticator code after password.</div>
                      </div>
                      <Switch
                        checked={authPolicy.mfa_enabled}
                        onCheckedChange={(v) => setAuthPolicy((p) => (p ? { ...p, mfa_enabled: Boolean(v) } : p))}
                      />
                    </div>
                    <div className={adminSwitchRowClass}>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">MFA enforced</div>
                        <div className="text-xs text-muted-foreground">Block login until MFA is set up.</div>
                      </div>
                      <Switch
                        checked={authPolicy.mfa_enforced}
                        disabled={!authPolicy.mfa_enabled}
                        onCheckedChange={(v) => setAuthPolicy((p) => (p ? { ...p, mfa_enforced: Boolean(v) } : p))}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end border-t border-border/60 pt-4">
                    <AdminPrimaryButton
                      type="button"
                      disabled={savingAuth || !canWriteAuth}
                      onClick={async () => {
                        if (!authPolicy) return
                        setSavingAuth(true)
                        toast.loading("Saving auth policy…", { id: "auth-policy-save" })
                        try {
                          const updated = await putJson<AuthPolicy>(
                            "/admin/settings/auth-policy",
                            authPolicy as unknown as Record<string, unknown>
                          )
                          setAuthPolicy(updated)
                          toast.success("Saved", { id: "auth-policy-save" })
                        } catch (e) {
                          const message = e instanceof Error ? e.message : "Save failed"
                          toast.error(message, { id: "auth-policy-save" })
                        } finally {
                          setSavingAuth(false)
                        }
                      }}
                    >
                      {savingAuth ? "Saving…" : "Save auth policy"}
                    </AdminPrimaryButton>
                  </div>
                </>
              )}
          </AdminPanel>

          <AdminPanel
            title="Session idle timeout"
            // description="All users are signed out after this many minutes without activity, or while the browser tab is in the background. The server also ends the session if the app is closed."
            contentClassName="space-y-4 px-5 py-5"
          >
            {sessionIdle ? (
              <>
                <div className="max-w-xs space-y-1.5">
                  <Label htmlFor="idle-timeout-minutes">Idle timeout (minutes)</Label>
                  <Input
                    id="idle-timeout-minutes"
                    type="number"
                    min={1}
                    max={1440}
                    value={sessionIdle.idle_timeout_minutes}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10)
                      setSessionIdle((s) =>
                        s ? { ...s, idle_timeout_minutes: Number.isFinite(n) ? n : s.idle_timeout_minutes } : s
                      )
                    }}
                  />
                  {/* <p className="text-xs text-muted-foreground">
                    Default is 10 minutes. Applies to every signed-in user on the next sign-in or API call.
                  </p> */}
                </div>
                <div className="flex justify-end border-t border-border/60 pt-4">
                  <AdminPrimaryButton
                    type="button"
                    disabled={savingSessionIdle || !canWriteSettings}
                    onClick={async () => {
                      if (!sessionIdle) return
                      setSavingSessionIdle(true)
                      toast.loading("Saving session timeout…", { id: "session-idle-save" })
                      try {
                        const updated = await putJson<SessionIdleSettings>(
                          "/admin/settings/session-idle",
                          sessionIdle as unknown as Record<string, unknown>
                        )
                        setSessionIdle(updated)
                        toast.success("Saved", { id: "session-idle-save" })
                      } catch (e) {
                        const message = e instanceof Error ? e.message : "Save failed"
                        toast.error(message, { id: "session-idle-save" })
                      } finally {
                        setSavingSessionIdle(false)
                      }
                    }}
                  >
                    {savingSessionIdle ? "Saving…" : "Save session timeout"}
                  </AdminPrimaryButton>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
          </AdminPanel>

          <AdminPanel
            title="Application version"
            description="Shown on the login screen. Update this when you release a new build."
            contentClassName="space-y-4 px-5 py-5"
          >
            {appVersion ? (
              <>
                <div className="max-w-xs space-y-1.5">
                  <Label htmlFor="app-version">Version</Label>
                  <Input
                    id="app-version"
                    value={appVersion.version}
                    onChange={(e) => setAppVersion({ version: e.target.value })}
                    placeholder="1.0.0"
                    disabled={!canWriteSettings}
                  />
                </div>
                <div className="flex justify-end border-t border-border/60 pt-4">
                  <AdminPrimaryButton
                    type="button"
                    disabled={savingAppVersion || !canWriteSettings || !appVersion.version.trim()}
                    onClick={async () => {
                      if (!appVersion) return
                      setSavingAppVersion(true)
                      toast.loading("Saving…", { id: "app-version-save" })
                      try {
                        const updated = await putJson<AppVersionSettings>(
                          "/admin/settings/app-version",
                          { version: appVersion.version.trim() },
                        )
                        setAppVersion(updated)
                        toast.success("Saved", { id: "app-version-save" })
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Save failed", {
                          id: "app-version-save",
                        })
                      } finally {
                        setSavingAppVersion(false)
                      }
                    }}
                  >
                    {savingAppVersion ? "Saving…" : "Save version"}
                  </AdminPrimaryButton>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
          </AdminPanel>
        </WorkspaceTabsContent>

        <WorkspaceTabsContent value="password" className="space-y-4">
          <AdminPanel
            title="Password rules"
            // description="Enforced on password changes and resets."
            contentClassName="space-y-4 px-5 py-5"
          >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="min_length">Minimum length</Label>
                  <Input
                    id="min_length"
                    type="number"
                    min={1}
                    max={256}
                    value={policy.min_length}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setPolicy((p) => (p ? { ...p, min_length: Number.isFinite(n) ? n : p.min_length } : p))
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="max_age_days">Max age (days)</Label>
                  <Input
                    id="max_age_days"
                    type="number"
                    min={0}
                    max={36500}
                    value={policy.max_age_days}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setPolicy((p) => (p ? { ...p, max_age_days: Number.isFinite(n) ? n : p.max_age_days } : p))
                    }}
                  />
                  <p className="text-xs text-muted-foreground">Use 0 to disable password expiry.</p>
                </div>
              </div>

              <Separator />

              {(
                [
                  ["require_uppercase", "Require uppercase (A–Z)"],
                  ["require_lowercase", "Require lowercase (a–z)"],
                  ["require_digit", "Require a digit"],
                  ["require_special", "Require a special character"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <Label htmlFor={key} className="font-normal text-muted-foreground">
                    {label}
                  </Label>
                  <Switch
                    id={key}
                    checked={policy[key]}
                    onCheckedChange={(v) =>
                      setPolicy((p) => (p ? { ...p, [key]: Boolean(v) } : p))
                    }
                  />
                </div>
              ))}

              <div className="flex justify-end border-t border-border/60 pt-4">
                <AdminPrimaryButton type="button" onClick={() => void save()} disabled={saving || !canWriteSettings}>
                  {saving ? "Saving…" : "Save password policy"}
                </AdminPrimaryButton>
              </div>
          </AdminPanel>
        </WorkspaceTabsContent>

        <WorkspaceTabsContent value="email" className="space-y-4">
          <AdminPanel
            title="SMTP & email delivery"
            // description="Used for notifications, password reset, tasks, and user invites. Use an app password when 2FA is enabled."
            contentClassName="space-y-4 px-5 py-5"
          >
              {!emailDelivery ? (
                <p className="text-sm text-muted-foreground">Loading email settings…</p>
              ) : (
                <>
                  <div className={adminSwitchRowClass}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">Send real emails</div>
                      <div className="text-xs text-muted-foreground">
                        Off = log messages to the API server console (development).
                      </div>
                    </div>
                    <Switch
                      checked={emailDelivery.delivery_enabled}
                      onCheckedChange={(v) =>
                        setEmailDelivery((p) => (p ? { ...p, delivery_enabled: Boolean(v) } : p))
                      }
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="smtp_host">SMTP host</Label>
                      <Input
                        id="smtp_host"
                        placeholder="smtp.gmail.com (not smtp.google.com)"
                        value={emailDelivery.smtp_host}
                        onChange={(e) =>
                          setEmailDelivery((p) => (p ? { ...p, smtp_host: e.target.value } : p))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="smtp_port">Port</Label>
                      <Input
                        id="smtp_port"
                        type="number"
                        min={1}
                        max={65535}
                        value={emailDelivery.smtp_port}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          setEmailDelivery((p) =>
                            p ? { ...p, smtp_port: Number.isFinite(n) ? n : p.smtp_port } : p
                          )
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Gmail: 587 with TLS on, or 465 (implicit SSL).
                      </p>
                    </div>
                    <div className={adminSwitchRowClass}>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">Use TLS (STARTTLS)</div>
                        <div className="text-xs text-muted-foreground">Typical for port 587.</div>
                      </div>
                      <Switch
                        checked={emailDelivery.smtp_use_tls}
                        onCheckedChange={(v) =>
                          setEmailDelivery((p) => (p ? { ...p, smtp_use_tls: Boolean(v) } : p))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="smtp_username">Username / email</Label>
                      <Input
                        id="smtp_username"
                        autoComplete="username"
                        placeholder="you@company.com"
                        value={emailDelivery.smtp_username}
                        onChange={(e) =>
                          setEmailDelivery((p) => (p ? { ...p, smtp_username: e.target.value } : p))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="smtp_password">App password</Label>
                      <Input
                        id="smtp_password"
                        type="password"
                        autoComplete="new-password"
                        placeholder={
                          emailDelivery.password_configured
                            ? "Leave blank to keep current password"
                            : "Required when sending mail"
                        }
                        value={emailDelivery.smtp_password}
                        onChange={(e) =>
                          setEmailDelivery((p) => (p ? { ...p, smtp_password: e.target.value } : p))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="smtp_from_email">From email</Label>
                      <Input
                        id="smtp_from_email"
                        placeholder="noreply@company.com"
                        value={emailDelivery.smtp_from_email}
                        onChange={(e) =>
                          setEmailDelivery((p) => (p ? { ...p, smtp_from_email: e.target.value } : p))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="smtp_from_name">From name</Label>
                      <Input
                        id="smtp_from_name"
                        placeholder="Ultra Workspace"
                        value={emailDelivery.smtp_from_name}
                        onChange={(e) =>
                          setEmailDelivery((p) => (p ? { ...p, smtp_from_name: e.target.value } : p))
                        }
                      />
                    </div>
                  </div>

                  <Separator />

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1 space-y-1.5">
                      <Label htmlFor="test_to_email">Send test email to</Label>
                      <Input
                        id="test_to_email"
                        type="email"
                        placeholder="you@example.com"
                        value={testToEmail}
                        onChange={(e) => setTestToEmail(e.target.value)}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={testingEmail || !testToEmail.trim()}
                      onClick={async () => {
                        if (!emailDelivery) return
                        setTestingEmail(true)
                        toast.loading("Sending test…", { id: "email-test" })
                        const controller = new AbortController()
                        const timeoutId = window.setTimeout(() => controller.abort(), 25_000)
                        try {
                          await postJson(
                            "/admin/settings/email-delivery/test",
                            {
                              to_email: testToEmail.trim(),
                              config: emailDelivery,
                            },
                            { signal: controller.signal }
                          )
                          toast.success("Test email sent. Save settings to use for all emails.", {
                            id: "email-test",
                          })
                        } catch (e) {
                          const aborted = e instanceof DOMException && e.name === "AbortError"
                          const message = aborted
                            ? "Request timed out. Check SMTP host/port and network (Gmail: smtp.gmail.com, port 587)."
                            : e instanceof Error
                              ? e.message
                              : "Test send failed"
                          toast.error(message, { id: "email-test" })
                        } finally {
                          window.clearTimeout(timeoutId)
                          setTestingEmail(false)
                        }
                      }}
                    >
                      {testingEmail ? "Sending…" : "Send test"}
                    </Button>
                  </div>

                  <div className="flex justify-end border-t border-border/60 pt-4">
                    <AdminPrimaryButton
                      type="button"
                      disabled={savingEmail || !canWriteSettings}
                      onClick={async () => {
                        if (!emailDelivery) return
                        setSavingEmail(true)
                        toast.loading("Saving email settings…", { id: "email-save" })
                        try {
                          const updated = await putJson<EmailDelivery>(
                            "/admin/settings/email-delivery",
                            emailDelivery as unknown as Record<string, unknown>
                          )
                          setEmailDelivery(updated)
                          toast.success("Saved", { id: "email-save" })
                        } catch (e) {
                          const message = e instanceof Error ? e.message : "Save failed"
                          toast.error(message, { id: "email-save" })
                        } finally {
                          setSavingEmail(false)
                        }
                      }}
                    >
                      {savingEmail ? "Saving…" : "Save email settings"}
                    </AdminPrimaryButton>
                  </div>
                </>
              )}
          </AdminPanel>
        </WorkspaceTabsContent>

        <WorkspaceTabsContent value="financial" className="space-y-4">
          <AdminPanel
            title="Financial year"
            // description="Used when creating physical verification orders to detect assets already verified in the current period (e.g. 1 Apr – 31 Mar)."
            contentClassName="space-y-4 px-5 py-5"
          >
            {!financialYear ? (
              <p className="text-sm text-muted-foreground">Loading financial year settings…</p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="fy_start_month">Start month</Label>
                    <select
                      id="fy_start_month"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={financialYear.start_month}
                      onChange={(e) =>
                        setFinancialYear((p) =>
                          p ? { ...p, start_month: Number(e.target.value) } : p,
                        )
                      }
                    >
                      {MONTHS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fy_start_day">Start day</Label>
                    <Input
                      id="fy_start_day"
                      type="number"
                      min={1}
                      max={31}
                      value={financialYear.start_day}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        setFinancialYear((p) =>
                          p ? { ...p, start_day: Number.isFinite(n) ? n : p.start_day } : p,
                        )
                      }}
                    />
                  </div>
                </div>
                {financialYear.period_label ? (
                  <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-sm text-muted-foreground">
                    Current period:{" "}
                    <span className="font-medium text-foreground">{financialYear.period_label}</span>
                    {financialYear.period_start && financialYear.period_end ? (
                      <>
                        {" "}
                        ({formatAppDate(financialYear.period_start)} –{" "}
                        {formatAppDate(financialYear.period_end)})
                      </>
                    ) : null}
                  </p>
                ) : null}
                <div className="flex justify-end border-t border-border/60 pt-4">
                  <AdminPrimaryButton
                    type="button"
                    disabled={savingFinancialYear || !canWriteSettings}
                    onClick={async () => {
                      if (!financialYear) return
                      setSavingFinancialYear(true)
                      toast.loading("Saving…", { id: "fy-save" })
                      try {
                        const updated = await putJson<FinancialYearSettings>(
                          "/admin/settings/financial-year",
                          {
                            start_month: financialYear.start_month,
                            start_day: financialYear.start_day,
                          },
                        )
                        setFinancialYear(updated)
                        toast.success("Saved", { id: "fy-save" })
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Save failed", { id: "fy-save" })
                      } finally {
                        setSavingFinancialYear(false)
                      }
                    }}
                  >
                    {savingFinancialYear ? "Saving…" : "Save financial year"}
                  </AdminPrimaryButton>
                </div>
              </>
            )}
          </AdminPanel>
        </WorkspaceTabsContent>

        <WorkspaceTabsContent value="documents" className="space-y-4">
          <AdminPanel
            title="PDF & Excel format"
            // description="Edit the fields, preview PDF or Excel with those unsaved values, then save when it looks right. Logo, header and footer wrap every report page — the table sits between them."
            contentClassName="space-y-4 px-5 py-5"
          >
            {!documentFormat ? (
              <p className="text-sm text-muted-foreground">Loading document format…</p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="doc_org_name">Organisation</Label>
                    <Input
                      id="doc_org_name"
                      value={documentFormat.org_name}
                      onChange={(e) =>
                        setDocumentFormat((p) => (p ? { ...p, org_name: e.target.value } : p))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="doc_confidential">Confidential line</Label>
                    <Input
                      id="doc_confidential"
                      value={documentFormat.confidential_line}
                      onChange={(e) =>
                        setDocumentFormat((p) => (p ? { ...p, confidential_line: e.target.value } : p))
                      }
                    />
                  </div>
                </div>
                <Separator />
                <p className="text-sm font-medium">Signature blocks</p>
                <p className="text-xs text-muted-foreground">
                  When on, name and date lines sit above the footer for the creator and each approve step.
                </p>
                {(
                  [
                    ["capex", "Capitalization form"],
                    ["reports", "Reports (PDF & Excel)"],
                    ["transfer", "Transfer print"],
                    ["disposal", "Disposal print"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className={adminSwitchRowClass}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{label}</div>
                    </div>
                    <Switch
                      checked={documentFormat.signatures[key]}
                      onCheckedChange={(v) =>
                        setDocumentFormat((p) =>
                          p
                            ? {
                                ...p,
                                signatures: { ...p.signatures, [key]: Boolean(v) },
                              }
                            : p,
                        )
                      }
                    />
                  </div>
                ))}
                <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={previewing !== null}
                    onClick={() => void previewDocumentFormat("pdf")}
                  >
                    {previewing === "pdf" ? "Preparing…" : "Preview PDF"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={previewing !== null}
                    onClick={() => void previewDocumentFormat("xlsx")}
                  >
                    {previewing === "xlsx" ? "Preparing…" : "Preview Excel"}
                  </Button>
                  <AdminPrimaryButton
                    type="button"
                    disabled={savingDocuments || !canWriteSettings}
                    onClick={() => void saveDocumentFormat()}
                  >
                    {savingDocuments ? "Saving…" : "Save document format"}
                  </AdminPrimaryButton>
                </div>
              </>
            )}
          </AdminPanel>
          <Dialog
            open={preview !== null}
            onOpenChange={(open) => {
              if (!open) closeFormatPreview()
            }}
          >
            <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
              <DialogHeader className="px-5 pt-5 pb-3">
                <DialogTitle>{preview?.kind === "xlsx" ? "Excel preview" : "PDF preview"}</DialogTitle>
                <DialogDescription>
                  This uses your current fields, not the last saved settings. Save when it looks right.
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-auto px-5 pb-2">
                {preview?.kind === "pdf" ? (
                  <iframe
                    title="PDF preview"
                    src={preview.url}
                    className="h-[min(70vh,720px)] w-full rounded-md border bg-muted"
                  />
                ) : preview?.kind === "xlsx" && documentFormat ? (
                  <div className="overflow-auto rounded-md border bg-background text-sm">
                    <div className="px-3 pt-3">
                      <div className="flex items-start justify-between gap-4 border-b-2 border-[#E1242A] px-3 py-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <img
                            src={TAKEDA_LOGO_SRC}
                            alt=""
                            className="h-9 w-auto max-w-[120px] object-contain object-left"
                          />
                          <div className="min-w-0">
                            <p className="text-base font-semibold">Sample report</p>
                            <p className="text-xs text-muted-foreground">
                              Preview of current (unsaved) format
                            </p>
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                          <div>
                            Generated on {formatAppDate(new Date())}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <p className="mb-2 text-xs text-muted-foreground">Records: 2</p>
                      <table className="w-full border-collapse text-left">
                        <thead>
                          <tr className="bg-muted">
                            {["Asset name", "Plant", "Status"].map((h) => (
                              <th key={h} className="border px-2 py-1.5 font-semibold">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            ["Filling line 1", "Goa", "Active"],
                            ["HVAC unit", "Goa", "Active"],
                          ].map((row) => (
                            <tr key={row.join("-")}>
                              {row.map((cell) => (
                                <td key={cell} className="border px-2 py-1.5">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="mt-6 grid grid-cols-3 gap-4">
                        {[
                          { label: "Signature of User", name: "A. Sharma", date: "11.08.2026" },
                          { label: "Signature of Plant Head", name: "", date: "" },
                          { label: "Signature of Finance", name: "", date: "" },
                        ].map((s) => (
                          <div key={s.label} className="min-w-0 text-xs">
                            <div className="mb-2 font-semibold">{s.label}:</div>
                            <div className="mb-2 min-h-8 border-b border-foreground/80 pb-1 italic">
                              {s.name || "\u00a0"}
                            </div>
                            <div>
                              Name: <strong>{s.name}</strong>
                            </div>
                            <div>
                              Date: <strong>{s.date}</strong>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-4 border-t px-4 py-2 text-xs">
                      <div>
                        <div className="font-semibold">{documentFormat.org_name}</div>
                        <div className="text-muted-foreground">{documentFormat.confidential_line}</div>
                      </div>
                      <div className="text-right text-muted-foreground">
                        <div>Page 1 of 1</div>
                        <div>Generated by</div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <DialogFooter className="px-5 py-4" showCloseButton>
                {preview?.kind === "xlsx" ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (preview.kind !== "xlsx") return
                      const url = URL.createObjectURL(preview.blob)
                      const a = document.createElement("a")
                      a.href = url
                      a.download = "document-format-preview.xlsx"
                      a.click()
                      URL.revokeObjectURL(url)
                    }}
                  >
                    Download .xlsx
                  </Button>
                ) : null}
                <AdminPrimaryButton
                  type="button"
                  disabled={savingDocuments || !canWriteSettings}
                  onClick={() => void saveDocumentFormat()}
                >
                  {savingDocuments ? "Saving…" : "Save"}
                </AdminPrimaryButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </WorkspaceTabsContent>
      </WorkspaceTabs>
    </AdminPage>
  )
}
