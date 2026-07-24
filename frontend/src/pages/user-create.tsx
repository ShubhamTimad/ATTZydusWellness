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

type RoleListItem = { id: number; name: string; org_unit_ids?: number[] }

function rolesForPlant(all: RoleListItem[] | null, plantId: string): RoleListItem[] {
  if (!all) return []
  const pid = Number(plantId)
  if (!plantId || !Number.isFinite(pid)) return all
  return all.filter((r) => {
    const ids = r.org_unit_ids ?? []
    if (ids.length === 0) return true
    return ids.includes(pid)
  })
}

type OrgUnitPublic = {
  id: number
  name: string
  code: string
  type: string
  parent_id: number | null
  created_at: string
  updated_at: string
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
  org_unit: { id: number; name: string; type: string } | null
  created_at: string
  updated_at: string
}

const createUserSchema = z.object({
  full_name: z.string().min(1, "Full name is required").max(255),
  username: z.string().min(3, "Username is required").max(64),
  phone: phoneFieldSchema,
  email: z.string().email("Enter a valid email"),
  role_id: z.string().min(1, "Role is required"),
  org_unit_id: z.string().min(1, "Plant is required"),
  is_active: z.boolean(),
})

type CreateUserValues = z.infer<typeof createUserSchema>

export function UserCreatePage() {
  const navigate = useNavigate()
  const [roles, setRoles] = React.useState<RoleListItem[] | null>(null)
  const [plants, setPlants] = React.useState<OrgUnitPublic[] | null>(null)
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
      org_unit_id: "",
      is_active: true,
    },
    mode: "onSubmit",
  })

  const plantId = form.watch("org_unit_id")

  React.useEffect(() => {
    if (!roles) return
    const rid = form.getValues("role_id")
    if (!rid) return
    if (!rolesForPlant(roles, plantId).some((r) => String(r.id) === rid)) {
      form.setValue("role_id", "")
    }
  }, [plantId, roles, form])

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
      const email = values.email.trim()
      const roleId = Number(values.role_id)
      const orgUnitId = Number(values.org_unit_id)
      if (!Number.isFinite(roleId) || roleId <= 0) {
        toast.error("Role is required", { id: "create-user" })
        return
      }
      if (!Number.isFinite(orgUnitId) || orgUnitId <= 0) {
        toast.error("Plant is required", { id: "create-user" })
        return
      }
      const created = await postJson<UserPublic>("/admin/users", {
        full_name: values.full_name.trim(),
        username: values.username.trim(),
        phone: values.phone.trim(),
        email,
        role_id: roleId,
        org_unit_id: orgUnitId,
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
      description="Choose a plant, then a role for that plant. The user is activated immediately and a temporary password is emailed (if configured)."
      actions={<AdminBackLink to=".." />}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <AdminPanel title="User details" description="All fields are required." contentClassName="px-5 py-5">
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

              <div className="space-y-2">
                <Label>Plant</Label>
                <select className={adminSelectClass} {...form.register("org_unit_id")}>
                  <option value="">Select a plant…</option>
                  {(plants ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </option>
                  ))}
                </select>
                {form.formState.errors.org_unit_id?.message ? (
                  <p className="text-xs text-destructive">{form.formState.errors.org_unit_id.message}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label>Role</Label>
                <select className={adminSelectClass} {...form.register("role_id")}>
                  <option value="">Select a role…</option>
                  {rolesForPlant(roles, plantId).map((r) => (
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

