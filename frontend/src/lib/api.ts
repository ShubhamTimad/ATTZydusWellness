export const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? ""

type Json = Record<string, unknown>

type TokenPair = {
  access_token: string
  refresh_token: string
}

import {
  SESSION_ACTIVITY_EVENT,
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

function getAccessToken() {
  try {
    const t = localStorage.getItem("access_token")
    return t && t.length > 0 ? t : null
  } catch {
    return null
  }
}

function getRefreshToken() {
  try {
    const t = localStorage.getItem("refresh_token")
    return t && t.length > 0 ? t : null
  } catch {
    return null
  }
}

function storeTokens(pair: TokenPair) {
  localStorage.setItem("access_token", pair.access_token)
  localStorage.setItem("refresh_token", pair.refresh_token)
}

function accessTokenExpiresAtMs(token: string): number | null {
  try {
    const segment = token.split(".")[1]
    if (!segment) return null
    const payload = JSON.parse(atob(segment.replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: unknown
    }
    return typeof payload.exp === "number" ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

const REFRESH_BUFFER_MS = 2 * 60 * 1000

let refreshInFlight: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return null

  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const url = `${API_BASE_URL}/refresh`
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      const text = await res.text()
      const data = parseResponseBody(text)
      if (!res.ok) return null
      const pair = data as Partial<TokenPair>
      if (typeof pair.access_token !== "string" || typeof pair.refresh_token !== "string") {
        return null
      }
      storeTokens({ access_token: pair.access_token, refresh_token: pair.refresh_token })
      return pair.access_token
    } catch {
      return null
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

async function ensureFreshAccessToken(): Promise<string | null> {
  const token = getAccessToken()
  if (!token) return null
  const expiresAt = accessTokenExpiresAtMs(token)
  if (expiresAt === null || expiresAt - Date.now() > REFRESH_BUFFER_MS) return token
  const refreshed = await refreshAccessToken()
  return refreshed ?? token
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

function isSessionIdleResponse(data: unknown): boolean {
  return (
    data !== null &&
    typeof data === "object" &&
    (data as { detail?: unknown }).detail === "session_idle"
  )
}

function logoutReasonFrom401(data: unknown): AuthLogoutReason {
  if (isSessionIdleResponse(data)) return "session_idle"
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

function notifySessionActivity() {
  if (!getAccessToken()) return
  window.dispatchEvent(new CustomEvent(SESSION_ACTIVITY_EVENT))
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

type FetchWithAuthOptions = {
  path: string
  init?: RequestInit
  /** When false, do not attempt token refresh on 401 (used for /refresh itself). */
  allowRefresh?: boolean
}

async function fetchWithAuth({
  path,
  init,
  allowRefresh = true,
}: FetchWithAuthOptions): Promise<Response> {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
  const token = await ensureFreshAccessToken()

  const buildHeaders = (accessToken: string | null) => ({
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(init?.headers ?? {}),
  })

  let res = await fetch(url, {
    ...init,
    headers: buildHeaders(token),
  })

  if (res.status === 401 && allowRefresh && shouldLogoutOn401(path) && getRefreshToken()) {
    const text = await res.text()
    const data = parseResponseBody(text)
    if (!isSessionIdleResponse(data)) {
      const newToken = await refreshAccessToken()
      if (newToken) {
        res = await fetch(url, {
          ...init,
          headers: buildHeaders(newToken),
        })
        if (res.ok) {
          notifySessionActivity()
        }
        return res
      }
    }
    maybeDispatchAuthLogout(401, data, path)
    throw new ApiError(parseErrorMessage(data, 401), 401, data)
  }

  if (res.ok && token) {
    notifySessionActivity()
  }

  return res
}

export async function getJson<TResponse>(
  path: string,
  init?: Omit<RequestInit, "method">,
): Promise<TResponse> {
  const res = await fetchWithAuth({ path, init: { method: "GET", ...init } })
  const text = await res.text()
  const data = parseResponseBody(text)

  if (!res.ok) {
    maybeDispatchAuthLogout(res.status, data, path)
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }

  return data as TResponse
}

export async function postJson<TResponse>(
  path: string,
  body: Json,
  init?: Omit<RequestInit, "method" | "body">,
): Promise<TResponse> {
  const res = await fetchWithAuth({
    path,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      body: JSON.stringify(body),
      ...init,
    },
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
  init?: Omit<RequestInit, "method" | "body">,
): Promise<TResponse> {
  const res = await fetchWithAuth({
    path,
    init: {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      body: JSON.stringify(body),
      ...init,
    },
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
  init?: Omit<RequestInit, "method" | "body">,
): Promise<TResponse> {
  const res = await fetchWithAuth({
    path,
    init: {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      body: JSON.stringify(body),
      ...init,
    },
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
  const res = await fetchWithAuth({ path, init: { method: "DELETE", ...init } })
  const text = await res.text()
  const data = parseResponseBody(text)

  if (!res.ok) {
    maybeDispatchAuthLogout(res.status, data, path)
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }
}

export async function getBlob(path: string): Promise<Blob> {
  const res = await fetchWithAuth({ path, init: { method: "GET" } })
  if (!res.ok) {
    const text = await res.text()
    const data = parseResponseBody(text)
    maybeDispatchAuthLogout(res.status, data, path)
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }
  return res.blob()
}

export async function putFormData<TResponse>(
  path: string,
  body: FormData,
): Promise<TResponse> {
  const res = await fetchWithAuth({ path, init: { method: "PUT", body } })
  const text = await res.text()
  const data = parseResponseBody(text)
  if (!res.ok) {
    maybeDispatchAuthLogout(res.status, data, path)
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }
  return data as TResponse
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
  const res = await fetchWithAuth({ path, init: { method: "GET", ...init } })

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
