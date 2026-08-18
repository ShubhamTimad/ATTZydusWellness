import {
  ArrowRightLeft,
  ClipboardCheck,
  ClipboardList,
  Package,
  PackageX,
  Users,
  type LucideIcon,
} from "lucide-react"

/** Semantic dashboard colors from the workspace UI spec (not brand tokens). */
export const DASHBOARD_COLOR = {
  blue: "#4285F4",
  green: "#34A853",
  orange: "#FBBC05",
  red: "#EA4335",
  purple: "#7B61FF",
  gray: "#D1D5DB",
} as const

export const DASHBOARD_ICON = {
  danger: "text-[#EA4335]",
  success: "text-[#34A853]",
} as const

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
  progress: DASHBOARD_COLOR.blue,
  complete: DASHBOARD_COLOR.green,
  rejected: DASHBOARD_COLOR.red,
  rest: DASHBOARD_COLOR.gray,
} as const

/** Section chart / accent hex values (keep in sync with theme classes). */
export const DASHBOARD_CHART = {
  orders: DASHBOARD_COLOR.blue,
  assets: DASHBOARD_COLOR.blue,
  fy: DASHBOARD_COLOR.green,
  fyPending: DASHBOARD_COLOR.gray,
  it: DASHBOARD_COLOR.orange,
  transfers: DASHBOARD_COLOR.orange,
  disposals: DASHBOARD_COLOR.red,
} as const

const panelSurface = "border-border/80 bg-card"

export const DASHBOARD_THEMES = {
  orders: {
    icon: ClipboardList,
    tag: "Operations",
    surface: panelSurface,
    iconWrap: DASHBOARD_ICON.danger,
    accentBar: "from-sky-500 to-sky-600",
    accentText: "text-sky-700 dark:text-sky-300",
    chartFill: DASHBOARD_CHART.orders,
    kpiTint: "border-border/70 bg-muted/20",
  },
  assets: {
    icon: Package,
    tag: "Assets",
    surface: panelSurface,
    iconWrap: DASHBOARD_ICON.danger,
    accentBar: "from-primary/80 via-primary to-primary/70",
    accentText: "text-primary",
    chartFill: DASHBOARD_CHART.assets,
    kpiTint: "border-border/70 bg-muted/20",
  },
  fy: {
    icon: ClipboardCheck,
    tag: "FY",
    surface: panelSurface,
    iconWrap: DASHBOARD_ICON.danger,
    accentBar: "from-emerald-500 to-emerald-600",
    accentText: "text-emerald-700 dark:text-emerald-300",
    chartFill: DASHBOARD_CHART.fy,
    kpiTint: "border-border/70 bg-muted/20",
  },
  transfers: {
    icon: ArrowRightLeft,
    tag: "Transfers",
    surface: panelSurface,
    iconWrap: DASHBOARD_ICON.danger,
    accentBar: "from-orange-500 to-orange-600",
    accentText: "text-orange-800 dark:text-orange-300",
    chartFill: DASHBOARD_CHART.transfers,
    kpiTint: "border-border/70 bg-muted/20",
  },
  disposals: {
    icon: PackageX,
    tag: "Disposals",
    surface: panelSurface,
    iconWrap: DASHBOARD_ICON.danger,
    accentBar: "from-rose-500 to-rose-600",
    accentText: "text-rose-800 dark:text-rose-300",
    chartFill: DASHBOARD_CHART.disposals,
    kpiTint: "border-border/70 bg-muted/20",
  },
  it: {
    icon: Users,
    tag: "IT · Users",
    surface: panelSurface,
    iconWrap: DASHBOARD_ICON.danger,
    accentBar: "from-teal-600/80 to-teal-700",
    accentText: "text-teal-800 dark:text-teal-300",
    chartFill: DASHBOARD_CHART.it,
    kpiTint: "border-border/70 bg-muted/20",
  },
} satisfies Record<string, DashboardPanelTheme>

export function dashboardPct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}
