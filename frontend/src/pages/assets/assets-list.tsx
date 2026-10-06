import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import {
  AlertTriangle,
  Columns3,
  Download,
  ListFilter,
  Plus,
  Search,
  SlidersHorizontal,
  Upload,
  X,
  FileSpreadsheet,
  FileText,
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
  AdminPrimaryButton,
  AdminPillBadge,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeaderRow,
  adminPillToneClass,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import type { AdminPillTone } from "@/components/layout/admin-ui"
import {
  nextColumnSort,
  SortableColumnHeader,
} from "@/components/layout/sortable-column-header"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useConfirmDialog } from "@/components/ui/confirm-dialog"
import { AssetActionsMenu } from "@/components/assets/asset-actions-menu"
import { AssetExportDialog } from "@/components/assets/asset-export-dialog"
import { AssetRfidDialog } from "@/components/assets/asset-rfid-dialog"
import { ApiError, deleteJson, downloadFile, getJson, postJson, putJson } from "@/lib/api"
import {
  assetListRootKey,
  invalidateAssetLists,
  LIST_STALE_MS,
} from "@/lib/query-client"
import {
  buildAssetListActionItems,
  canActOnAsset,
  eligibleDeactivateAssets,
  eligibleDeleteAssets,
  eligibleDecisionAssets,
  eligiblePhysicalOrderAssets,
  eligibleReactivateAssets,
  eligibleSubmitAssets,
  mayRequestNewOrder,
} from "@/lib/asset-actions"
import {
  asAssetListItem,
  clearAssetMasterSelection,
  takeAssetMasterSelection,
  writeAssetMasterSelection,
} from "@/lib/asset-master-selection"
import type {
  AssetListResponse,
  AssetListItem,
  AssetRfidAttachResult,
  FinancialYearListResponse,
  FinancialYearOption,
  SubmitForApprovalResult,
} from "@/lib/assets-types"
import {
  formatRfidAttachError,
  formatRfidAttachSuccess,
  formatSubmitForApprovalError,
  formatSubmitForApprovalSuccess,
} from "@/lib/assets-types"
import { CapexAssigneePickerDialog } from "@/pages/capex/capex-assignee-picker-dialog"
import { CapexDecisionDialog } from "@/pages/capex/capex-decision-dialog"
import {
  assetClassLabel,
  assetConditionLabel,
  categoryLabel,
  plantLabel,
  useAssetMasterLookups,
} from "@/lib/use-asset-masters"
import {
  ASSET_APPROVAL_STATUS_TABS,
  ASSET_STATUS_FILTER_OPTIONS,
  assetStatusFilterOption,
  assetStatusFilterValue,
  assetStatusLabel,
  assetStatusPillTone,
} from "@/lib/asset-lifecycle"
import { currentUserId, hasPermission, isSuperuser } from "@/lib/permissions"
import type { ValidateAssetsResponse } from "@/lib/orders-types"
import { writePhysicalOrderPreview } from "@/lib/physical-order-preview"
import { orderStatusLabel } from "@/lib/orders-types"
import {
  TRANSFER_IN_PROGRESS_MESSAGE,
  type ValidateTransferAssetsResponse,
} from "@/lib/transfer-types"
import { formatAppDate } from "@/lib/dates"
import { hasSessionState, useSessionState, useUrlPage, useUrlTab } from "@/lib/use-url-tab"
import { cn } from "@/lib/utils"

export type AssetListTab = "all" | "draft" | "pending" | "rejected" | "approved" | "fy"
export type AssetFySubTab = "verified" | "pending"

const ASSET_LIST_TAB_KEYS = [
  "approved",
  "draft",
  "pending",
  "rejected",
  "all",
  "fy",
] as const satisfies readonly AssetListTab[]
const FY_SUB_TAB_KEYS = ["verified", "pending"] as const satisfies readonly AssetFySubTab[]

export type AssetListColumnKey =
  | "asset_code"
  | "combined_asset_number"
  | "asset_name"
  | "rfid_code"
  | "category_name"
  | "sub_no"
  | "asset_class"
  | "asset_type"
  | "asset_condition"
  | "asset_custodian"
  | "plant_code"
  | "plant_name"
  | "cost_center"
  | "cost_center_name"
  | "functional_location"
  | "actual_location"
  | "cap_date"
  | "gross_block"
  | "party_details"
  | "life_span"
  | "pm_equipment_id"
  | "inventory_count"
  | "physical_count"
  | "last_verification_date"
  | "lifecycle_status"

type AssetListColumnDefinition = {
  key: AssetListColumnKey
  label: string
  group: "Asset information" | "Location & financial" | "Inventory"
}

const ASSET_LIST_COLUMNS: AssetListColumnDefinition[] = [
  { key: "asset_code", label: "Asset Number", group: "Asset information" },
  { key: "combined_asset_number", label: "Combined Asset No", group: "Asset information" },
  { key: "asset_name", label: "Asset Name", group: "Asset information" },
  { key: "rfid_code", label: "RFID Code", group: "Asset information" },
  { key: "category_name", label: "Asset Category", group: "Asset information" },
  { key: "sub_no", label: "Sub-No", group: "Asset information" },
  { key: "asset_class", label: "Asset Class", group: "Asset information" },
  { key: "asset_type", label: "Asset Type", group: "Asset information" },
  { key: "asset_condition", label: "Asset Physical Condition", group: "Asset information" },
  { key: "asset_custodian", label: "Asset Custodian", group: "Asset information" },
  { key: "plant_code", label: "Plant Code", group: "Location & financial" },
  { key: "plant_name", label: "Plant Name", group: "Location & financial" },
  { key: "cost_center", label: "Cost Center Code", group: "Location & financial" },
  { key: "cost_center_name", label: "Cost Center Name", group: "Location & financial" },
  { key: "functional_location", label: "Actual Location 1", group: "Location & financial" },
  { key: "actual_location", label: "Actual Location 2", group: "Location & financial" },
  { key: "cap_date", label: "Capitalization Date", group: "Location & financial" },
  { key: "gross_block", label: "APC-IGAAP", group: "Location & financial" },
  { key: "party_details", label: "Party Details", group: "Location & financial" },
  { key: "life_span", label: "Life-Span (Years)", group: "Location & financial" },
  { key: "pm_equipment_id", label: "PM Equipment ID", group: "Location & financial" },
  { key: "inventory_count", label: "Inventory Count", group: "Inventory" },
  { key: "physical_count", label: "Physical Count", group: "Inventory" },
  { key: "last_verification_date", label: "Last Verification", group: "Inventory" },
  { key: "lifecycle_status", label: "Status", group: "Asset information" },
]

const ASSET_LIST_COLUMNS_CACHE_KEY = "asset.listColumns"

function readStoredAssetListColumns(): AssetListColumnKey[] | null {
  try {
    const raw = sessionStorage.getItem(ASSET_LIST_COLUMNS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const allowed = new Set(ASSET_LIST_COLUMNS.map((column) => column.key))
    const columns = parsed.flatMap((key): AssetListColumnKey[] => {
      if (key === "plant") return ["plant_code", "plant_name"]
      return allowed.has(key as AssetListColumnKey) ? [key as AssetListColumnKey] : []
    })
    return columns.length > 0 ? columns : null
  } catch {
    return null
  }
}

const DEFAULT_ASSET_LIST_COLUMN_KEYS: AssetListColumnKey[] = [
  "asset_code",
  "combined_asset_number",
  "asset_name",
  "rfid_code",
  "category_name",
  "cost_center",
  "functional_location",
  "inventory_count",
  "physical_count",
  "lifecycle_status",
]

const DATE_SORT_KEYS = new Set<AssetListColumnKey>(["last_verification_date", "cap_date"])
const NUMERIC_COLUMN_KEYS = new Set<AssetListColumnKey>([
  "inventory_count",
  "physical_count",
  "gross_block",
])

function defaultSortDirForColumn(key: AssetListColumnKey): "asc" | "desc" {
  return DATE_SORT_KEYS.has(key) ? "desc" : "asc"
}

type AssetListColumnsPreference = { columns: AssetListColumnKey[] }

export type AssetListFilters = {
  plant_id: string
  category_id: string
  lifecycle_status: string
  approval_status: string
  rfid_status: string
  fy_start_year: string
  fy_scan_from: string
  fy_scan_to: string
  sort_by: string
  sort_dir: string
  source_type: string
}

const DEFAULT_FILTERS: AssetListFilters = {
  plant_id: "",
  category_id: "",
  lifecycle_status: "",
  approval_status: "",
  rfid_status: "",
  fy_start_year: "",
  fy_scan_from: "",
  fy_scan_to: "",
  sort_by: "last_action_at",
  sort_dir: "desc",
  source_type: "",
}

const DEFAULT_FY_FILTERS: AssetListFilters = {
  ...DEFAULT_FILTERS,
  sort_by: "last_verification_date",
  sort_dir: "desc",
}

export type AssetColumnFilters = {
  asset_code: string
  combined_asset_number: string
  asset_name: string
  rfid_code: string
  sub_no: string
  asset_class: string
  asset_type: string
  asset_condition: string
  asset_custodian: string
  cost_center: string
  functional_location: string
  actual_location: string
  cap_date: string
  gross_block: string
  party_details: string
  life_span: string
  pm_equipment_id: string
  inventory_count: string
  physical_count: string
  last_verification_date: string
  created_at: string
  source_type: string
}

const DEFAULT_COLUMN_FILTERS: AssetColumnFilters = {
  asset_code: "",
  combined_asset_number: "",
  asset_name: "",
  rfid_code: "",
  sub_no: "",
  asset_class: "",
  asset_type: "",
  asset_condition: "",
  asset_custodian: "",
  cost_center: "",
  functional_location: "",
  actual_location: "",
  cap_date: "",
  gross_block: "",
  party_details: "",
  life_span: "",
  pm_equipment_id: "",
  inventory_count: "",
  physical_count: "",
  last_verification_date: "",
  created_at: "",
  source_type: "",
}

const listToolbarBtnClass = "h-9 shrink-0 gap-1.5 px-3"
const columnFilterControlClass =
  "h-7 w-full min-w-24 px-2 py-0 text-xs font-normal normal-case tracking-normal"

function formatMasterLabel(_code: string | null | undefined, name: string | null | undefined): string {
  const n = name?.trim()
  if (n) return n
  return _code?.trim() || "—"
}

function formatListDate(value: string | null | undefined): string {
  return formatAppDate(value)
}

function assetListCell(row: AssetListItem, key: AssetListColumnKey): React.ReactNode {
  switch (key) {
    case "asset_code":
      return <span className="font-mono text-xs font-medium text-foreground">{row.asset_code || "—"}</span>
    case "combined_asset_number":
      return (
        <span className="font-mono text-xs font-medium text-foreground">
          {row.combined_asset_number || "—"}
        </span>
      )
    case "asset_name":
      return (
        <span className="block max-w-[14rem] truncate font-medium text-foreground" title={row.asset_name}>
          {row.asset_name}
        </span>
      )
    case "rfid_code":
      return row.rfid_code?.trim() ? (
        <span className="font-mono text-xs text-foreground" title={row.rfid_code}>
          {row.rfid_code}
        </span>
      ) : (
        <span className="text-muted-foreground">Not tagged</span>
      )
    case "category_name":
      return row.category_name ?? "—"
    case "sub_no":
      return row.sub_no?.trim() || "—"
    case "asset_class":
      return row.asset_class_name?.trim() || row.asset_class?.trim() || "—"
    case "asset_type":
      return row.asset_type?.trim() || "—"
    case "asset_condition":
      return row.asset_condition_name?.trim() || "—"
    case "asset_custodian":
      return row.asset_custodian_name?.trim() || "—"
    case "plant_code":
      return (
        <span className="font-mono text-xs text-foreground">{row.plant_code?.trim() || "—"}</span>
      )
    case "plant_name":
      return row.plant_name?.trim() || "—"
    case "cost_center":
      return (
        <span className="font-mono text-xs text-foreground">{row.cost_center?.trim() || "—"}</span>
      )
    case "cost_center_name":
      return (
        <span
          className="block max-w-[14rem] truncate"
          title={row.cost_center_description ?? undefined}
        >
          {row.cost_center_description?.trim() || "—"}
        </span>
      )
    case "functional_location":
      return formatMasterLabel(row.functional_location, row.functional_location_description)
    case "actual_location":
      return formatMasterLabel(row.actual_location, row.actual_location_description)
    case "cap_date":
      return formatListDate(row.cap_date)
    case "gross_block":
      return row.gross_block == null || row.gross_block === "" ? "—" : String(row.gross_block)
    case "party_details":
      return (
        <span className="block max-w-[14rem] truncate" title={row.party_details ?? undefined}>
          {row.party_details?.trim() || "—"}
        </span>
      )
    case "life_span":
      return row.life_span?.trim() || "—"
    case "pm_equipment_id":
      return row.pm_equipment_id?.trim() || "—"
    case "inventory_count":
      return row.inventory_count ?? "—"
    case "physical_count":
      return row.physical_count ?? 0
    case "last_verification_date":
      return formatListDate(row.last_verification_date)
    case "lifecycle_status":
      return (
        <AdminPillBadge tone={assetStatusPillTone(row.lifecycle_status, row.approval_status)}>
          {assetStatusLabel(row.lifecycle_status, row.approval_status)}
        </AdminPillBadge>
      )
  }
}

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return ""
  return iso.slice(0, 10)
}

function countActiveFilters(
  f: AssetListFilters,
  isFy: boolean,
  currentFyStartYear: number | null,
  defaultScanFrom: string,
  defaultScanTo: string,
): number {
  let n = 0
  if (f.plant_id) n += 1
  if (f.category_id) n += 1
  if (isFy) {
    if (f.fy_start_year && currentFyStartYear && Number(f.fy_start_year) !== currentFyStartYear) {
      n += 1
    }
    if (f.fy_scan_from && f.fy_scan_from !== defaultScanFrom) n += 1
    if (f.fy_scan_to && f.fy_scan_to !== defaultScanTo) n += 1
  } else {
    if (assetStatusFilterValue(f.lifecycle_status, f.approval_status)) n += 1
    if (f.rfid_status) n += 1
  }
  return n
}

function buildQueryParams(
  page: number,
  search: string,
  filters: AssetListFilters,
  listTab: AssetListTab,
  fySubTab: AssetFySubTab,
  scanFrom: string,
  scanTo: string,
  columnFilters: AssetColumnFilters,
): URLSearchParams {
  const q = new URLSearchParams({ page: String(page), page_size: "20" })
  if (search.trim()) q.set("search", search.trim())
  if (filters.plant_id) q.set("plant_id", filters.plant_id)
  if (filters.category_id) q.set("category_id", filters.category_id)
  // Approval tabs own approval_status — ignore conflicting Status/Approval column filters.
  const tabMeta = ASSET_APPROVAL_STATUS_TABS.find((t) => t.key === listTab)
  const tabApproval = tabMeta?.approval_status ?? ""
  if (tabApproval) {
    q.set("approval_status", tabApproval)
  } else {
    if (filters.lifecycle_status) q.set("lifecycle_status", filters.lifecycle_status)
    if (filters.approval_status) q.set("approval_status", filters.approval_status)
  }
  if (listTab !== "fy" && filters.rfid_status) q.set("rfid_status", filters.rfid_status)
  if (listTab === "fy") {
    q.set("fy_verification", fySubTab)
    if (filters.fy_start_year) q.set("fy_start_year", filters.fy_start_year)
    if (scanFrom) q.set("fy_scan_from", scanFrom)
    if (scanTo) q.set("fy_scan_to", scanTo)
  }
  if (filters.sort_by) q.set("sort_by", filters.sort_by)
  if (filters.sort_dir) q.set("sort_dir", filters.sort_dir)
  for (const [key, value] of Object.entries(columnFilters)) {
    if (value.trim()) q.set(key, value.trim())
  }
  return q
}

function fyVerifiedEligibleIdsFrom(res: ValidateAssetsResponse): number[] {
  const eligibleSet = new Set(res.eligible_asset_ids)
  return res.already_verified_in_fy
    .filter((a) => eligibleSet.has(a.asset_id))
    .map((a) => a.asset_id)
}

function hasOrderCreateWarnings(res: ValidateAssetsResponse): boolean {
  return (
    res.active_order_conflicts.length > 0 ||
    (res.not_approved?.length ?? 0) > 0 ||
    res.missing_rfid.length > 0 ||
    res.plant_mismatch.length > 0 ||
    res.cost_center_mismatch.length > 0 ||
    fyVerifiedEligibleIdsFrom(res).length > 0
  )
}

function hasBlockingOrderMismatch(res: ValidateAssetsResponse): boolean {
  return (
    res.active_order_conflicts.length > 0 ||
    res.plant_mismatch.length > 0 ||
    res.cost_center_mismatch.length > 0
  )
}

function warningIdentity(
  ref: { asset_id: number; asset_code: string; asset_name: string },
  byId: Map<number, AssetListItem>,
): { number: string; name: string } {
  const row = byId.get(ref.asset_id)
  const number = (
    row?.asset_code ||
    ref.asset_code ||
    row?.combined_asset_number ||
    ""
  ).trim()
  const name = (row?.asset_name || ref.asset_name || "").trim()
  return { number: number || "—", name: name || "—" }
}

function collectOrderWarningRows(
  res: ValidateAssetsResponse,
  byId: Map<number, AssetListItem>,
): { assetId: number; number: string; name: string; issues: string[] }[] {
  const rows = new Map<number, { assetId: number; number: string; name: string; issues: string[] }>()
  const ensure = (ref: { asset_id: number; asset_code: string; asset_name: string }) => {
    const existing = rows.get(ref.asset_id)
    if (existing) return existing
    const id = warningIdentity(ref, byId)
    const created = { assetId: ref.asset_id, number: id.number, name: id.name, issues: [] as string[] }
    rows.set(ref.asset_id, created)
    return created
  }
  const addIssue = (
    ref: { asset_id: number; asset_code: string; asset_name: string },
    issue: string,
  ) => {
    const row = ensure(ref)
    if (!row.issues.includes(issue)) row.issues.push(issue)
  }

  const ordersByAsset = new Map<
    number,
    { ref: { asset_id: number; asset_code: string; asset_name: string }; parts: string[] }
  >()
  for (const c of res.active_order_conflicts) {
    const kind = c.order_kind ? `${c.order_kind} ` : ""
    const part = `${kind}${c.order_number} (${orderStatusLabel(c.order_status)})`
    const cur = ordersByAsset.get(c.asset_id)
    if (cur) {
      if (!cur.parts.includes(part)) cur.parts.push(part)
    } else {
      ordersByAsset.set(c.asset_id, { ref: c, parts: [part] })
    }
  }
  for (const { ref, parts } of ordersByAsset.values()) {
    addIssue(
      ref,
      `Still on ${parts.join(", ")}. Another order is allowed once the step before Close is done.`,
    )
  }
  for (const a of res.not_approved ?? []) addIssue(a, "Not approved")
  for (const a of res.missing_rfid) addIssue(a, "No RFID tag")
  for (const a of res.plant_mismatch) addIssue(a, "Different plant")
  for (const a of res.cost_center_mismatch) addIssue(a, "Outside your cost centers")
  const fyOk = new Set(res.eligible_asset_ids)
  for (const a of res.already_verified_in_fy) {
    if (!fyOk.has(a.asset_id)) continue
    const when = a.last_verification_date ? ` on ${formatAppDate(a.last_verification_date)}` : ""
    const fy = res.financial_year_label ? ` (${res.financial_year_label})` : ""
    addIssue(a, `Already verified${when}${fy}`)
  }
  return [...rows.values()]
}

export function AssetsListPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [listTab, setListTab] = useUrlTab(ASSET_LIST_TAB_KEYS, "approved")
  const [fySubTab, setFySubTab] = useUrlTab(FY_SUB_TAB_KEYS, "verified", "fy_sub")
  const approvalTab = ASSET_APPROVAL_STATUS_TABS.find((t) => t.key === listTab)
  const initialRfidStatus = searchParams.get("rfid_status")
  const validInitialRfid =
    initialRfidStatus === "tagged" || initialRfidStatus === "not_tagged" ? initialRfidStatus : ""
  const initialAllFilters: AssetListFilters = {
    ...DEFAULT_FILTERS,
    rfid_status: listTab !== "fy" ? validInitialRfid : "",
    approval_status: approvalTab?.approval_status ?? "",
  }
  const [searchInput, setSearchInput] = useSessionState("assets:searchInput", "")
  const [search, setSearch] = useSessionState("assets:search", "")
  const [page, setPage] = useUrlPage()
  // Saved filters carry tab-owned fields (approval_status, FY sort), so only restore
  // them on the tab they were saved from; a `?rfid_status=` deep link always wins.
  const [filtersTab, setFiltersTab] = useSessionState<string>("assets:filtersTab", listTab)
  const restoreFilters = filtersTab === listTab && !validInitialRfid
  const [filters, setFilters] = useSessionState<AssetListFilters>(
    "assets:filters",
    listTab === "fy" ? DEFAULT_FY_FILTERS : initialAllFilters,
    restoreFilters,
  )
  const [draftFilters, setDraftFilters] = useSessionState<AssetListFilters>(
    "assets:draftFilters",
    listTab === "fy" ? DEFAULT_FY_FILTERS : initialAllFilters,
    restoreFilters,
  )
  React.useEffect(() => setFiltersTab(listTab), [listTab, setFiltersTab])
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const [columnFiltersOpen, setColumnFiltersOpen] = React.useState(false)
  const hadSavedColumnFilters = React.useRef(hasSessionState("assets:columnFilters")).current
  const [columnFilterInputs, setColumnFilterInputs] = useSessionState<AssetColumnFilters>(
    "assets:columnFilterInputs",
    DEFAULT_COLUMN_FILTERS,
  )
  const [columnFilters, setColumnFilters] = useSessionState<AssetColumnFilters>(
    "assets:columnFilters",
    DEFAULT_COLUMN_FILTERS,
  )
  const [costCenterOptions, setCostCenterOptions] = React.useState<
    { code: string; name: string | null }[]
  >([])
  const [functionalLocationOptions, setFunctionalLocationOptions] = React.useState<
    { code: string; name: string | null }[]
  >([])
  const [actualLocationOptions, setActualLocationOptions] = React.useState<
    { code: string; name: string | null }[]
  >([])
  // view_all + assigned CCs → pre-select one actionable CC once (user can clear to see all).
  const defaultCcAppliedRef = React.useRef(hadSavedColumnFilters)
  const canViewAllAssets = hasPermission("asset.view_all")
  const [defaultCcReady, setDefaultCcReady] = React.useState(!canViewAllAssets)

  React.useEffect(() => {
    const qs = draftFilters.plant_id
      ? `?plant_id=${encodeURIComponent(draftFilters.plant_id)}`
      : ""
    void getJson<{
      cost_centers: { code: string; name: string | null }[]
      functional_locations: { code: string; name: string | null }[]
      actual_locations: { code: string; name: string | null }[]
      assigned_cost_centers?: { code: string; name: string | null }[]
    }>(`/admin/assets/column-filter-options${qs}`)
      .then((res) => {
        setCostCenterOptions(res.cost_centers)
        setFunctionalLocationOptions(res.functional_locations)
        setActualLocationOptions(res.actual_locations)

        const assigned = res.assigned_cost_centers ?? []
        let preferredCc = ""
        if (canViewAllAssets && !defaultCcAppliedRef.current && assigned.length > 0) {
          defaultCcAppliedRef.current = true
          preferredCc =
            assigned.find((a) => res.cost_centers.some((c) => c.code === a.code))?.code ??
            assigned[0]?.code ??
            ""
        }

        setColumnFilterInputs((prev) => {
          const next = { ...prev }
          if (
            next.cost_center &&
            !res.cost_centers.some((c) => c.code === next.cost_center)
          ) {
            next.cost_center = ""
          }
          if (
            next.functional_location &&
            !res.functional_locations.some((c) => c.code === next.functional_location)
          ) {
            next.functional_location = ""
          }
          if (
            next.actual_location &&
            !res.actual_locations.some((c) => c.code === next.actual_location)
          ) {
            next.actual_location = ""
          }
          if (preferredCc && !next.cost_center) next.cost_center = preferredCc
          return next
        })
        setColumnFilters((prev) => {
          const next = { ...prev }
          if (
            next.cost_center &&
            !res.cost_centers.some((c) => c.code === next.cost_center)
          ) {
            next.cost_center = ""
          }
          if (
            next.functional_location &&
            !res.functional_locations.some((c) => c.code === next.functional_location)
          ) {
            next.functional_location = ""
          }
          if (
            next.actual_location &&
            !res.actual_locations.some((c) => c.code === next.actual_location)
          ) {
            next.actual_location = ""
          }
          if (preferredCc && !next.cost_center) next.cost_center = preferredCc
          return next
        })
      })
      .catch(() => {
        setCostCenterOptions([])
        setFunctionalLocationOptions([])
        setActualLocationOptions([])
        if (canViewAllAssets && !defaultCcAppliedRef.current) {
          defaultCcAppliedRef.current = true
        }
      })
      .finally(() => setDefaultCcReady(true))
  }, [draftFilters.plant_id, canViewAllAssets])
  const [restoredSelection] = React.useState(() => takeAssetMasterSelection())
  const [selected, setSelected] = React.useState<Set<number>>(
    () => new Set((restoredSelection ?? []).map((row) => row.id)),
  )
  const [selectedHasRfid, setSelectedHasRfid] = React.useState<Map<number, boolean>>(
    () =>
      new Map(
        (restoredSelection ?? []).map((row) => [row.id, Boolean(row.rfid_code?.trim())]),
      ),
  )
  const [selectionCache, setSelectionCache] = React.useState<Map<number, AssetListItem>>(
    () => new Map((restoredSelection ?? []).map((row) => [row.id, asAssetListItem(row)])),
  )

  function applyReturnedSelection(rows: AssetListItem[]) {
    setSelected(new Set(rows.map((row) => row.id)))
    setSelectedHasRfid(new Map(rows.map((row) => [row.id, Boolean(row.rfid_code?.trim())])))
    setSelectionCache(new Map(rows.map((row) => [row.id, asAssetListItem(row)])))
  }

  React.useLayoutEffect(() => {
    const rows = takeAssetMasterSelection()
    if (!rows?.length) return
    applyReturnedSelection(rows)
  }, [])

  // Keep the return selection for this visit. Drop it only after leaving Asset Master,
  // so opening the page again from another screen starts with nothing selected.
  React.useEffect(() => {
    return () => {
      window.setTimeout(() => {
        if (window.location.pathname === "/dashboard/assets") return
        clearAssetMasterSelection()
      }, 0)
    }
  }, [])
  const [bulkActionBusy, setBulkActionBusy] = React.useState(false)
  const [orderValidateBusy, setOrderValidateBusy] = React.useState(false)
  const [orderWarningsOpen, setOrderWarningsOpen] = React.useState(false)
  const [validationResult, setValidationResult] = React.useState<ValidateAssetsResponse | null>(null)
  const [transferBlockOpen, setTransferBlockOpen] = React.useState(false)
  const [transferBlockRows, setTransferBlockRows] = React.useState<
    { assetId: number; number: string; name: string; reason: string }[]
  >([])
  const [rfidDialogOpen, setRfidDialogOpen] = React.useState(false)
  const [rfidDialogIsUpdate, setRfidDialogIsUpdate] = React.useState(false)
  const [rfidDialogMode, setRfidDialogMode] = React.useState<"by-code" | "selected">("by-code")
  const [rfidAttachAssetId, setRfidAttachAssetId] = React.useState<number | null>(null)
  const [rfidAssetCode, setRfidAssetCode] = React.useState("")
  const [rfidValue, setRfidValue] = React.useState("")
  const [rfidTagColorId, setRfidTagColorId] = React.useState("")
  const [rfidSaving, setRfidSaving] = React.useState(false)
  const [fyExportBusy, setFyExportBusy] = React.useState<"xlsx" | "pdf" | null>(null)
  const [fyYearOptions, setFyYearOptions] = React.useState<FinancialYearOption[]>([])
  const [currentFyStartYear, setCurrentFyStartYear] = React.useState<number | null>(null)
  const [exportOpen, setExportOpen] = React.useState(false)
  const [submitAssignOpen, setSubmitAssignOpen] = React.useState(false)
  const [bulkDecisionOpen, setBulkDecisionOpen] = React.useState(false)
  const [bulkDecisionMode, setBulkDecisionMode] = React.useState<"approve" | "reject">("approve")
  const [columnsOpen, setColumnsOpen] = React.useState(false)
  const [visibleColumnKeys, setVisibleColumnKeys] = React.useState<AssetListColumnKey[]>(
    () => readStoredAssetListColumns() ?? DEFAULT_ASSET_LIST_COLUMN_KEYS,
  )
  const [columnsReady, setColumnsReady] = React.useState(
    () => readStoredAssetListColumns() != null,
  )
  const [draftColumnKeys, setDraftColumnKeys] = React.useState<Set<AssetListColumnKey>>(
    new Set(DEFAULT_ASSET_LIST_COLUMN_KEYS),
  )
  const [columnsSaving, setColumnsSaving] = React.useState(false)

  const filterPlantId = draftFilters.plant_id ? Number(draftFilters.plant_id) : null
  const masters = useAssetMasterLookups(filterPlantId, null, null)

  const canCreate = hasPermission("asset.create") || hasPermission("asset.manage")
  const canImport = hasPermission("asset.import")
  const canDelete = hasPermission("asset.delete") || hasPermission("asset.manage")
  const canCreateOrder = hasPermission("order.create")
  const canUpdate = hasPermission("asset.update") || hasPermission("asset.manage")
  const canAttachRfid = canUpdate
  const canDeactivate = hasPermission("asset.deactivate")
  const canReactivate = hasPermission("asset.reactivate")
  const canSubmitForApproval = canCreate
  const canDecide = hasPermission("approval.act")
  const { ask: confirmAsk, dialog: confirmDialog } = useConfirmDialog()
  const isFyTab = listTab === "fy"
  const canCreateTransfer = hasPermission("transfer.create") && !isFyTab
  const canCreateDisposal = hasPermission("disposal.create") && !isFyTab
  const showAttachRfid = canAttachRfid && !isFyTab
  const selectedFyStartYear =
    filters.fy_start_year || (currentFyStartYear != null ? String(currentFyStartYear) : "")
  const selectedFyOption = fyYearOptions.find((o) => String(o.start_year) === selectedFyStartYear)
  const defaultScanFrom = toDateInputValue(selectedFyOption?.start)
  const defaultScanTo = toDateInputValue(
    selectedFyOption?.is_current ? new Date().toISOString() : selectedFyOption?.end,
  )
  const effectiveScanFrom = filters.fy_scan_from || defaultScanFrom
  const effectiveScanTo = filters.fy_scan_to || defaultScanTo
  const activeFilterCount = countActiveFilters(
    filters,
    isFyTab,
    currentFyStartYear,
    defaultScanFrom,
    defaultScanTo,
  )
  const activeColumnFilterCount =
    Object.values(columnFilters).filter((value) => value.trim()).length +
    (filters.category_id ? 1 : 0) +
    (assetStatusFilterValue(filters.lifecycle_status, filters.approval_status) ? 1 : 0)

  const visibleColumns = React.useMemo(() => {
    const selected = new Set(visibleColumnKeys)
    return ASSET_LIST_COLUMNS.filter((column) => selected.has(column.key))
  }, [visibleColumnKeys])

  function scanRangeForOption(option: FinancialYearOption | undefined) {
    if (!option) return { from: "", to: "" }
    const from = toDateInputValue(option.start)
    const to = toDateInputValue(option.is_current ? new Date().toISOString() : option.end)
    return { from, to }
  }

  React.useEffect(() => {
    void getJson<AssetListColumnsPreference>("/admin/assets/list-columns")
      .then((preference) => {
        const allowed = new Set(ASSET_LIST_COLUMNS.map((column) => column.key))
        const columns = preference.columns.flatMap((key): AssetListColumnKey[] => {
          if ((key as string) === "plant") return ["plant_code", "plant_name"]
          return allowed.has(key) ? [key] : []
        })
        if (columns.length > 0) {
          sessionStorage.setItem(ASSET_LIST_COLUMNS_CACHE_KEY, JSON.stringify(columns))
          setVisibleColumnKeys((prev) =>
            prev.length === columns.length && prev.every((key, i) => key === columns[i])
              ? prev
              : columns,
          )
        }
      })
      .catch((e) =>
        toast.error(e instanceof Error ? e.message : "Failed to load column preferences"),
      )
      .finally(() => setColumnsReady(true))
  }, [])

  React.useEffect(() => {
    if (!isFyTab) return
    void getJson<FinancialYearListResponse>("/admin/assets/financial-years")
      .then((res) => {
        setFyYearOptions(res.items)
        setCurrentFyStartYear(res.current_start_year)
        const running = res.items.find((o) => o.is_current) ?? res.items[0]
        if (running && !filters.fy_scan_from && !filters.fy_scan_to) {
          const { from, to } = scanRangeForOption(running)
          setFilters((f) => ({ ...f, fy_scan_from: from, fy_scan_to: to }))
          setDraftFilters((f) => ({ ...f, fy_scan_from: from, fy_scan_to: to }))
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load financial years"))
  }, [isFyTab])

  const assetListQueryKey = React.useMemo(
    () =>
      [
        ...assetListRootKey,
        {
          page,
          search,
          filters,
          listTab,
          fySubTab,
          effectiveScanFrom,
          effectiveScanTo,
          columnFilters,
        },
      ] as const,
    [page, search, filters, listTab, fySubTab, effectiveScanFrom, effectiveScanTo, columnFilters],
  )

  const assetsQuery = useQuery({
    queryKey: assetListQueryKey,
    queryFn: async () => {
      const q = buildQueryParams(
        page,
        search,
        filters,
        listTab,
        fySubTab,
        effectiveScanFrom,
        effectiveScanTo,
        columnFilters,
      )
      return getJson<AssetListResponse>(`/admin/assets?${q}`)
    },
    staleTime: LIST_STALE_MS,
    enabled: defaultCcReady,
  })

  const data = assetsQuery.data ?? null
  const loading = !columnsReady || (assetsQuery.isPending && !assetsQuery.data)

  React.useEffect(() => {
    if (assetsQuery.error) {
      toast.error(
        assetsQuery.error instanceof Error ? assetsQuery.error.message : "Failed to load assets",
      )
    }
  }, [assetsQuery.error])

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch((prev) => {
        if (prev === searchInput) return prev
        setPage(1)
        return searchInput
      })
    }, 300)
    return () => window.clearTimeout(t)
  }, [searchInput, setPage])

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setColumnFilters((prev) => {
        const changed = Object.entries(columnFilterInputs).some(
          ([k, v]) => prev[k as keyof AssetColumnFilters] !== v,
        )
        if (!changed) return prev
        setPage(1)
        return { ...columnFilterInputs }
      })
    }, 300)
    return () => window.clearTimeout(t)
  }, [columnFilterInputs])

  function applyFilters() {
    if (!isFyTab) {
      const approval = draftFilters.approval_status
      const matchingTab = ASSET_APPROVAL_STATUS_TABS.find(
        (t) => t.key !== "all" && t.approval_status === approval,
      )
      setListTab(matchingTab?.key ?? "all")
    }
    setFilters(draftFilters)
    setPage(1)
    setFiltersOpen(false)
  }

  function setColumnPanelFilter(
    field: "category_id" | "lifecycle_status" | "plant_id" | "approval_status",
    value: string,
  ) {
    if (field === "approval_status") {
      const matchingTab = ASSET_APPROVAL_STATUS_TABS.find(
        (t) => t.key !== "all" && t.approval_status === value,
      )
      setListTab(matchingTab?.key ?? "all")
      setFilters((f) => ({ ...f, approval_status: value, lifecycle_status: "" }))
      setDraftFilters((f) => ({ ...f, approval_status: value, lifecycle_status: "" }))
      setPage(1)
      return
    }
    setFilters((f) => ({ ...f, [field]: value }))
    setDraftFilters((f) => ({ ...f, [field]: value }))
    setPage(1)
  }

  /** Status column filter — matches badge labels (Draft / Approved / …). */
  function setStatusColumnFilter(value: string) {
    const opt = value ? assetStatusFilterOption(value) : null
    const lifecycle_status = opt?.lifecycle_status ?? ""
    const approval_status = opt?.approval_status ?? ""
    setFilters((f) => ({ ...f, lifecycle_status, approval_status }))
    setDraftFilters((f) => ({ ...f, lifecycle_status, approval_status }))
    const matchingTab = ASSET_APPROVAL_STATUS_TABS.find(
      (t) => t.key !== "all" && t.approval_status === approval_status,
    )
    setListTab(matchingTab?.key ?? "all")
    setPage(1)
  }

  function toggleColumnSort(key: AssetListColumnKey) {
    setFilters((f) => {
      const next = nextColumnSort(f.sort_by, f.sort_dir, key, defaultSortDirForColumn(key))
      setDraftFilters((d) => ({ ...d, sort_by: next.sort_by, sort_dir: next.sort_dir }))
      return { ...f, sort_by: next.sort_by, sort_dir: next.sort_dir }
    })
    setPage(1)
  }

  function columnFilterControl(key: AssetListColumnKey): React.ReactNode {
    if (
      key === "asset_code" ||
      key === "combined_asset_number" ||
      key === "asset_name" ||
      key === "rfid_code" ||
      key === "sub_no" ||
      key === "asset_type" ||
      key === "asset_custodian" ||
      key === "party_details" ||
      key === "life_span" ||
      key === "pm_equipment_id" ||
      key === "gross_block"
    ) {
      const columnLabel =
        ASSET_LIST_COLUMNS.find((column) => column.key === key)?.label ?? key.replaceAll("_", " ")
      return (
        <Input
          value={columnFilterInputs[key]}
          onChange={(e) => setColumnFilterInputs((f) => ({ ...f, [key]: e.target.value }))}
          aria-label={`Filter ${columnLabel}`}
          placeholder={columnLabel}
          className={columnFilterControlClass}
        />
      )
    }
    if (key === "category_name") {
      return (
        <select
          className={cn(adminSelectClass, columnFilterControlClass)}
          value={filters.category_id}
          aria-label="Filter category"
          onChange={(e) => setColumnPanelFilter("category_id", e.target.value)}
        >
          <option value="">Category</option>
          {masters.categories.map((category) => (
            <option key={category.id} value={String(category.id)}>
              {categoryLabel(category)}
            </option>
          ))}
        </select>
      )
    }
    if (key === "cost_center" || key === "cost_center_name") {
      return (
        <select
          className={cn(adminSelectClass, columnFilterControlClass)}
          value={columnFilterInputs.cost_center}
          aria-label={key === "cost_center" ? "Filter cost center code" : "Filter cost center name"}
          onChange={(e) =>
            setColumnFilterInputs((f) => ({ ...f, cost_center: e.target.value }))
          }
        >
          <option value="">
            {key === "cost_center_name" ? "Cost Center Name" : "Cost Center Code"}
          </option>
          {costCenterOptions.map((costCenter) => (
            <option key={costCenter.code} value={costCenter.code}>
              {key === "cost_center_name"
                ? costCenter.name || costCenter.code
                : costCenter.code}
            </option>
          ))}
        </select>
      )
    }
    if (key === "functional_location") {
      return (
        <select
          className={cn(adminSelectClass, columnFilterControlClass)}
          value={columnFilterInputs.functional_location}
          aria-label="Filter actual location 1"
          onChange={(e) =>
            setColumnFilterInputs((f) => ({ ...f, functional_location: e.target.value }))
          }
        >
          <option value="">Actual Location 1</option>
          {functionalLocationOptions.map((location) => (
            <option key={location.code} value={location.code}>
              {location.name ? `${location.code} — ${location.name}` : location.code}
            </option>
          ))}
        </select>
      )
    }
    if (key === "lifecycle_status") {
      return (
        <select
          className={cn(adminSelectClass, columnFilterControlClass)}
          value={assetStatusFilterValue(filters.lifecycle_status, filters.approval_status)}
          aria-label="Filter status"
          onChange={(e) => setStatusColumnFilter(e.target.value)}
        >
          <option value="">Status</option>
          {ASSET_STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )
    }
    if (key === "plant_code" || key === "plant_name") {
      return (
        <select
          className={cn(adminSelectClass, columnFilterControlClass)}
          value={filters.plant_id}
          aria-label={key === "plant_code" ? "Filter plant code" : "Filter plant name"}
          onChange={(e) => setColumnPanelFilter("plant_id", e.target.value)}
        >
          <option value="">{key === "plant_code" ? "Plant Code" : "Plant Name"}</option>
          {masters.plants.map((p) => (
            <option key={p.id} value={String(p.id)}>
              {key === "plant_code" ? p.code : p.name || p.code}
            </option>
          ))}
        </select>
      )
    }
    if (key === "actual_location") {
      return (
        <select
          className={cn(adminSelectClass, columnFilterControlClass)}
          value={columnFilterInputs.actual_location}
          aria-label="Filter actual location 2"
          onChange={(e) =>
            setColumnFilterInputs((f) => ({ ...f, actual_location: e.target.value }))
          }
        >
          <option value="">Actual Location 2</option>
          {actualLocationOptions.map((location) => (
            <option key={location.code} value={location.code}>
              {location.name ? `${location.code} — ${location.name}` : location.code}
            </option>
          ))}
        </select>
      )
    }
    if (key === "inventory_count" || key === "physical_count") {
      const label = key === "inventory_count" ? "Inventory Count" : "Physical Count"
      return (
        <Input
          type="number"
          min={0}
          value={columnFilterInputs[key]}
          onChange={(e) => setColumnFilterInputs((f) => ({ ...f, [key]: e.target.value }))}
          aria-label={`Filter ${label}`}
          placeholder={label}
          className={columnFilterControlClass}
        />
      )
    }
    if (key === "asset_class") {
      return (
        <select
          className={cn(adminSelectClass, columnFilterControlClass)}
          value={columnFilterInputs.asset_class}
          aria-label="Filter asset class"
          onChange={(e) =>
            setColumnFilterInputs((f) => ({ ...f, asset_class: e.target.value }))
          }
        >
          <option value="">Asset Class</option>
          {masters.assetClasses.map((assetClass) => (
            <option key={assetClass.id} value={String(assetClass.id)}>
              {assetClassLabel(assetClass)}
            </option>
          ))}
        </select>
      )
    }
    if (key === "asset_condition") {
      return (
        <select
          className={cn(adminSelectClass, columnFilterControlClass)}
          value={columnFilterInputs.asset_condition}
          aria-label="Filter asset physical condition"
          onChange={(e) =>
            setColumnFilterInputs((f) => ({ ...f, asset_condition: e.target.value }))
          }
        >
          <option value="">Asset Physical Condition</option>
          {masters.assetConditions.map((condition) => (
            <option key={condition.id} value={String(condition.id)}>
              {assetConditionLabel(condition)}
            </option>
          ))}
        </select>
      )
    }
    if (key === "last_verification_date" || key === "cap_date") {
      const label = key === "cap_date" ? "Capitalization Date" : "Last Verification"
      return (
        <Input
          type="date"
          value={columnFilterInputs[key]}
          onChange={(e) => setColumnFilterInputs((f) => ({ ...f, [key]: e.target.value }))}
          aria-label={`Filter ${label}`}
          className={columnFilterControlClass}
        />
      )
    }
    return null
  }

  function clearFilters() {
    if (isFyTab) {
      const next = { ...DEFAULT_FY_FILTERS }
      setDraftFilters(next)
      setFilters(next)
    } else {
      // Approval tabs own approval_status — clearing filters returns to All assets.
      setListTab("all")
      const next = { ...DEFAULT_FILTERS }
      setDraftFilters(next)
      setFilters(next)
    }
    setColumnFilterInputs({ ...DEFAULT_COLUMN_FILTERS })
    setColumnFilters({ ...DEFAULT_COLUMN_FILTERS })
    setPage(1)
  }

  function openColumnsDialog() {
    setDraftColumnKeys(new Set(visibleColumnKeys))
    setColumnsOpen(true)
  }

  function toggleListColumn(key: AssetListColumnKey, checked: boolean) {
    setDraftColumnKeys((current) => {
      const next = new Set(current)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  async function saveColumnPreferences() {
    const columns = ASSET_LIST_COLUMNS.map((column) => column.key).filter((key) =>
      draftColumnKeys.has(key),
    )
    if (columns.length === 0) return
    setColumnsSaving(true)
    try {
      const saved = await putJson<AssetListColumnsPreference>("/admin/assets/list-columns", {
        columns,
      })
      setVisibleColumnKeys(saved.columns)
      sessionStorage.setItem(ASSET_LIST_COLUMNS_CACHE_KEY, JSON.stringify(saved.columns))
      setColumnsOpen(false)
      toast.success("Asset List Columns Saved")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save column preferences")
    } finally {
      setColumnsSaving(false)
    }
  }

  function applyFyYear(value: string) {
    const option = fyYearOptions.find((o) => String(o.start_year) === value)
    const { from, to } = scanRangeForOption(option)
    const fyYear = value === String(currentFyStartYear) ? "" : value
    setFilters((f) => ({ ...f, fy_start_year: fyYear, fy_scan_from: from, fy_scan_to: to }))
    setDraftFilters((f) => ({ ...f, fy_start_year: fyYear, fy_scan_from: from, fy_scan_to: to }))
    setPage(1)
    clearSelection()
  }

  function applyScanDate(field: "fy_scan_from" | "fy_scan_to", value: string) {
    setDraftFilters((f) => ({ ...f, [field]: value }))
  }

  function onDraftFyYearChange(value: string) {
    const option = fyYearOptions.find((o) => String(o.start_year) === value)
    const { from, to } = scanRangeForOption(option)
    setDraftFilters((f) => ({
      ...f,
      fy_start_year: value === String(currentFyStartYear) ? "" : value,
      fy_scan_from: from,
      fy_scan_to: to,
    }))
  }

  async function exportFyReport(format: "xlsx" | "pdf") {
    setFyExportBusy(format)
    try {
      const q = buildQueryParams(
        1,
        search,
        filters,
        "fy",
        fySubTab,
        effectiveScanFrom,
        effectiveScanTo,
        columnFilters,
      )
      q.set("format", format)
      await downloadFile(
        `/admin/assets/fy-verification/export?${q.toString()}`,
        `fy-physical-verification.${format === "xlsx" ? "xlsx" : "pdf"}`,
      )
      toast.success(`${format === "xlsx" ? "Excel" : "PDF"} report downloaded`)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Export failed")
    } finally {
      setFyExportBusy(null)
    }
  }

  function clearSelection() {
    setSelected(new Set())
    setSelectedHasRfid(new Map())
    setSelectionCache(new Map())
  }

  function rememberRow(row: AssetListItem | undefined, on: boolean) {
    if (!row) return
    setSelectionCache((prev) => {
      const next = new Map(prev)
      if (on) next.set(row.id, row)
      else next.delete(row.id)
      return next
    })
  }

  function toggleRow(id: number, on: boolean) {
    const row = data?.items.find((item) => item.id === id)
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
    setSelectedHasRfid((prev) => {
      const next = new Map(prev)
      if (on) next.set(id, Boolean(row?.rfid_code?.trim()))
      else next.delete(id)
      return next
    })
    rememberRow(row, on)
  }

  function toggleAll(on: boolean) {
    if (!data) return
    const pageIds = data.items.filter((item) => canActOnAsset(item)).map((item) => item.id)
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) {
        for (const id of pageIds) next.add(id)
      } else {
        for (const id of pageIds) next.delete(id)
      }
      return next
    })
    setSelectedHasRfid((prev) => {
      const next = new Map(prev)
      if (on) {
        for (const row of data.items) {
          next.set(row.id, Boolean(row.rfid_code?.trim()))
        }
      } else {
        for (const id of pageIds) next.delete(id)
      }
      return next
    })
    setSelectionCache((prev) => {
      const next = new Map(prev)
      if (on) {
        for (const row of data.items) {
          if (canActOnAsset(row)) next.set(row.id, row)
        }
      } else {
        for (const id of pageIds) next.delete(id)
      }
      return next
    })
  }

  const items = data?.items ?? []
  const actionableItems = items.filter((row) => canActOnAsset(row))
  const pageSelectedCount = actionableItems.filter((row) => selected.has(row.id)).length
  const allPageSelected = actionableItems.length > 0 && pageSelectedCount === actionableItems.length
  const somePageSelected = pageSelectedCount > 0 && !allPageSelected
  const selectedRows = React.useMemo(() => {
    const byId = new Map(selectionCache)
    for (const item of items) {
      if (selected.has(item.id)) byId.set(item.id, item)
    }
    return [...selected]
      .map((id) => byId.get(id))
      .filter((row): row is AssetListItem => row != null)
  }, [items, selected, selectionCache])
  const selectedById = React.useMemo(
    () => new Map(selectedRows.map((row) => [row.id, row])),
    [selectedRows],
  )
  const rfidTaggedCount = React.useMemo(() => {
    let count = 0
    for (const id of selected) {
      const known = selectedHasRfid.get(id)
      if (known != null) {
        if (known) count += 1
        continue
      }
      const row = items.find((item) => item.id === id)
      if (row?.rfid_code?.trim()) count += 1
    }
    return count
  }, [selected, selectedHasRfid, items])
  const physicalOrderEligibleRows = React.useMemo(
    () => eligiblePhysicalOrderAssets(selectedRows),
    [selectedRows],
  )
  const submitEligibleRows = React.useMemo(
    () => eligibleSubmitAssets(selectedRows),
    [selectedRows],
  )
  const decisionEligibleRows = React.useMemo(
    () => eligibleDecisionAssets(selectedRows),
    [selectedRows],
  )
  const deactivateEligibleRows = React.useMemo(
    () => eligibleDeactivateAssets(selectedRows),
    [selectedRows],
  )
  const deleteEligibleRows = React.useMemo(
    () => eligibleDeleteAssets(selectedRows),
    [selectedRows],
  )
  const reactivateEligibleRows = React.useMemo(
    () => eligibleReactivateAssets(selectedRows),
    [selectedRows],
  )
  const viewerUserId = currentUserId()
  const transferEligibleRows = React.useMemo(() => {
    const approved = selectedRows.filter((r) => {
      if (!canActOnAsset(r)) return false
      const approval = (r.approval_status ?? "").trim().toLowerCase()
      if (!mayRequestNewOrder(r.lifecycle_status)) return false
      return approval === "approved" || approval === "not_required"
    })
    if (isSuperuser()) return approved
    if (viewerUserId == null) return []
    return approved.filter((r) => r.asset_custodian_id === viewerUserId)
  }, [selectedRows, viewerUserId])
  const listActions = React.useMemo(
    () =>
      buildAssetListActionItems({
        selectedCount: selected.size,
        rfidTaggedCount,
        physicalOrderEligibleCount: physicalOrderEligibleRows.length,
        submitEligibleCount: submitEligibleRows.length,
        deactivateEligibleCount: deactivateEligibleRows.length,
        reactivateEligibleCount: reactivateEligibleRows.length,
        deleteEligibleCount: deleteEligibleRows.length,
        transferEligibleCount: transferEligibleRows.length,
        disposalEligibleCount: transferEligibleRows.length,
        canDelete,
        canDeactivate: canDeactivate && !isFyTab,
        canReactivate: canReactivate && !isFyTab,
        canAttachRfid: showAttachRfid,
        canCreateOrder,
        canCreateTransfer,
        canCreateDisposal,
        canSubmitForApproval,
      }),
    [
      selected.size,
      rfidTaggedCount,
      physicalOrderEligibleRows.length,
      submitEligibleRows.length,
      deactivateEligibleRows.length,
      reactivateEligibleRows.length,
      deleteEligibleRows.length,
      transferEligibleRows.length,
      canDelete,
      canUpdate,
      canDeactivate,
      canReactivate,
      isFyTab,
      showAttachRfid,
      canCreateOrder,
      canCreateTransfer,
      canCreateDisposal,
      canSubmitForApproval,
    ],
  )

  const attachRfidRow = selectedRows.length === 1 ? selectedRows[0] : null

  function openAttachRfidFromSelection() {
    const row = attachRfidRow
    if (!row) return
    setRfidDialogMode("selected")
    setRfidAttachAssetId(row.id)
    setRfidAssetCode("")
    setRfidValue(row.rfid_code?.trim() ?? "")
    setRfidTagColorId(row.tag_color_id != null ? String(row.tag_color_id) : "")
    setRfidDialogIsUpdate(Boolean(row.rfid_code?.trim()))
    setRfidDialogOpen(true)
  }

  function rfidPayloadExtras() {
    return {
      tag_color_id: rfidTagColorId ? Number(rfidTagColorId) : null,
    }
  }

  async function saveAttachedRfid() {
    const rfid = rfidValue.trim()
    if (!rfid) {
      toast.error("Enter or scan an RFID code.")
      return
    }
    if (rfidDialogMode === "by-code") {
      const assetCode = rfidAssetCode.trim()
      if (!assetCode) {
        toast.error("Enter the asset code.")
        return
      }
      setRfidSaving(true)
      try {
        const res = await postJson<AssetRfidAttachResult>("/admin/assets/rfid/attach-by-code", {
          asset_code: assetCode,
          rfid_code: rfid,
          ...rfidPayloadExtras(),
        })
        toast.success(formatRfidAttachSuccess(res))
        setRfidDialogOpen(false)
        await invalidateAssetLists()
      } catch (e) {
        toast.error(formatRfidAttachError(e, "Failed to attach RFID."))
      } finally {
        setRfidSaving(false)
      }
      return
    }

    if (rfidAttachAssetId == null) return
    setRfidSaving(true)
    try {
      const res = await postJson<AssetRfidAttachResult>(
        `/admin/assets/${rfidAttachAssetId}/rfid/attach`,
        { rfid_code: rfid, ...rfidPayloadExtras() },
      )
      toast.success(formatRfidAttachSuccess(res))
      setRfidDialogOpen(false)
      await invalidateAssetLists()
    } catch (e) {
      toast.error(formatRfidAttachError(e, "Failed to attach RFID."))
    } finally {
      setRfidSaving(false)
    }
  }

  function openBulkSubmit() {
    if (submitEligibleRows.length === 0) {
      toast.error(
        "Select at least one draft or rejected asset to submit for approval.",
      )
      return
    }
    setSubmitAssignOpen(true)
  }

  async function submitSelectedWithAssignee(userId: number) {
    const ids = submitEligibleRows.map((r) => r.id)
    if (ids.length === 0) return
    setBulkActionBusy(true)
    try {
      const res = await postJson<SubmitForApprovalResult>("/admin/assets/submit-for-approval", {
        asset_ids: ids,
        assignee_user_id: userId,
      })
      const single =
        ids.length === 1 && submitEligibleRows[0]
          ? {
              assetCode: submitEligibleRows[0].asset_code,
              assetName: submitEligibleRows[0].asset_name,
            }
          : undefined
      const success = formatSubmitForApprovalSuccess(res, single)
      if (res.errors?.length) {
        toast.error(formatSubmitForApprovalError(res.errors[0]))
      }
      if (success) {
        toast.success(success)
        setSubmitAssignOpen(false)
        clearSelection()
        await invalidateAssetLists()
      } else if (!res.errors?.length) {
        toast.error("No Asset were submitted for approval.")
      }
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Could not submit assets for approval. Please try again.",
      )
    } finally {
      setBulkActionBusy(false)
    }
  }

  function openBulkDecision(mode: "approve" | "reject") {
    if (decisionEligibleRows.length === 0) {
      toast.error("No selected assets are pending approval assigned to you.")
      return
    }
    if (mode === "reject" && selected.size !== 1) {
      toast.error("Reject one asset at a time.")
      return
    }
    setBulkDecisionMode(mode)
    setBulkDecisionOpen(true)
  }

  async function confirmBulkDecision(payload: {
    comment: string | null
    nextAssignedUserId: number | null
  }) {
    const ids = decisionEligibleRows.map((r) => r.id)
    const comment = (payload.comment || "").trim()
    if (!comment) {
      toast.error(bulkDecisionMode === "approve" ? "Comment is required." : "Reason is required.")
      return
    }
    if (ids.length === 0) return
    setBulkActionBusy(true)
    try {
      const res = await postJson<{ processed_count: number; errors: string[] }>(
        "/admin/assets/bulk-decision",
        {
          asset_ids: ids,
          action: bulkDecisionMode,
          comment,
        },
      )
      if (res.processed_count > 0) {
        toast.success(
          bulkDecisionMode === "approve"
            ? `Approved.`
            : `Rejected.`,
        )
        setBulkDecisionOpen(false)
        clearSelection()
        await invalidateAssetLists()
      }
      if (res.errors?.length) {
        toast.error(res.errors[0] ?? "Some assets could not be processed.")
      } else if (res.processed_count === 0) {
        toast.error("No Assets were processed.")
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed.")
    } finally {
      setBulkActionBusy(false)
    }
  }

  async function deleteSelected() {
    const rows = deleteEligibleRows
    const ids = rows.map((r) => r.id)
    if (ids.length === 0) {
      toast.error("Assets on an open order cannot be deleted.")
      return
    }
    const ok = await confirmAsk({
      title: "Delete assets?",
      description:
        ids.length < selectedRows.length
          ? `Delete ${ids.length} of ${selectedRows.length} selected asset(s)? Assets on an open order are skipped.`
          : `Delete ${ids.length} Selected Asset(s)? This cannot be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    })
    if (!ok) return
    setBulkActionBusy(true)
    try {
      const errors: string[] = []
      for (const id of ids) {
        try {
          await deleteJson(`/admin/assets/${id}`)
        } catch (e) {
          errors.push(e instanceof ApiError ? e.message : `Asset ${id}`)
        }
      }
      if (errors.length === 0) {
        toast.success(`Deleted ${ids.length} Asset(s).`)
      } else if (errors.length < ids.length) {
        toast.warning(`Deleted ${ids.length - errors.length} of ${ids.length}. Some failed.`)
      } else {
        toast.error(errors[0] ?? "Delete failed.")
      }
      clearSelection()
      await invalidateAssetLists()
    } finally {
      setBulkActionBusy(false)
    }
  }

  async function bulkLifecycle(action: "deactivate" | "reactivate") {
    const rows = action === "deactivate" ? deactivateEligibleRows : reactivateEligibleRows
    const ids = rows.map((r) => r.id)
    if (ids.length === 0) {
      toast.error(
        action === "deactivate"
          ? "No active assets in the selection."
          : "No deactivated assets in the selection.",
      )
      return
    }
    const ok = await confirmAsk({
      title: action === "deactivate" ? "Deactivate assets?" : "Reactivate assets?",
      description:
        action === "deactivate"
          ? `Deactivate ${ids.length} active asset(s)? They will be marked inactive until reactivated.`
          : `Reactivate ${ids.length} deactivated asset(s)?`,
      confirmLabel: action === "deactivate" ? "Deactivate" : "Reactivate",
      destructive: action === "deactivate",
    })
    if (!ok) return
    setBulkActionBusy(true)
    try {
      const res = await postJson<{ processed_count: number; errors: string[] }>(
        "/admin/assets/bulk-lifecycle",
        { asset_ids: ids, action },
      )
      if (res.processed_count > 0) {
        toast.success(
          action === "deactivate"
            ? `${res.processed_count} deactivated.`
            : `${res.processed_count} reactivated.`,
        )
        clearSelection()
        await invalidateAssetLists()
      }
      if (res.errors?.length) {
        toast.error(res.errors[0] ?? "Some assets could not be processed.")
      } else if (res.processed_count === 0) {
        toast.error("No Assets were processed.")
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Action failed.")
    } finally {
      setBulkActionBusy(false)
    }
  }

  function openPhysicalOrderPreview(
    assetIds: number[],
    resetVerificationAssetIds: number[] = [],
  ) {
    if (assetIds.length === 0) {
      toast.error("No eligible assets selected.")
      return
    }
    const idSet = new Set(assetIds)
    const selection = selectedRows.filter((row) => idSet.has(row.id))
    writePhysicalOrderPreview({
      asset_ids: assetIds,
      reset_verification_asset_ids: resetVerificationAssetIds,
      selection,
      assets: selection.map((row) => ({
        id: row.id,
        asset_code: row.asset_code,
        asset_name: row.asset_name,
        rfid_code: row.rfid_code,
        cost_center: row.cost_center,
        plant_name: row.plant_name,
        inventory_count: row.inventory_count,
        physical_count: row.physical_count,
        last_verification_date: row.last_verification_date,
      })),
    })
    writeAssetMasterSelection(selection)
    setOrderWarningsOpen(false)
    navigate("/dashboard/orders/new")
  }

  async function beginCreatePhysicalOrder() {
    const ids = [...selected]
    if (ids.length === 0) return
    setOrderValidateBusy(true)
    try {
      const res = await postJson<ValidateAssetsResponse>("/admin/physical-orders/validate-assets", {
        asset_ids: ids,
      })
      setValidationResult(res)
      if (hasOrderCreateWarnings(res)) {
        setOrderWarningsOpen(true)
        return
      }
      if (res.eligible_asset_ids.length === 0) {
        toast.error("No eligible assets selected.")
        return
      }
      openPhysicalOrderPreview(res.eligible_asset_ids)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Validation failed.")
    } finally {
      setOrderValidateBusy(false)
    }
  }

  async function beginCreateTransferOrder() {
    const checkIds = selectedRows.map((r) => r.id)
    if (checkIds.length === 0) return

    setOrderValidateBusy(true)
    try {
      const blocked = new Map<number, { assetId: number; number: string; name: string; reason: string }>()
      const res = await postJson<ValidateTransferAssetsResponse>(
        "/admin/transfer-orders/validate-assets",
        { asset_ids: checkIds },
      )
      for (const a of res.in_progress) {
        const id = warningIdentity(a, selectedById)
        blocked.set(a.asset_id, {
          assetId: a.asset_id,
          number: id.number,
          name: id.name,
          reason: a.reason || TRANSFER_IN_PROGRESS_MESSAGE,
        })
      }
      if (blocked.size > 0) {
        setTransferBlockRows([...blocked.values()])
        setTransferBlockOpen(true)
        return
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Validation failed.")
      return
    } finally {
      setOrderValidateBusy(false)
    }

    if (transferEligibleRows.length === 0) {
      toast.error("Only approved assets you custodiate can be transferred.")
      return
    }
    if (transferEligibleRows.length < selectedRows.length) {
      toast.error("Select only approved assets where you are the custodian.")
      return
    }
    const plants = [
      ...new Set(
        transferEligibleRows.map((r) => r.plant_id).filter((id): id is number => id != null),
      ),
    ]
    if (plants.length !== 1) {
      toast.error("Select assets from the same plant.")
      return
    }
    const costCenters = [
      ...new Set(
        transferEligibleRows
          .map((r) => r.cost_center?.trim())
          .filter((c): c is string => Boolean(c)),
      ),
    ]
    if (costCenters.length !== 1) {
      toast.error(
        "Select assets from the same cost center. Create a separate transfer for each source cost center.",
      )
      return
    }
    try {
      sessionStorage.setItem(
        "transfer-order-draft-assets",
        JSON.stringify(
          transferEligibleRows.map((r) => ({
            id: r.id,
            asset_code: r.asset_code,
            asset_name: r.asset_name,
            plant_id: r.plant_id,
            plant_name: r.plant_name,
            cost_center: r.cost_center,
            cost_center_description: r.cost_center_description,
            functional_location: r.functional_location,
            functional_location_description: r.functional_location_description,
            actual_location: r.actual_location,
            actual_location_description: r.actual_location_description,
            asset_custodian_id: r.asset_custodian_id ?? null,
            approval_status: r.approval_status,
            lifecycle_status: r.lifecycle_status,
          })),
        ),
      )
    } catch {
      /* ignore quota */
    }
    writeAssetMasterSelection(transferEligibleRows)
    const q = new URLSearchParams({
      asset_ids: transferEligibleRows.map((r) => r.id).join(","),
      from: "assets",
    })
    q.set("plant_id", String(plants[0]))
    navigate(`/dashboard/transfer-orders/new?${q}`)
  }

  async function beginCreateDisposalOrder() {
    const checkIds = selectedRows.map((r) => r.id)
    if (checkIds.length === 0) return
    setOrderValidateBusy(true)
    try {
      const res = await postJson<ValidateTransferAssetsResponse>(
        "/admin/disposal-orders/validate-assets",
        { asset_ids: checkIds },
      )
      if (res.in_progress.length > 0) {
        setTransferBlockRows(
          res.in_progress.map((a) => {
            const id = warningIdentity(a, selectedById)
            return {
              assetId: a.asset_id,
              number: id.number,
              name: id.name,
              reason: a.reason || "This asset is still on an order.",
            }
          }),
        )
        setTransferBlockOpen(true)
        return
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Validation failed.")
      return
    } finally {
      setOrderValidateBusy(false)
    }

    if (transferEligibleRows.length === 0) {
      toast.error("Only approved assets you custodiate can be disposed.")
      return
    }
    if (transferEligibleRows.length < selectedRows.length) {
      toast.error("Select only approved assets where you are the custodian.")
      return
    }
    const plants = [
      ...new Set(
        transferEligibleRows.map((r) => r.plant_id).filter((id): id is number => id != null),
      ),
    ]
    if (plants.length !== 1) {
      toast.error("Select assets from the same plant.")
      return
    }
    const costCenters = [
      ...new Set(
        transferEligibleRows
          .map((r) => r.cost_center?.trim())
          .filter((c): c is string => Boolean(c)),
      ),
    ]
    if (costCenters.length !== 1) {
      toast.error(
        "Select assets from the same cost center. Create a separate disposal for each source cost center.",
      )
      return
    }
    try {
      sessionStorage.setItem(
        "disposal-order-draft-assets",
        JSON.stringify(
          transferEligibleRows.map((r) => ({
            id: r.id,
            asset_code: r.asset_code,
            asset_name: r.asset_name,
            plant_id: r.plant_id,
            plant_name: r.plant_name,
            cost_center: r.cost_center,
            cost_center_description: r.cost_center_description,
            functional_location: r.functional_location,
            functional_location_description: r.functional_location_description,
            actual_location: r.actual_location,
            actual_location_description: r.actual_location_description,
            asset_custodian_id: r.asset_custodian_id ?? null,
            approval_status: r.approval_status,
            lifecycle_status: r.lifecycle_status,
          })),
        ),
      )
    } catch {
      /* ignore quota */
    }
    writeAssetMasterSelection(transferEligibleRows)
    const q = new URLSearchParams({
      asset_ids: transferEligibleRows.map((r) => r.id).join(","),
      from: "assets",
    })
    q.set("plant_id", String(plants[0]))
    navigate(`/dashboard/disposal-orders/new?${q}`)
  }

  function handleListAction(actionId: string) {
    if (actionId === "attach-rfid") {
      openAttachRfidFromSelection()
      return
    }
    if (actionId === "submit-for-approval") {
      openBulkSubmit()
      return
    }
    if (actionId === "create-physical-order") {
      void beginCreatePhysicalOrder()
      return
    }
    if (actionId === "create-transfer-order") {
      void beginCreateTransferOrder()
      return
    }
    if (actionId === "create-disposal-order") {
      void beginCreateDisposalOrder()
      return
    }
    if (actionId === "open") {
      const id = selectedRows[0]?.id
      if (id != null) navigate(String(id))
      return
    }
    if (actionId === "delete") {
      void deleteSelected()
      return
    }
    if (actionId === "deactivate") {
      void bulkLifecycle("deactivate")
      return
    }
    if (actionId === "reactivate") {
      void bulkLifecycle("reactivate")
      return
    }
    if (actionId === "clear-selection") {
      clearSelection()
      clearAssetMasterSelection()
    }
  }

  const bulkSubmitAssigneesUrl = React.useMemo(() => {
    const first = submitEligibleRows[0]
    if (!first) return "/admin/assets/assignees?action=asset.create"
    const action =
      (first.source_type || "").toLowerCase() === "import" ? "asset.import" : "asset.create"
    return `/admin/assets/assignees?action=${encodeURIComponent(action)}`
  }, [submitEligibleRows])
  const total = data?.total ?? 0
  const pageSize = data?.page_size ?? 20
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const tableColSpan = visibleColumns.length + 1

  const actionButtons = (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={listToolbarBtnClass}
        onClick={openColumnsDialog}
      >
        <Columns3 className="size-4" aria-hidden />
        Columns
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={listToolbarBtnClass}
        onClick={() => setExportOpen(true)}
      >
        <Download className="size-4" aria-hidden />
        Export
      </Button>
      {canImport ? (
        <Button variant="outline" size="sm" className={listToolbarBtnClass} asChild>
          <Link to="/dashboard/assets/import">
            <Upload className="size-4" aria-hidden />
            Import
          </Link>
        </Button>
      ) : null}
      {canCreate ? (
        <AdminPrimaryButton type="button" className={cn(listToolbarBtnClass, "px-4")} asChild>
          <Link to="/dashboard/assets/new">
            <Plus className="size-4" aria-hidden />
            Create Asset
          </Link>
        </AdminPrimaryButton>
      ) : null}
    </>
  )

  return (
    <AdminPage fullWidth dense viewportFill className="gap-[var(--app-grid-gap)]">
      <div className="flex min-h-0 flex-1 flex-col gap-[var(--app-grid-gap)]">
        <div className="shrink-0 space-y-[var(--app-grid-gap)]">
          <ListPageHeader
            className="shrink-0"
            title="Asset Master"
            description={
              isFyTab
                ? ""
                : ""
            }
            actions={actionButtons}
          />

          <WorkspaceTabs
            value={listTab}
            onValueChange={(value) => {
              const nextTab = value as AssetListTab
              setListTab(nextTab)
              if (nextTab === "fy") {
                setFilters((f) => ({
                  ...DEFAULT_FY_FILTERS,
                  plant_id: f.plant_id,
                  category_id: f.category_id,
                }))
                setDraftFilters((f) => ({
                  ...DEFAULT_FY_FILTERS,
                  plant_id: f.plant_id,
                  category_id: f.category_id,
                }))
              } else {
                const tabMeta = ASSET_APPROVAL_STATUS_TABS.find((t) => t.key === nextTab)
                setFilters((f) => ({
                  ...DEFAULT_FILTERS,
                  plant_id: f.plant_id,
                  category_id: f.category_id,
                  rfid_status: f.rfid_status,
                  approval_status: tabMeta?.approval_status ?? "",
                }))
                setDraftFilters((f) => ({
                  ...DEFAULT_FILTERS,
                  plant_id: f.plant_id,
                  category_id: f.category_id,
                  rfid_status: f.rfid_status,
                  approval_status: tabMeta?.approval_status ?? "",
                }))
              }
              setPage(1)
              clearSelection()
              clearAssetMasterSelection()
            }}
            className="shrink-0"
          >
            <WorkspaceTabsList>
              {ASSET_APPROVAL_STATUS_TABS.map((t) => {
                const count = data?.tab_counts?.[t.key]
                return (
                  <WorkspaceTabsTrigger key={t.key} value={t.key}>
                    {t.key === "all" ? "All" : t.label}
                    {typeof count === "number" ? (
                      <span className="ml-1.5 tabular-nums text-muted-foreground">({count})</span>
                    ) : null}
                  </WorkspaceTabsTrigger>
                )
              })}
              <WorkspaceTabsTrigger value="fy">Physical Verification</WorkspaceTabsTrigger>
            </WorkspaceTabsList>
          </WorkspaceTabs>

          {isFyTab && data?.financial_year_label ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-[var(--app-radius-surface)] border border-border/70 bg-card px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-black">
                  Verified assets
                </p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                  {data.verified_assets_total ?? 0}
                </p>
              </div>

              <div className="rounded-[var(--app-radius-surface)] border border-border/70 bg-card px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-black">
                  Verification scans
                </p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                  {data.total_fy_verification_events ?? 0}
                </p>
              </div>

              <div className="rounded-[var(--app-radius-surface)] border border-border/70 bg-card px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-black">
                  Pending assets
                </p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                  {data.pending_assets_total ?? 0}
                </p>
              </div>

              <div className="rounded-[var(--app-radius-surface)] border border-border/70 bg-card px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-black">
                  Financial year
                </p>
                <p className="mt-0.5 text-xl font-semibold leading-tight text-foreground">
                  {data.financial_year_label}
                </p>
              </div>
            </div>
          ) : null}

          {isFyTab ? (
            <WorkspaceTabs
              value={fySubTab}
              onValueChange={(value) => {
                setFySubTab(value as AssetFySubTab)
                setPage(1)
                clearSelection()
              }}
            >
              <WorkspaceTabsList>
                <WorkspaceTabsTrigger value="verified">Physically Verified</WorkspaceTabsTrigger>
                <WorkspaceTabsTrigger value="pending">Pending for Verification</WorkspaceTabsTrigger>
              </WorkspaceTabsList>
            </WorkspaceTabs>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-[var(--app-grid-gap)]">
        <div className="app-list-toolbar shrink-0">
          <div className="relative min-w-[16rem] flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="asset-search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search Records by Asset No, Name, RFID, Cost Center, etc."
              className="w-full pl-9"
              aria-label="Search Records By Asset No, Name, RFID, Cost Center, etc."
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

          {isFyTab ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(listToolbarBtnClass, filtersOpen && "border-primary/40 bg-primary/5")}
              onClick={() => {
                setDraftFilters(filters)
                setFiltersOpen((o) => !o)
                setColumnFiltersOpen(false)
              }}
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              <span className="inline-flex items-center gap-0.5">
                Filters
                {activeFilterCount > 0 ? (
                  <span className="text-xs font-medium text-red-600">({activeFilterCount})</span>
                ) : null}
              </span>
            </Button>
          ) : (
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
                <span className="inline-block min-w-[1.35rem] text-xs font-medium tabular-nums text-red-600">
                  {activeColumnFilterCount > 0 ? `(${activeColumnFilterCount})` : "\u00a0"}
                </span>
              </span>
            </Button>
          )}

          {isFyTab ? (
            <>
              <select
                className={cn(adminSelectClass, "h-9 max-w-[11rem] shrink-0 text-sm")}
                value={selectedFyStartYear}
                onChange={(e) => applyFyYear(e.target.value)}
                disabled={fyYearOptions.length === 0}
                aria-label="Financial year for report"
              >
                {fyYearOptions.map((option) => (
                  <option key={option.start_year} value={String(option.start_year)}>
                    {option.label}
                    {option.is_current ? " " : ""}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={listToolbarBtnClass}
                disabled={fyExportBusy !== null}
                onClick={() => void exportFyReport("xlsx")}
              >
                <FileSpreadsheet className="size-4" aria-hidden />
                {fyExportBusy === "xlsx" ? "Exporting…" : "Excel"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={listToolbarBtnClass}
                disabled={fyExportBusy !== null}
                onClick={() => void exportFyReport("pdf")}
              >
                <FileText className="size-4" aria-hidden />
                {fyExportBusy === "pdf" ? "Exporting…" : "PDF"}
              </Button>
            </>
          ) : null}

          {selected.size > 0 && canDecide && decisionEligibleRows.length > 0 ? (
            <>
              {selected.size === 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={listToolbarBtnClass}
                  disabled={bulkActionBusy}
                  onClick={() => openBulkDecision("reject")}
                >
                  Reject
                </Button>
              ) : null}
              <AdminPrimaryButton
                type="button"
                className={listToolbarBtnClass}
                disabled={bulkActionBusy}
                onClick={() => openBulkDecision("approve")}
              >
                Approve
              </AdminPrimaryButton>
            </>
          ) : null}

          {selected.size > 0 ? (
            <AssetActionsMenu
              actions={listActions}
              busy={bulkActionBusy || orderValidateBusy}
              onAction={handleListAction}
            />
          ) : null}
        </div>

        {filtersOpen && isFyTab ? (
          <div className="app-panel max-h-[min(24rem,42vh)] shrink-0 overflow-y-auto rounded-[var(--app-radius-surface)] bg-muted/15 p-[var(--app-card-padding)] shadow-none">
            <div className="app-grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {isFyTab ? (
                <>
                  <div className="app-form-field">
                    <Label className="app-form-label text-muted-foreground">Financial year</Label>
                    <select
                      className={adminSelectClass}
                      value={draftFilters.fy_start_year || selectedFyStartYear}
                      onChange={(e) => onDraftFyYearChange(e.target.value)}
                      disabled={fyYearOptions.length === 0}
                    >
                      {fyYearOptions.map((option) => (
                        <option key={option.start_year} value={String(option.start_year)}>
                          {option.label}
                          {option.is_current ? " " : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="app-form-field">
                    <Label className="app-form-label text-muted-foreground">Scan from</Label>
                    <Input
                      type="date"
                      value={draftFilters.fy_scan_from || defaultScanFrom}
                      min={defaultScanFrom}
                      max={draftFilters.fy_scan_to || defaultScanTo}
                      onChange={(e) => applyScanDate("fy_scan_from", e.target.value)}
                    />
                  </div>
                  <div className="app-form-field">
                    <Label className="app-form-label text-muted-foreground">Scan to</Label>
                    <Input
                      type="date"
                      value={draftFilters.fy_scan_to || defaultScanTo}
                      min={draftFilters.fy_scan_from || defaultScanFrom}
                      max={defaultScanTo}
                      onChange={(e) => applyScanDate("fy_scan_to", e.target.value)}
                    />
                  </div>
                </>
              ) : null}
              <div className="app-form-field">
                <Label className="app-form-label text-muted-foreground">Plant</Label>
                <select
                  className={adminSelectClass}
                  value={draftFilters.plant_id}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, plant_id: e.target.value }))}
                >
                  <option value="">All</option>
                  {masters.plants.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {plantLabel(p)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="app-form-field">
                <Label className="app-form-label text-muted-foreground">Category</Label>
                <select
                  className={adminSelectClass}
                  value={draftFilters.category_id}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, category_id: e.target.value }))}
                >
                  <option value="">All</option>
                  {masters.categories.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {categoryLabel(c)}
                    </option>
                  ))}
                </select>
              </div>
              {!isFyTab ? (
                <>
                  <div className="app-form-field">
                    <Label className="app-form-label text-muted-foreground">Asset status</Label>
                    <select
                      className={adminSelectClass}
                      value={assetStatusFilterValue(
                        draftFilters.lifecycle_status,
                        draftFilters.approval_status,
                      )}
                      onChange={(e) => {
                        const opt = e.target.value
                          ? assetStatusFilterOption(e.target.value)
                          : null
                        setDraftFilters((f) => ({
                          ...f,
                          lifecycle_status: opt?.lifecycle_status ?? "",
                          approval_status: opt?.approval_status ?? "",
                        }))
                      }}
                    >
                      <option value="">All</option>
                      {ASSET_STATUS_FILTER_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="app-form-field">
                    <Label className="app-form-label text-muted-foreground">RFID tag</Label>
                    <select
                      className={adminSelectClass}
                      value={draftFilters.rfid_status}
                      onChange={(e) =>
                        setDraftFilters((f) => ({ ...f, rfid_status: e.target.value }))
                      }
                    >
                      <option value="">
                        All
                        {data?.rfid_tagged_total != null && data?.rfid_not_tagged_total != null
                          ? ` (${(data.rfid_tagged_total ?? 0) + (data.rfid_not_tagged_total ?? 0)})`
                          : ""}
                      </option>
                      <option value="tagged">
                        RFID tagged
                        {data?.rfid_tagged_total != null ? ` (${data.rfid_tagged_total})` : ""}
                      </option>
                      <option value="not_tagged">
                        Not RFID tagged
                        {data?.rfid_not_tagged_total != null ? ` (${data.rfid_not_tagged_total})` : ""}
                      </option>
                    </select>
                  </div>
                </>
              ) : null}
              <div className="app-form-field">
                <Label className="app-form-label text-muted-foreground">Sort by</Label>
                <select
                  className={adminSelectClass}
                  value={draftFilters.sort_by}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, sort_by: e.target.value }))}
                >
                  <option value="last_action_at">Latest Action</option>
                  {ASSET_LIST_COLUMNS.map((column) => (
                    <option key={column.key} value={column.key}>
                      {column.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="app-form-field">
                <Label className="app-form-label text-muted-foreground">Order</Label>
                <select
                  className={adminSelectClass}
                  value={draftFilters.sort_dir}
                  onChange={(e) => setDraftFilters((f) => ({ ...f, sort_dir: e.target.value }))}
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </div>
            </div>
            <div className="mt-[var(--app-grid-gap)] flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-[var(--app-grid-gap)]">
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={clearFilters}>
                Clear All
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => {
                  setDraftFilters(filters)
                  setFiltersOpen(false)
                }}
              >
                Cancel
              </Button>
              <AdminPrimaryButton type="button" className="h-9 px-4" onClick={applyFilters}>
                Apply filters
              </AdminPrimaryButton>
            </div>
          </div>
        ) : null}

        {activeFilterCount > 0 && !filtersOpen ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {isFyTab &&
            filters.fy_start_year &&
            currentFyStartYear &&
            Number(filters.fy_start_year) !== currentFyStartYear ? (
              <FilterChip
                prefix="FY"
                label={
                  fyYearOptions.find((o) => String(o.start_year) === filters.fy_start_year)?.label ??
                  filters.fy_start_year
                }
                onRemove={() => applyFyYear(String(currentFyStartYear))}
              />
            ) : null}
            {filters.plant_id ? (
              <FilterChip
                prefix="Plant"
                label={masters.plants.find((p) => String(p.id) === filters.plant_id)?.code ?? filters.plant_id}
                onRemove={() => {
                  setFilters((f) => ({ ...f, plant_id: "" }))
                  setDraftFilters((f) => ({ ...f, plant_id: "" }))
                  setPage(1)
                }}
              />
            ) : null}
            {filters.category_id ? (
              <FilterChip
                prefix="Category"
                label={
                  masters.categories.find((c) => String(c.id) === filters.category_id)?.code ??
                  filters.category_id
                }
                onRemove={() => {
                  setFilters((f) => ({ ...f, category_id: "" }))
                  setDraftFilters((f) => ({ ...f, category_id: "" }))
                  setPage(1)
                }}
              />
            ) : null}
            {!isFyTab &&
            assetStatusFilterValue(filters.lifecycle_status, filters.approval_status) ? (
              <FilterChip
                prefix="Status"
                label={
                  assetStatusFilterOption(
                    assetStatusFilterValue(filters.lifecycle_status, filters.approval_status),
                  )?.label ?? ""
                }
                tone={assetStatusPillTone(
                  filters.lifecycle_status,
                  filters.approval_status,
                )}
                onRemove={() => {
                  setListTab("all")
                  setFilters((f) => ({ ...f, lifecycle_status: "", approval_status: "" }))
                  setDraftFilters((f) => ({ ...f, lifecycle_status: "", approval_status: "" }))
                  setPage(1)
                }}
              />
            ) : null}
            {!isFyTab && filters.rfid_status ? (
              <FilterChip
                prefix="RFID"
                label={filters.rfid_status === "tagged" ? "tagged" : "not tagged"}
                tone={filters.rfid_status === "tagged" ? "info" : "warning"}
                onRemove={() => {
                  setFilters((f) => ({ ...f, rfid_status: "" }))
                  setDraftFilters((f) => ({ ...f, rfid_status: "" }))
                  setPage(1)
                }}
              />
            ) : null}
            <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={clearFilters}>
              Clear All
            </Button>
          </div>
        ) : null}

      <AdminDataTable
        className="min-h-0 flex-1"
        footer={
          <AdminTablePagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            loading={loading}
            itemLabel={total === 1 ? "Asset" : "Assets"}
            selectedCount={selected.size}
            onPageChange={setPage}
          />
        }
      >
        <Table className="app-table-head-sticky">
            <TableHeader>
              {columnsReady ? (
              <AdminTableHeaderRow>
                <AdminTableHeadCell className="w-10 px-3">
                  <Checkbox
                    checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                    onCheckedChange={(v) => toggleAll(Boolean(v))}
                    aria-label="Select all on this page"
                  />
                </AdminTableHeadCell>
                {visibleColumns.map((column) => (
                  <SortableColumnHeader
                    key={column.key}
                    label={column.label}
                    columnKey={column.key}
                    sortBy={filters.sort_by}
                    sortDir={filters.sort_dir}
                    onSort={(k) => toggleColumnSort(k as AssetListColumnKey)}
                    align={NUMERIC_COLUMN_KEYS.has(column.key) ? "right" : "left"}
                    className={NUMERIC_COLUMN_KEYS.has(column.key) ? "text-right" : undefined}
                  />
                ))}
              </AdminTableHeaderRow>
              ) : null}
              {columnFiltersOpen && !isFyTab ? (
                <AdminTableHeaderRow>
                  <AdminTableHeadCell className="w-10 px-3 py-1.5">
                    <span className="sr-only">Column filters</span>
                  </AdminTableHeadCell>
                  {visibleColumns.map((column) => (
                    <AdminTableHeadCell key={column.key} className="px-2 py-1.5">
                      {columnFilterControl(column.key)}
                    </AdminTableHeadCell>
                  ))}
                </AdminTableHeaderRow>
              ) : null}
            </TableHeader>
            <TableBody>
              {loading && items.length === 0 ? (
                <AdminTableLoadingRow colSpan={tableColSpan} label="Loading assets" />
              ) : items.length === 0 ? (
                <AdminTableEmptyRow colSpan={tableColSpan}>
                  {isFyTab
                    ? fySubTab === "verified"
                      ? "No physically verified assets for the current financial year."
                      : "No RFID-tagged assets pending financial year verification."
                    : "No Assets match your search or filters."}
                </AdminTableEmptyRow>
              ) : (
                items.map((row) => {
                  return (
                  <AdminTableBodyRow
                    key={row.id}
                    onClick={() => {
                      if (selected.size > 0) {
                        if (!canActOnAsset(row)) return
                        toggleRow(row.id, !selected.has(row.id))
                        return
                      }
                      navigate(String(row.id))
                    }}
                  >
                    <AdminTableCell className="w-10 px-3">
                      <div
                        className="flex items-center"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        role="presentation"
                      >
                        <Checkbox
                          checked={selected.has(row.id)}
                          disabled={!canActOnAsset(row)}
                          onCheckedChange={(v) => toggleRow(row.id, Boolean(v))}
                          aria-label={`Select ${row.combined_asset_number || row.asset_code}`}
                          title={
                            canActOnAsset(row)
                              ? undefined
                              : "No action access — this cost center is not assigned to you"
                          }
                        />
                      </div>
                    </AdminTableCell>
                    {visibleColumns.map((column) => (
                      <AdminTableCell
                        key={column.key}
                        className={cn(
                          "max-w-[16rem]",
                          NUMERIC_COLUMN_KEYS.has(column.key) && "text-right tabular-nums",
                        )}
                      >
                        <span className="block truncate">
                          {assetListCell(row, column.key)}
                        </span>
                      </AdminTableCell>
                    ))}
                  </AdminTableBodyRow>
                  )
                })
              )}
            </TableBody>
          </Table>
      </AdminDataTable>
        </div>
      </div>

      <Dialog open={columnsOpen} onOpenChange={setColumnsOpen}>
        <DialogContent className="max-w-2xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Choose Asset List Columns</DialogTitle>
          </DialogHeader>
          <div className="dialog-body max-h-[60vh] space-y-4 overflow-y-auto">
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="bg-muted/40"
                onClick={() => setDraftColumnKeys(new Set(DEFAULT_ASSET_LIST_COLUMN_KEYS))}
              >
                Default Fields
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="bg-muted/40"
                onClick={() =>
                  setDraftColumnKeys(new Set(ASSET_LIST_COLUMNS.map((column) => column.key)))
                }
              >
                Select All
              </Button>
            </div>
            {(["Asset information", "Location & financial", "Inventory"] as const).map((group) => (
              <div key={group} className="rounded-md border border-border/60 bg-muted/15 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {ASSET_LIST_COLUMNS.filter((column) => column.group === group).map((column) => (
                    <label
                      key={column.key}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={draftColumnKeys.has(column.key)}
                        onCheckedChange={(checked) =>
                          toggleListColumn(column.key, Boolean(checked))
                        }
                      />
                      <span>{column.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="dialog-footer-actions">
            <Button
              type="button"
              variant="outline"
              disabled={columnsSaving}
              onClick={() => setColumnsOpen(false)}
            >
              Cancel
            </Button>
            <AdminPrimaryButton
              type="button"
              disabled={columnsSaving || draftColumnKeys.size === 0}
              onClick={() => void saveColumnPreferences()}
            >
              {columnsSaving ? "Saving…" : "Save Setting"}
            </AdminPrimaryButton>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={orderWarningsOpen}
        onOpenChange={setOrderWarningsOpen}
      >
        <DialogContent
          className="flex max-h-[min(90vh,40rem)] max-w-2xl flex-col overflow-hidden p-0 sm:max-w-2xl"
          aria-describedby={undefined}
        >
          {validationResult ? (
            <>
              <DialogHeader className="pr-12">
                <DialogTitle>
                  {hasBlockingOrderMismatch(validationResult)
                    ? "Cannot Create Order"
                    : "Review Warning"}
                </DialogTitle>
              </DialogHeader>
              <div className="dialog-body min-h-0 gap-3 overflow-y-auto">
                <p className="flex gap-2 text-sm text-foreground">
                  <AlertTriangle
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      hasBlockingOrderMismatch(validationResult)
                        ? "text-red-600"
                        : "text-amber-600",
                    )}
                    aria-hidden
                  />
                  <span>
                    {hasBlockingOrderMismatch(validationResult)
                      ? validationResult.active_order_conflicts.length > 0
                        ? "A new physical verification order cannot be created while these assets are still on an order."
                        : "Deselect these assets and try again."
                      : "Review the warnings below before continuing."}
                  </span>
                </p>
                <div className="overflow-auto rounded-md border">
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-[28%]">Asset Number</TableHead>
                        <TableHead className="w-[32%]">Asset Name</TableHead>
                        <TableHead>Warning</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {collectOrderWarningRows(validationResult, selectedById).map((row) => (
                        <TableRow key={row.assetId} className="hover:bg-transparent">
                          <TableCell className="h-auto whitespace-normal py-2.5 align-top font-medium">
                            {row.number}
                          </TableCell>
                          <TableCell className="h-auto whitespace-normal py-2.5 align-top">
                            {row.name}
                          </TableCell>
                          <TableCell className="h-auto whitespace-normal py-2.5 align-top text-muted-foreground">
                            {row.issues.length > 1 ? (
                              <ul className="list-disc space-y-1 pl-4 text-foreground">
                                {row.issues.map((issue) => (
                                  <li key={issue}>{issue}</li>
                                ))}
                              </ul>
                            ) : (
                              row.issues[0]
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {!hasBlockingOrderMismatch(validationResult) &&
                fyVerifiedEligibleIdsFrom(validationResult).length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Re-verify resets count and date when the order is created.
                  </p>
                ) : null}
              </div>
              <div className="dialog-footer-actions">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOrderWarningsOpen(false)}
                >
                  {hasBlockingOrderMismatch(validationResult) ? "Close" : "Cancel"}
                </Button>
                {!hasBlockingOrderMismatch(validationResult) &&
                validationResult.eligible_asset_ids.length > 0 ? (
                  <AdminPrimaryButton
                    type="button"
                    onClick={() =>
                      openPhysicalOrderPreview(
                        validationResult.eligible_asset_ids,
                        fyVerifiedEligibleIdsFrom(validationResult),
                      )
                    }
                  >
                    Continue
                  </AdminPrimaryButton>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={transferBlockOpen} onOpenChange={setTransferBlockOpen}>
        <DialogContent
          className="flex max-h-[min(90vh,40rem)] max-w-2xl flex-col overflow-hidden p-0 sm:max-w-2xl"
          aria-describedby={undefined}
        >
          <DialogHeader className="pr-12">
            <DialogTitle>Cannot Create Order</DialogTitle>
          </DialogHeader>
          <div className="dialog-body min-h-0 gap-3 overflow-y-auto">
            <p className="flex gap-2 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
              <span>
                Another order cannot be created until the step before Close is done on the existing
                order.
              </span>
            </p>
            <div className="overflow-auto rounded-md border">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[28%]">Asset Number</TableHead>
                    <TableHead className="w-[32%]">Asset Name</TableHead>
                    <TableHead>Warning</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transferBlockRows.map((row) => (
                    <TableRow key={row.assetId} className="hover:bg-transparent">
                      <TableCell className="h-auto whitespace-normal py-2.5 align-top font-medium">
                        {row.number}
                      </TableCell>
                      <TableCell className="h-auto whitespace-normal py-2.5 align-top">
                        {row.name}
                      </TableCell>
                      <TableCell className="h-auto whitespace-normal py-2.5 align-top text-muted-foreground">
                        {row.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <div className="dialog-footer-actions">
            <Button type="button" variant="outline" onClick={() => setTransferBlockOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AssetRfidDialog
        open={rfidDialogOpen}
        onOpenChange={setRfidDialogOpen}
        isUpdate={rfidDialogIsUpdate}
        value={rfidValue}
        onChange={(v) => {
          setRfidValue(v)
          if (!v.trim()) setRfidTagColorId("")
        }}
        onSave={() => void saveAttachedRfid()}
        saving={rfidSaving}
        assetCode={rfidDialogMode === "by-code" ? rfidAssetCode : undefined}
        onAssetCodeChange={rfidDialogMode === "by-code" ? setRfidAssetCode : undefined}
        tagColorId={rfidTagColorId}
        onTagColorChange={setRfidTagColorId}
        tagColors={masters.tagColors}
      />

      <AssetExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        listTab={listTab}
        fySubTab={fySubTab}
        initialPlantId={filters.plant_id}
        initialCategoryId={filters.category_id}
        initialFyStartYear={selectedFyStartYear}
        scanFrom={effectiveScanFrom}
        scanTo={effectiveScanTo}
        selectedAssetIds={[...selected]}
        fyYearOptions={fyYearOptions}
        currentFyStartYear={currentFyStartYear}
      />

      <CapexAssigneePickerDialog
        open={submitAssignOpen}
        onOpenChange={setSubmitAssignOpen}
        assigneesUrl={bulkSubmitAssigneesUrl}
        roleLabel="Approver"
        title="Submit for Approval"
        confirmLabel={
          submitEligibleRows.length > 1
            ? "Submit"
            : "Submit"
        }
        busy={bulkActionBusy}
        onConfirm={submitSelectedWithAssignee}
      />

      <CapexDecisionDialog
        open={bulkDecisionOpen}
        onOpenChange={setBulkDecisionOpen}
        mode={bulkDecisionMode}
        busy={bulkActionBusy}
        requireComment
        title={
          bulkDecisionMode === "approve"
            ? `Approve  Asset${decisionEligibleRows.length === 1 ? "" : "s"}`
            : `Reject Asset${decisionEligibleRows.length === 1 ? "" : "s"}`
        }
        confirmLabel={bulkDecisionMode === "approve" ? "Approve" : "Reject"}
        fieldLabel={bulkDecisionMode === "approve" ? "Comment" : undefined}
        needsNextAssignee={false}
        onConfirm={confirmBulkDecision}
      />
      {confirmDialog}
    </AdminPage>
  )
}

function FilterChip({
  label,
  onRemove,
  tone,
  prefix,
}: {
  label: string
  onRemove: () => void
  tone?: AdminPillTone
  prefix?: string
}) {
  const name = prefix ? `${prefix} ${label}` : label
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border pl-2.5 pr-1 text-xs font-medium leading-none",
        tone ? adminPillToneClass[tone] : "border-border/70 bg-muted/40 text-muted-foreground",
      )}
    >
      {tone ? (
        <span className="size-1.5 shrink-0 rounded-full bg-current opacity-80" aria-hidden />
      ) : null}
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
