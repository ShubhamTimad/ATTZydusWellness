import {
  ArrowRightLeft,
  CalendarRange,
  ClipboardList,
  Package,
  PackageX,
  Users,
  type LucideIcon,
} from "lucide-react"

export type DashboardPanelTheme = {
  icon: LucideIcon
  tag: string
  surface: string
  iconWrap: string
  accentBar: string
  /** KPI accent text/icon — must match the section, not always brand red. */
  accentText: string
  chartFill: string
  pattern?: string
  kpiTint?: string
}

export const DASHBOARD_STATUS = {
  progress: "#2563eb",
  complete: "#16a34a",
  rejected: "#e11d48",
  rest: "#cbd5e1",
} as const

/** Section chart / accent hex values (keep in sync with theme classes). */
export const DASHBOARD_CHART = {
  orders: DASHBOARD_STATUS.progress,
  assets: "#E1242A",
  fy: DASHBOARD_STATUS.complete,
  fyPending: DASHBOARD_STATUS.rest,
  it: "#0f766e",
  transfers: "#c2410c",
  disposals: "#9f1239",
} as const

export const DASHBOARD_THEMES = {
  orders: {
    icon: ClipboardList,
    tag: "Operations",
    surface: "border-border/80 bg-card",
    iconWrap: "bg-sky-100 text-sky-700 ring-sky-200/80 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-800",
    accentBar: "from-sky-500 to-sky-600",
    accentText: "text-sky-700 dark:text-sky-300",
    chartFill: DASHBOARD_CHART.orders,
    kpiTint: "border-border/70 bg-muted/20",
  },
  assets: {
    icon: Package,
    tag: "Assets",
    surface: "border-border/80 bg-card",
    iconWrap: "bg-primary/12 text-primary ring-primary/20",
    accentBar: "from-primary/80 via-primary to-primary/70",
    accentText: "text-primary",
    chartFill: DASHBOARD_CHART.assets,
    kpiTint: "border-border/70 bg-muted/20",
  },
  fy: {
    icon: CalendarRange,
    tag: "FY",
    surface: "border-border/80 bg-card",
    iconWrap: "bg-emerald-100 text-emerald-700 ring-emerald-200/80 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-800",
    accentBar: "from-emerald-500 to-emerald-600",
    accentText: "text-emerald-700 dark:text-emerald-300",
    chartFill: DASHBOARD_CHART.fy,
    kpiTint: "border-border/70 bg-muted/20",
  },
  transfers: {
    icon: ArrowRightLeft,
    tag: "Transfers",
    surface: "border-border/80 bg-card",
    iconWrap: "bg-orange-100 text-orange-800 ring-orange-200/80 dark:bg-orange-950/50 dark:text-orange-300 dark:ring-orange-800",
    accentBar: "from-orange-500 to-orange-600",
    accentText: "text-orange-800 dark:text-orange-300",
    chartFill: DASHBOARD_CHART.transfers,
    kpiTint: "border-border/70 bg-muted/20",
  },
  disposals: {
    icon: PackageX,
    tag: "Disposals",
    surface: "border-border/80 bg-card",
    iconWrap: "bg-rose-100 text-rose-800 ring-rose-200/80 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-800",
    accentBar: "from-rose-500 to-rose-600",
    accentText: "text-rose-800 dark:text-rose-300",
    chartFill: DASHBOARD_CHART.disposals,
    kpiTint: "border-border/70 bg-muted/20",
  },
  it: {
    icon: Users,
    tag: "IT · Users",
    surface:
      "border-teal-200/70 bg-[linear-gradient(160deg,color-mix(in_srgb,#0f766e_8%,var(--card))_0%,var(--card)_100%)] dark:border-teal-900/40",
    iconWrap: "bg-teal-600/12 text-teal-800 ring-teal-600/20 dark:text-teal-300",
    accentBar: "from-teal-600/80 to-teal-700",
    accentText: "text-teal-800 dark:text-teal-300",
    chartFill: DASHBOARD_CHART.it,
    pattern:
      "bg-[radial-gradient(circle_at_100%_0%,color-mix(in_srgb,#0f766e_10%,transparent)_0%,transparent_55%)]",
    kpiTint: "border-teal-600/10 bg-teal-600/[0.04]",
  },
} satisfies Record<string, DashboardPanelTheme>
