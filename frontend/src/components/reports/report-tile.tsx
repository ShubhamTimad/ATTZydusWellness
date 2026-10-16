import { FileSpreadsheet, FileText, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ReportDefinition, ReportFormat } from "@/lib/reports-types"
import { cn } from "@/lib/utils"

type ChartKind = "bars" | "lines" | "ring"

const REPORT_CHART: Record<string, ChartKind> = {
  asset_register: "bars",
  financial_year_verification: "lines",
  physical_orders_summary: "ring",
}

function ChartArtwork({ kind }: { kind: ChartKind }) {
  if (kind === "lines") {
    return (
      <svg viewBox="0 0 220 160" className="h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="rpt-line-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M12 110 C 42 88, 58 120, 88 78 C 112 48, 132 102, 162 62 C 182 42, 196 52, 208 36 L 208 148 L 12 148 Z"
          fill="url(#rpt-line-fill)"
        />
        <path
          d="M12 110 C 42 88, 58 120, 88 78 C 112 48, 132 102, 162 62 C 182 42, 196 52, 208 36"
          fill="none"
          stroke="var(--primary)"
          strokeOpacity="0.55"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M12 124 C 48 104, 72 132, 102 98 C 126 74, 150 112, 178 82 C 192 66, 200 74, 208 64"
          fill="none"
          stroke="var(--primary)"
          strokeOpacity="0.28"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  if (kind === "ring") {
    return (
      <svg viewBox="0 0 220 160" className="h-full w-full" aria-hidden>
        <g transform="translate(128 80)">
          <circle r="58" fill="none" stroke="var(--primary)" strokeOpacity="0.14" strokeWidth="22" />
          <circle
            r="58"
            fill="none"
            stroke="var(--primary)"
            strokeOpacity="0.5"
            strokeWidth="22"
            strokeDasharray="110 260"
            strokeLinecap="round"
            transform="rotate(-90)"
          />
          <circle
            r="58"
            fill="none"
            stroke="var(--primary)"
            strokeOpacity="0.28"
            strokeWidth="22"
            strokeDasharray="70 260"
            strokeDashoffset="-120"
            strokeLinecap="round"
            transform="rotate(-90)"
          />
          <circle r="36" fill="white" fillOpacity="0.65" />
        </g>
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 220 160" className="h-full w-full" aria-hidden>
      <g fill="var(--primary)">
        <rect x="28" y="78" width="22" height="58" rx="3" opacity="0.28" />
        <rect x="58" y="52" width="22" height="84" rx="3" opacity="0.4" />
        <rect x="88" y="32" width="22" height="104" rx="3" opacity="0.55" />
        <rect x="118" y="64" width="22" height="72" rx="3" opacity="0.35" />
        <rect x="148" y="44" width="22" height="92" rx="3" opacity="0.48" />
        <rect x="178" y="86" width="22" height="50" rx="3" opacity="0.3" />
      </g>
    </svg>
  )
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
  const busy = generatingKey?.startsWith(`${report.key}:`) ?? false
  const formats: ReportFormat[] = report.formats?.length ? report.formats : ["xlsx"]
  const showPdf = formats.includes("pdf")
  const chart = REPORT_CHART[report.key] ?? "bars"

  return (
    <article
      className={cn(
        "relative flex h-full min-h-[17rem] w-full min-w-0 flex-col overflow-hidden",
        "rounded-2xl border border-border/50 bg-card",
        "shadow-[0_2px_8px_rgb(15_23_42_/_0.06),0_10px_28px_rgb(15_23_42_/_0.06)]",
        "transition-shadow hover:shadow-[0_4px_14px_rgb(15_23_42_/_0.08),0_14px_36px_rgb(15_23_42_/_0.08)]",
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,var(--card)_0%,var(--card)_42%,color-mix(in_srgb,var(--primary)_10%,var(--card))_100%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-3 right-0 w-[55%] opacity-90 sm:inset-y-4"
        aria-hidden
      >
        <ChartArtwork kind={chart} />
      </div>

      <div className="relative z-[1] flex flex-1 flex-col p-7 sm:p-8">
        <h3 className="max-w-[58%] text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {report.title}
        </h3>

        <div className="mt-auto flex justify-end gap-2.5 pt-12">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            className={cn(exportBtnClass, "bg-background/90 backdrop-blur-[2px]")}
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
    <div className="h-[17rem] animate-pulse rounded-2xl border border-border/50 bg-muted/25 shadow-[0_2px_8px_rgb(15_23_42_/_0.04)]" />
  )
}
