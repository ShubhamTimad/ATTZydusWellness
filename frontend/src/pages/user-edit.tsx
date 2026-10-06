import * as React from "react"
import { Building2, Info, UserRound } from "lucide-react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { MultiCheckList } from "@/components/admin/multi-check-list"
import { AssetImage, validateAssetImageFile } from "@/components/assets/asset-image"
import { RequiredFieldMark } from "@/components/assets/required-field-mark"
import { AdminPage } from "@/components/layout/admin-page"
import { PageLoader } from "@/components/ui/page-loader"
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
import { ApiError, deleteJson, getBlob, getJson, patchJson, putFormData } from "@/lib/api"
import { phoneFieldSchema } from "@/lib/phone"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"
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
  full_name: string
  username: string
  phone: string | null
  email: string | null
  is_active: boolean
  is_superuser: boolean
  role: { id: number; name: string } | null
  roles?: { id: number; name: string }[]
  org_units?: { id: number; name: string; type: string; code?: string | null }[]
  departments?: { id: number; name: string; type: string; code?: string | null }[]
  cost_centers?: { id: number; code: string; name: string }[]
  org_unit: { id: number; name: string; type: string } | null
  department: { id: number; name: string; type: string; code?: string | null } | null
  cost_center: { id: number; code: string; name: string } | null
  has_photo?: boolean
}

const editUserSchema = z.object({
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

type EditUserValues = z.infer<typeof editUserSchema>

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

export function UserEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [user, setUser] = React.useState<UserPublic | null>(null)
  const [roles, setRoles] = React.useState<RoleListItem[] | null>(null)
  const [plants, setPlants] = React.useState<OrgUnitPublic[] | null>(null)
  const [departments, setDepartments] = React.useState<OrgUnitPublic[]>([])
  const [costCenters, setCostCenters] = React.useState<CostCenterOption[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [photoFile, setPhotoFile] = React.useState<File | null>(null)
  const [photoUrl, setPhotoUrl] = React.useState<string | null>(null)
  const [removePhoto, setRemovePhoto] = React.useState(false)
  const skipPlantReset = React.useRef(true)

  const canLoadPlantList = canListOrgUnitsForAssignments()

  const form = useForm<EditUserValues>({
    resolver: zodResolver(editUserSchema),
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
    setPhotoUrl(null)
    if (!user?.id || !user.has_photo) return
    let cancelled = false
    let objectUrl: string | null = null
    void getBlob(`/admin/users/${user.id}/photo`)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setPhotoUrl(objectUrl)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [user?.id, user?.has_photo])

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
    if (skipPlantReset.current) {
      skipPlantReset.current = false
      return
    }
    form.setValue("department_ids", [])
    form.setValue("cost_center_ids", [])
  }, [plantIds.join(","), form])

  React.useEffect(() => {
    const userId = Number(id)
    if (!hasPermission("users.update") || !Number.isFinite(userId) || userId <= 0) {
      navigate("..", { replace: true })
      return
    }
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [all, r] = await Promise.all([
          getJson<UserPublic[]>("/admin/users?skip=0&limit=200"),
          getJson<RoleListItem[]>("/admin/roles?skip=0&limit=200"),
        ])
        const u = all.find((x) => x.id === userId) ?? null
        setUser(u)
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

        if (u) {
          skipPlantReset.current = true
          const orgIds =
            u.org_units && u.org_units.length > 0
              ? u.org_units.map((o) => String(o.id))
              : u.org_unit?.id
                ? [String(u.org_unit.id)]
                : []
          const deptIds =
            u.departments && u.departments.length > 0
              ? u.departments.map((d) => String(d.id))
              : u.department?.id
                ? [String(u.department.id)]
                : []
          const ccIds =
            u.cost_centers && u.cost_centers.length > 0
              ? u.cost_centers.map((c) => String(c.id))
              : u.cost_center?.id
                ? [String(u.cost_center.id)]
                : []
          form.reset({
            full_name: u.full_name,
            username: u.username ?? "",
            phone: u.phone ?? "",
            email: u.email ?? "",
            role_ids:
              u.roles && u.roles.length > 0
                ? u.roles.map((r) => String(r.id))
                : u.role?.id
                  ? [String(u.role.id)]
                  : [],
            org_unit_ids: orgIds,
            department_ids: deptIds,
            cost_center_ids: ccIds,
            is_active: u.is_active,
          })
        }
      } catch (e) {
        const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to load user"
        setError(message)
      } finally {
        setLoading(false)
      }
    })()
  }, [id, navigate, canLoadPlantList, form])

  async function onSubmit(values: EditUserValues) {
    if (!user) return
    toast.loading("Saving user…", { id: "edit-user" })
    setError(null)
    try {
      const roleIds = values.role_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      const orgUnitIds = values.org_unit_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      if (roleIds.length === 0) {
        toast.error("Select at least one role", { id: "edit-user" })
        return
      }
      if (orgUnitIds.length === 0) {
        toast.error("Select at least one plant", { id: "edit-user" })
        return
      }
      await patchJson<UserPublic>(`/admin/users/${user.id}`, {
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
          await putFormData(`/admin/users/${user.id}/photo`, body)
        } catch {
          toast.error("User updated, but the photo could not be uploaded.")
        }
      } else if (removePhoto && user.has_photo) {
        try {
          await deleteJson(`/admin/users/${user.id}/photo`)
        } catch {
          toast.error("User updated, but the photo could not be removed.")
        }
      }
      toast.success("User updated", { id: "edit-user" })
      navigate(`../${user.id}`, { replace: true })
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to update user"
      toast.error(message, { id: "edit-user" })
      setError(message)
    }
  }

  if (loading) {
    return (
      <AdminPage fullWidth dense viewportFill className="w-full pb-6" actions={<AdminBackLink to=".." />}>
        <PageLoader label="Loading user" />
      </AdminPage>
    )
  }

  const locked = Boolean(user?.is_superuser)

  return (
    <AdminPage fullWidth dense className="w-full pb-6" actions={<AdminBackLink to=".." />}>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!user ? (
        <Alert>
          <AlertTitle>User not found</AlertTitle>
          <AlertDescription>This user may have been deleted or is outside the loaded range.</AlertDescription>
        </Alert>
      ) : (
        <>
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl truncate">
                Edit User
              </h1>
            </div>
          </header>

          {locked ? (
            <Alert>
              <AlertTitle>Superuser accounts cannot be edited here.</AlertTitle>
            </Alert>
          ) : null}

          <form
            id="edit-user-form"
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
                  id="edit-full-name"
                  labelText="Full Name"
                  required
                  error={form.formState.errors.full_name?.message}
                >
                  <Input id="edit-full-name" {...form.register("full_name")} disabled={locked} />
                </FormField>
                <FormField
                  id="edit-username"
                  labelText="Username"
                  required
                  error={form.formState.errors.username?.message}
                >
                  <Input id="edit-username" {...form.register("username")} disabled={locked} />
                </FormField>
                <FormField
                  id="edit-phone"
                  labelText="Phone"
                  required
                  error={form.formState.errors.phone?.message}
                >
                  <Input
                    id="edit-phone"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="e.g. 9876543210"
                    {...form.register("phone")}
                    disabled={locked}
                  />
                </FormField>
                <FormField
                  id="edit-email"
                  labelText="Email"
                  required
                  error={form.formState.errors.email?.message}
                >
                  <Input id="edit-email" type="email" {...form.register("email")} disabled={locked} />
                </FormField>
                <FormField
                  id="edit-is-active"
                  labelText="Active"
                  hint="Inactive users cannot sign in and will not receive emails."
                >
                  <select
                    id="edit-is-active"
                    className={adminSelectClass}
                    value={form.watch("is_active") ? "true" : "false"}
                    onChange={(e) =>
                      form.setValue("is_active", e.target.value === "true", { shouldDirty: true })
                    }
                    disabled={locked}
                  >
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </FormField>
                <FormField labelText="Photo">
                  <AssetImage
                    label="Photo"
                    imageUrl={removePhoto ? null : photoUrl}
                    file={photoFile}
                    editable={!locked}
                    busy={form.formState.isSubmitting}
                    onFileChange={(file) => {
                      const message = validateAssetImageFile(file, "Photo")
                      if (message) {
                        toast.error(message)
                        return
                      }
                      setPhotoFile(file)
                      setRemovePhoto(false)
                    }}
                    onRemove={() => {
                      setPhotoFile(null)
                      setRemovePhoto(true)
                    }}
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
                  labelText="Plants"
                  required
                  error={form.formState.errors.org_unit_ids?.message}
                >
                  <MultiCheckList
                    options={(plants ?? []).map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }))}
                    values={plantIds}
                    onChange={(next) =>
                      form.setValue("org_unit_ids", next, { shouldDirty: true, shouldValidate: true })
                    }
                    disabled={locked}
                    emptyLabel="No plants available."
                  />
                </FormField>
                <FormField labelText="Cost Centers">
                  <MultiCheckList
                    options={costCenters.map((c) => ({
                      id: c.id,
                      label: c.code,
                      title: `${c.code} — ${c.name}`,
                    }))}
                    values={form.watch("cost_center_ids")}
                    onChange={(next) => form.setValue("cost_center_ids", next, { shouldDirty: true })}
                    disabled={locked || !plantChosen}
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
                    disabled={locked || !plantChosen}
                    emptyLabel={plantChosen ? "No roles available." : "Select a plant first"}
                  />
                </FormField>
                {departments.length > 0 ? (
                  <FormField labelText="Departments">
                    <MultiCheckList
                      options={departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` }))}
                      values={form.watch("department_ids")}
                      onChange={(next) => form.setValue("department_ids", next, { shouldDirty: true })}
                      disabled={locked}
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
              <AdminPrimaryButton type="submit" disabled={form.formState.isSubmitting || locked}>
                {form.formState.isSubmitting ? "Saving…" : "Save Changes"}
              </AdminPrimaryButton>
            </div>
          </form>
        </>
      )}
    </AdminPage>
  )
}
