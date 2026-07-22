import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { ClipboardList, DollarSign, FileText, MapPin, Package } from "lucide-react"
import { toast } from "sonner"

import { RequiredFieldMark } from "@/components/assets/required-field-mark"
import { AssetImage, validateAssetImageFile } from "@/components/assets/asset-image"
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
import { ApiError, getJson, postJson, putFormData } from "@/lib/api"
import type { CapexFormDetail, CapexFormListResponse } from "@/lib/capex-types"
import type { AssetDetail } from "@/lib/assets-types"
import { useAssetFieldConfig } from "@/lib/use-asset-field-config"
import { hasPermission } from "@/lib/permissions"
import {
  assetConditionLabel,
  assetCustodianLabel,
  categoryLabel,
  costCenterLabel,
  profitCenterLabel,
  actualLocationLabel,
  functionalLocationLabel,
  useAssetMasterLookups,
} from "@/lib/use-asset-masters"
import { cn } from "@/lib/utils"

type CreateForm = {
  asset_name: string
  asset_code: string
  combined_asset_number: string
  remark: string
  sub_no: string
  asset_class: string
  asset_type: string
  asset_category_id: string
  rfid_code: string
  tag_color_id: string
  asset_custodian_id: string
  asset_condition_id: string
  serial_no: string
  ownership_type: string
  inventory_no: string
  asset_description: string
  engineering_description: string
  qa_description: string
  asset_allocation: string
  pm_equipment_id: string
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
  capitalization_form_id: string
}

const EMPTY_FORM: CreateForm = {
  asset_name: "",
  asset_code: "",
  combined_asset_number: "",
  remark: "",
  sub_no: "",
  asset_class: "",
  asset_type: "",
  asset_category_id: "",
  rfid_code: "",
  tag_color_id: "",
  asset_custodian_id: "",
  asset_condition_id: "",
  serial_no: "",
  ownership_type: "",
  inventory_no: "",
  asset_description: "",
  engineering_description: "",
  qa_description: "",
  asset_allocation: "",
  pm_equipment_id: "",
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
  capitalization_form_id: "",
}

function validateCreateForm(
  form: CreateForm,
  isRequired: (key: string) => boolean,
  getLabel: (key: string, fallback?: string) => string,
): string | null {
  const checks: { key: string; ok: boolean }[] = [
    { key: "combined_asset_number", ok: Boolean(form.combined_asset_number.trim()) },
    { key: "asset_category_id", ok: Boolean(form.asset_category_id) },
    { key: "plant_id", ok: Boolean(form.plant_id) },
    { key: "cost_center", ok: Boolean(form.cost_center.trim()) },
    { key: "profit_center", ok: Boolean(form.profit_center.trim()) },
    { key: "functional_location", ok: Boolean(form.functional_location.trim()) },
    { key: "actual_location", ok: Boolean(form.actual_location.trim()) },
  ]
  const missing = checks.filter((c) => isRequired(c.key) && !c.ok)
  if (missing.length === 0) return null
  return `${getLabel(missing[0]!.key)} is required.`
}

function strOrNull(v: string): string | null {
  const t = v.trim()
  return t || null
}

function buildCreatePayload(form: CreateForm) {
  const can = form.combined_asset_number.trim()
  const assetName = form.asset_name.trim() || can || form.asset_code.trim() || "Asset"
  return {
    asset_name: assetName,
    asset_code: form.asset_code.trim() || null,
    combined_asset_number: can,
    capitalization_form_id: form.capitalization_form_id
      ? Number(form.capitalization_form_id)
      : null,
    remark: form.remark.trim() || null,
    sub_no: form.sub_no.trim() || null,
    asset_class: strOrNull(form.asset_class),
    asset_type: strOrNull(form.asset_type),
    rfid_code: strOrNull(form.rfid_code),
    tag_color_id:
      form.rfid_code.trim() && form.tag_color_id ? Number(form.tag_color_id) : null,
    asset_custodian_id: form.asset_custodian_id ? Number(form.asset_custodian_id) : null,
    asset_condition_id: form.asset_condition_id ? Number(form.asset_condition_id) : null,
    serial_no: strOrNull(form.serial_no),
    asset_category_id: form.asset_category_id ? Number(form.asset_category_id) : null,
    ownership_type: strOrNull(form.ownership_type),
    information: {
      inventory_no: strOrNull(form.inventory_no),
      asset_description: strOrNull(form.asset_description),
      engineering_description: strOrNull(form.engineering_description),
      qa_description: strOrNull(form.qa_description),
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
        {required ? <RequiredFieldMark /> : null}
      </Label>
      {children}
    </div>
  )
}

export function AssetCreatePage() {
  const navigate = useNavigate()
  const [form, setForm] = React.useState<CreateForm>(EMPTY_FORM)
  const [creating, setCreating] = React.useState(false)
  const [imageFile, setImageFile] = React.useState<File | null>(null)
  const [capexOptions, setCapexOptions] = React.useState<
    { id: number; form_number: string; asset_name: string }[]
  >([])
  const [selectedCapex, setSelectedCapex] = React.useState<CapexFormDetail | null>(null)
  const fc = useAssetFieldConfig()
  const canViewCapex = hasPermission("capitalization.view")

  const plantIdForLookups = form.plant_id ? Number(form.plant_id) : null
  const masters = useAssetMasterLookups(
    plantIdForLookups,
    form.cost_center || null,
    form.functional_location || null,
  )

  const selectedPlant = masters.plants.find((p) => String(p.id) === form.plant_id)
  const costCenterDesc =
    masters.costCenters.find((c) => c.code === form.cost_center)?.name ?? "—"

  const patch = (patch: Partial<CreateForm>) => setForm((f) => ({ ...f, ...patch }))

  const field = (fieldKey: string, node: React.ReactNode) => (fc.isVisible(fieldKey) ? node : null)

  React.useEffect(() => {
    if (!hasPermission("asset.create")) {
      navigate("/dashboard/assets", { replace: true })
    }
  }, [navigate])

  React.useEffect(() => {
    if (!canViewCapex) return
    void getJson<CapexFormListResponse>(
      "/admin/capitalization-forms?available_for_asset=true&page_size=100",
    )
      .then((res) =>
        setCapexOptions(
          res.items.map((i) => ({
            id: i.id,
            form_number: i.form_number,
            asset_name: i.asset_name,
          })),
        ),
      )
      .catch(() => setCapexOptions([]))
  }, [canViewCapex])

  async function onCapexSelect(formId: string) {
    patch({ capitalization_form_id: formId })
    if (!formId) {
      setSelectedCapex(null)
      return
    }
    try {
      const d = await getJson<CapexFormDetail>(`/admin/capitalization-forms/${formId}`)
      setSelectedCapex(d)
      patch({
        capitalization_form_id: formId,
        asset_name: d.asset_name || form.asset_name,
        party_details: d.party_name || form.party_details,
        vendor_name: d.party_name || form.vendor_name,
        life_span: d.useful_life?.replace(/\D/g, "") || form.life_span,
        asset_description: d.asset_specifications || form.asset_description,
        remark: d.functioning_comment || form.remark,
      })
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to load capitalization form")
      setSelectedCapex(null)
    }
  }

  React.useEffect(() => {
    if (masters.plants.length >= 1 && !form.plant_id) {
      patch({ plant_id: String(masters.plants[0].id) })
    }
  }, [masters.plants, form.plant_id])

  async function createAsset() {
    const validationError = validateCreateForm(form, fc.isRequired, fc.getLabel)
    if (validationError) {
      toast.error(validationError)
      return
    }
    setCreating(true)
    try {
      const created = await postJson<AssetDetail>("/admin/assets", buildCreatePayload(form))
      if (imageFile) {
        const body = new FormData()
        body.append("file", imageFile)
        try {
          await putFormData(`/admin/assets/${created.id}/image`, body)
        } catch {
          toast.error("Asset created, but the image could not be uploaded. Add it from Edit.")
        }
      }
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
        {canViewCapex ? (
          <AdminPanel
            title="Capitalization form"
            description="Optional link to an approved CapEx form (one form per asset)."
            contentClassName="px-5 py-5"
          >
            <FormField id="capitalization_form_id" labelText="Approved CapEx form">
              <select
                id="capitalization_form_id"
                className={adminSelectClass}
                value={form.capitalization_form_id}
                onChange={(e) => void onCapexSelect(e.target.value)}
              >
                <option value="">— None —</option>
                {capexOptions.map((o) => (
                  <option key={o.id} value={String(o.id)}>
                    {o.form_number} — {o.asset_name}
                  </option>
                ))}
              </select>
            </FormField>
            {selectedCapex ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Viewing{" "}
                <Link
                  className="text-primary hover:underline"
                  to={`/dashboard/capitalization/${selectedCapex.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selectedCapex.form_number}
                </Link>
                {selectedCapex.auc_code ? ` · AUC ${selectedCapex.auc_code}` : null}
              </p>
            ) : null}
          </AdminPanel>
        ) : null}

        <div className="grid gap-[var(--app-grid-gap)] lg:grid-cols-2">
          <AdminPanel
            title="Asset information"
            description="Core identification fields"
            headerActions={<Package className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="px-5 py-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="app-form-label mb-2 block">Asset image</Label>
                <AssetImage
                  file={imageFile}
                  editable
                  busy={creating}
                  onFileChange={(file) => {
                    const error = validateAssetImageFile(file)
                    if (error) {
                      toast.error(error)
                      return
                    }
                    setImageFile(file)
                  }}
                  onRemove={() => setImageFile(null)}
                />
              </div>
              {field(
                "asset_code",
                <FormField
                  id="asset_code"
                  labelText={fc.getLabel("asset_code", "Asset Number")}
                  required={fc.isRequired("asset_code")}
                >
                  <Input
                    id="asset_code"
                    value={form.asset_code}
                    onChange={(e) => patch({ asset_code: e.target.value })}
                    className="font-mono uppercase"
                    autoFocus
                  />
                </FormField>,
              )}
              {field(
                "rfid_code",
                <FormField id="rfid_code" labelText={fc.getLabel("rfid_code", "RFID Code")}>
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
                </FormField>,
              )}
              {field(
                "combined_asset_number",
                <FormField
                  id="combined_asset_number"
                  labelText={fc.getLabel("combined_asset_number", "Combined Asset No")}
                  required={fc.isRequired("combined_asset_number")}
                >
                  <Input
                    id="combined_asset_number"
                    value={form.combined_asset_number}
                    onChange={(e) => patch({ combined_asset_number: e.target.value })}
                    className="font-mono uppercase"
                  />
                </FormField>,
              )}
              {field(
                "sub_no",
                <FormField id="sub_no" labelText={fc.getLabel("sub_no", "Sub-No")}>
                  <Input
                    id="sub_no"
                    value={form.sub_no}
                    onChange={(e) => patch({ sub_no: e.target.value })}
                  />
                </FormField>,
              )}
              {field(
                "asset_category_id",
                <FormField
                  id="asset_category_id"
                  labelText={fc.getLabel("asset_category_id", "Asset Category")}
                  required={fc.isRequired("asset_category_id")}
                >
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
                </FormField>,
              )}
              {field(
                "asset_class",
                <FormField id="asset_class" labelText={fc.getLabel("asset_class", "Asset Class")}>
                  <Input
                    id="asset_class"
                    value={form.asset_class}
                    onChange={(e) => patch({ asset_class: e.target.value })}
                  />
                </FormField>,
              )}
              {field(
                "asset_type",
                <FormField id="asset_type" labelText={fc.getLabel("asset_type", "Asset Type")}>
                  <Input
                    id="asset_type"
                    value={form.asset_type}
                    onChange={(e) => patch({ asset_type: e.target.value })}
                  />
                </FormField>,
              )}
              {field(
                "asset_condition_id",
                <FormField
                  id="asset_condition_id"
                  labelText={fc.getLabel("asset_condition_id", "Asset Physical Condition")}
                >
                  <select
                    id="asset_condition_id"
                    className={adminSelectClass}
                    value={form.asset_condition_id}
                    onChange={(e) => patch({ asset_condition_id: e.target.value })}
                  >
                    <option value="">—</option>
                    {masters.assetConditions.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {assetConditionLabel(c)}
                      </option>
                    ))}
                  </select>
                </FormField>,
              )}
              {field(
                "remark",
                <FormField id="remark" labelText={fc.getLabel("remark", "Remark")}>
                  <Input
                    id="remark"
                    value={form.remark}
                    onChange={(e) => patch({ remark: e.target.value })}
                  />
                </FormField>,
              )}
              {field(
                "asset_description",
                <FormField
                  id="asset_description"
                  labelText={fc.getLabel("asset_description", "Asset Description")}
                >
                  <Input
                    id="asset_description"
                    value={form.asset_description}
                    onChange={(e) => patch({ asset_description: e.target.value })}
                  />
                </FormField>,
              )}
              {field(
                "asset_custodian_id",
                <FormField
                  id="asset_custodian_id"
                  labelText={fc.getLabel("asset_custodian_id", "Asset Custodian")}
                >
                  <select
                    id="asset_custodian_id"
                    className={adminSelectClass}
                    value={form.asset_custodian_id}
                    onChange={(e) => patch({ asset_custodian_id: e.target.value })}
                  >
                    <option value="">—</option>
                    {masters.custodianUsers.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {assetCustodianLabel(c)}
                      </option>
                    ))}
                  </select>
                </FormField>,
              )}
              {form.rfid_code.trim() && fc.isVisible("tag_color_id") ? (
                <TagColorSelect
                  id="tag_color_id"
                  value={form.tag_color_id}
                  onChange={(v) => patch({ tag_color_id: v })}
                  tagColors={masters.tagColors}
                />
              ) : null}
            </div>
          </AdminPanel>

          <AdminPanel
            title="Location"
            description="Plant is fixed to Takeda"
            headerActions={<MapPin className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="px-5 py-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field(
                "plant_code",
                <FormField
                  labelText="Plant Code"
                >
                  <Input
                    readOnly
                    disabled
                    className="bg-muted/40 font-mono"
                    value={selectedPlant?.code ?? "—"}
                  />
                </FormField>,
              )}
              <FormField
                id="functional_location"
                labelText={fc.getLabel("functional_location", "Actual Location 1")}
                required={fc.isRequired("functional_location")}
              >
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
              <FormField
                labelText="Plant Name"
                required={fc.isRequired("plant_id")}
              >
                <Input
                  readOnly
                  disabled
                  className="bg-muted/40"
                  value={selectedPlant?.name ?? "Takeda"}
                />
              </FormField>
              <FormField
                id="actual_location"
                labelText={fc.getLabel("actual_location", "Actual location 2")}
                required={fc.isRequired("actual_location")}
              >
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
              {field(
                "sub_location",
                <FormField id="sub_location" labelText={fc.getLabel("sub_location", "Sub location")}>
                  <Input id="sub_location" value={form.sub_location} onChange={(e) => patch({ sub_location: e.target.value })} />
                </FormField>,
              )}
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
            </div>
          </AdminPanel>

          <AdminPanel
            title="Financial information"
            description="Cost, capitalization, and life span"
            headerActions={<DollarSign className="size-4 text-muted-foreground" aria-hidden />}
            contentClassName="px-5 py-5"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field(
                "cost_center",
                <FormField
                  id="cost_center"
                  labelText={fc.getLabel("cost_center", "Cost Center")}
                  required={fc.isRequired("cost_center")}
                >
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
                </FormField>,
              )}
              {field(
                "cap_date",
                <FormField id="cap_date" labelText={fc.getLabel("cap_date", "Capitalization Date")}>
                  <Input
                    id="cap_date"
                    type="date"
                    value={form.cap_date}
                    onChange={(e) => patch({ cap_date: e.target.value })}
                  />
                </FormField>,
              )}
              {field(
                "cost_center_name",
                <FormField labelText={fc.getLabel("cost_center_name", "Cost Center Name")}>
                  <Input readOnly disabled className="bg-muted/40" value={costCenterDesc} />
                </FormField>,
              )}
              {field(
                "gross_block",
                <FormField id="gross_block" labelText={fc.getLabel("gross_block", "APC-IGAAP")}>
                  <Input
                    id="gross_block"
                    type="number"
                    step="0.01"
                    value={form.gross_block}
                    onChange={(e) => patch({ gross_block: e.target.value })}
                  />
                </FormField>,
              )}
              {field(
                "party_details",
                <FormField id="party_details" labelText={fc.getLabel("party_details", "Party Details")}>
                  <Input
                    id="party_details"
                    value={form.party_details}
                    onChange={(e) => patch({ party_details: e.target.value })}
                  />
                </FormField>,
              )}
              {field(
                "life_span",
                <FormField id="life_span" labelText={fc.getLabel("life_span", "Life-Span (Years)")}>
                  <Input
                    id="life_span"
                    value={form.life_span}
                    onChange={(e) => patch({ life_span: e.target.value })}
                  />
                </FormField>,
              )}
              {field(
                "profit_center",
                <FormField
                  id="profit_center"
                  labelText={fc.getLabel("profit_center", "Profit center")}
                  required={fc.isRequired("profit_center")}
                >
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
                </FormField>,
              )}
              {field(
                "laboratory",
                <FormField id="laboratory" labelText={fc.getLabel("laboratory", "Laboratory")}>
                  <Input
                    id="laboratory"
                    value={form.laboratory}
                    onChange={(e) => patch({ laboratory: e.target.value })}
                  />
                </FormField>,
              )}
              {field(
                "depreciation_rate",
                <FormField
                  id="depreciation_rate"
                  labelText={fc.getLabel("depreciation_rate", "Rate of depreciation")}
                >
                  <Input
                    id="depreciation_rate"
                    type="number"
                    step="0.0001"
                    value={form.depreciation_rate}
                    onChange={(e) => patch({ depreciation_rate: e.target.value })}
                  />
                </FormField>,
              )}
              {field(
                "put_to_use_date",
                <FormField id="put_to_use_date" labelText={fc.getLabel("put_to_use_date", "Put to use")}>
                  <Input
                    id="put_to_use_date"
                    type="date"
                    value={form.put_to_use_date}
                    onChange={(e) => patch({ put_to_use_date: e.target.value })}
                  />
                </FormField>,
              )}
              {field(
                "vendor_name",
                <FormField id="vendor_name" labelText={fc.getLabel("vendor_name", "Vendor name")}>
                  <Input
                    id="vendor_name"
                    value={form.vendor_name}
                    onChange={(e) => patch({ vendor_name: e.target.value })}
                  />
                </FormField>,
              )}
              {field(
                "po_number",
                <FormField id="po_number" labelText={fc.getLabel("po_number", "PO number")}>
                  <Input
                    id="po_number"
                    value={form.po_number}
                    onChange={(e) => patch({ po_number: e.target.value })}
                  />
                </FormField>,
              )}
              {field(
                "currency",
                <FormField id="currency" labelText={fc.getLabel("currency", "Currency")}>
                  <Input
                    id="currency"
                    value={form.currency}
                    onChange={(e) => patch({ currency: e.target.value })}
                    placeholder="USD"
                  />
                </FormField>,
              )}
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
            <FormField labelText={fc.getLabel("inventory_count", "Inventory count")}>
              <Input readOnly disabled className="bg-muted/40" value="1" />
            </FormField>
            <FormField labelText={fc.getLabel("physical_count", "Physical count")}>
              <Input readOnly disabled className="bg-muted/40" value="0" />
            </FormField>
            <FormField labelText={fc.getLabel("last_verification_date", "Last verification date")}>
              <Input readOnly disabled className="bg-muted/40" value="—" />
            </FormField>
            {field(
              "invoice_no",
              <FormField id="invoice_no" labelText={fc.getLabel("invoice_no", "Invoice no.")}>
                <Input id="invoice_no" value={form.invoice_no} onChange={(e) => patch({ invoice_no: e.target.value })} />
              </FormField>,
            )}
            {field(
              "invoice_date",
              <FormField id="invoice_date" labelText={fc.getLabel("invoice_date", "Invoice date")}>
                <Input
                  id="invoice_date"
                  type="date"
                  value={form.invoice_date}
                  onChange={(e) => patch({ invoice_date: e.target.value })}
                />
              </FormField>,
            )}
            {field(
              "voucher_no",
              <FormField id="voucher_no" labelText={fc.getLabel("voucher_no", "Voucher no.")}>
                <Input id="voucher_no" value={form.voucher_no} onChange={(e) => patch({ voucher_no: e.target.value })} />
              </FormField>,
            )}
            {field(
              "voucher_date",
              <FormField id="voucher_date" labelText={fc.getLabel("voucher_date", "Voucher date")}>
                <Input
                  id="voucher_date"
                  type="date"
                  value={form.voucher_date}
                  onChange={(e) => patch({ voucher_date: e.target.value })}
                />
              </FormField>,
            )}
            {field(
              "grn_no",
              <FormField id="grn_no" labelText={fc.getLabel("grn_no", "GRN no.")}>
                <Input id="grn_no" value={form.grn_no} onChange={(e) => patch({ grn_no: e.target.value })} />
              </FormField>,
            )}
            {field(
              "grn_date",
              <FormField id="grn_date" labelText={fc.getLabel("grn_date", "GRN date")}>
                <Input
                  id="grn_date"
                  type="date"
                  value={form.grn_date}
                  onChange={(e) => patch({ grn_date: e.target.value })}
                />
              </FormField>,
            )}
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
