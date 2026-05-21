/** Build POST /login body fields from a single email-or-username field. */
export function loginRequestFields(identifier: string, password: string): {
  email?: string
  username?: string
  password: string
} {
  const id = identifier.trim()
  if (id.includes("@")) {
    return { email: id.toLowerCase(), password }
  }
  return { username: id, password }
}

export function validateLoginIdentifier(identifier: string): string | null {
  const id = identifier.trim()
  if (!id) return "Email or username is required."
  if (id.includes("@")) {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)
    return ok ? null : "Enter a valid email address."
  }
  if (id.length < 3) return "Username must be at least 3 characters."
  return null
}
