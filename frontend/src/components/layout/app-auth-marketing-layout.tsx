import * as React from "react"
import { BarChart3, Package, Radio } from "lucide-react"

import { AuthBrandMark } from "@/components/auth/auth-brand-mark"
import { AuthShellModeContext } from "@/components/auth/auth-shell-mode"
import { API_BASE_URL, getJson } from "@/lib/api"
import { cn } from "@/lib/utils"

type AppAuthMarketingLayoutProps = {
  children: React.ReactNode
  variant?: "workspace" | "admin"
}

const FEATURES = [
  {
    icon: Package,
    title: "Unified asset registry",
    body: "Create, import, and manage assets across plants from one workspace.",
  },
  {
    icon: Radio,
    title: "RFID tagging",
    body: "Attach RFID codes and tag colors for fast floor-level identification.",
  },
  {
    icon: BarChart3,
    title: "Verification workflows",
    body: "Physical counts, approvals, and audit trails built in.",
  },
] as const

const LOGIN_BG_URL = `${API_BASE_URL}/auth/login-background`

export function AppAuthMarketingLayout({
  children,
  variant = "workspace",
}: AppAuthMarketingLayoutProps) {
  const isAdmin = variant === "admin"
  const [version, setVersion] = React.useState<string | null>(null)
  // Pending uses the photo shell so the default marketing layout never flashes first.
  const [bgStatus, setBgStatus] = React.useState<"pending" | "ready" | "failed">("pending")

  React.useEffect(() => {
    let cancelled = false
    void getJson<{ version: string }>("/auth/app-version")
      .then((res) => {
        if (!cancelled && res.version?.trim()) setVersion(res.version.trim())
      })
      .catch(() => {
        if (!cancelled) setVersion(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (bgStatus !== "failed") {
    return (
      <AuthShellModeContext.Provider value="rail">
        <div className="relative h-svh max-h-svh w-full overflow-hidden bg-[#111827]">
          <img
            src={LOGIN_BG_URL}
            alt=""
            className={cn(
              "absolute inset-0 size-full object-cover object-center transition-opacity duration-300",
              bgStatus === "ready" ? "opacity-100" : "opacity-0",
            )}
            aria-hidden
            onLoad={() => setBgStatus("ready")}
            onError={() => setBgStatus("failed")}
            ref={(el) => {
              // Cached images can be complete before onLoad attaches.
              if (el?.complete && el.naturalWidth > 0) setBgStatus("ready")
            }}
          />

          <div className="relative z-10 flex h-full items-center justify-center overflow-y-auto overscroll-contain p-5 sm:p-8 md:justify-end md:pr-[5%] lg:pr-[7%] xl:pr-[9%]">
            <div
              className={cn(
                "my-auto flex w-full max-w-[400px] flex-col justify-center rounded-2xl border border-neutral-200 bg-white",
                "min-h-[min(34rem,calc(100svh-3.5rem))] px-7 py-9 sm:min-h-[36rem] sm:px-9 sm:py-10",
                "shadow-[0_16px_48px_-10px_rgba(0,0,0,0.35),0_6px_16px_-6px_rgba(0,0,0,0.18)]",
              )}
            >
              {children}
            </div>
          </div>
        </div>
      </AuthShellModeContext.Provider>
    )
  }

  return (
    <AuthShellModeContext.Provider value="card">
      <div className="relative h-svh max-h-svh overflow-hidden bg-[#f4f5f7]">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_100%_0%,color-mix(in_srgb,var(--primary)_12%,transparent),transparent_55%)]"
          aria-hidden
        />

        <div className="relative flex h-full flex-col lg:flex-row">
          <aside
            className={cn(
              "relative hidden shrink-0 flex-col justify-between overflow-hidden px-8 py-10 text-white lg:flex lg:w-[min(46%,520px)] lg:px-10 lg:py-12 xl:px-14",
              isAdmin
                ? "bg-[linear-gradient(155deg,#111827_0%,#1f2937_42%,#450a0a_100%)]"
                : "bg-[linear-gradient(155deg,#111827_0%,#1f2937_38%,#7f1d1d_100%)]",
            )}
          >
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.35]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
                backgroundSize: "32px 32px",
              }}
              aria-hidden
            />
            <div
              className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-primary/20 blur-3xl"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute bottom-0 left-0 size-56 rounded-full bg-white/5 blur-3xl"
              aria-hidden
            />

            <div className="relative z-10">
              <AuthBrandMark size="lg" onDark />

              <div className="mt-10 max-w-md space-y-4">
                <p className="text-xs font-semibold tracking-[0.18em] text-primary-foreground/70 uppercase">
                  {isAdmin ? "Platform administration" : "Enterprise workspace"}
                </p>
                <h2 className="text-3xl leading-[1.15] font-semibold tracking-tight text-balance xl:text-4xl">
                  {isAdmin
                    ? "Secure access to the admin console."
                    : "Know where every asset is — and who verified it."}
                </h2>
                <p className="max-w-sm text-sm leading-relaxed text-white/70">
                  {isAdmin
                    ? "Manage users, workflows, email templates, and platform settings."
                    : "RFID tagging, physical verification, and approval workflows in one place."}
                </p>
              </div>
            </div>

            <ul className="relative z-10 mt-10 space-y-4">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <li
                  key={title}
                  className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Icon className="size-4" aria-hidden />
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium text-white">{title}</p>
                    <p className="text-xs leading-relaxed text-white/60">{body}</p>
                  </div>
                </li>
              ))}
            </ul>

            <p className="relative z-10 mt-8 text-xs text-white/45">
              © {new Date().getFullYear()} Takeda · Asset Tracking & Tagging
              {version ? <span className="ml-2 tabular-nums">· v{version}</span> : null}
            </p>
          </aside>

          <main className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto overscroll-contain px-4 py-6 sm:px-10 lg:items-end lg:px-12 lg:py-10 xl:px-16">
            <div className="w-full max-w-[440px]">{children}</div>
          </main>
        </div>
      </div>
    </AuthShellModeContext.Provider>
  )
}
