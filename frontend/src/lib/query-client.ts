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
