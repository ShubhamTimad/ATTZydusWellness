import {
  CalendarRange,
  ClipboardList,
  Database,
  FileSpreadsheet,
  FileText,
  Layers,
  Loader2,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ReportDefinition, ReportFormat } from "@/lib/reports-types"
import { cn } from "@/lib/utils"

export type ReportTileStyle = {
  icon: LucideIcon
  tag: string
  surface: string
  iconWrap: string
  accentBar?: string
}

export const REPORT_TILE_STYLES: Record<string, ReportTileStyle> = {
  asset_register: {
    icon: Database,
    tag: "Asset master",
    surface: "border-border/80 bg-card",
    iconWrap: "bg-primary/12 text-primary ring-primary/20",
    accentBar: "from-primary/80 via-primary to-primary/70",
  },
  financial_year_verification: {
    icon: CalendarRange,
    tag: "FY verification",
    surface: "border-border/80 bg-card",
    iconWrap: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
    accentBar: "from-emerald-500/80 to-emerald-600",
  },
  physical_orders_summary: {
    icon: ClipboardList,
    tag: "Orders",
    surface: "border-border/80 bg-card",
    iconWrap: "bg-sky-500/10 text-sky-700 ring-sky-500/15 dark:text-sky-300",
    accentBar: "from-sky-500/70 to-sky-600/80",
  },
}

const FALLBACK_STYLE: ReportTileStyle = {
  icon: Layers,
  tag: "Report",
  surface: "border-border/80 bg-card",
  iconWrap: "bg-muted text-muted-foreground ring-border/60",
  accentBar: "from-muted-foreground/50 to-muted-foreground/30",
}

const exportBtnClass = "h-8 min-w-[5.5rem] gap-1.5 px-2.5 text-xs font-medium shadow-none"

export function ReportTile({
  report,
  onGenerate,
  generatingKey,
}: {
  report: ReportDefinition
  onGenerate: (format: ReportFormat) => void
  generatingKey: string | null
}) {
  const style = REPORT_TILE_STYLES[report.key] ?? FALLBACK_STYLE
  const Icon = style.icon
  const busy = generatingKey?.startsWith(`${report.key}:`) ?? false
  const formats: ReportFormat[] = report.formats?.length ? report.formats : ["xlsx"]
  const showPdf = formats.includes("pdf")

  return (
    <article
      className={cn(
        "relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[var(--app-radius-surface)] border shadow-[var(--app-shadow-surface)] transition-shadow hover:shadow-[var(--app-shadow-elevated)]",
        style.surface,
      )}
    >
      {style.accentBar ? (
        <div className={cn("h-0.5 w-full shrink-0 bg-gradient-to-r", style.accentBar)} aria-hidden />
      ) : null}

      <div className="flex flex-1 flex-col gap-3.5 p-4">
        <div className="flex items-start gap-2.5">
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
              style.iconWrap,
            )}
          >
            <Icon className="size-4" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              {style.tag}
            </p>
            <h3 className="mt-0.5 truncate text-sm font-semibold leading-tight text-foreground">
              {report.title}
            </h3>
            <p className="mt-0.5 line-clamp-1 text-xs leading-snug text-muted-foreground">
              {report.description}
            </p>
          </div>
        </div>

        <div className="mt-auto flex justify-end gap-2 border-t border-border/60 pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            className={cn(exportBtnClass, "bg-background")}
            onClick={() => onGenerate("xlsx")}
          >
            {busy && generatingKey === `${report.key}:xlsx` ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
            ) : (
              <FileSpreadsheet className="size-3.5 shrink-0" aria-hidden />
            )}
            Excel
          </Button>
          {showPdf ? (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              className={exportBtnClass}
              onClick={() => onGenerate("pdf")}
            >
              {busy && generatingKey === `${report.key}:pdf` ? (
                <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
              ) : (
                <FileText className="size-3.5 shrink-0" aria-hidden />
              )}
              PDF
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export function ReportTileSkeleton() {
  return (
    <div className="h-[8.5rem] animate-pulse rounded-[var(--app-radius-surface)] border border-border/60 bg-muted/20" />
  )
}
