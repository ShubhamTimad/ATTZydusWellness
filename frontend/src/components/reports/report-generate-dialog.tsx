import * as React from "react"
import { Download, Loader2 } from "lucide-react"

import { AdminPrimaryButton, adminSelectClass } from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import type { ReportDefinition, ReportFilterValues, ReportFormat } from "@/lib/reports-types"
import { categoryLabel, plantLabel, useAssetMasterLookups } from "@/lib/use-asset-masters"
import { cn } from "@/lib/utils"

const FILTER_LABELS: Record<string, string> = {
  fy_start_year: "Financial year",
  plant_id: "Plant",
  category_id: "Category",
  fy_status: "Verification",
  status: "Order status",
}

const FILTER_ORDER = [
  "fy_start_year",
  "plant_id",
  "category_id",
  "cost_center",
  "functional_location",
  "actual_location",
  "fy_status",
  "status",
]

function orderedFilters(report: ReportDefinition) {
  return [...report.filters].sort((a, b) => {
    const ai = FILTER_ORDER.indexOf(a.key)
    const bi = FILTER_ORDER.indexOf(b.key)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
}

function shortenFilterOptionLabel(key: string, value: string, label: string): string {
  if (key === "fy_status") {
    if (value === "verified") return "Verified"
    if (value === "pending") return "Pending"
    if (value === "all") return "All"
  }
  if (key === "status" && value === "all") return "All statuses"
  if (key === "plant_id" && value === "all") return "All plants"
  return label
}

function masterOptionLabel(_code: string, name?: string | null): string {
  const n = name?.trim()
  if (n) return n
  return _code.trim()
}

export function defaultReportFilters(report: ReportDefinition): ReportFilterValues {
  const values: ReportFilterValues = {}
  for (const filter of report.filters) {
    if (filter.key === "fy_start_year") {
      const running = filter.options.find((o) => o.label.includes("(running)"))
      values[filter.key] = running?.value ?? filter.options[0]?.value ?? ""
    } else if (filter.key === "fy_status") {
      values[filter.key] = report.key === "financial_year_verification" ? "verified" : "all"
    } else {
      values[filter.key] = "all"
    }
  }
  return values
}

function FilterField({
  filter,
  value,
  options,
  disabled,
  placeholder,
  onChange,
}: {
  filter: ReportDefinition["filters"][number]
  value: string
  options: { value: string; label: string }[]
  disabled?: boolean
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {FILTER_LABELS[filter.key] ?? filter.label}
      </Label>
      <select
        className={cn(adminSelectClass, "h-9 w-full min-w-0 bg-background text-sm")}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.length === 0 && placeholder ? <option value="all">{placeholder}</option> : null}
        {options.map((option) => {
          const optionValue = option.value || "all"
          return (
            <option key={`${filter.key}-${optionValue}`} value={optionValue}>
              {shortenFilterOptionLabel(filter.key, optionValue, option.label)}
            </option>
          )
        })}
      </select>
    </div>
  )
}

function resolveFilterOptions(
  filter: ReportDefinition["filters"][number],
  filters: ReportFilterValues,
  masters: ReturnType<typeof useAssetMasterLookups>,
): { options: { value: string; label: string }[]; disabled?: boolean; placeholder?: string } {
  const plantId = filters.plant_id && filters.plant_id !== "all" ? Number(filters.plant_id) : null

  if (filter.kind === "category") {
    return {
      options: [
        { value: "all", label: "All categories" },
        ...masters.categories.map((c) => ({ value: String(c.id), label: categoryLabel(c) })),
      ],
    }
  }
  if (filter.kind === "cost_center") {
    return {
      disabled: !plantId,
      placeholder: plantId ? "All cost centers" : "Select plant first",
      options: plantId
        ? [
            { value: "all", label: "All cost centers" },
            ...masters.costCenters.map((cc) => ({
              value: cc.code,
              label: masterOptionLabel(cc.code, cc.name),
            })),
          ]
        : [],
    }
  }
  if (filter.kind === "functional_location") {
    return {
      disabled: !plantId,
      placeholder: plantId ? "All functional locations" : "Select plant first",
      options: plantId
        ? [
            { value: "all", label: "All functional locations" },
            ...masters.functionalLocations.map((fl) => ({
              value: fl.code,
              label: masterOptionLabel(fl.code, fl.name),
            })),
          ]
        : [],
    }
  }
  if (filter.kind === "actual_location") {
    const fl = filters.functional_location
    const hasFl = Boolean(fl && fl !== "all")
    return {
      disabled: !plantId || !hasFl,
      placeholder: !plantId
        ? "Select plant first"
        : !hasFl
          ? "Select functional location first"
          : "All actual locations",
      options:
        plantId && hasFl
          ? [
              { value: "all", label: "All actual locations" },
              ...masters.actualLocations.map((al) => ({
                value: al.code,
                label: masterOptionLabel(al.code, al.name),
              })),
            ]
          : [],
    }
  }
  if (filter.kind === "plant") {
    return {
      options: [
        { value: "all", label: "All plants" },
        ...masters.plants.map((p) => ({ value: String(p.id), label: plantLabel(p) })),
      ],
    }
  }
  if (filter.kind === "financial_year") {
    return {
      options: filter.options.map((o) => ({
        value: o.value,
        label: o.label.replace(" (running)", ""),
      })),
    }
  }
  return {
    options: filter.options.map((o) => ({
      value: o.value || "all",
      label: shortenFilterOptionLabel(filter.key, o.value || "all", o.label),
    })),
  }
}

export function ReportGenerateDialog({
  open,
  onOpenChange,
  report,
  format,
  generating,
  onGenerate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  report: ReportDefinition | null
  format: ReportFormat
  generating: boolean
  onGenerate: (filters: ReportFilterValues) => void
}) {
  const [filters, setFilters] = React.useState<ReportFilterValues>({})

  React.useEffect(() => {
    if (!open || !report) return
    setFilters(defaultReportFilters(report))
  }, [open, report])

  const plantId = filters.plant_id && filters.plant_id !== "all" ? Number(filters.plant_id) : null
  const masters = useAssetMasterLookups(
    plantId,
    filters.cost_center && filters.cost_center !== "all" ? filters.cost_center : null,
    filters.functional_location && filters.functional_location !== "all"
      ? filters.functional_location
      : null,
  )

  if (!report) return null

  const filtersList = orderedFilters(report)
  const formatLabel = format === "pdf" ? "PDF" : "Excel"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{report.title}</DialogTitle>
          <DialogDescription>Set filters, then download the {formatLabel} report.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtersList.map((filter) => {
            const resolved = resolveFilterOptions(filter, filters, masters)
            return (
              <FilterField
                key={filter.key}
                filter={filter}
                value={filters[filter.key] ?? "all"}
                options={resolved.options}
                disabled={resolved.disabled}
                placeholder={resolved.placeholder}
                onChange={(value) => setFilters((prev) => ({ ...prev, [filter.key]: value }))}
              />
            )
          })}
        </div>

        <div className="dialog-footer-actions">
          <Button type="button" variant="outline" disabled={generating} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <AdminPrimaryButton type="button" disabled={generating} onClick={() => onGenerate(filters)}>
            {generating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Download className="size-4" aria-hidden />
            )}
            {generating ? "Generating…" : `Download ${formatLabel}`}
          </AdminPrimaryButton>
        </div>
      </DialogContent>
    </Dialog>
  )
}
