import * as React from "react"
import { toast } from "sonner"
import { Barcode, QrCode, Radio } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { PageLoader } from "@/components/ui/page-loader"
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
import {
  BrandLogoPlaceholder,
  currentBrandLogoSrc,
  writeStoredBrandLogoVersion,
} from "@/components/layout/app-brand-mark"
import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminPanel,
  AdminPrimaryButton,
  adminSelectClass,
  adminSwitchRowClass,
  adminTabsListClass,
  adminTabsTriggerClass,
} from "@/components/layout/admin-ui"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { deleteJson, getBlob, getJson, postBlob, postJson, putFormData, putJson } from "@/lib/api"
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
  max_failed_login_attempts: number
  sso_enabled?: boolean
  sso_button_label?: string
}

type SessionIdleSettings = {
  idle_timeout_minutes: number
  apply_to_sso: boolean
}

type AppVersionSettings = {
  version: string
}

type LoginBackgroundMeta = {
  configured: boolean
  content_type: string | null
  version: string | null
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

type SsoSettings = {
  enabled: boolean
  button_label: string
  issuer: string
  client_id: string
  client_secret: string
  client_secret_configured: boolean
  redirect_uri: string
  scopes: string
  email_claim: string
  subject_claim: string
  allow_jit: boolean
}

type FinancialYearSettings = {
  start_month: number
  start_day: number
  period_label: string
  period_start: string
  period_end: string
}

export type ScanningProcessSettings = {
  process_mode: string
  label: string
  rfid_enabled: boolean
  barcode_enabled: boolean
  qr_enabled: boolean
  description: string
}

const SCANNING_PROCESS_OPTIONS = [
  {
    value: "rfid_only",
    label: "RFID only",
    hint: "Verification restricted to RFID tag scans only.",
  },
  {
    value: "barcode_only",
    label: "Barcode only (Bar only)",
    hint: "Verification restricted to 1D optical barcode scans only.",
  },
  {
    value: "qr_only",
    label: "QR code only (QR only)",
    hint: "Verification restricted to 2D QR code scans/camera only.",
  },
  {
    value: "barcode_qr",
    label: "QR code + Bar code",
    hint: "Accepts 1D Barcode and 2D QR Code scans.",
  },
  {
    value: "rfid_barcode",
    label: "RFID + Bar code",
    hint: "Accepts RFID tag and 1D Barcode scans.",
  },
  {
    value: "rfid_qr",
    label: "RFID + QR code",
    hint: "Accepts RFID tag and 2D QR Code scans.",
  },
  {
    value: "rfid_barcode_qr",
    label: "RFID + Bar code + QR code (All)",
    hint: "Accepts all scanning methods (RFID tag, 1D Barcode, and 2D QR Code).",
  },
]

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

const settingsTabClass = "mt-0 space-y-4 outline-none"

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
  const [loginBgMeta, setLoginBgMeta] = React.useState<LoginBackgroundMeta | null>(null)
  const [loginBgPreviewUrl, setLoginBgPreviewUrl] = React.useState<string | null>(null)
  const [loginBgBusy, setLoginBgBusy] = React.useState(false)
  const loginBgInputRef = React.useRef<HTMLInputElement>(null)
  const [logoMeta, setLogoMeta] = React.useState<LoginBackgroundMeta | null>(null)
  const [logoPreviewUrl, setLogoPreviewUrl] = React.useState<string | null>(null)
  const shownLogoSrc = logoPreviewUrl ?? currentBrandLogoSrc()
  const [logoBusy, setLogoBusy] = React.useState(false)
  const logoInputRef = React.useRef<HTMLInputElement>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [savingAuth, setSavingAuth] = React.useState(false)
  const [emailDelivery, setEmailDelivery] = React.useState<EmailDelivery | null>(null)
  const [savingEmail, setSavingEmail] = React.useState(false)
  const [testingEmail, setTestingEmail] = React.useState(false)
  const [testToEmail, setTestToEmail] = React.useState("")
  const [ssoSettings, setSsoSettings] = React.useState<SsoSettings | null>(null)
  const [savingSso, setSavingSso] = React.useState(false)
  const [urlTab, setTab] = useUrlTab(
    ["general", "appearance", "security", "sso", "auth", "password", "session", "email", "branding", "financial", "documents", "scanning"] as const,
    "general",
  )
  const tab =
    urlTab === "auth" || urlTab === "password" || urlTab === "session"
      ? "security"
      : urlTab === "email" || urlTab === "financial" || urlTab === "scanning"
        ? "general"
        : urlTab === "branding" || urlTab === "documents"
          ? "appearance"
          : urlTab
  const [financialYear, setFinancialYear] = React.useState<FinancialYearSettings | null>(null)
  const [savingFinancialYear, setSavingFinancialYear] = React.useState(false)
  const [scanningProcess, setScanningProcess] = React.useState<ScanningProcessSettings | null>(null)
  const [savingScanningProcess, setSavingScanningProcess] = React.useState(false)
  const [documentFormat, setDocumentFormat] = React.useState<DocumentFormatSettings | null>(null)
  const [savingDocuments, setSavingDocuments] = React.useState(false)
  const [previewing, setPreviewing] = React.useState<"pdf" | "xlsx" | null>(null)
  const [preview, setPreview] = React.useState<
    { kind: "pdf"; url: string } | { kind: "xlsx"; blob: Blob } | null
  >(null)

  async function loadLoginBackgroundPreview(configured: boolean) {
    setLoginBgPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    if (!configured) return
    try {
      const blob = await getBlob("/admin/settings/login-background")
      setLoginBgPreviewUrl(URL.createObjectURL(blob))
    } catch {
      setLoginBgPreviewUrl(null)
    }
  }

  async function loadLogoPreview(configured: boolean) {
    setLogoPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    if (!configured) return
    try {
      const blob = await getBlob("/admin/settings/brand-logo")
      setLogoPreviewUrl(URL.createObjectURL(blob))
    } catch {
      setLogoPreviewUrl(null)
    }
  }

  async function load() {
    setLoadError(null)
    try {
      const [data, auth, email, sso, fy, idle, docs, ver, bgMeta, brandLogo, scan] = await Promise.all([
        getJson<PasswordPolicy>("/admin/settings/password-policy"),
        getJson<AuthPolicy>("/admin/settings/auth-policy").catch(() => null),
        getJson<EmailDelivery>("/admin/settings/email-delivery").catch(() => null),
        getJson<SsoSettings>("/admin/settings/sso").catch(() => null),
        getJson<FinancialYearSettings>("/admin/settings/financial-year").catch(() => null),
        getJson<SessionIdleSettings>("/admin/settings/session-idle").catch(() => ({
          idle_timeout_minutes: 10,
          apply_to_sso: false,
        })),
        getJson<DocumentFormatSettings>("/admin/settings/document-format").catch(
          () => DEFAULT_DOCUMENT_FORMAT,
        ),
        getJson<AppVersionSettings>("/auth/app-version").catch(() => ({ version: "dev" })),
        getJson<LoginBackgroundMeta>("/admin/settings/login-background/meta").catch(() => ({
          configured: false,
          content_type: null,
          version: null,
        })),
        getJson<LoginBackgroundMeta>("/admin/settings/brand-logo/meta").catch(() => ({
          configured: false,
          content_type: null,
          version: null,
        })),
        getJson<ScanningProcessSettings>("/admin/settings/scanning-process").catch(() => null),
      ])
      setPolicy(data)
      setAuthPolicy(auth)
      setEmailDelivery(email)
      setSsoSettings(sso)
      setFinancialYear(fy)
      setScanningProcess(scan)
      setSessionIdle({
        idle_timeout_minutes: Number(idle?.idle_timeout_minutes) || 10,
        apply_to_sso: Boolean(idle?.apply_to_sso),
      })
      setDocumentFormat(docs)
      setAppVersion(ver)
      setLoginBgMeta(bgMeta)
      setLogoMeta(brandLogo)
      writeStoredBrandLogoVersion(brandLogo.configured ? brandLogo.version : null)
      void loadLoginBackgroundPreview(bgMeta.configured)
      void loadLogoPreview(brandLogo.configured)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load settings")
      setPolicy(null)
      setAuthPolicy(null)
    }
  }

  React.useEffect(() => {
    void load()
    return () => {
      setLoginBgPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
    }
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
      <AdminPage fullWidth viewportFill>
        <PageLoader label="Loading settings" />
      </AdminPage>
    )
  }

  return (
    <AdminPage fullWidth>
      <Tabs value={tab} onValueChange={setTab} className="gap-5">
        <TabsList className={adminTabsListClass}>
          <TabsTrigger className={adminTabsTriggerClass} value="general">
            General
          </TabsTrigger>
          <TabsTrigger className={adminTabsTriggerClass} value="appearance">
            Appearance
          </TabsTrigger>
          <TabsTrigger className={adminTabsTriggerClass} value="security">
            Security
          </TabsTrigger>
          <TabsTrigger className={adminTabsTriggerClass} value="sso">
            Single sign-on
          </TabsTrigger>
        </TabsList>

        <TabsContent value="security" className={settingsTabClass}>
          <div className="grid items-start gap-4 xl:grid-cols-2">
          <AdminPanel
            className="h-full"
            title="Sign-in policy"
            // description="Password login, MFA, captcha, and account lockout. Superusers are not affected."
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
                        disabled={!canWriteAuth}
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
                        disabled={!canWriteAuth}
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
                        disabled={!canWriteAuth}
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
                        disabled={!canWriteAuth || !authPolicy.mfa_enabled}
                        onCheckedChange={(v) => setAuthPolicy((p) => (p ? { ...p, mfa_enforced: Boolean(v) } : p))}
                      />
                    </div>
                    <div className="space-y-1.5 lg:col-span-2">
                      <Label htmlFor="max-failed-login-attempts">Failed login attempts before lock</Label>
                      <Input
                        id="max-failed-login-attempts"
                        type="number"
                        min={0}
                        max={20}
                        className="max-w-[8rem]"
                        value={authPolicy.max_failed_login_attempts}
                        disabled={!canWriteAuth}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          setAuthPolicy((p) =>
                            p
                              ? {
                                  ...p,
                                  max_failed_login_attempts: Number.isFinite(n)
                                    ? Math.min(20, Math.max(0, n))
                                    : 0,
                                }
                              : p,
                          )
                        }}
                      />
                      {/* <p className="text-xs text-muted-foreground">
                        Lock the account after this many consecutive failed password attempts. Use 0 to disable.
                      </p> */}
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
            className="h-full"
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
                  disabled={!canWriteSettings}
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
                  disabled={!canWriteSettings}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setPolicy((p) => (p ? { ...p, max_age_days: Number.isFinite(n) ? n : p.max_age_days } : p))
                  }}
                />
                <p className="text-xs text-muted-foreground">Use 0 to disable password expiry.</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["require_uppercase", "Require uppercase (A–Z)"],
                  ["require_lowercase", "Require lowercase (a–z)"],
                  ["require_digit", "Require a digit"],
                  ["require_special", "Require a special character"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className={adminSwitchRowClass}>
                  <Label htmlFor={key} className="font-medium text-foreground">
                    {label}
                  </Label>
                  <Switch
                    id={key}
                    checked={policy[key]}
                    disabled={!canWriteSettings}
                    onCheckedChange={(v) => setPolicy((p) => (p ? { ...p, [key]: Boolean(v) } : p))}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end border-t border-border/60 pt-4">
              <AdminPrimaryButton type="button" onClick={() => void save()} disabled={saving || !canWriteSettings}>
                {saving ? "Saving…" : "Save password policy"}
              </AdminPrimaryButton>
            </div>
          </AdminPanel>
          <AdminPanel
            className="h-full xl:col-span-2"
            title="Session idle timeout"
            // description="Password sign-in always uses this timer. For SSO, use Apply to SSO below (off by default — no navbar countdown)."
            contentClassName="space-y-4 px-5 py-5"
          >
            {sessionIdle ? (
              <>
                <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start">
                  <div className="space-y-1.5">
                    <Label htmlFor="idle-timeout-minutes">Idle timeout (minutes)</Label>
                    <Input
                      id="idle-timeout-minutes"
                      type="number"
                      min={1}
                      max={1440}
                      value={sessionIdle.idle_timeout_minutes}
                      disabled={!canWriteSettings}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10)
                        setSessionIdle((s) =>
                          s ? { ...s, idle_timeout_minutes: Number.isFinite(n) ? n : s.idle_timeout_minutes } : s,
                        )
                      }}
                    />
                  </div>
                  <div className={adminSwitchRowClass}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">Apply to SSO sessions</div>
                      <div className="text-xs text-muted-foreground">
                        Off (default): Microsoft/OIDC sessions stay signed in until logout or JWT expiry — no top
                        navbar timer. On: SSO uses the same idle minutes as password sign-in.
                      </div>
                    </div>
                    <Switch
                      checked={sessionIdle.apply_to_sso}
                      disabled={!canWriteSettings}
                      onCheckedChange={(v) =>
                        setSessionIdle((s) => (s ? { ...s, apply_to_sso: Boolean(v) } : s))
                      }
                    />
                  </div>
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
                          sessionIdle as unknown as Record<string, unknown>,
                        )
                        setSessionIdle({
                          idle_timeout_minutes: updated.idle_timeout_minutes,
                          apply_to_sso: Boolean(updated.apply_to_sso),
                        })
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
              <PageLoader compact className="min-h-40" />
            )}
          </AdminPanel>
          </div>
        </TabsContent>

        <TabsContent value="sso" className={settingsTabClass}>
          <AdminPanel
            title="Single sign-on (OIDC)"
            // description="Works with Microsoft Entra ID, Okta, Auth0, Keycloak, and any OpenID Connect provider. Redirect URI must match the IdP app registration."
            contentClassName="space-y-4 px-5 py-5"
          >
            {!ssoSettings ? (
              <Alert variant="destructive">
                <AlertTitle>SSO settings unavailable</AlertTitle>
                <AlertDescription>Missing permission: auth_policy.view or settings.view</AlertDescription>
              </Alert>
            ) : (
              <>
                <div className={adminSwitchRowClass}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Enable SSO</div>
                    {/* <div className="text-xs text-muted-foreground">
                      Show SSO on login pages. Requires issuer, client ID, secret, and redirect URI.
                    </div> */}
                  </div>
                  <Switch
                    checked={ssoSettings.enabled}
                    disabled={!canWriteAuth}
                    onCheckedChange={(v) =>
                      setSsoSettings((p) => (p ? { ...p, enabled: Boolean(v) } : p))
                    }
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="sso_button_label">Button label</Label>
                    <Input
                      id="sso_button_label"
                      value={ssoSettings.button_label}
                      disabled={!canWriteAuth}
                      onChange={(e) =>
                        setSsoSettings((p) => (p ? { ...p, button_label: e.target.value } : p))
                      }
                      placeholder="Sign in with Microsoft"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="sso_issuer">OIDC issuer</Label>
                    <Input
                      id="sso_issuer"
                      value={ssoSettings.issuer}
                      disabled={!canWriteAuth}
                      onChange={(e) =>
                        setSsoSettings((p) => (p ? { ...p, issuer: e.target.value } : p))
                      }
                      placeholder="https://login.microsoftonline.com/{tenant-id}/v2.0"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sso_client_id">Client ID</Label>
                    <Input
                      id="sso_client_id"
                      value={ssoSettings.client_id}
                      disabled={!canWriteAuth}
                      onChange={(e) =>
                        setSsoSettings((p) => (p ? { ...p, client_id: e.target.value } : p))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sso_client_secret">Client secret</Label>
                    <Input
                      id="sso_client_secret"
                      type="password"
                      autoComplete="new-password"
                      placeholder={
                        ssoSettings.client_secret_configured
                          ? "•••••••• (leave blank to keep)"
                          : "Client secret"
                      }
                      value={ssoSettings.client_secret}
                      disabled={!canWriteAuth}
                      onChange={(e) =>
                        setSsoSettings((p) => (p ? { ...p, client_secret: e.target.value } : p))
                      }
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="sso_redirect_uri">Redirect URI</Label>
                    <Input
                      id="sso_redirect_uri"
                      value={ssoSettings.redirect_uri}
                      disabled={!canWriteAuth}
                      onChange={(e) =>
                        setSsoSettings((p) => (p ? { ...p, redirect_uri: e.target.value } : p))
                      }
                      placeholder="https://api.example.com/auth/sso/callback"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="sso_scopes">Scopes</Label>
                    <Input
                      id="sso_scopes"
                      value={ssoSettings.scopes}
                      disabled={!canWriteAuth}
                      onChange={(e) =>
                        setSsoSettings((p) => (p ? { ...p, scopes: e.target.value } : p))
                      }
                      placeholder="openid profile email"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sso_email_claim">Email claim</Label>
                    <Input
                      id="sso_email_claim"
                      value={ssoSettings.email_claim}
                      disabled={!canWriteAuth}
                      onChange={(e) =>
                        setSsoSettings((p) => (p ? { ...p, email_claim: e.target.value } : p))
                      }
                      placeholder="email"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sso_subject_claim">Subject claim</Label>
                    <Input
                      id="sso_subject_claim"
                      value={ssoSettings.subject_claim}
                      disabled={!canWriteAuth}
                      onChange={(e) =>
                        setSsoSettings((p) => (p ? { ...p, subject_claim: e.target.value } : p))
                      }
                      placeholder="sub"
                    />
                    <p className="text-xs text-muted-foreground">
                      Use <code className="text-[11px]">oid</code> for Microsoft Entra if preferred.
                    </p>
                  </div>
                </div>

                <div className={adminSwitchRowClass}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Allow JIT user creation</div>
                    <div className="text-xs text-muted-foreground">
                      Off = only pre-provisioned ATT users can sign in. On = create a user on first SSO.
                    </div>
                  </div>
                  <Switch
                    checked={ssoSettings.allow_jit}
                    disabled={!canWriteAuth}
                    onCheckedChange={(v) =>
                      setSsoSettings((p) => (p ? { ...p, allow_jit: Boolean(v) } : p))
                    }
                  />
                </div>

                <div className="flex justify-end border-t border-border/60 pt-4">
                  <AdminPrimaryButton
                    type="button"
                    disabled={savingSso || !canWriteAuth}
                    onClick={async () => {
                      if (!ssoSettings) return
                      setSavingSso(true)
                      toast.loading("Saving SSO settings…", { id: "sso-settings-save" })
                      try {
                        const updated = await putJson<SsoSettings>(
                          "/admin/settings/sso",
                          {
                            ...ssoSettings,
                            client_secret: ssoSettings.client_secret,
                          } as unknown as Record<string, unknown>,
                        )
                        setSsoSettings({ ...updated, client_secret: "" })
                        toast.success("Saved", { id: "sso-settings-save" })
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Save failed", {
                          id: "sso-settings-save",
                        })
                      } finally {
                        setSavingSso(false)
                      }
                    }}
                  >
                    {savingSso ? "Saving…" : "Save SSO settings"}
                  </AdminPrimaryButton>
                </div>
              </>
            )}
          </AdminPanel>
        </TabsContent>

        <TabsContent value="appearance" className={settingsTabClass}>
          <div className="grid items-start gap-4 xl:grid-cols-3">
          <AdminPanel
            className="h-full"
            title="Application version"
            // description="Shown on the login screen. Update this when you release a new build."
            contentClassName="space-y-4 px-5 py-5"
          >
            {appVersion ? (
              <div className="space-y-1.5">
                <Label htmlFor="app-version">Version</Label>
                <Input id="app-version" value={appVersion.version} readOnly disabled />
                <p className="text-xs text-muted-foreground">
                  Set automatically when a release is built.
                </p>
              </div>
            ) : (
              <PageLoader compact className="min-h-40" />
            )}
          </AdminPanel>

          <AdminPanel
            className="h-full"
            title="Logo"
            // description="Application logo on the login screen, sidebar, and reports. PNG, JPEG, or WebP · max 5 MB. When unset, the default logo is used."
            contentClassName="space-y-4 px-5 py-5"
          >
            {logoMeta ? (
              <>
                <div className="flex h-28 items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-muted/30 px-4">
                  {shownLogoSrc ? (
                    <img
                      src={shownLogoSrc}
                      alt="Application logo preview"
                      className="h-16 w-auto max-w-full object-contain"
                    />
                  ) : (
                    <BrandLogoPlaceholder className="h-16 w-40 text-sm" />
                  )}
                </div>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ""
                    if (!file || !canWriteSettings) return
                    if (file.size > 5 * 1024 * 1024) {
                      toast.error("Image must be 5 MB or smaller.")
                      return
                    }
                    setLogoBusy(true)
                    toast.loading("Uploading…", { id: "brand-logo-upload" })
                    try {
                      const fd = new FormData()
                      fd.append("file", file)
                      const meta = await putFormData<LoginBackgroundMeta>(
                        "/admin/settings/brand-logo",
                        fd,
                      )
                      setLogoMeta(meta)
                      writeStoredBrandLogoVersion(meta.version)
                      await loadLogoPreview(meta.configured)
                      toast.success("Logo updated", { id: "brand-logo-upload" })
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Upload failed", {
                        id: "brand-logo-upload",
                      })
                    } finally {
                      setLogoBusy(false)
                    }
                  }}
                />
                <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 pt-4">
                  {logoMeta.configured ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={logoBusy || !canWriteSettings}
                      onClick={async () => {
                        setLogoBusy(true)
                        toast.loading("Removing…", { id: "brand-logo-remove" })
                        try {
                          await deleteJson("/admin/settings/brand-logo")
                          setLogoMeta({ configured: false, content_type: null, version: null })
                          writeStoredBrandLogoVersion(null)
                          await loadLogoPreview(false)
                          toast.success("Logo reset to default", { id: "brand-logo-remove" })
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Remove failed", {
                            id: "brand-logo-remove",
                          })
                        } finally {
                          setLogoBusy(false)
                        }
                      }}
                    >
                      Use default
                    </Button>
                  ) : null}
                  <AdminPrimaryButton
                    type="button"
                    disabled={logoBusy || !canWriteSettings}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    {logoBusy ? "Working…" : logoMeta.configured ? "Replace logo" : "Upload logo"}
                  </AdminPrimaryButton>
                </div>
              </>
            ) : (
              <PageLoader compact className="min-h-40" />
            )}
          </AdminPanel>

          <AdminPanel
            className="h-full"
            title="Login background"
            // description="Optional full-page background image on the login screen. PNG, JPEG, or WebP · max 5 MB. Large photos are resized automatically. When unset, the default marketing layout is used."
            contentClassName="space-y-4 px-5 py-5"
          >
            {loginBgMeta ? (
              <>
                <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/30">
                  {loginBgPreviewUrl ? (
                    <img
                      src={loginBgPreviewUrl}
                      alt="Login background preview"
                      className="h-40 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-40 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                      No custom background — login uses the default split layout.
                    </div>
                  )}
                </div>
                <input
                  ref={loginBgInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ""
                    if (!file || !canWriteSettings) return
                    if (file.size > 5 * 1024 * 1024) {
                      toast.error("Image must be 5 MB or smaller.")
                      return
                    }
                    setLoginBgBusy(true)
                    toast.loading("Uploading…", { id: "login-bg-upload" })
                    try {
                      const fd = new FormData()
                      fd.append("file", file)
                      const meta = await putFormData<LoginBackgroundMeta>(
                        "/admin/settings/login-background",
                        fd,
                      )
                      setLoginBgMeta(meta)
                      await loadLoginBackgroundPreview(meta.configured)
                      toast.success("Login background updated", { id: "login-bg-upload" })
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Upload failed", {
                        id: "login-bg-upload",
                      })
                    } finally {
                      setLoginBgBusy(false)
                    }
                  }}
                />
                <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 pt-4">
                  {loginBgMeta.configured ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={loginBgBusy || !canWriteSettings}
                      onClick={async () => {
                        setLoginBgBusy(true)
                        toast.loading("Removing…", { id: "login-bg-remove" })
                        try {
                          await deleteJson("/admin/settings/login-background")
                          setLoginBgMeta({ configured: false, content_type: null, version: null })
                          await loadLoginBackgroundPreview(false)
                          toast.success("Background removed", { id: "login-bg-remove" })
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Remove failed", {
                            id: "login-bg-remove",
                          })
                        } finally {
                          setLoginBgBusy(false)
                        }
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                  <AdminPrimaryButton
                    type="button"
                    disabled={loginBgBusy || !canWriteSettings}
                    onClick={() => loginBgInputRef.current?.click()}
                  >
                    {loginBgBusy ? "Working…" : loginBgMeta.configured ? "Replace image" : "Upload image"}
                  </AdminPrimaryButton>
                </div>
              </>
            ) : (
              <PageLoader compact className="min-h-40" />
            )}
          </AdminPanel>
          </div>
        </TabsContent>

        <TabsContent value="general" className={settingsTabClass}>
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(22rem,1fr)]">
          <AdminPanel
            className="h-full"
            title="SMTP & email delivery"
            // description="Used for notifications, password reset, tasks, and invites. Use an app password when 2FA is enabled."
            contentClassName="space-y-4 px-5 py-5"
          >
              {!emailDelivery ? (
                <PageLoader label="Loading email settings" compact className="min-h-40" />
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
          <div className="space-y-4">
            <AdminPanel
              className="h-full"
              title="Financial year"
              // description="Start date for the current verification period, used when creating physical verification orders."
              contentClassName="space-y-4 px-5 py-5"
            >
              {!financialYear ? (
                <PageLoader label="Loading financial year settings" compact className="min-h-40" />
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="fy_start_month">Start month</Label>
                      <select
                        id="fy_start_month"
                        className={adminSelectClass}
                        disabled={!canWriteSettings}
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
                        disabled={!canWriteSettings}
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

            <AdminPanel
              className="h-full"
              title="Scanning process"
              // description="Globally configure active tag verification technology for assets across web and mobile."
              contentClassName="space-y-4 px-5 py-5"
            >
              {!scanningProcess ? (
                <PageLoader label="Loading scanning settings" compact className="min-h-40" />
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="scanning_process_mode">Verification & scanning mode</Label>
                    <select
                      id="scanning_process_mode"
                      className={adminSelectClass}
                      disabled={!canWriteSettings}
                      value={scanningProcess.process_mode}
                      onChange={(e) => {
                        const nextMode = e.target.value
                        const opt = SCANNING_PROCESS_OPTIONS.find((o) => o.value === nextMode)
                        setScanningProcess((p) =>
                          p
                            ? {
                                ...p,
                                process_mode: nextMode,
                                rfid_enabled: nextMode.includes("rfid") || nextMode === "rfid_barcode_qr",
                                barcode_enabled: nextMode.includes("barcode") || nextMode === "rfid_barcode_qr",
                                qr_enabled: nextMode.includes("qr") || nextMode === "rfid_barcode_qr",
                                label: opt?.label ?? nextMode,
                                description: opt?.hint ?? p.description,
                              }
                            : p,
                        )
                      }}
                    >
                      {SCANNING_PROCESS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2.5">
                    <div className="text-xs font-medium text-muted-foreground">
                      Active verification methods:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          scanningProcess.rfid_enabled
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                            : "bg-muted text-muted-foreground/50 border border-border/40 line-through"
                        }`}
                      >
                        <Radio className="size-3.5" />
                        RFID Tag
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          scanningProcess.barcode_enabled
                            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/30"
                            : "bg-muted text-muted-foreground/50 border border-border/40 line-through"
                        }`}
                      >
                        <Barcode className="size-3.5" />
                        1D Barcode
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          scanningProcess.qr_enabled
                            ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/30"
                            : "bg-muted text-muted-foreground/50 border border-border/40 line-through"
                        }`}
                      >
                        <QrCode className="size-3.5" />
                        2D QR Code
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {SCANNING_PROCESS_OPTIONS.find((o) => o.value === scanningProcess.process_mode)?.hint ||
                        "Globally sets the accepted tag scanning methods during asset audit and verification."}
                    </p>
                  </div>

                  <div className="flex justify-end border-t border-border/60 pt-4">
                    <AdminPrimaryButton
                      type="button"
                      disabled={savingScanningProcess || !canWriteSettings}
                      onClick={async () => {
                        if (!scanningProcess) return
                        setSavingScanningProcess(true)
                        toast.loading("Saving scanning process…", { id: "scan-save" })
                        try {
                          const updated = await putJson<ScanningProcessSettings>(
                            "/admin/settings/scanning-process",
                            {
                              process_mode: scanningProcess.process_mode,
                            },
                          )
                          setScanningProcess(updated)
                          toast.success("Saved scanning process", { id: "scan-save" })
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Save failed", { id: "scan-save" })
                        } finally {
                          setSavingScanningProcess(false)
                        }
                      }}
                    >
                      {savingScanningProcess ? "Saving…" : "Save scanning process"}
                    </AdminPrimaryButton>
                  </div>
                </>
              )}
            </AdminPanel>
          </div>
          </div>
        </TabsContent>

        <TabsContent value="appearance" className={settingsTabClass}>
          <AdminPanel
            title="PDF & Excel format"
            // description="Header, confidential line, and signature blocks. Preview uses the values on this form, then save when it looks right."
            contentClassName="space-y-4 px-5 py-5"
          >
            {!documentFormat ? (
              <PageLoader label="Loading document format" compact className="min-h-40" />
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
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium">Signature blocks</p>
                    {/* <p className="text-xs text-muted-foreground">
                      When on, name and date lines sit above the footer for the creator and each approve step.
                    </p> */}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
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
                      disabled={!canWriteSettings}
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
                  </div>
                </div>
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
                          {shownLogoSrc ? (
                            <img
                              src={shownLogoSrc}
                              alt=""
                              className="h-9 w-auto max-w-[120px] object-contain object-left"
                            />
                          ) : (
                            <BrandLogoPlaceholder className="h-9 w-24 shrink-0" />
                          )}
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
        </TabsContent>
      </Tabs>
    </AdminPage>
  )
}
