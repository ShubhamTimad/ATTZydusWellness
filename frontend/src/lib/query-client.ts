import { QueryClient } from "@tanstack/react-query"

/** Lists stay fresh for 5m; navigating back within that window uses cache. */
export const LIST_STALE_MS = 5 * 60 * 1000
export const LIST_GC_MS = 30 * 60 * 1000

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: LIST_STALE_MS,
      gcTime: LIST_GC_MS,
      refetchOnWindowFocus: false,
    },
  },
})

/**
 * Order lists whose Pending Action tab changes when *other* users act, which never
 * invalidates this cache: always revalidate on mount/visibility, and poll while open
 * (side-by-side windows never fire a visibility change).
 */
export const LIVE_LIST_QUERY_OPTIONS = {
  staleTime: 0,
  refetchOnWindowFocus: true,
  refetchInterval: 30_000,
} as const

/** Treat stale cache as loading until the first refetch after mount, so an old empty list never shows "No Pending Action". */
export function isListLoading(q: {
  isPending: boolean
  isFetching: boolean
  isFetchedAfterMount: boolean
}): boolean {
  return q.isPending || (q.isFetching && !q.isFetchedAfterMount)
}

export const assetListRootKey = ["assets", "list"] as const
export const orderListRootKey = ["orders", "list"] as const
export const transferListRootKey = ["transfers", "list"] as const
export const disposalListRootKey = ["disposals", "list"] as const

export function invalidateAssetLists() {
  return queryClient.invalidateQueries({ queryKey: assetListRootKey })
}

export function invalidateOrderLists() {
  return queryClient.invalidateQueries({ queryKey: orderListRootKey })
}

export function invalidateTransferLists() {
  return queryClient.invalidateQueries({ queryKey: transferListRootKey })
}

export function invalidateDisposalLists() {
  return queryClient.invalidateQueries({ queryKey: disposalListRootKey })
}
