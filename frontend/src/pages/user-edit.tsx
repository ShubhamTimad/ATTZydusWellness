import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { MultiCheckList } from "@/components/admin/multi-check-list"
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
import { Switch } from "@/components/ui/switch"
import { ApiError, getJson, patchJson } from "@/lib/api"
import { phoneFieldSchema } from "@/lib/phone"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"

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
  org_units?: { id: number; name: string; type: string; code?: string | null }[]
  departments?: { id: number; name: string; type: string; code?: string | null }[]
  cost_centers?: { id: number; code: string; name: string }[]
  org_unit: { id: number; name: string; type: string } | null
  department: { id: number; name: string; type: string; code?: string | null } | null
  cost_center: { id: number; code: string; name: string } | null
}

const editUserSchema = z.object({
  full_name: z.string().min(1, "Full name is required").max(255),
  username: z.string().min(3, "Username is required").max(64),
  phone: phoneFieldSchema,
  email: z.string().email("Enter a valid email"),
  role_id: z.string().min(1, "Role is required"),
  org_unit_ids: z.array(z.string()).min(1, "Select at least one plant"),
  department_ids: z.array(z.string()),
  cost_center_ids: z.array(z.string()),
  is_active: z.boolean(),
})

type EditUserValues = z.infer<typeof editUserSchema>

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
  const skipPlantReset = React.useRef(true)

  const canLoadPlantList = canListOrgUnitsForAssignments()

  const form = useForm<EditUserValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      full_name: "",
      username: "",
      phone: "",
      email: "",
      role_id: "",
      org_unit_ids: [],
      department_ids: [],
      cost_center_ids: [],
      is_active: true,
    },
    mode: "onSubmit",
  })

  const plantIds = form.watch("org_unit_ids")

  React.useEffect(() => {
    if (!roles) return
    const rid = form.getValues("role_id")
    if (!rid) return
    if (!rolesForPlants(roles, plantIds).some((r) => String(r.id) === rid)) {
      form.setValue("role_id", "")
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
            role_id: u.role?.id ? String(u.role.id) : "",
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
      const roleId = Number(values.role_id)
      const orgUnitIds = values.org_unit_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      if (!Number.isFinite(roleId) || roleId <= 0) {
        toast.error("Role is required", { id: "edit-user" })
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
        role_id: roleId,
        org_unit_ids: orgUnitIds,
        department_ids: values.department_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0),
        cost_center_ids: values.cost_center_ids
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0),
        is_active: values.is_active,
      })
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
      <AdminPage fullWidth description="Loading…" actions={<AdminBackLink to=".." />}>
        <p className="text-sm text-muted-foreground">Please wait.</p>
      </AdminPage>
    )
  }

  return (
    <AdminPage
      fullWidth
      description="Plant is required. Department is optional — plant + cost center, or plant + department + cost center."
      actions={<AdminBackLink to=".." />}
    >
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
        <AdminPanel title={user.full_name} description="Make changes and save." contentClassName="px-5 py-5">
          <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="edit-full-name">Full name</Label>
                <Input id="edit-full-name" {...form.register("full_name")} disabled={user.is_superuser} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="edit-username">Username</Label>
                <Input id="edit-username" {...form.register("username")} disabled={user.is_superuser} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Phone</Label>
                <Input id="edit-phone" maxLength={10} {...form.register("phone")} disabled={user.is_superuser} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input id="edit-email" type="email" {...form.register("email")} disabled={user.is_superuser} />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>Plants</Label>
                <MultiCheckList
                  options={(plants ?? []).map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }))}
                  values={plantIds}
                  onChange={(next) =>
                    form.setValue("org_unit_ids", next, { shouldDirty: true, shouldValidate: true })
                  }
                  disabled={user.is_superuser}
                  emptyLabel="No plants available."
                />
              </div>
              <div className="space-y-2">
                <Label>Departments (optional)</Label>
                <MultiCheckList
                  options={departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` }))}
                  values={form.watch("department_ids")}
                  onChange={(next) => form.setValue("department_ids", next, { shouldDirty: true })}
                  disabled={user.is_superuser || plantIds.length === 0}
                  emptyLabel="Select at least one plant first…"
                />
                <p className="text-xs text-muted-foreground">
                  Skip if the user only needs plant and cost center.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Cost centers (optional)</Label>
                <MultiCheckList
                  options={costCenters.map((c) => ({
                    id: c.id,
                    label: c.code,
                    title: `${c.code} — ${c.name}`,
                  }))}
                  values={form.watch("cost_center_ids")}
                  onChange={(next) => form.setValue("cost_center_ids", next, { shouldDirty: true })}
                  disabled={user.is_superuser || plantIds.length === 0}
                  emptyLabel="Select at least one plant first…"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Role</Label>
                <select className={adminSelectClass} {...form.register("role_id")} disabled={user.is_superuser}>
                  <option value="">Select a role…</option>
                  {rolesForPlants(roles, plantIds).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between gap-3 sm:col-span-2">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Active</div>
                  <div className="text-xs text-muted-foreground">
                    Inactive users cannot sign in and will not receive emails.
                  </div>
                </div>
                <Switch
                  checked={form.watch("is_active")}
                  onCheckedChange={(v) => form.setValue("is_active", v, { shouldDirty: true })}
                  disabled={user.is_superuser}
                />
              </div>
            </div>
            <div className="sticky bottom-0 z-10 -mx-5 mt-1 flex justify-end gap-2 border-t border-border/60 bg-card/95 px-5 pt-4 pb-5 backdrop-blur supports-[backdrop-filter]:bg-card/90">
              <Button type="button" variant="outline" className="h-9 shadow-sm" onClick={() => navigate("..")}>
                Cancel
              </Button>
              <AdminPrimaryButton type="submit" disabled={form.formState.isSubmitting || user.is_superuser}>
                {form.formState.isSubmitting ? "Saving…" : "Save changes"}
              </AdminPrimaryButton>
            </div>
          </form>
        </AdminPanel>
      )}
    </AdminPage>
  )
}
