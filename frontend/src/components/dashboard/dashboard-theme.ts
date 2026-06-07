import { CalendarRange, ClipboardList, Package, type LucideIcon } from "lucide-react"

export type DashboardPanelTheme = {
  icon: LucideIcon
  tag: string
  surface: string
  iconWrap: string
  accentBar: string
  pattern?: string
  kpiTint?: string
}

export const DASHBOARD_THEMES = {
  orders: {
    icon: ClipboardList,
    tag: "Operations",
    surface:
      "border-sky-200/80 bg-[linear-gradient(165deg,color-mix(in_srgb,#0ea5e9_9%,var(--card))_0%,var(--card)_100%)] dark:border-sky-900/40",
    iconWrap: "bg-sky-500/12 text-sky-700 ring-sky-500/20 dark:text-sky-300",
    accentBar: "from-sky-500/80 via-sky-500 to-sky-600/80",
    pattern:
      "bg-[radial-gradient(circle_at_100%_0%,color-mix(in_srgb,#0ea5e9_12%,transparent)_0%,transparent_55%)]",
    kpiTint: "border-sky-500/10 bg-sky-500/[0.04]",
  },
  assets: {
    icon: Package,
    tag: "Asset register",
    surface:
      "border-primary/20 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary)_8%,var(--card))_0%,var(--card)_45%,color-mix(in_srgb,var(--primary)_4%,var(--card))_100%)]",
    iconWrap: "bg-primary/12 text-primary ring-primary/20",
    accentBar: "from-primary/80 via-primary to-primary/70",
    pattern:
      "bg-[radial-gradient(circle_at_100%_0%,color-mix(in_srgb,var(--primary)_14%,transparent)_0%,transparent_55%)]",
    kpiTint: "border-primary/10 bg-primary/[0.04]",
  },
  fy: {
    icon: CalendarRange,
    tag: "FY verification",
    surface:
      "border-emerald-200/80 bg-[linear-gradient(160deg,color-mix(in_srgb,#059669_10%,var(--card))_0%,var(--card)_100%)] dark:border-emerald-900/40",
    iconWrap: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
    accentBar: "from-emerald-500/80 to-emerald-600",
    pattern:
      "bg-[radial-gradient(circle_at_0%_0%,color-mix(in_srgb,#059669_12%,transparent)_0%,transparent_50%)]",
    kpiTint: "border-emerald-500/10 bg-emerald-500/[0.04]",
  },
  heroOrders: {
    icon: ClipboardList,
    tag: "Orders",
    surface:
      "border-sky-200/70 bg-[linear-gradient(145deg,color-mix(in_srgb,#0ea5e9_14%,var(--card))_0%,var(--card)_55%)] dark:border-sky-900/35",
    iconWrap: "bg-sky-500/15 text-sky-700 ring-sky-500/25 dark:text-sky-300",
    accentBar: "from-sky-400 to-sky-600",
    pattern:
      "bg-[radial-gradient(circle_at_100%_100%,color-mix(in_srgb,#0ea5e9_18%,transparent)_0%,transparent_50%)]",
  },
  heroAssets: {
    icon: Package,
    tag: "RFID",
    surface:
      "border-primary/25 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--primary)_12%,var(--card))_0%,var(--card)_55%)]",
    iconWrap: "bg-primary/15 text-primary ring-primary/25",
    accentBar: "from-primary/90 to-primary",
    pattern:
      "bg-[radial-gradient(circle_at_100%_100%,color-mix(in_srgb,var(--primary)_16%,transparent)_0%,transparent_50%)]",
  },
  heroFy: {
    icon: CalendarRange,
    tag: "Financial year",
    surface:
      "border-emerald-200/70 bg-[linear-gradient(145deg,color-mix(in_srgb,#059669_14%,var(--card))_0%,var(--card)_55%)] dark:border-emerald-900/35",
    iconWrap: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
    accentBar: "from-emerald-400 to-emerald-600",
    pattern:
      "bg-[radial-gradient(circle_at_0%_100%,color-mix(in_srgb,#059669_18%,transparent)_0%,transparent_50%)]",
  },
} satisfies Record<string, DashboardPanelTheme>
