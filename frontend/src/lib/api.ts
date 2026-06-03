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
    throw new ApiError(parseErrorMessage(data, res.status), res.status, data)
  }
}
