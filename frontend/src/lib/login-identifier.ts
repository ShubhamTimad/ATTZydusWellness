/**
 * Build POST /login body from the login form.
 *
 * UI + validateLoginIdentifier are email-only. Username login remains supported
 * by the API and by this helper when a non-email identifier is passed (disabled in UI).
 */
export function loginRequestFields(identifier: string, password: string): {
  email?: string
  username?: string
  password: string
} {
  const id = identifier.trim()
  if (id.includes("@")) {
    return { email: id.toLowerCase(), password }
  }
  // Kept for API/scripts; login pages never reach here (email validation).
  return { username: id, password }
}

/** Login form validation — email address only (username entry disabled in UI). */
export function validateLoginIdentifier(identifier: string): string | null {
  const id = identifier.trim()
  if (!id) return "Email Address is required."
  if (!id.includes("@") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id)) {
    return "Enter a valid email address."
  }
  return null
}
