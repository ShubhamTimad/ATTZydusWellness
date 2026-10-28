import * as React from "react"
import { Building2, Landmark, Mail, Phone, Shield, UsersRound, XIcon, ZoomIn } from "lucide-react"

import { AdminStatusBadge } from "@/components/layout/admin-ui"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getJson } from "@/lib/api"
import { useMyPhotoUrl } from "@/lib/navbar-user"
import { cn } from "@/lib/utils"
type MeProfile = {
  id: number
  full_name: string
  email: string | null
  phone: string | null
  role: string | null
  org_unit: string | null
  department: string | null
  cost_center: string | null
  is_active: boolean
  is_superuser: boolean
  has_photo?: boolean
  created_at: string
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

/** Split comma-joined multi-values (e.g. cost centers) into readable lines. */
function MultiLineValue({ value }: { value: string | null | undefined }) {
  if (!value?.trim()) return <span>—</span>
  const parts = value.split(", ").map((s) => s.trim()).filter(Boolean)
  if (parts.length <= 1) {
    return <span className="break-words">{value.trim()}</span>
  }
  return (
    <ul className="mt-0.5 list-none space-y-1.5">
      {parts.map((part) => (
        <li key={part} className="break-words">
          {part}
        </li>
      ))}
    </ul>
  )
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
        <div className="mt-0.5 text-sm font-medium leading-snug text-foreground">{value}</div>
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
  const [photoPreviewOpen, setPhotoPreviewOpen] = React.useState(false)

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
  const photoUrl = useMyPhotoUrl(me?.has_photo)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex max-h-[min(90dvh,40rem)] flex-col gap-0 overflow-hidden sm:max-w-[420px]"
          showCloseButton={false}
        >
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-2.5 right-2.5 z-10 size-10 rounded-full text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              aria-label="Close"
            >
              <XIcon className="size-5" aria-hidden />
            </Button>
          </DialogClose>
          <div className="dialog-surface-header shrink-0 -mx-0 border-b border-primary/10">
            <DialogHeader className="px-0 pt-0">
              <DialogTitle className="sr-only">My profile</DialogTitle>
              <DialogDescription className="sr-only">
                Your account details, plant, department, and cost center.
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
              <div className="flex items-center gap-4 pr-10">
                <button
                  type="button"
                  disabled={!photoUrl}
                  onClick={() => {
                    if (photoUrl) setPhotoPreviewOpen(true)
                  }}
                  className={cn(
                    "group relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                    photoUrl ? "cursor-pointer" : "cursor-default",
                  )}
                  title={photoUrl ? "Click to view image" : undefined}
                  aria-label={photoUrl ? `View profile photo of ${me.full_name}` : undefined}
                >
                  <Avatar className="size-14 ring-2 ring-primary/20 ring-offset-2 ring-offset-card transition-all group-hover:scale-105 group-hover:ring-primary/50">
                    {photoUrl ? <AvatarImage src={photoUrl} alt={me.full_name} /> : null}
                    <AvatarFallback className="bg-primary text-base font-semibold text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  {photoUrl ? (
                    <span
                      className="absolute inset-0 flex items-center justify-center rounded-full bg-black/35 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    >
                      <ZoomIn className="size-4 text-white drop-shadow" />
                    </span>
                  ) : null}
                </button>
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

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
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
                <ProfileRow icon={Mail} label="Email" value={<MultiLineValue value={me.email} />} />
                <ProfileRow icon={Phone} label="Mobile" value={me.phone ?? "—"} />
                <ProfileRow icon={Building2} label="Plant" value={<MultiLineValue value={me.org_unit} />} />
                <ProfileRow
                  icon={UsersRound}
                  label="Department"
                  value={<MultiLineValue value={me.department} />}
                />
                <ProfileRow
                  icon={Landmark}
                  label="Cost center"
                  value={<MultiLineValue value={me.cost_center} />}
                />
                <ProfileRow icon={Shield} label="Role" value={<MultiLineValue value={me.role} />} />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={photoPreviewOpen} onOpenChange={setPhotoPreviewOpen}>
        <DialogContent className="max-w-2xl p-4 sm:p-6" showCloseButton>
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-foreground">
              {me?.full_name ? `${me.full_name}` : "Profile Photo"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Full size profile photo
            </DialogDescription>
          </DialogHeader>
          {photoUrl ? (
            <div className="mt-2 flex max-h-[75vh] items-center justify-center overflow-hidden rounded-xl bg-muted/20 p-2">
              <img
                src={photoUrl}
                alt={me?.full_name ? `${me.full_name}'s profile photo` : "Profile photo"}
                className="max-h-[75vh] max-w-full rounded-lg object-contain shadow-md"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
