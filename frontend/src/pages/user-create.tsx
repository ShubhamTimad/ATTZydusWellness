import * as React from "react"
import { Building2, Info, UserRound } from "lucide-react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { AssetImage, validateAssetImageFile } from "@/components/assets/asset-image"
import { RequiredFieldMark } from "@/components/assets/required-field-mark"
import { AdminPage } from "@/components/layout/admin-page"
import {
  AdminBackLink,
  AdminPanel,
  AdminPrimaryButton,
  adminSelectClass,
} from "@/components/layout/admin-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, getJson, postJson, putFormData } from "@/lib/api"
import { phoneFieldSchema } from "@/lib/phone"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"
import { MultiCheckList } from "@/components/admin/multi-check-list"
import { cn } from "@/lib/utils"

type RoleListItem = { id: number; name: string; org_unit_ids?: number[] }

function rolesForPlants(all: RoleListItem[] | null, plantIds: string[]): RoleListItem[] {
  if (!all) return []
  const selected = new Set(plantIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))
  if (selected.size === 0) return all
  return all.filter((r) => {
    const ids = r.org_unit_ids ?? []
    if (ids.length === 0) return true
    return ids.some((id) => selected.has(id))
  })
}

type OrgUnitPublic = {
  id: number
  name: string
  code: string
  type: string
  parent_id: number | null
}

type CostCenterOption = {
  id: number
  code: string
  name: string
  plant_id: number
}

type UserPublic = {
  id: number
}

const createUserSchema = z.object({
  full_name: z.string().min(1, "Full name is required").max(255),
  username: z.string().min(3, "Username is required").max(64),
  phone: phoneFieldSchema,
  email: z.string().email("Enter a valid email"),
  role_ids: z.array(z.string()).min(1, "Select at least one role"),
  org_unit_ids: z.array(z.string()).min(1, "Select at least one plant"),
  department_ids: z.array(z.string()),
  cost_center_ids: z.array(z.string()),
  is_active: z.boolean(),
})

type CreateUserValues = z.infer<typeof createUserSchema>

function FormField({
  id,
  labelText,
  required,
  hint,
  error,
  className,
  children,
}: {
  id?: string
  labelText: string
  required?: boolean
  hint?: string
  error?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("app-form-field", className)}>
      <Label htmlFor={id} className="app-form-label uppercase">
        {labelText}
        {required ? <RequiredFieldMark /> : null}
        {hint ? (
          <span
            tabIndex={0}
            className="group relative ml-1 inline-flex align-middle outline-none"
            aria-label={hint}
          >
            <Info className="size-3.5 text-muted-foreground" aria-hidden />
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-56 -translate-x-1/2 rounded-md bg-foreground px-2.5 py-1.5 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-background shadow-md group-hover:block group-focus-visible:block"
            >
              {hint}
            </span>
          </span>
        ) : null}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

export function UserCreatePage() {
  const navigate = useNavigate()
  const [roles, setRoles] = React.useState<RoleListItem[] | null>(null)
  const [plants, setPlants] = React.useState<OrgUnitPublic[] | null>(null)
  const [departments, setDepartments] = React.useState<OrgUnitPublic[]>([])
  const [costCenters, setCostCenters] = React.useState<CostCenterOption[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [photoFile, setPhotoFile] = React.useState<File | null>(null)

  const canLoadPlantList = canListOrgUnitsForAssignments()

  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      full_name: "",
      username: "",
      phone: "",
      email: "",
      role_ids: [],
      org_unit_ids: [],
      department_ids: [],
      cost_center_ids: [],
      is_active: true,
    },
    mode: "onSubmit",
  })

  const plantIds = form.watch("org_unit_ids")
  const plantChosen = plantIds.length > 0

  React.useEffect(() => {
    if (!plants || plants.length !== 1) return
    if (form.getValues("org_unit_ids").length > 0) return
    form.setValue("org_unit_ids", [String(plants[0].id)], { shouldDirty: false, shouldValidate: true })
  }, [plants, form])

  React.useEffect(() => {
    if (!roles) return
    const allowed = new Set(rolesForPlants(roles, plantIds).map((r) => String(r.id)))
    const current = form.getValues("role_ids")
    const next = current.filter((id) => allowed.has(id))
    if (next.length !== current.length) {
      form.setValue("role_ids", next)
    }
  }, [plantIds, roles, form])

  React.useEffect(() => {
    form.setValue("department_ids", [])
    form.setValue("cost_center_ids", [])
    if (plantIds.length === 0) {
      setDepartments([])
      setCostCenters([])
      return
    }
    void (async () => {
      try {
        const depLists = await Promise.all(
          plantIds.map((pid) =>
            getJson<OrgUnitPublic[]>(`/admin/org-units?type=DEPARTMENT&parent_id=${pid}`),
          ),
        )
        const ccLists = await Promise.all(
          plantIds.map((pid) =>
            getJson<CostCenterOption[]>(
              `/admin/asset-masters/cost-centers?plant_id=${pid}&active_only=true`,
            ),
          ),
        )
        const deptMap = new Map<number, OrgUnitPublic>()
        for (const list of depLists) for (const d of list) deptMap.set(d.id, d)
        const ccMap = new Map<number, CostCenterOption>()
        for (const list of ccLists) for (const c of list) ccMap.set(c.id, c)
        setDepartments([...deptMap.values()])
        setCostCenters([...ccMap.values()])
      } catch {
        setDepartments([])
        setCostCenters([])
      }
    })()
  }, [plantIds.join(","), form])

  React.useEffect(() => {
    if (!hasPermission("users.create")) {
      navigate("..", { replace: true })
      return
    }
    void (async () => {
      setError(null)
      try {
        const r = await getJson<RoleListItem[]>("/admin/roles?skip=0&limit=200")
        setRoles(r)
        if (canLoadPlantList) {
          try {
            const p = await getJson<OrgUnitPublic[]>("/admin/org-units?type=PLANT")
            setPlants(p)
          } catch {
            setPlants([])
          }
        } else {
          setPlants([])
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load form options")
        setRoles([])
        setPlants([])
      }
    })()
  }, [navigate, canLoadPlantList])

  async function onSubmit(values: CreateUserValues) {
    toast.loading("Creating user…", { id: "create-user" })
    setError(null)
    try {
      const roleIds = values.role_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      const orgUnitIds = values.org_unit_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      if (roleIds.length === 0) {
        toast.error("Select at least one role", { id: "create-user" })
        return
      }
      if (orgUnitIds.length === 0) {
        toast.error("Select at least one plant", { id: "create-user" })
        return
      }
      const created = await postJson<UserPublic>("/admin/users", {
        full_name: values.full_name.trim(),
        username: values.username.trim(),
        phone: values.phone.trim(),
        email: values.email.trim(),
        role_ids: roleIds,
        org_unit_ids: orgUnitIds,
        department_ids: values.department_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0),
        cost_center_ids: values.cost_center_ids
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0),
        is_active: values.is_active,
      })
      if (photoFile) {
        const body = new FormData()
        body.append("file", photoFile)
        try {
          await putFormData(`/admin/users/${created.id}/photo`, body)
        } catch {
          toast.error("User created, but the photo could not be uploaded.")
        }
      }
      toast.success("User created", { id: "create-user" })
      navigate(`../${created.id}`, { replace: true })
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to create user"
      toast.error(message, { id: "create-user" })
      setError(message)
    }
  }

  return (
    <AdminPage fullWidth dense className="w-full pb-6" actions={<AdminBackLink to=".." />}>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl truncate">
            Create User
          </h1>
        </div>
      </header>

      <form
        id="create-user-form"
        className="space-y-[var(--app-grid-gap)]"
        onSubmit={form.handleSubmit(onSubmit)}
      >
        <AdminPanel
          title="PROFILE"
          headerActions={<UserRound className="size-4 text-primary" aria-hidden />}
          contentClassName="px-5 py-5"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField
              id="create-full-name"
              labelText="Full Name"
              required
              error={form.formState.errors.full_name?.message}
            >
              <Input id="create-full-name" autoComplete="name" {...form.register("full_name")} />
            </FormField>
            <FormField
              id="create-username"
              labelText="Username"
              required
              error={form.formState.errors.username?.message}
            >
              <Input id="create-username" autoComplete="username" {...form.register("username")} />
            </FormField>
            <FormField
              id="create-phone"
              labelText="Phone"
              required
              error={form.formState.errors.phone?.message}
            >
              <Input
                id="create-phone"
                autoComplete="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="e.g. 9876543210"
                {...form.register("phone")}
              />
            </FormField>
            <FormField
              id="create-email"
              labelText="Email"
              required
              error={form.formState.errors.email?.message}
            >
              <Input id="create-email" type="email" autoComplete="email" {...form.register("email")} />
            </FormField>
            <FormField
              id="create-is-active"
              labelText="Active"
              hint="Inactive users cannot sign in and will not receive emails."
            >
              <select
                id="create-is-active"
                className={adminSelectClass}
                value={form.watch("is_active") ? "true" : "false"}
                onChange={(e) =>
                  form.setValue("is_active", e.target.value === "true", { shouldDirty: true })
                }
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </FormField>
            <FormField labelText="Photo">
              <AssetImage
                label="Photo"
                file={photoFile}
                editable
                busy={form.formState.isSubmitting}
                onFileChange={(file) => {
                  const message = validateAssetImageFile(file, "Photo")
                  if (message) {
                    toast.error(message)
                    return
                  }
                  setPhotoFile(file)
                }}
                onRemove={() => setPhotoFile(null)}
              />
            </FormField>
          </div>
        </AdminPanel>

        <AdminPanel
          title="ASSIGNMENT"
          headerActions={<Building2 className="size-4 text-primary" aria-hidden />}
          contentClassName="px-5 py-5"
        >
          <div className="grid min-w-0 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
            <FormField
              labelText="Plant"
              required
              error={form.formState.errors.org_unit_ids?.message}
            >
              <MultiCheckList
                options={(plants ?? []).map((p) => ({
                  id: p.id,
                  label: `${p.code} — ${p.name}`,
                }))}
                values={plantIds}
                onChange={(next) =>
                  form.setValue("org_unit_ids", next, { shouldDirty: true, shouldValidate: true })
                }
                emptyLabel="No plants available."
              />
            </FormField>
            <FormField labelText="Cost Center">
              <MultiCheckList
                options={costCenters.map((c) => ({
                  id: c.id,
                  label: c.code,
                  title: `${c.code} — ${c.name}`,
                }))}
                values={form.watch("cost_center_ids")}
                onChange={(next) => form.setValue("cost_center_ids", next, { shouldDirty: true })}
                disabled={!plantChosen}
                selectAll
                emptyLabel={plantChosen ? "No cost centers available." : "Select a plant first"}
              />
            </FormField>
            <FormField
              labelText="Roles"
              required
              error={form.formState.errors.role_ids?.message}
            >
              <MultiCheckList
                options={rolesForPlants(roles, plantIds).map((r) => ({ id: r.id, label: r.name }))}
                values={form.watch("role_ids")}
                onChange={(next) =>
                  form.setValue("role_ids", next, { shouldDirty: true, shouldValidate: true })
                }
                disabled={!plantChosen}
                emptyLabel={plantChosen ? "No roles available." : "Select a plant first"}
              />
            </FormField>
            {departments.length > 0 ? (
              <FormField labelText="Department">
                <MultiCheckList
                  options={departments.map((d) => ({
                    id: d.id,
                    label: `${d.code} — ${d.name}`,
                  }))}
                  values={form.watch("department_ids")}
                  onChange={(next) => form.setValue("department_ids", next, { shouldDirty: true })}
                  emptyLabel="No departments available."
                />
              </FormField>
            ) : null}
          </div>
        </AdminPanel>

        <div className="flex justify-end gap-2 border-t border-border/60 pt-4">
          <Button type="button" variant="outline" className="h-9 shadow-sm" onClick={() => navigate("..")}>
            Cancel
          </Button>
          <AdminPrimaryButton type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Creating…" : "Create User"}
          </AdminPrimaryButton>
        </div>
      </form>
    </AdminPage>
  )
}
