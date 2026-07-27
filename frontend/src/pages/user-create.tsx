import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

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
import { ApiError, getJson, postJson } from "@/lib/api"
import { phoneFieldSchema } from "@/lib/phone"
import { canListOrgUnitsForAssignments, hasPermission } from "@/lib/permissions"
import { MultiCheckList } from "@/components/admin/multi-check-list"

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
  role_id: z.string().min(1, "Role is required"),
  org_unit_ids: z.array(z.string()).min(1, "Select at least one plant"),
  department_ids: z.array(z.string()),
  cost_center_ids: z.array(z.string()),
  is_active: z.boolean(),
})

type CreateUserValues = z.infer<typeof createUserSchema>

export function UserCreatePage() {
  const navigate = useNavigate()
  const [roles, setRoles] = React.useState<RoleListItem[] | null>(null)
  const [plants, setPlants] = React.useState<OrgUnitPublic[] | null>(null)
  const [departments, setDepartments] = React.useState<OrgUnitPublic[]>([])
  const [costCenters, setCostCenters] = React.useState<CostCenterOption[]>([])
  const [error, setError] = React.useState<string | null>(null)

  const canLoadPlantList = canListOrgUnitsForAssignments()

  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
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
      const roleId = Number(values.role_id)
      const orgUnitIds = values.org_unit_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      if (!Number.isFinite(roleId) || roleId <= 0) {
        toast.error("Role is required", { id: "create-user" })
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
        role_id: roleId,
        org_unit_ids: orgUnitIds,
        department_ids: values.department_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0),
        cost_center_ids: values.cost_center_ids
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0),
        is_active: values.is_active,
      })
      toast.success("User created", { id: "create-user" })
      navigate(`../${created.id}`, { replace: true })
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed to create user"
      toast.error(message, { id: "create-user" })
      setError(message)
    }
  }

  return (
    <AdminPage
      fullWidth
      description="Plant is required. Department is optional — you can assign plant + cost center only, or plant + department + cost center."
      actions={<AdminBackLink to=".." />}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <AdminPanel title="User details" description="Name, contact, at least one plant, and role are required. Department is optional." contentClassName="px-5 py-5">
        <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="create-full-name">Full name</Label>
              <Input id="create-full-name" autoComplete="name" {...form.register("full_name")} />
              {form.formState.errors.full_name?.message ? (
                <p className="text-xs text-destructive">{form.formState.errors.full_name.message}</p>
              ) : null}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="create-username">Username</Label>
              <Input id="create-username" autoComplete="username" {...form.register("username")} />
              {form.formState.errors.username?.message ? (
                <p className="text-xs text-destructive">{form.formState.errors.username.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-phone">Phone</Label>
              <Input
                id="create-phone"
                autoComplete="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="e.g. 9876543210"
                {...form.register("phone")}
              />
              {form.formState.errors.phone?.message ? (
                <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-email">Email</Label>
              <Input id="create-email" type="email" autoComplete="email" {...form.register("email")} />
              {form.formState.errors.email?.message ? (
                <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
              ) : null}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>Plants</Label>
              <MultiCheckList
                options={(plants ?? []).map((p) => ({
                  id: p.id,
                  label: `${p.code} — ${p.name}`,
                }))}
                values={plantIds}
                onChange={(next) => form.setValue("org_unit_ids", next, { shouldDirty: true, shouldValidate: true })}
                emptyLabel="No plants available."
              />
              {form.formState.errors.org_unit_ids?.message ? (
                <p className="text-xs text-destructive">{form.formState.errors.org_unit_ids.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>Departments (optional)</Label>
              <MultiCheckList
                options={departments.map((d) => ({
                  id: d.id,
                  label: `${d.code} — ${d.name}`,
                }))}
                values={form.watch("department_ids")}
                onChange={(next) => form.setValue("department_ids", next, { shouldDirty: true })}
                disabled={plantIds.length === 0}
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
                  label: `${c.code} — ${c.name}`,
                }))}
                values={form.watch("cost_center_ids")}
                onChange={(next) => form.setValue("cost_center_ids", next, { shouldDirty: true })}
                disabled={plantIds.length === 0}
                emptyLabel="Select at least one plant first…"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label>Role</Label>
              <select className={adminSelectClass} {...form.register("role_id")}>
                <option value="">Select a role…</option>
                {rolesForPlants(roles, plantIds).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              {form.formState.errors.role_id?.message ? (
                <p className="text-xs text-destructive">{form.formState.errors.role_id.message}</p>
              ) : null}
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
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-border/60 pt-4">
            <Button type="button" variant="outline" className="h-9 shadow-sm" onClick={() => navigate("..")}>
              Cancel
            </Button>
            <AdminPrimaryButton type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Creating…" : "Create user"}
            </AdminPrimaryButton>
          </div>
        </form>
      </AdminPanel>
    </AdminPage>
  )
}
