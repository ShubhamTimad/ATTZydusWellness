import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronsUpDown } from "lucide-react"

import { AdminTableHeadCell } from "@/components/layout/admin-ui"
import { cn } from "@/lib/utils"

export type SortDir = "asc" | "desc"

/** Toggle sort: same column flips dir; new column uses ``defaultDir``. */
export function nextColumnSort(
  currentBy: string,
  currentDir: string,
  columnKey: string,
  defaultDir: SortDir = "asc",
): { sort_by: string; sort_dir: SortDir } {
  if (currentBy === columnKey) {
    return { sort_by: columnKey, sort_dir: currentDir === "asc" ? "desc" : "asc" }
  }
  return { sort_by: columnKey, sort_dir: defaultDir }
}

export function SortableColumnHeader({
  label,
  columnKey,
  sortBy,
  sortDir,
  onSort,
  className,
  align = "left",
}: {
  label: string
  columnKey: string
  sortBy: string
  sortDir: string
  onSort: (columnKey: string) => void
  className?: string
  align?: "left" | "right"
}) {
  const active = sortBy === columnKey
  const asc = active && sortDir === "asc"
  const desc = active && sortDir === "desc"
  return (
    <AdminTableHeadCell className={className}>
      <button
        type="button"
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded-sm text-left tracking-wide text-xm font-bold uppercase",
          "text-black",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          align === "right" && "ml-auto",
        )}
        aria-label={`Sort by ${label}${active ? (asc ? ", ascending" : ", descending") : ""}`}
        onClick={() => onSort(columnKey)}
      >
        <span className="truncate">{label}</span>
        {asc ? (
          <ArrowUpNarrowWide className="size-3.5 shrink-0 text-primary" aria-hidden />
        ) : desc ? (
          <ArrowDownWideNarrow className="size-3.5 shrink-0 text-primary" aria-hidden />
        ) : (
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-40" aria-hidden />
        )}
      </button>
    </AdminTableHeadCell>
  )
}
