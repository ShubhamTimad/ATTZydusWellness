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

/** Section chart / accent hex values (keep in sync with theme classes). */
export const DASHBOARD_CHART = {
  orders: "#0284c7",
  assets: "#E1242A",
  fy: "#059669",
  fyPending: "#d97706",
  it: "#0f766e",
  transfers: "#c2410c",
  disposals: "#9f1239",
} as const

export const DASHBOARD_THEMES = {
  orders: {
    icon: ClipboardList,
    tag: "Operations",
    surface:
      "border-sky-200/70 bg-[linear-gradient(165deg,color-mix(in_srgb,#0284c7_8%,var(--card))_0%,var(--card)_100%)] dark:border-sky-900/40",
    iconWrap: "bg-sky-500/12 text-sky-700 ring-sky-500/20 dark:text-sky-300",
    accentBar: "from-sky-500/80 via-sky-500 to-sky-600/80",
    accentText: "text-sky-700 dark:text-sky-300",
    chartFill: DASHBOARD_CHART.orders,
    pattern:
      "bg-[radial-gradient(circle_at_100%_0%,color-mix(in_srgb,#0284c7_10%,transparent)_0%,transparent_55%)]",
    kpiTint: "border-sky-500/10 bg-sky-500/[0.04]",
  },
  assets: {
    icon: Package,
    tag: "Assets",
    surface:
      "border-primary/20 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary)_7%,var(--card))_0%,var(--card)_100%)]",
    iconWrap: "bg-primary/12 text-primary ring-primary/20",
    accentBar: "from-primary/80 via-primary to-primary/70",
    accentText: "text-primary",
    chartFill: DASHBOARD_CHART.assets,
    pattern:
      "bg-[radial-gradient(circle_at_100%_0%,color-mix(in_srgb,var(--primary)_12%,transparent)_0%,transparent_55%)]",
    kpiTint: "border-primary/10 bg-primary/[0.04]",
  },
  fy: {
    icon: CalendarRange,
    tag: "FY",
    surface:
      "border-emerald-200/70 bg-[linear-gradient(160deg,color-mix(in_srgb,#059669_8%,var(--card))_0%,var(--card)_100%)] dark:border-emerald-900/40",
    iconWrap: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
    accentBar: "from-emerald-500/80 to-emerald-600",
    accentText: "text-emerald-700 dark:text-emerald-300",
    chartFill: DASHBOARD_CHART.fy,
    pattern:
      "bg-[radial-gradient(circle_at_0%_0%,color-mix(in_srgb,#059669_10%,transparent)_0%,transparent_50%)]",
    kpiTint: "border-emerald-500/10 bg-emerald-500/[0.04]",
  },
  transfers: {
    icon: ArrowRightLeft,
    tag: "Transfers",
    surface:
      "border-orange-200/70 bg-[linear-gradient(160deg,color-mix(in_srgb,#c2410c_8%,var(--card))_0%,var(--card)_100%)] dark:border-orange-900/40",
    iconWrap: "bg-orange-600/12 text-orange-800 ring-orange-600/20 dark:text-orange-300",
    accentBar: "from-orange-500/80 to-orange-700",
    accentText: "text-orange-800 dark:text-orange-300",
    chartFill: DASHBOARD_CHART.transfers,
    pattern:
      "bg-[radial-gradient(circle_at_100%_0%,color-mix(in_srgb,#c2410c_10%,transparent)_0%,transparent_55%)]",
    kpiTint: "border-orange-600/10 bg-orange-600/[0.04]",
  },
  disposals: {
    icon: PackageX,
    tag: "Disposals",
    surface:
      "border-rose-200/70 bg-[linear-gradient(160deg,color-mix(in_srgb,#9f1239_8%,var(--card))_0%,var(--card)_100%)] dark:border-rose-900/40",
    iconWrap: "bg-rose-700/12 text-rose-800 ring-rose-700/20 dark:text-rose-300",
    accentBar: "from-rose-600/80 to-rose-800",
    accentText: "text-rose-800 dark:text-rose-300",
    chartFill: DASHBOARD_CHART.disposals,
    pattern:
      "bg-[radial-gradient(circle_at_100%_0%,color-mix(in_srgb,#9f1239_10%,transparent)_0%,transparent_55%)]",
    kpiTint: "border-rose-700/10 bg-rose-700/[0.04]",
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
  heroOrders: {
    icon: ClipboardList,
    tag: "Orders",
    surface:
      "border-sky-200/60 bg-[linear-gradient(145deg,color-mix(in_srgb,#0284c7_12%,var(--card))_0%,var(--card)_60%)] dark:border-sky-900/35",
    iconWrap: "bg-sky-500/15 text-sky-700 ring-sky-500/25 dark:text-sky-300",
    accentBar: "from-sky-400 to-sky-600",
    accentText: "text-sky-700 dark:text-sky-300",
    chartFill: DASHBOARD_CHART.orders,
  },
  heroAssets: {
    icon: Package,
    tag: "RFID",
    surface:
      "border-primary/20 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--primary)_10%,var(--card))_0%,var(--card)_60%)]",
    iconWrap: "bg-primary/15 text-primary ring-primary/25",
    accentBar: "from-primary/90 to-primary",
    accentText: "text-primary",
    chartFill: DASHBOARD_CHART.assets,
  },
  heroFy: {
    icon: CalendarRange,
    tag: "FY",
    surface:
      "border-emerald-200/60 bg-[linear-gradient(145deg,color-mix(in_srgb,#059669_12%,var(--card))_0%,var(--card)_60%)] dark:border-emerald-900/35",
    iconWrap: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
    accentBar: "from-emerald-400 to-emerald-600",
    accentText: "text-emerald-700 dark:text-emerald-300",
    chartFill: DASHBOARD_CHART.fy,
  },
  heroTransfers: {
    icon: ArrowRightLeft,
    tag: "Transfers",
    surface:
      "border-orange-200/60 bg-[linear-gradient(145deg,color-mix(in_srgb,#c2410c_12%,var(--card))_0%,var(--card)_60%)] dark:border-orange-900/35",
    iconWrap: "bg-orange-600/15 text-orange-800 ring-orange-600/25 dark:text-orange-300",
    accentBar: "from-orange-500 to-orange-700",
    accentText: "text-orange-800 dark:text-orange-300",
    chartFill: DASHBOARD_CHART.transfers,
  },
  heroDisposals: {
    icon: PackageX,
    tag: "Disposals",
    surface:
      "border-rose-200/60 bg-[linear-gradient(145deg,color-mix(in_srgb,#9f1239_12%,var(--card))_0%,var(--card)_60%)] dark:border-rose-900/35",
    iconWrap: "bg-rose-700/15 text-rose-800 ring-rose-700/25 dark:text-rose-300",
    accentBar: "from-rose-600 to-rose-800",
    accentText: "text-rose-800 dark:text-rose-300",
    chartFill: DASHBOARD_CHART.disposals,
  },
  heroIt: {
    icon: Users,
    tag: "Users",
    surface:
      "border-teal-200/60 bg-[linear-gradient(145deg,color-mix(in_srgb,#0f766e_12%,var(--card))_0%,var(--card)_60%)] dark:border-teal-900/35",
    iconWrap: "bg-teal-600/15 text-teal-800 ring-teal-600/25 dark:text-teal-300",
    accentBar: "from-teal-500 to-teal-700",
    accentText: "text-teal-800 dark:text-teal-300",
    chartFill: DASHBOARD_CHART.it,
  },
} satisfies Record<string, DashboardPanelTheme>
