/** Dashboard page shell + per-section visibility (synced from MODULE_CONFIG). */
export const DASHBOARD_VIEW = "dashboard.view"
export const DASHBOARD_ORDERS_VIEW = "dashboard.orders.view"
export const DASHBOARD_ASSETS_VIEW = "dashboard.assets.view"
export const DASHBOARD_FY_VIEW = "dashboard.financial_year.view"
export const DASHBOARD_IT_VIEW = "dashboard.it.view"
export const DASHBOARD_TRANSFERS_VIEW = "dashboard.transfers.view"
export const DASHBOARD_DISPOSALS_VIEW = "dashboard.disposals.view"
const DASHBOARD_SUMMARY_TILES = [
  "dashboard.summary_orders.view",
  "dashboard.summary_transfers.view",
  "dashboard.summary_disposals.view",
  "dashboard.summary_assets.view",
  "dashboard.summary_users.view",
] as const

/** Any of these unlocks Dashboard nav / page access. */
export const DASHBOARD_ANY_OF = [
  DASHBOARD_VIEW,
  DASHBOARD_ORDERS_VIEW,
  DASHBOARD_ASSETS_VIEW,
  DASHBOARD_FY_VIEW,
  DASHBOARD_IT_VIEW,
  DASHBOARD_TRANSFERS_VIEW,
  DASHBOARD_DISPOSALS_VIEW,
  ...DASHBOARD_SUMMARY_TILES,
] as const
