import * as React from "react"
import { useSearchParams } from "react-router-dom"
import {
  Barcode,
  History,
  ListFilter,
  Printer,
  QrCode,
  RotateCw,
  Search,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminDataTable,
  AdminTableBodyRow,
  AdminTableEmptyRow,
  AdminTableLoadingRow,
  AdminTablePagination,
  ListPageHeader,
  WorkspaceTabs,
  WorkspaceTabsList,
  WorkspaceTabsTrigger,
} from "@/components/layout/list-page-ui"
import {
  nextColumnSort,
  SortableColumnHeader,
} from "@/components/layout/sortable-column-header"
import {
  AdminPrimaryButton,
  AdminPillBadge,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Table, TableBody, TableHeader } from "@/components/ui/table"
import { getJson, postJson } from "@/lib/api"
import { formatAppDate } from "@/lib/dates"
import { assetStatusLabel, assetStatusPillTone } from "@/lib/asset-lifecycle"
import { useAssetMasterLookups } from "@/lib/use-asset-masters"
import { useScanningProcess } from "@/lib/use-scanning-process"
import { cn } from "@/lib/utils"
import { encryptTagCode } from "@/lib/tag-crypto"
import {
  AssetTagSticker,
  getAssetEncodedValue,
  type LabelFormat,
  type TagCodeType,
} from "@/components/assets/asset-tag-print-dialog"

export type AssetPrintItem = {
  id: number
  asset_name: string
  asset_code: string
  combined_asset_number: string | null
  rfid_code: string | null
  category_name: string | null
  plant_name: string | null
  plant_code: string | null
  functional_location: string | null
  actual_location: string | null
  asset_class: string | null
  serial_no: string | null
  print_count: number
  last_printed_at: string | null
  last_printed_by: number | null
  last_printed_by_name: string | null
  last_reprint_reason: string | null
  lifecycle_status: string
  approval_status: string
  created_at: string
}

type PrintQueueResponse = {
  items: AssetPrintItem[]
  total: number
  page: number
  page_size: number
}

type ReprintReason = {
  code: string
  label: string
  description: string | null
}

type ReprintReasonsResponse = {
  reasons: ReprintReason[]
}

export type { LabelFormat, TagCodeType }

const listToolbarBtnClass = "h-9 shrink-0 gap-1.5 px-3"
const columnFilterControlClass =
  "h-7 w-full min-w-24 px-2 py-0 text-xs font-normal normal-case tracking-normal"

export type PrintTab = "pending" | "reprint"

type PrintColumnFilters = {
  asset_code: string
  asset_name: string
  category_id: string
  plant_id: string
  rfid_code: string
  reprint_reason: string
}

const DEFAULT_COLUMN_FILTERS: PrintColumnFilters = {
  asset_code: "",
  asset_name: "",
  category_id: "",
  plant_id: "",
  rfid_code: "",
  reprint_reason: "",
}

function FilterChip({
  label,
  onRemove,
  prefix,
}: {
  label: string
  onRemove: () => void
  prefix?: string
}) {
  const name = prefix ? `${prefix} ${label}` : label
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 pl-2.5 pr-1 text-xs font-medium leading-none text-muted-foreground">
      {prefix ? <span className="font-normal tracking-wide opacity-70">{prefix}</span> : null}
      <span>{label}</span>
      <button
        type="button"
        className="rounded-full p-0.5 opacity-70 transition-opacity hover:bg-current/10 hover:opacity-100"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

export function AssetTagPrintingPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get("tab")
  const initialTab: PrintTab = tabParam === "reprint" ? "reprint" : "pending"

  const [activeTab, setActiveTab] = React.useState<PrintTab>(initialTab)
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(20)

  // Search input & debounced search
  const [searchInput, setSearchInput] = React.useState("")
  const [search, setSearch] = React.useState("")

  // Sort state
  const [sortBy, setSortBy] = React.useState("created_at")
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc")

  // Column filters & inputs
  const [columnFiltersOpen, setColumnFiltersOpen] = React.useState(false)
  const [columnFilterInputs, setColumnFilterInputs] = React.useState<PrintColumnFilters>({
    ...DEFAULT_COLUMN_FILTERS,
  })
  const [columnFilters, setColumnFilters] = React.useState<PrintColumnFilters>({
    ...DEFAULT_COLUMN_FILTERS,
  })

  function toggleColumnSort(columnKey: string) {
    const next = nextColumnSort(
      sortBy,
      sortDir,
      columnKey,
      columnKey === "created_at" || columnKey === "last_printed_at" || columnKey === "print_count"
        ? "desc"
        : "asc",
    )
    setSortBy(next.sort_by)
    setSortDir(next.sort_dir)
    setPage(1)
  }

  const [loading, setLoading] = React.useState(false)
  const [items, setItems] = React.useState<AssetPrintItem[]>([])
  const [total, setTotal] = React.useState(0)
  const idsParam = searchParams.get("ids")
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(() => {
    if (!idsParam) return new Set()
    const parsed = idsParam.split(",").map(Number).filter((n) => !isNaN(n) && n > 0)
    return new Set(parsed)
  })

  React.useEffect(() => {
    if (idsParam) {
      const parsed = idsParam.split(",").map(Number).filter((n) => !isNaN(n) && n > 0)
      if (parsed.length > 0) {
        setSelectedIds(new Set(parsed))
      }
    }
  }, [idsParam])

  // Queue counts for tab headers
  const [pendingTotalCount, setPendingTotalCount] = React.useState<number | null>(null)
  const [reprintTotalCount, setReprintTotalCount] = React.useState<number | null>(null)

  // Scanning mode configuration
  const { barcodeEnabled, qrEnabled, barcodeQrField } = useScanningProcess()

  // Master lookups for filter dropdowns
  const { plants, categories } = useAssetMasterLookups()

  // Reprint reason modal state
  const [reprintModalOpen, setReprintModalOpen] = React.useState(false)
  const [reprintTargetAsset, setReprintTargetAsset] = React.useState<AssetPrintItem | null>(null)
  const [reprintReasons, setReprintReasons] = React.useState<ReprintReason[]>([])
  const [selectedReasonCode, setSelectedReasonCode] = React.useState("")
  const [reprintRemarks, setReprintRemarks] = React.useState("")
  const [reprintSubmitting, setReprintSubmitting] = React.useState(false)

  // Print Preview Dialog state
  const [printPreviewOpen, setPrintPreviewOpen] = React.useState(false)
  const [previewAssets, setPreviewAssets] = React.useState<AssetPrintItem[]>([])
  const [previewMode, setPreviewMode] = React.useState<"initial" | "reprint">("initial")
  const [labelFormat, setLabelFormat] = React.useState<LabelFormat>("standard")
  const [selectedCodeType, setSelectedCodeType] = React.useState<TagCodeType>("qr")
  const [isMarkingPrinted, setIsMarkingPrinted] = React.useState(false)

  // Sync default code type with global scanning mode
  React.useEffect(() => {
    if (barcodeEnabled && !qrEnabled) {
      setSelectedCodeType("barcode")
    } else {
      setSelectedCodeType("qr")
    }
  }, [barcodeEnabled, qrEnabled])

  // Count active column filters
  const activeColumnFilterCount = React.useMemo(() => {
    return Object.values(columnFilters).filter(Boolean).length
  }, [columnFilters])

  // Debounce search input
  React.useEffect(() => {
    const handler = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(handler)
  }, [searchInput])

  // Debounce column filter inputs
  React.useEffect(() => {
    const handler = setTimeout(() => {
      setColumnFilters((prev) => {
        const changed = Object.entries(columnFilterInputs).some(
          ([k, v]) => prev[k as keyof PrintColumnFilters] !== v,
        )
        if (!changed) return prev
        setPage(1)
        return { ...columnFilterInputs }
      })
    }, 300)
    return () => clearTimeout(handler)
  }, [columnFilterInputs])

  // Clear all filters & search
  const clearFilters = () => {
    setSearchInput("")
    setSearch("")
    setColumnFilterInputs({ ...DEFAULT_COLUMN_FILTERS })
    setColumnFilters({ ...DEFAULT_COLUMN_FILTERS })
    setPage(1)
  }

  // Sync tab with URL
  const handleTabChange = (nextTab: string) => {
    const t: PrintTab = nextTab === "reprint" ? "reprint" : "pending"
    setActiveTab(t)
    setPage(1)
    setSelectedIds(new Set())
    setSearchParams({ tab: t })
  }

  // Load reprint reasons once
  React.useEffect(() => {
    getJson<ReprintReasonsResponse>("/admin/assets/printing/reprint-reasons")
      .then((res) => setReprintReasons(res.reasons || []))
      .catch(() => setReprintReasons([]))
  }, [])

  // Load tab counts for badges
  const fetchCounts = React.useCallback(async () => {
    try {
      const [pendingRes, reprintRes] = await Promise.all([
        getJson<PrintQueueResponse>("/admin/assets/printing-queue?tab=pending&page=1&page_size=1"),
        getJson<PrintQueueResponse>("/admin/assets/printing-queue?tab=reprint&page=1&page_size=1"),
      ])
      setPendingTotalCount(pendingRes.total)
      setReprintTotalCount(reprintRes.total)
    } catch {
      // ignore
    }
  }, [])

  // Load active tab data
  const loadData = React.useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        tab: activeTab,
        page: String(page),
        page_size: String(pageSize),
      })
      if (search) params.set("search", search)
      if (columnFilters.asset_code) params.set("asset_code", columnFilters.asset_code)
      if (columnFilters.asset_name) params.set("asset_name", columnFilters.asset_name)
      if (columnFilters.category_id) params.set("category_id", columnFilters.category_id)
      if (columnFilters.plant_id) params.set("plant_id", columnFilters.plant_id)
      if (columnFilters.rfid_code) params.set("rfid_code", columnFilters.rfid_code)
      if (activeTab === "reprint" && columnFilters.reprint_reason) {
        params.set("reprint_reason", columnFilters.reprint_reason)
      }
      params.set("sort_by", sortBy)
      params.set("sort_dir", sortDir)

      const res = await getJson<PrintQueueResponse>(`/admin/assets/printing-queue?${params.toString()}`)
      setItems(res.items || [])
      setTotal(res.total || 0)

      if (activeTab === "pending") {
        setPendingTotalCount(res.total)
      } else if (activeTab === "reprint") {
        setReprintTotalCount(res.total)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load printing queue")
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [activeTab, page, pageSize, search, columnFilters, sortBy, sortDir])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  React.useEffect(() => {
    fetchCounts()
  }, [fetchCounts])

  // Bulk selection handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const next = new Set<number>(items.map((i) => i.id))
      setSelectedIds(next)
    } else {
      setSelectedIds(new Set())
    }
  }

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Single Print Trigger (Initial Print tab)
  const handleTriggerInitialPrint = (assetList: AssetPrintItem[]) => {
    if (!assetList.length) return
    setPreviewAssets(assetList)
    setPreviewMode("initial")
    setPrintPreviewOpen(true)
  }

  // Trigger Reprint flow (Reprint tab) - Opens reason selection dialog
  const handleOpenReprintDialog = (asset: AssetPrintItem) => {
    setReprintTargetAsset(asset)
    setSelectedReasonCode(reprintReasons[0]?.code || "")
    setReprintRemarks("")
    setReprintModalOpen(true)
  }

  // Confirm Reprint and send to server, then show printable label
  const handleConfirmReprint = async () => {
    if (!reprintTargetAsset) return
    const reasonObj = reprintReasons.find((r) => r.code === selectedReasonCode)
    const reasonLabel = reasonObj?.label || selectedReasonCode

    if (selectedReasonCode === "other" && !reprintRemarks.trim()) {
      toast.error("Please enter remarks explaining the reprint reason.")
      return
    }

    setReprintSubmitting(true)
    try {
      await postJson("/admin/assets/printing/mark-printed", {
        asset_ids: [reprintTargetAsset.id],
        print_type: "reprint",
        reprint_reason: reasonLabel,
        remarks: reprintRemarks.trim() || null,
      })

      toast.success(`Reprint logged for asset ${reprintTargetAsset.asset_code}`)
      setReprintModalOpen(false)

      // Open print preview with updated asset data
      const updatedAsset: AssetPrintItem = {
        ...reprintTargetAsset,
        print_count: (reprintTargetAsset.print_count || 0) + 1,
        last_reprint_reason: reasonLabel,
      }
      setPreviewAssets([updatedAsset])
      setPreviewMode("reprint")
      setPrintPreviewOpen(true)

      // Refresh list
      loadData()
      fetchCounts()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record reprint")
    } finally {
      setReprintSubmitting(false)
    }
  }

  // Execute printing from Print Preview modal
  const handleExecutePrint = async () => {
    if (!previewAssets.length) return

    // If initial print, send mark-printed call to backend so items move to Reprint tab!
    if (previewMode === "initial") {
      setIsMarkingPrinted(true)
      try {
        await postJson("/admin/assets/printing/mark-printed", {
          asset_ids: previewAssets.map((a) => a.id),
          print_type: "initial",
        })
        toast.success(`Printed ${previewAssets.length} asset tag(s). Moved to Reprint archive.`)
        setSelectedIds(new Set())
        loadData()
        fetchCounts()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update print status")
      } finally {
        setIsMarkingPrinted(false)
      }
    }

    // Trigger browser print dialog
    window.print()
  }

  const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id))

  return (
    <AdminPage fullWidth dense viewportFill className="gap-[var(--app-grid-gap)]">
      {/* Printable Area - Styles ensure only this element prints when window.print() is executed */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #asset-printable-labels, #asset-printable-labels * {
            visibility: visible !important;
          }
          #asset-printable-labels {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 10px !important;
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 12px !important;
            background: white !important;
          }
        }
      `}</style>

      {/* Hidden container for print-to-paper execution */}
      <div id="asset-printable-labels" className="hidden print:flex">
        {previewAssets.map((asset) => (
          <AssetTagSticker
            key={asset.id}
            asset={asset}
            codeType={selectedCodeType}
            format={labelFormat}
            isReprint={previewMode === "reprint"}
            encodingField={barcodeQrField}
          />
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[var(--app-grid-gap)]">
        {/* Header & Scanning Mode Banner */}
        <div className="shrink-0 space-y-3">
          <ListPageHeader
            title="Asset Tag & Label Printing"
            // description="Generate and manage physical QR code and Barcode stickers for equipment and physical assets. Newly created assets appear in Print; once printed, they transition to the Reprint archive with full audit reasons."
            actions={
              <div className="flex items-center gap-2">
                {activeTab === "pending" && selectedIds.size > 0 && (
                  <AdminPrimaryButton
                    type="button"
                    onClick={() => {
                      const selectedList = items.filter((i) => selectedIds.has(i.id))
                      handleTriggerInitialPrint(selectedList)
                    }}
                    className="flex items-center gap-1.5"
                  >
                    <Printer className="h-4 w-4" />
                    Print Selected ({selectedIds.size})
                  </AdminPrimaryButton>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    loadData()
                    fetchCounts()
                  }}
                  className="flex items-center gap-1.5"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  Refresh
                </Button>
              </div>
            }
          />


          {/* Main List-Style Tab Navigation (Matching Asset Master) */}
          <WorkspaceTabs value={activeTab} onValueChange={handleTabChange} className="shrink-0">
            <WorkspaceTabsList>
              <WorkspaceTabsTrigger value="pending">
                Print
                {typeof pendingTotalCount === "number" ? (
                  <span className="ml-1.5 tabular-nums text-muted-foreground">({pendingTotalCount})</span>
                ) : null}
              </WorkspaceTabsTrigger>

              <WorkspaceTabsTrigger value="reprint">
                Reprint
                {typeof reprintTotalCount === "number" ? (
                  <span className="ml-1.5 tabular-nums text-muted-foreground">({reprintTotalCount})</span>
                ) : null}
              </WorkspaceTabsTrigger>
            </WorkspaceTabsList>
          </WorkspaceTabs>

          {/* Toolbar: Search + Filter button + Clear button */}
          <div className="app-list-toolbar shrink-0">
            <div className="relative min-w-[16rem] flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="tag-printing-search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search Records by Asset No, Name, RFID, etc."
                className="w-full pl-9"
                aria-label="Search Records"
              />
              {searchInput ? (
                <button
                  type="button"
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                  onClick={() => setSearchInput("")}
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                listToolbarBtnClass,
                columnFiltersOpen && "border-primary/40 bg-primary/5",
              )}
              aria-expanded={columnFiltersOpen}
              onClick={() => setColumnFiltersOpen((open) => !open)}
            >
              <ListFilter className="size-4" aria-hidden />
              <span className="inline-flex items-center gap-0.5">
                Filter
                {activeColumnFilterCount > 0 ? (
                  <span className="text-xs font-medium text-red-600">
                    ({activeColumnFilterCount})
                  </span>
                ) : null}
              </span>
            </Button>

            {activeColumnFilterCount > 0 || searchInput.trim() ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={listToolbarBtnClass}
                onClick={clearFilters}
              >
                Clear
              </Button>
            ) : null}
          </div>

          {/* Active Filter Chips */}
          {activeColumnFilterCount > 0 && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {columnFilters.asset_code ? (
                <FilterChip
                  prefix="Asset No:"
                  label={columnFilters.asset_code}
                  onRemove={() => {
                    setColumnFilterInputs((f) => ({ ...f, asset_code: "" }))
                    setColumnFilters((f) => ({ ...f, asset_code: "" }))
                  }}
                />
              ) : null}
              {columnFilters.asset_name ? (
                <FilterChip
                  prefix="Name:"
                  label={columnFilters.asset_name}
                  onRemove={() => {
                    setColumnFilterInputs((f) => ({ ...f, asset_name: "" }))
                    setColumnFilters((f) => ({ ...f, asset_name: "" }))
                  }}
                />
              ) : null}
              {columnFilters.category_id ? (
                <FilterChip
                  prefix="Category:"
                  label={
                    categories.find((c) => String(c.id) === columnFilters.category_id)?.name ??
                    columnFilters.category_id
                  }
                  onRemove={() => {
                    setColumnFilterInputs((f) => ({ ...f, category_id: "" }))
                    setColumnFilters((f) => ({ ...f, category_id: "" }))
                  }}
                />
              ) : null}
              {columnFilters.plant_id ? (
                <FilterChip
                  prefix="Plant:"
                  label={
                    plants.find((p) => String(p.id) === columnFilters.plant_id)?.name ??
                    columnFilters.plant_id
                  }
                  onRemove={() => {
                    setColumnFilterInputs((f) => ({ ...f, plant_id: "" }))
                    setColumnFilters((f) => ({ ...f, plant_id: "" }))
                  }}
                />
              ) : null}
              {columnFilters.rfid_code ? (
                <FilterChip
                  prefix="RFID:"
                  label={columnFilters.rfid_code}
                  onRemove={() => {
                    setColumnFilterInputs((f) => ({ ...f, rfid_code: "" }))
                    setColumnFilters((f) => ({ ...f, rfid_code: "" }))
                  }}
                />
              ) : null}
              {columnFilters.reprint_reason ? (
                <FilterChip
                  prefix="Reason:"
                  label={columnFilters.reprint_reason}
                  onRemove={() => {
                    setColumnFilterInputs((f) => ({ ...f, reprint_reason: "" }))
                    setColumnFilters((f) => ({ ...f, reprint_reason: "" }))
                  }}
                />
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={clearFilters}
              >
                Clear all
              </Button>
            </div>
          )}
        </div>

        {/* Data Table */}
        <AdminDataTable
          className="min-h-0 flex-1"
          footer={
            <AdminTablePagination
              page={page}
              totalPages={Math.ceil(total / pageSize) || 1}
              total={total}
              pageSize={pageSize}
              loading={loading}
              itemLabel="assets"
              selectedCount={activeTab === "pending" ? selectedIds.size : undefined}
              onPageChange={setPage}
            />
          }
        >
          <Table className="app-table-head-sticky">
            <TableHeader>
              <AdminTableHeaderRow>
                {activeTab === "pending" && (
                  <AdminTableHeadCell className="w-10 text-center">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={handleSelectAll}
                      aria-label="Select all"
                    />
                  </AdminTableHeadCell>
                )}
                <SortableColumnHeader
                  label="Asset Number"
                  columnKey="asset_code"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleColumnSort}
                  className="min-w-[140px]"
                />
                <SortableColumnHeader
                  label="Asset Name"
                  columnKey="asset_name"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleColumnSort}
                  className="min-w-[200px]"
                />
                <SortableColumnHeader
                  label="Category"
                  columnKey="category_name"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleColumnSort}
                  className="min-w-[140px]"
                />
                <SortableColumnHeader
                  label="Plant & Location"
                  columnKey="plant_name"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleColumnSort}
                  className="min-w-[150px]"
                />
                <SortableColumnHeader
                  label="RFID Code"
                  columnKey="rfid_code"
                  sortBy={sortBy}
                  sortDir={sortDir}
                  onSort={toggleColumnSort}
                  className="min-w-[120px]"
                />

                {activeTab === "pending" ? (
                  <>
                    <SortableColumnHeader
                      label="Created Date"
                      columnKey="created_at"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={toggleColumnSort}
                      className="min-w-[110px]"
                    />
                    <SortableColumnHeader
                      label="Status"
                      columnKey="approval_status"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={toggleColumnSort}
                      className="min-w-[100px]"
                    />
                    <AdminTableHeadCell className="w-[110px] text-right pr-4">Action</AdminTableHeadCell>
                  </>
                ) : (
                  <>
                    <SortableColumnHeader
                      label="Print Count"
                      columnKey="print_count"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={toggleColumnSort}
                      className="min-w-[100px] text-center"
                    />
                    <SortableColumnHeader
                      label="Last Printed"
                      columnKey="last_printed_at"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={toggleColumnSort}
                      className="min-w-[140px]"
                    />
                    <SortableColumnHeader
                      label="Reprint Reason"
                      columnKey="last_reprint_reason"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={toggleColumnSort}
                      className="min-w-[170px]"
                    />
                    <AdminTableHeadCell className="w-[110px] text-right pr-4">Action</AdminTableHeadCell>
                  </>
                )}
              </AdminTableHeaderRow>

              {columnFiltersOpen ? (
                <AdminTableHeaderRow>
                  {activeTab === "pending" && (
                    <AdminTableHeadCell className="w-10 px-3 py-1.5">
                      <span className="sr-only">Filters</span>
                    </AdminTableHeadCell>
                  )}
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <Input
                      value={columnFilterInputs.asset_code}
                      onChange={(e) =>
                        setColumnFilterInputs((f) => ({ ...f, asset_code: e.target.value }))
                      }
                      aria-label="Filter asset number"
                      placeholder="Asset No"
                      className={columnFilterControlClass}
                    />
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <Input
                      value={columnFilterInputs.asset_name}
                      onChange={(e) =>
                        setColumnFilterInputs((f) => ({ ...f, asset_name: e.target.value }))
                      }
                      aria-label="Filter asset name"
                      placeholder="Asset Name"
                      className={columnFilterControlClass}
                    />
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <select
                      className={cn(adminSelectClass, columnFilterControlClass)}
                      value={columnFilterInputs.category_id}
                      aria-label="Filter category"
                      onChange={(e) =>
                        setColumnFilterInputs((f) => ({ ...f, category_id: e.target.value }))
                      }
                    >
                      <option value="">Category</option>
                      {categories.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <select
                      className={cn(adminSelectClass, columnFilterControlClass)}
                      value={columnFilterInputs.plant_id}
                      aria-label="Filter plant"
                      onChange={(e) =>
                        setColumnFilterInputs((f) => ({ ...f, plant_id: e.target.value }))
                      }
                    >
                      <option value="">Plant</option>
                      {plants.map((p) => (
                        <option key={p.id} value={String(p.id)}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </AdminTableHeadCell>
                  <AdminTableHeadCell className="px-2 py-1.5">
                    <Input
                      value={columnFilterInputs.rfid_code}
                      onChange={(e) =>
                        setColumnFilterInputs((f) => ({ ...f, rfid_code: e.target.value }))
                      }
                      aria-label="Filter RFID"
                      placeholder="RFID"
                      className={columnFilterControlClass}
                    />
                  </AdminTableHeadCell>

                  {activeTab === "pending" ? (
                    <>
                      <AdminTableHeadCell className="px-2 py-1.5">
                        <span className="sr-only">No filter</span>
                      </AdminTableHeadCell>
                      <AdminTableHeadCell className="px-2 py-1.5">
                        <span className="sr-only">No filter</span>
                      </AdminTableHeadCell>
                      <AdminTableHeadCell className="px-2 py-1.5">
                        <span className="sr-only">No filter</span>
                      </AdminTableHeadCell>
                    </>
                  ) : (
                    <>
                      <AdminTableHeadCell className="px-2 py-1.5">
                        <span className="sr-only">No filter</span>
                      </AdminTableHeadCell>
                      <AdminTableHeadCell className="px-2 py-1.5">
                        <span className="sr-only">No filter</span>
                      </AdminTableHeadCell>
                      <AdminTableHeadCell className="px-2 py-1.5">
                        <select
                          className={cn(adminSelectClass, columnFilterControlClass)}
                          value={columnFilterInputs.reprint_reason}
                          aria-label="Filter reprint reason"
                          onChange={(e) =>
                            setColumnFilterInputs((f) => ({ ...f, reprint_reason: e.target.value }))
                          }
                        >
                          <option value="">Reason</option>
                          {reprintReasons.map((r) => (
                            <option key={r.code} value={r.label}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </AdminTableHeadCell>
                      <AdminTableHeadCell className="px-2 py-1.5">
                        <span className="sr-only">No filter</span>
                      </AdminTableHeadCell>
                    </>
                  )}
                </AdminTableHeaderRow>
              ) : null}
            </TableHeader>

            <TableBody>
              {loading ? (
                <AdminTableLoadingRow colSpan={9} label="Loading assets" />
              ) : items.length === 0 ? (
                <AdminTableEmptyRow colSpan={9}>
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground">
                      {activeTab === "pending"
                        ? "No new assets pending initial print"
                        : "No printed assets found in reprint archive"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {activeTab === "pending"
                        ? "All newly created assets have been printed, or no assets match your search filters."
                        : "No assets have been printed yet. Tags printed from the Print tab will appear here."}
                    </p>
                  </div>
                </AdminTableEmptyRow>
              ) : (
                items.map((asset) => {
                  const isSelected = selectedIds.has(asset.id)
                  return (
                    <AdminTableBodyRow
                      key={asset.id}
                      className={cn(isSelected && "bg-primary/5")}
                    >
                      {activeTab === "pending" && (
                        <AdminTableCell className="w-10 text-center">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => handleToggleSelect(asset.id)}
                            aria-label={`Select ${asset.asset_code}`}
                          />
                        </AdminTableCell>
                      )}

                      {/* Asset Number */}
                      <AdminTableCell>
                        <div className="flex flex-col">
                          <span className="font-mono text-xs font-medium text-foreground">
                            {asset.asset_code || "—"}
                          </span>
                          {asset.combined_asset_number && asset.combined_asset_number !== asset.asset_code && (
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {asset.combined_asset_number}
                            </span>
                          )}
                        </div>
                      </AdminTableCell>

                      {/* Asset Name (no category underneath!) */}
                      <AdminTableCell>
                        <span
                          className="block max-w-[14rem] truncate font-medium text-foreground"
                          title={asset.asset_name}
                        >
                          {asset.asset_name}
                        </span>
                      </AdminTableCell>

                      {/* Category (separate column!) */}
                      <AdminTableCell>
                        <span className="text-muted-foreground">
                          {asset.category_name || "—"}
                        </span>
                      </AdminTableCell>

                      {/* Plant & Location */}
                      <AdminTableCell>
                        <div className="flex flex-col text-xs">
                          <span className="font-medium text-foreground">
                            {asset.plant_name || asset.plant_code || "—"}
                          </span>
                          <span className="truncate text-muted-foreground">
                            {asset.functional_location || asset.actual_location || "—"}
                          </span>
                        </div>
                      </AdminTableCell>

                      {/* RFID Code */}
                      <AdminTableCell>
                        {asset.rfid_code?.trim() ? (
                          <span
                            className="font-mono text-xs text-foreground"
                            title={asset.rfid_code}
                          >
                            {asset.rfid_code}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Not tagged</span>
                        )}
                      </AdminTableCell>

                      {activeTab === "pending" ? (
                        <>
                          {/* Created Date */}
                          <AdminTableCell className="text-xs text-muted-foreground">
                            {asset.created_at ? formatAppDate(asset.created_at) : "—"}
                          </AdminTableCell>

                          {/* Status */}
                          <AdminTableCell>
                            <AdminPillBadge
                              tone={assetStatusPillTone(asset.lifecycle_status, asset.approval_status)}
                            >
                              {assetStatusLabel(asset.lifecycle_status, asset.approval_status)}
                            </AdminPillBadge>
                          </AdminTableCell>

                          {/* Action: Print */}
                          <AdminTableCell className="text-right pr-4">
                            <Button
                              size="sm"
                              variant="default"
                              className="h-8 gap-1.5 font-medium"
                              onClick={() => handleTriggerInitialPrint([asset])}
                            >
                              <Printer className="h-3.5 w-3.5" />
                              Print
                            </Button>
                          </AdminTableCell>
                        </>
                      ) : (
                        <>
                          {/* Print Count */}
                          <AdminTableCell className="text-center font-medium tabular-nums text-foreground">
                            {asset.print_count}
                          </AdminTableCell>

                          {/* Last Printed */}
                          <AdminTableCell>
                            <div className="flex flex-col text-xs">
                              <span className="text-foreground">
                                {asset.last_printed_at ? formatAppDate(asset.last_printed_at) : "—"}
                              </span>
                              {asset.last_printed_by_name && (
                                <span className="text-muted-foreground">
                                  by {asset.last_printed_by_name}
                                </span>
                              )}
                            </div>
                          </AdminTableCell>

                          {/* Reprint Reason */}
                          <AdminTableCell>
                            <span
                              className="block max-w-[14rem] truncate text-xs text-muted-foreground"
                              title={asset.last_reprint_reason || undefined}
                            >
                              {asset.last_reprint_reason || "—"}
                            </span>
                          </AdminTableCell>

                          {/* Action: Reprint */}
                          <AdminTableCell className="text-right pr-4">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1.5 font-medium"
                              onClick={() => handleOpenReprintDialog(asset)}
                            >
                              <RotateCw className="h-3.5 w-3.5" />
                              Reprint
                            </Button>
                          </AdminTableCell>
                        </>
                      )}
                    </AdminTableBodyRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </AdminDataTable>
      </div>

      {/* ========================================================================= */}
      {/* DIALOG 1: REPRINT REASON SELECTION MODAL */}
      {/* ========================================================================= */}
      <Dialog open={reprintModalOpen} onOpenChange={setReprintModalOpen}>
        <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-3">
            <div className="flex items-center gap-2 text-amber-600">
              <History className="h-5 w-5" />
              <DialogTitle>Reason for Reprint</DialogTitle>
            </div>
            <DialogDescription>
              Specify the operational reason for generating a replacement tag for{" "}
              <strong className="text-foreground">{reprintTargetAsset?.asset_code}</strong>.
              This audit record will be logged with your timestamp.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 py-5">
            {/* Target Asset Summary Card */}
            {reprintTargetAsset && (
              <div className="rounded-lg border border-border/80 bg-muted/40 p-3.5 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Asset Code:</span>
                  <span className="font-mono font-bold text-foreground">
                    {reprintTargetAsset.asset_code}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Asset Name:</span>
                  <span className="font-semibold text-foreground truncate max-w-[260px]">
                    {reprintTargetAsset.asset_name}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Previous Prints:</span>
                  <span className="font-bold text-amber-600">
                    {reprintTargetAsset.print_count} {reprintTargetAsset.print_count === 1 ? "time" : "times"}
                  </span>
                </div>
              </div>
            )}

            {/* Reprint Reason Dropdown */}
            <div className="space-y-1.5">
              <Label htmlFor="reprint-reason-select" className="text-xs font-semibold text-foreground">
                Select Reprint Reason <span className="text-rose-500">*</span>
              </Label>
              <select
                id="reprint-reason-select"
                className={cn(adminSelectClass, "h-10 text-sm font-medium w-full")}
                value={selectedReasonCode}
                onChange={(e) => setSelectedReasonCode(e.target.value)}
              >
                {reprintReasons.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
              {reprintReasons.find((r) => r.code === selectedReasonCode)?.description && (
                <p className="text-[11px] text-muted-foreground">
                  {reprintReasons.find((r) => r.code === selectedReasonCode)?.description}
                </p>
              )}
            </div>

            {/* Remarks Input */}
            <div className="space-y-1.5">
              <Label htmlFor="reprint-remarks" className="text-xs font-semibold text-foreground">
                Remarks / Operational Notes{" "}
                {selectedReasonCode === "other" ? (
                  <span className="text-rose-500">* (Required)</span>
                ) : (
                  <span className="text-muted-foreground font-normal">(Optional)</span>
                )}
              </Label>
              <textarea
                id="reprint-remarks"
                rows={3}
                placeholder="e.g. Tag damaged during chemical washdown in Clean Room A..."
                value={reprintRemarks}
                onChange={(e) => setReprintRemarks(e.target.value)}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </div>

          <DialogFooter className="px-6 py-4 gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={reprintSubmitting}
              onClick={() => setReprintModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={reprintSubmitting}
              onClick={handleConfirmReprint}
              className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
            >
              {reprintSubmitting ? (
                <>
                  <RotateCw className="h-4 w-4 animate-spin" />
                  Logging Reprint…
                </>
              ) : (
                <>
                  <Printer className="h-4 w-4" />
                  Confirm & Generate Tag
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========================================================================= */}
      {/* DIALOG 2: PRINT PREVIEW & STICKER GENERATOR MODAL */}
      {/* ========================================================================= */}
      <Dialog open={printPreviewOpen} onOpenChange={setPrintPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="shrink-0 px-6 pt-5 pb-3 border-b border-border/80">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Printer className="h-5 w-5 text-primary" />
                <DialogTitle>Tag Sticker Print Preview</DialogTitle>
              </div>
              <span className="text-xs bg-muted px-2.5 py-1 rounded font-medium text-muted-foreground mr-6">
                {previewAssets.length} {previewAssets.length === 1 ? "Label" : "Labels"} Ready
              </span>
            </div>
          </DialogHeader>

          {/* Controls Bar: Tag Code Type & Sticker Label Size */}
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3 border-b border-border/60 text-xs bg-muted/20">
            {/* Tag Code Type Selection */}
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Tag Code:</span>
              <div className="flex items-center gap-1 rounded-md border border-border p-0.5 bg-muted/40">
                <button
                  type="button"
                  onClick={() => setSelectedCodeType("qr")}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    selectedCodeType === "qr"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <QrCode className="h-3.5 w-3.5" />
                  QR Code
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCodeType("barcode")}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    selectedCodeType === "barcode"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Barcode className="h-3.5 w-3.5" />
                  Barcode
                </button>
              </div>
            </div>

            {/* Sticker Label Size Selection */}
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Sticker Label Size:</span>
              <div className="flex items-center gap-1 rounded-md border border-border p-0.5 bg-muted/40">
                <button
                  type="button"
                  onClick={() => setLabelFormat("compact")}
                  className={cn(
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    labelFormat === "compact"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Compact (50x25mm)
                </button>
                <button
                  type="button"
                  onClick={() => setLabelFormat("standard")}
                  className={cn(
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    labelFormat === "standard"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Standard (75x50mm)
                </button>
                <button
                  type="button"
                  onClick={() => setLabelFormat("large")}
                  className={cn(
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    labelFormat === "large"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Large (100x50mm)
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
              {(() => {
                const enc = previewAssets[0] ? getAssetEncodedValue(previewAssets[0], barcodeQrField) : null
                const encVal = enc?.value ? encryptTagCode(enc.value) : ""
                return (
                  <>
                    <span>
                      Encoding ({enc?.label || "Asset Code"}):{" "}
                      <strong className="text-foreground">{enc?.value || "—"}</strong>
                    </span>
                    {encVal && (
                      <span className="text-[11px] font-mono bg-muted/80 text-foreground px-2 py-0.5 rounded border border-border/60">
                        Tag Code: {encVal}
                      </span>
                    )}
                  </>
                )
              })()}
            </div>
          </div>

          {/* Interactive Sticker Preview Area */}
          <div className="flex-1 overflow-y-auto p-6 m-6 bg-neutral-100/70 dark:bg-neutral-900/50 rounded-lg border border-border/40 flex flex-wrap gap-4 items-center justify-center">
            {previewAssets.map((asset) => (
              <AssetTagSticker
                key={asset.id}
                asset={asset}
                codeType={selectedCodeType}
                format={labelFormat}
                isReprint={previewMode === "reprint"}
                encodingField={barcodeQrField}
              />
            ))}
          </div>

          {/* Modal Footer Actions */}
          <DialogFooter className="shrink-0 px-6 py-4 border-t border-border/80 gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isMarkingPrinted}
              onClick={() => setPrintPreviewOpen(false)}
            >
              Close
            </Button>
            <Button
              type="button"
              variant="default"
              disabled={isMarkingPrinted}
              onClick={handleExecutePrint}
              className="gap-2 bg-primary text-primary-foreground"
            >
              {isMarkingPrinted ? (
                <>
                  <RotateCw className="h-4 w-4 animate-spin" />
                  Updating Print Queue…
                </>
              ) : (
                <>
                  <Printer className="h-4 w-4" />
                  Print to Printer ({previewAssets.length})
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  )
}
