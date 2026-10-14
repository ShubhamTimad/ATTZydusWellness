import * as React from "react"

import { getBlob } from "@/lib/api"

/** Navbar account chip: identity from ``GET /me``. */
export type NavbarUser = {
  fullName: string | null
  email: string | null
  role: string | null
  hasPhoto?: boolean
}

/** Object URL of the signed-in user's profile photo, or null (show initials) when none / not loaded. */
export function useMyPhotoUrl(hasPhoto: boolean | undefined): string | null {
  const [url, setUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!hasPhoto) return
    let cancelled = false
    let objectUrl: string | null = null
    getBlob("/me/photo")
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(null)
    }
  }, [hasPhoto])

  return url
}

export function navbarDisplayName(user: NavbarUser | null | undefined): string {
  const name = user?.fullName?.trim()
  if (name) return name
  const email = user?.email?.trim()
  if (email) return email
  return "Account"
}

export function navbarInitials(user: NavbarUser | null | undefined): string {
  const name = user?.fullName?.trim()
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase()
    }
    return name.slice(0, 2).toUpperCase()
  }
  const raw = (user?.email ?? "").trim()
  if (!raw) return "?"
  const left = raw.split("@")[0] ?? raw
  const parts = left.split(/[.\-_ ]+/).filter(Boolean)
  const a = (parts[0]?.[0] ?? left[0] ?? "?").toUpperCase()
  const b = (parts[1]?.[0] ?? left[1] ?? "").toUpperCase()
  return `${a}${b}`.slice(0, 2)
}
