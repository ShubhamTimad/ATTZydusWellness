import * as React from "react"
import { useNavigate } from "react-router-dom"
import { ClipboardList, DollarSign, FileText, MapPin, Package } from "lucide-react"
import { toast } from "sonner"

import { TagColorSelect } from "@/components/assets/tag-color-select"
import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPanel,
  AdminPrimaryButton,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ApiError, postJson } from "@/lib/api"
import { ASSET_FIELD_LABELS } from "@/lib/asset-master-fields"
import type { AssetDetail } from "@/lib/assets-types"
import { hasPermission } from "@/lib/permissions"
import {
  categoryLabel,
  costCenterLabel,
  profitCenterLabel,
  actualLocationLabel,
  functionalLocationLabel,
  plantLabel,
  useAssetMasterLookups,
} from "@/lib/use-asset-masters"
import { cn } from "@/lib/utils"

type CreateForm = {
  asset_name: string
  asset_code: string
  asset_class: string
  asset_type: string
  asset_category_id: string
  rfid_code: string
  tag_color_id: string
  serial_no: string
  ownership_type: string
  inventory_no: string
  asset_description: string
  engineering_description: string
  qa_description: string
  asset_allocation: string
  pm_equipment_id: string
  is_local_finance_user: boolean
  plant_id: string
  sub_location: string
  functional_location: string
  actual_location: string
  building: string
  floor: string
  room: string
  zone: string
  cost_center: string
  profit_center: string
  laboratory: string
  party_details: string
  invoice_no: string
  invoice_date: string
  voucher_no: string
  voucher_date: string
  grn_no: string
  grn_date: string
  put_to_use_date: string
  cap_date: string
  depreciation_rate: string
  gross_block: string
  life_span: string
  vendor_name: string
  po_number: string
  currency: string
}

const EMPTY_FORM: CreateForm = {
  asset_name: "",
  asset_code: "",
  asset_class: "",
  asset_type: "",
  asset_category_id: "",
  rfid_code: "",
  tag_color_id: "",
  serial_no: "",
  ownership_type: "",
  inventory_no: "",
  asset_description: "",
  engineering_description: "",
  qa_description: "",
  asset_allocation: "",
  pm_equipment_id: "",
  is_local_finance_user: false,
  plant_id: "",
  sub_location: "",
  functional_location: "",
  actual_location: "",
  building: "",
  floor: "",
  room: "",
  zone: "",
  cost_center: "",
  profit_center: "",
  laboratory: "",
  party_details: "",
  invoice_no: "",
  invoice_date: "",
  voucher_no: "",
  voucher_date: "",
  grn_no: "",
  grn_date: "",
  put_to_use_date: "",
  cap_date: "",
  depreciation_rate: "",
  gross_block: "",
  life_span: "",
  vendor_name: "",
  po_number: "",
  currency: "",
}

function label(key: string, fallback: string) {
  return ASSET_FIELD_LABELS[key] ?? fallback
}

function strOrNull(v: string): string | null {
  const t = v.trim()
  return t || null
}

function buildCreatePayload(form: CreateForm) {
  return {
    asset_name: form.asset_name.trim(),
    asset_code: form.asset_code.trim(),
    asset_class: strOrNull(form.asset_class),
    asset_type: strOrNull(form.asset_type),
    rfid_code: strOrNull(form.rfid_code),
    tag_color_id:
      form.rfid_code.trim() && form.tag_color_id ? Number(form.tag_color_id) : null,
    serial_no: strOrNull(form.serial_no),
    asset_category_id: form.asset_category_id ? Number(form.asset_category_id) : null,
    ownership_type: strOrNull(form.ownership_type),
    information: {
      inventory_no: strOrNull(form.inventory_no),
      asset_description: strOrNull(form.asset_description),
      engineering_description: strOrNull(form.engineering_description),
      qa_description: strOrNull(form.qa_description),
      is_local_finance_user: form.is_local_finance_user,
      asset_allocation: strOrNull(form.asset_allocation),
      pm_equipment_id: strOrNull(form.pm_equipment_id),
    },
    location: {
      plant_id: form.plant_id ? Number(form.plant_id) : null,
      sub_location: strOrNull(form.sub_location),
      functional_location: strOrNull(form.functional_location),
      actual_location: strOrNull(form.actual_location),
      building: strOrNull(form.building),
      floor: strOrNull(form.floor),
      room: strOrNull(form.room),
      zone: strOrNull(form.zone),
    },
    financial: {
      cost_center: strOrNull(form.cost_center),
      profit_center: strOrNull(form.profit_center),
      laboratory: strOrNull(form.laboratory),
      party_details: strOrNull(form.party_details),
      invoice_no: strOrNull(form.invoice_no),
      invoice_date: strOrNull(form.invoice_date),
      voucher_no: strOrNull(form.voucher_no),
      voucher_date: strOrNull(form.voucher_date),
      grn_no: strOrNull(form.grn_no),
      grn_date: strOrNull(form.grn_date),
      put_to_use_date: strOrNull(form.put_to_use_date),
      cap_date: strOrNull(form.cap_date),
      depreciation_rate: strOrNull(form.depreciation_rate),
      gross_block: strOrNull(form.gross_block),
      life_span: strOrNull(form.life_span),
      vendor_name: strOrNull(form.vendor_name),
      po_number: strOrNull(form.po_number),
      currency: strOrNull(form.currency),
    },
  }
}

function FormField({
  id,
  labelText,
  required,
  className,
  children,
}: {
  id?: string
  labelText: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("app-form-field", className)}>
      <Label htmlFor={id} className="app-form-label">
        {labelText}
        {required ? " *" : ""}
      </Label>
      {children}
    </div>
  )
}

export function AssetCreatePage() {
  const navigate = useNavigate()
  const [form, setForm] = React.useState<CreateForm>(EMPTY_FORM)
  const [creating, setCreating] = React.useState(false)

  const plantIdForLookups = form.plant_id ? Number(form.plant_id) : null
  const masters = useAssetMasterLookups(
    plantIdForLookups,
    form.cost_center || null,
    form.functional_location || null,
  )

  const selectedPlant = masters.plants.find((p) => String(p.id) === form.plant_id)
  const costCenterDesc =
    masters.costCenters.find((c) => c.code === form.cost_center)?.description ?? "—"
  const profitCenterDesc =
    masters.profitCenters.find((p) => p.code === form.profit_center)?.description ?? "—"

  const patch = (patch: Partial<CreateForm>) => setForm((f) => ({ ...f, ...patch }))

  React.useEffect(() => {
    if (!hasPermission("asset.create")) {
      navigate("/dashboard/assets", { replace: true })
    }
  }, [navigate])

  React.useEffect(() => {
    if (masters.plants.length >= 1 && !form.plant_id) {
      patch({ plant_id: String(masters.plants[0].id) })
    }
  }, [masters.plants, form.plant_id])

  async function createAsset() {
    if (!form.asset_name.trim() || !form.asset_code.trim()) {
      toast.error("Asset name and code are required.")
      return
    }
    setCreating(true)
    try {
      const created = await postJson<AssetDetail>("/admin/assets", buildCreatePayload(form))
      toast.success("Asset created and activated.")
      navigate(`/dashboard/assets/${created.id}`, { replace: true })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Create failed.")
    } finally {
      setCreating(false)
    }
  }

  if (!hasPermission("asset.create")) {
    return null
  }

  return (
    <AdminPage
      description="Enter all asset master fields. Inventory count defaults to 1; physical count stays 0 until a physical verification order is completed."
      actions={<AdminBackLink to="/dashboard/assets">Assets</AdminBackLink>}
    >
      <form
        className="space-y-[var(--app-grid-gap)]"
        onSubmit={(e) => {
          e.preventDefault()
          void createAsset()
        }}
      >
        <div className="grid gap-[var(--app-grid-gap)] lg:grid-cols-2">
          <AdminPanel
            title="Asset information"
            description="Core identification fields"
            headerActions={<Package className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="px-5 py-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField id="asset_name" labelText={label("asset_name", "Asset name")} required className="sm:col-span-2">
                <Input
                  id="asset_name"
                  value={form.asset_name}
                  onChange={(e) => patch({ asset_name: e.target.value })}
                  autoFocus
                />
              </FormField>
              <FormField id="asset_code" labelText={label("asset_code", "Asset code")} required>
                <Input
                  id="asset_code"
                  value={form.asset_code}
                  onChange={(e) => patch({ asset_code: e.target.value })}
                  className="font-mono uppercase"
                />
              </FormField>
              <FormField id="rfid_code" labelText={label("rfid_code", "RFID code")}>
                <Input
                  id="rfid_code"
                  value={form.rfid_code}
                  onChange={(e) => {
                    const rfid = e.target.value
                    patch({
                      rfid_code: rfid,
                      ...(rfid.trim() ? {} : { tag_color_id: "" }),
                    })
                  }}
                  className="font-mono"
                />
              </FormField>
              {form.rfid_code.trim() ? (
                <TagColorSelect
                  id="tag_color_id"
                  value={form.tag_color_id}
                  onChange={(v) => patch({ tag_color_id: v })}
                  tagColors={masters.tagColors}
                />
              ) : null}
              <FormField id="asset_class" labelText={label("asset_class", "Asset class")}>
                <Input id="asset_class" value={form.asset_class} onChange={(e) => patch({ asset_class: e.target.value })} />
              </FormField>
              <FormField id="asset_type" labelText={label("asset_type", "Asset type")}>
                <Input id="asset_type" value={form.asset_type} onChange={(e) => patch({ asset_type: e.target.value })} />
              </FormField>
              <FormField id="asset_category_id" labelText={label("asset_category_id", "Asset category")}>
                <select
                  id="asset_category_id"
                  className={adminSelectClass}
                  value={form.asset_category_id}
                  onChange={(e) => patch({ asset_category_id: e.target.value })}
                >
                  <option value="">—</option>
                  {masters.categories.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {categoryLabel(c)}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="serial_no" labelText="Serial no.">
                <Input id="serial_no" value={form.serial_no} onChange={(e) => patch({ serial_no: e.target.value })} />
              </FormField>
              <FormField id="ownership_type" labelText="Ownership type">
                <Input
                  id="ownership_type"
                  value={form.ownership_type}
                  onChange={(e) => patch({ ownership_type: e.target.value })}
                  placeholder="e.g. owned"
                />
              </FormField>
            </div>
          </AdminPanel>

          <AdminPanel
            title="Location"
            description="Plant is fixed to Takeda"
            headerActions={<MapPin className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="px-5 py-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField labelText={label("plant_id", "Plant name")} className="sm:col-span-2">
                <Input
                  readOnly
                  disabled
                  className="bg-muted/40"
                  value={selectedPlant ? plantLabel(selectedPlant) : "Takeda"}
                />
              </FormField>
              <FormField id="sub_location" labelText={label("sub_location", "Sub location")}>
                <Input id="sub_location" value={form.sub_location} onChange={(e) => patch({ sub_location: e.target.value })} />
              </FormField>
              <FormField id="functional_location" labelText={label("functional_location", "Functional location")}>
                <select
                  id="functional_location"
                  className={adminSelectClass}
                  value={form.functional_location}
                  onChange={(e) =>
                    patch({ functional_location: e.target.value, actual_location: "" })
                  }
                >
                  <option value="">—</option>
                  {masters.functionalLocations.map((l) => (
                    <option key={l.id} value={l.code}>
                      {functionalLocationLabel(l)}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="actual_location" labelText={label("actual_location", "Actual location")}>
                <select
                  id="actual_location"
                  className={adminSelectClass}
                  value={form.actual_location}
                  disabled={!form.functional_location}
                  onChange={(e) => patch({ actual_location: e.target.value })}
                >
                  <option value="">
                    {form.functional_location ? "—" : "Select functional location first"}
                  </option>
                  {masters.actualLocations.map((l) => (
                    <option key={l.id} value={l.code}>
                      {actualLocationLabel(l)}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="building" labelText={label("building", "Building")}>
                <Input id="building" value={form.building} onChange={(e) => patch({ building: e.target.value })} />
              </FormField>
              <FormField id="floor" labelText={label("floor", "Floor")}>
                <Input id="floor" value={form.floor} onChange={(e) => patch({ floor: e.target.value })} />
              </FormField>
              <FormField id="room" labelText="Room">
                <Input id="room" value={form.room} onChange={(e) => patch({ room: e.target.value })} />
              </FormField>
              <FormField id="zone" labelText="Zone">
                <Input id="zone" value={form.zone} onChange={(e) => patch({ zone: e.target.value })} />
              </FormField>
            </div>
          </AdminPanel>

          <AdminPanel
            title="Descriptions & allocation"
            description="Extended asset information"
            headerActions={<FileText className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="px-5 py-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField id="inventory_no" labelText="Inventory no.">
                <Input id="inventory_no" value={form.inventory_no} onChange={(e) => patch({ inventory_no: e.target.value })} />
              </FormField>
              <FormField id="pm_equipment_id" labelText="PM equipment ID">
                <Input
                  id="pm_equipment_id"
                  value={form.pm_equipment_id}
                  onChange={(e) => patch({ pm_equipment_id: e.target.value })}
                />
              </FormField>
              <FormField id="asset_allocation" labelText="Asset allocation" className="sm:col-span-2">
                <Input
                  id="asset_allocation"
                  value={form.asset_allocation}
                  onChange={(e) => patch({ asset_allocation: e.target.value })}
                />
              </FormField>
              <FormField id="asset_description" labelText="Asset description" className="sm:col-span-2">
                <Input
                  id="asset_description"
                  value={form.asset_description}
                  onChange={(e) => patch({ asset_description: e.target.value })}
                />
              </FormField>
              <FormField id="engineering_description" labelText="Engineering description" className="sm:col-span-2">
                <Input
                  id="engineering_description"
                  value={form.engineering_description}
                  onChange={(e) => patch({ engineering_description: e.target.value })}
                />
              </FormField>
              <FormField id="qa_description" labelText="QA description" className="sm:col-span-2">
                <Input
                  id="qa_description"
                  value={form.qa_description}
                  onChange={(e) => patch({ qa_description: e.target.value })}
                />
              </FormField>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/15 px-4 py-3 sm:col-span-2">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">Local finance user</div>
                  <div className="text-xs text-muted-foreground">Mark when finance data is maintained locally.</div>
                </div>
                <Switch
                  checked={form.is_local_finance_user}
                  onCheckedChange={(v) => patch({ is_local_finance_user: v })}
                />
              </div>
            </div>
          </AdminPanel>

          <AdminPanel
            title="Financial detail"
            description="Cost, procurement, and depreciation"
            headerActions={<DollarSign className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="px-5 py-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField id="cost_center" labelText={label("cost_center", "Cost center")}>
                <select
                  id="cost_center"
                  className={adminSelectClass}
                  value={form.cost_center}
                  onChange={(e) => patch({ cost_center: e.target.value, profit_center: "" })}
                >
                  <option value="">—</option>
                  {masters.costCenters.map((m) => (
                    <option key={m.id} value={m.code}>
                      {costCenterLabel(m)}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField labelText="Cost center description">
                <Input readOnly disabled className="bg-muted/40" value={costCenterDesc} />
              </FormField>
              <FormField id="profit_center" labelText="Profit center">
                <select
                  id="profit_center"
                  className={adminSelectClass}
                  value={form.profit_center}
                  disabled={!form.cost_center}
                  onChange={(e) => patch({ profit_center: e.target.value })}
                >
                  <option value="">{form.cost_center ? "—" : "Select cost center first"}</option>
                  {masters.profitCenters.map((m) => (
                    <option key={m.id} value={m.code}>
                      {profitCenterLabel(m)}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField labelText="Profit center description">
                <Input readOnly disabled className="bg-muted/40" value={profitCenterDesc} />
              </FormField>
              <FormField id="laboratory" labelText="Laboratory">
                <Input id="laboratory" value={form.laboratory} onChange={(e) => patch({ laboratory: e.target.value })} />
              </FormField>
              <FormField id="party_details" labelText={label("party_details", "Party details")}>
                <Input id="party_details" value={form.party_details} onChange={(e) => patch({ party_details: e.target.value })} />
              </FormField>
              <FormField id="gross_block" labelText={label("gross_block", "Gross block")}>
                <Input
                  id="gross_block"
                  type="number"
                  step="0.01"
                  value={form.gross_block}
                  onChange={(e) => patch({ gross_block: e.target.value })}
                />
              </FormField>
              <FormField id="depreciation_rate" labelText={label("depreciation_rate", "Rate of depreciation")}>
                <Input
                  id="depreciation_rate"
                  type="number"
                  step="0.0001"
                  value={form.depreciation_rate}
                  onChange={(e) => patch({ depreciation_rate: e.target.value })}
                />
              </FormField>
              <FormField id="life_span" labelText={label("life_span", "Life span")}>
                <Input id="life_span" value={form.life_span} onChange={(e) => patch({ life_span: e.target.value })} />
              </FormField>
              <FormField id="put_to_use_date" labelText={label("put_to_use_date", "Put to use")}>
                <Input
                  id="put_to_use_date"
                  type="date"
                  value={form.put_to_use_date}
                  onChange={(e) => patch({ put_to_use_date: e.target.value })}
                />
              </FormField>
              <FormField id="cap_date" labelText="Capitalization date">
                <Input
                  id="cap_date"
                  type="date"
                  value={form.cap_date}
                  onChange={(e) => patch({ cap_date: e.target.value })}
                />
              </FormField>
              <FormField id="vendor_name" labelText="Vendor name">
                <Input id="vendor_name" value={form.vendor_name} onChange={(e) => patch({ vendor_name: e.target.value })} />
              </FormField>
              <FormField id="po_number" labelText="PO number">
                <Input id="po_number" value={form.po_number} onChange={(e) => patch({ po_number: e.target.value })} />
              </FormField>
              <FormField id="currency" labelText="Currency">
                <Input id="currency" value={form.currency} onChange={(e) => patch({ currency: e.target.value })} placeholder="USD" />
              </FormField>
            </div>
          </AdminPanel>
        </div>

        <AdminPanel
          title="Inventory & procurement"
          description="Document references; inventory counts are set automatically on create"
          headerActions={<ClipboardList className="size-4 text-muted-foreground" aria-hidden />}
          contentClassName="px-5 py-5"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField labelText={label("inventory_count", "Inventory count")}>
              <Input readOnly disabled className="bg-muted/40" value="1" />
            </FormField>
            <FormField labelText={label("physical_count", "Physical count")}>
              <Input readOnly disabled className="bg-muted/40" value="0" />
            </FormField>
            <FormField labelText={label("last_verification_date", "Last verification date")}>
              <Input readOnly disabled className="bg-muted/40" value="—" />
            </FormField>
            <FormField id="invoice_no" labelText={label("invoice_no", "Invoice no.")}>
              <Input id="invoice_no" value={form.invoice_no} onChange={(e) => patch({ invoice_no: e.target.value })} />
            </FormField>
            <FormField id="invoice_date" labelText={label("invoice_date", "Invoice date")}>
              <Input
                id="invoice_date"
                type="date"
                value={form.invoice_date}
                onChange={(e) => patch({ invoice_date: e.target.value })}
              />
            </FormField>
            <FormField id="voucher_no" labelText={label("voucher_no", "Voucher no.")}>
              <Input id="voucher_no" value={form.voucher_no} onChange={(e) => patch({ voucher_no: e.target.value })} />
            </FormField>
            <FormField id="voucher_date" labelText={label("voucher_date", "Voucher date")}>
              <Input
                id="voucher_date"
                type="date"
                value={form.voucher_date}
                onChange={(e) => patch({ voucher_date: e.target.value })}
              />
            </FormField>
            <FormField id="grn_no" labelText={label("grn_no", "GRN no.")}>
              <Input id="grn_no" value={form.grn_no} onChange={(e) => patch({ grn_no: e.target.value })} />
            </FormField>
            <FormField id="grn_date" labelText={label("grn_date", "GRN date")}>
              <Input
                id="grn_date"
                type="date"
                value={form.grn_date}
                onChange={(e) => patch({ grn_date: e.target.value })}
              />
            </FormField>
          </div>
        </AdminPanel>

        <div className="flex justify-end gap-2 border-t border-border/60 pt-4">
          <Button
            type="button"
            variant="outline"
            className="h-9 shadow-sm"
            onClick={() => navigate("/dashboard/assets")}
          >
            Cancel
          </Button>
          <AdminPrimaryButton type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create asset"}
          </AdminPrimaryButton>
        </div>
      </form>
    </AdminPage>
  )
}
