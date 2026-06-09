import { z } from "zod"

const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/

/** Normalize to a 10-digit Indian mobile (optional +91 / 91 / leading 0). */
export function normalizePhoneDigits(raw: string): string {
  let digits = raw.trim().replace(/\D/g, "")
  if (digits.startsWith("91") && digits.length === 12) {
    digits = digits.slice(2)
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1)
  }
  return digits
}

export function isValidIndianMobile(digits: string): boolean {
  return INDIAN_MOBILE_RE.test(digits)
}

export const phoneFieldSchema = z
  .string()
  .min(1, "Phone is required")
  .transform((value) => normalizePhoneDigits(value))
  .refine(
    (digits) => isValidIndianMobile(digits),
    "Enter a valid 10-digit Indian mobile number (starting with 6, 7, 8, or 9)",
  )
