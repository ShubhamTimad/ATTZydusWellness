import * as React from "react"
import { useSearchParams } from "react-router-dom"

type Mutator = (params: URLSearchParams) => void

/**
 * Module-level batch so useUrlTab + useUrlPage in the same event share one
 * setSearchParams write (RR functional updates do not chain).
 */
let pendingMutators: Mutator[] = []
let flushScheduled = false
let flushGet: (() => URLSearchParams) | null = null
let flushSet: ((params: URLSearchParams) => void) | null = null

function enqueueSearchParamsUpdate(
  mutate: Mutator,
  getParams: () => URLSearchParams,
  setParams: (params: URLSearchParams) => void,
) {
  pendingMutators.push(mutate)
  flushGet = getParams
  flushSet = setParams
  if (flushScheduled) return
  flushScheduled = true
  queueMicrotask(() => {
    flushScheduled = false
    const mutators = pendingMutators
    pendingMutators = []
    const get = flushGet
    const set = flushSet
    flushGet = null
    flushSet = null
    if (!get || !set || mutators.length === 0) return
    const next = new URLSearchParams(get())
    for (const m of mutators) m(next)
    set(next)
  })
}

function useBatchedSearchParams(): [URLSearchParams, (mutate: Mutator) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const searchParamsRef = React.useRef(searchParams)
  searchParamsRef.current = searchParams

  const apply = React.useCallback((mutate: Mutator) => {
    enqueueSearchParamsUpdate(
      mutate,
      () => searchParamsRef.current,
      (params) => setSearchParams(params, { replace: true }),
    )
  }, [setSearchParams])

  return [searchParams, apply]
}

function readPage(searchParams: URLSearchParams, paramKey: string): number {
  const raw = Number(searchParams.get(paramKey))
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1
}

function writePage(params: URLSearchParams, paramKey: string, next: number) {
  const value = Number.isFinite(next) && next >= 1 ? Math.floor(next) : 1
  if (value <= 1) params.delete(paramKey)
  else params.set(paramKey, String(value))
}

/**
 * Keep the active workspace/list tab in the URL (`?tab=` by default) so
 * navigating to a detail and back restores the last opened tab.
 */
export function useUrlTab<T extends string>(
  allowed: readonly T[],
  defaultTab: T,
  paramKey = "tab",
): [T, (next: string) => void] {
  const [searchParams, apply] = useBatchedSearchParams()
  const allowedKey = allowed.join("\0")
  const raw = searchParams.get(paramKey)
  const tab: T =
    raw != null && (allowed as readonly string[]).includes(raw) ? (raw as T) : defaultTab

  const setTab = React.useCallback(
    (next: string) => {
      const keys = allowedKey.split("\0") as T[]
      const value = keys.includes(next as T) ? (next as T) : defaultTab
      apply((p) => {
        if (value === defaultTab) p.delete(paramKey)
        else p.set(paramKey, value)
      })
    },
    [allowedKey, apply, defaultTab, paramKey],
  )

  return [tab, setTab]
}

/**
 * Keep list pagination in the URL (`?page=`) so back-navigation restores the page.
 * Page 1 omits the param.
 */
export function useUrlPage(paramKey = "page"): [number, (next: number) => void] {
  const [searchParams, apply] = useBatchedSearchParams()
  const page = readPage(searchParams, paramKey)

  const setPage = React.useCallback(
    (next: number) => {
      apply((p) => writePage(p, paramKey, next))
    },
    [apply, paramKey],
  )

  return [page, setPage]
}
