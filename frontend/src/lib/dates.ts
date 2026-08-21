/** App-wide calendar date display: DD/MM/YY */

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function parseDate(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  // Date-only ISO: avoid UTC timezone shifting the calendar day
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number)
    const local = new Date(y, m - 1, d)
    return Number.isNaN(local.getTime()) ? null : local
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Format as DD/MM/YY. Empty/invalid → "—" (or raw string if unparseable). */
export function formatAppDate(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "—"
  const d = parseDate(value)
  if (!d) return typeof value === "string" ? value : "—"
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`
}

/** Date + short time, e.g. 21/08/26, 2:47 PM */
export function formatAppDateTime(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "—"
  const d = parseDate(value)
  if (!d) return typeof value === "string" ? value : "—"
  return `${formatAppDate(d)} ${d.toLocaleTimeString(undefined, { timeStyle: "short" })}`
}

/** Split for audit When cells. */
export function formatAppWhenParts(value: string | Date): { date: string; time: string } {
  const d = parseDate(value)
  if (!d) return { date: typeof value === "string" ? value : "—", time: "" }
  return {
    date: formatAppDate(d),
    time: d.toLocaleTimeString(undefined, { timeStyle: "short" }),
  }
}

// ponytail: assert-based self-check (no test framework)
if (import.meta.env?.DEV) {
  console.assert(formatAppDate("2026-08-21") === "21/08/26", "formatAppDate DD/MM/YY")
  console.assert(formatAppDate("") === "—", "formatAppDate empty")
}
