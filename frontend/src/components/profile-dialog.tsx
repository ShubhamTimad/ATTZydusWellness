import * as React from "react"
import { Building2, Mail, Phone, Shield, User } from "lucide-react"

import { AdminStatusBadge } from "@/components/layout/admin-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { getJson } from "@/lib/api"
type MeProfile = {
  id: number
  full_name: string
  email: string | null
  phone: string | null
  role: string | null
  org_unit: string | null
  is_active: boolean
  is_superuser: boolean
  created_at: string
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    })
  } catch {
    return iso
  }
}

function profileInitials(name: string, email: string | null): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase()
  }
  const raw = (email ?? name).trim()
  const left = raw.split("@")[0] ?? raw
  const segs = left.split(/[.\-_ ]+/).filter(Boolean)
  const a = (segs[0]?.[0] ?? left[0] ?? "?").toUpperCase()
  const b = (segs[1]?.[0] ?? left[1] ?? "").toUpperCase()
  return `${a}${b}`.slice(0, 2)
}

function ProfileRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/40 bg-muted/20 px-4 py-3 transition-colors hover:bg-muted/35">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        <p className="mt-0.5 text-sm font-medium leading-snug text-foreground">{value}</p>
      </div>
    </div>
  )
}

export type ProfileDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProfileDialog({ open, onOpenChange }: ProfileDialogProps) {
  const [me, setMe] = React.useState<MeProfile | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const data = await getJson<MeProfile>("/me")
        if (!cancelled) {
          setMe(data)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setMe(null)
          setError(e instanceof Error ? e.message : "Could not load your profile.")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const initials = me ? profileInitials(me.full_name, me.email) : "?"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 sm:max-w-[420px]" showCloseButton>
        <div className="dialog-surface-header -mx-0 border-b border-primary/10">
          <DialogHeader className="px-0 pt-0">
            <DialogTitle className="sr-only">My profile</DialogTitle>
            <DialogDescription className="sr-only">
              Your account details and plant assignment.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center gap-4 py-2">
              <div className="size-14 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 animate-pulse rounded-md bg-muted" />
                <div className="h-3 w-40 animate-pulse rounded-md bg-muted/80" />
              </div>
            </div>
          ) : me ? (
            <div className="flex items-center gap-4">
              <Avatar className="size-14 ring-2 ring-primary/20 ring-offset-2 ring-offset-card">
                <AvatarFallback className="bg-primary text-base font-semibold text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold tracking-tight text-foreground">
                  {me.full_name}
                </p>
                <p className="truncate text-sm text-muted-foreground">{me.email ?? "No email"}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <AdminStatusBadge active={me.is_active} />
                  {me.is_superuser ? (
                    <Badge
                      variant="outline"
                      className="rounded-md border-primary/30 bg-primary/5 text-primary"
                    >
                      Superuser
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm font-medium text-foreground">My profile</p>
          )}
        </div>

        <div className="px-6 py-5">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/40" />
              ))}
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertTitle>Profile unavailable</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : !me ? (
            <Alert>
              <AlertTitle>Profile unavailable</AlertTitle>
              <AlertDescription>Sign in again or contact your administrator.</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              <ProfileRow icon={Mail} label="Email" value={me.email ?? "—"} />
              <ProfileRow icon={Phone} label="Mobile" value={me.phone ?? "—"} />
              <ProfileRow icon={Building2} label="Plant" value={me.org_unit ?? "—"} />
              <ProfileRow icon={Shield} label="Roles" value={me.role ?? "—"} />
            </div>
          )}
        </div>

        {!loading && me ? (
          <>
            <Separator />
            <p className="px-6 pb-5 text-center text-xs text-muted-foreground">
              <User className="mr-1 inline size-3.5 opacity-60" aria-hidden />
              Member since{" "}
              <span className="font-medium tabular-nums text-foreground/80">
                {formatDateTime(me.created_at)}
              </span>
            </p>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
