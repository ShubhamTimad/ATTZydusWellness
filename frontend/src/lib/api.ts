export const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? ""

type Json = Record<string, unknown>

function getAccessToken() {
  try {
    const t = localStorage.getItem("access_token")
    return t && t.length > 0 ? t : null
  } catch {
    return null
  }
}

import {
  SESSION_IDLE_LOGOUT_EVENT,
  type AuthLogoutReason,
} from "@/lib/session-idle-events"

export class ApiError extends Error {
  status: number
  body?: unknown

  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.body = body
  }
}

function parseErrorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object") {
    const detail = (data as { detail?: unknown }).detail
    if (typeof detail === "string") return detail
    if (detail && typeof detail === "object" && detail !== null) {
      const msg = (detail as { message?: unknown }).message
      if (typeof msg === "string" && msg.trim()) return msg
    }
    const err = (data as { error?: unknown }).error
    if (typeof err === "string") return err
  }
  return `Request failed (${status})`
}

const AUTH_PATHS_SKIP_LOGOUT = ["/login", "/refresh", "/forgot-password", "/reset-password"]

function shouldLogoutOn401(path: string): boolean {
  const normalized = path.startsWith("/") ? path : `/${path}`
  return !AUTH_PATHS_SKIP_LOGOUT.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  )
}

function logoutReasonFrom401(data: unknown): AuthLogoutReason {
  if (data && typeof data === "object") {
    const detail = (data as { detail?: unknown }).detail
    if (detail === "session_idle") return "session_idle"
  }
  return "unauthorized"
}

function maybeDispatchAuthLogout(status: number, data: unknown, path: string) {
  if (status !== 401 || !getAccessToken() || !shouldLogoutOn401(path)) return
  window.dispatchEvent(
    new CustomEvent(SESSION_IDLE_LOGOUT_EVENT, {
      detail: { reason: logoutReasonFrom401(data) },
    }),
  )
}

export async function getJson<TResponse>(
  path: string,
  init?: Omit<RequestInit, "method">
): Promise<TResponse> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  const token = getAccessToken()

  const res = await fetch(url, {
    method: "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  const text = await res.text()
  const data = parseResponseBody(text)

  if (!res.ok) {
    maybeDispatchAuthLogout(res.status, data, path)
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }

  return data as TResponse
}

function parseResponseBody(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    const hint = text.trimStart().startsWith("<")
      ? "Server returned HTML instead of JSON. In dev, ensure Vite proxies API paths (e.g. /dashboard) to the backend, or set VITE_API_URL=http://localhost:8000."
      : "Server returned invalid JSON."
    throw new Error(hint)
  }
}

export async function postJson<TResponse>(
  path: string,
  body: Json,
  init?: Omit<RequestInit, "method" | "body">
): Promise<TResponse> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  const token = getAccessToken()

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
    ...init,
  })

  const text = await res.text()
  const data = parseResponseBody(text)

  if (!res.ok) {
    maybeDispatchAuthLogout(res.status, data, path)
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }

  return data as TResponse
}

export async function patchJson<TResponse>(
  path: string,
  body: Json,
  init?: Omit<RequestInit, "method" | "body">
): Promise<TResponse> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  const token = getAccessToken()

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
    ...init,
  })

  const text = await res.text()
  const data = parseResponseBody(text)

  if (!res.ok) {
    maybeDispatchAuthLogout(res.status, data, path)
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }

  return data as TResponse
}

export async function putJson<TResponse>(
  path: string,
  body: Json,
  init?: Omit<RequestInit, "method" | "body">
): Promise<TResponse> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  const token = getAccessToken()

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
    ...init,
  })

  const text = await res.text()
  const data = parseResponseBody(text)

  if (!res.ok) {
    maybeDispatchAuthLogout(res.status, data, path)
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }

  return data as TResponse
}

export async function deleteJson(
  path: string,
  init?: Omit<RequestInit, "method" | "body">,
): Promise<void> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  const token = getAccessToken()

  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  const text = await res.text()
  const data = parseResponseBody(text)

  if (!res.ok) {
    maybeDispatchAuthLogout(res.status, data, path)
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(header)
  if (!match?.[1]) return null
  return decodeURIComponent(match[1].replace(/"/g, "").trim())
}

/** Download a binary file (Excel, PDF, etc.) and trigger a browser save. */
export async function downloadFile(
  path: string,
  fallbackFilename: string,
  init?: Omit<RequestInit, "method">,
): Promise<void> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  const token = getAccessToken()

  const res = await fetch(url, {
    method: "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!res.ok) {
    const text = await res.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
    maybeDispatchAuthLogout(res.status, data, path)
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }

  const blob = await res.blob()
  const filename =
    filenameFromContentDisposition(res.headers.get("Content-Disposition")) ?? fallbackFilename
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = filename
  anchor.rel = "noopener"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}
