import * as React from "react"

import { getJson } from "@/lib/api"
import {
  ASSET_FIELD_LABELS,
  ASSET_IMPORT_GRID_COLUMNS,
  ASSET_REQUIRED_IMPORT_FIELDS,
  ASSET_REQUIRED_MANUAL_FIELDS,
} from "@/lib/asset-master-fields"

export type AssetFieldConfigEntry = {
  field_key: string
  display_label: string
  is_visible: boolean
  is_required: boolean
}

type FieldConfigMap = Record<string, AssetFieldConfigEntry>

let cachedConfig: FieldConfigMap | null = null
let inflight: Promise<FieldConfigMap> | null = null

function fallbackLabel(fieldKey: string): string {
  return ASSET_FIELD_LABELS[fieldKey] ?? fieldKey.replace(/_/g, " ")
}

function buildFallbackMap(): FieldConfigMap {
  const keys = new Set<string>([
    ...Object.keys(ASSET_FIELD_LABELS),
    ...ASSET_IMPORT_GRID_COLUMNS.map((c) => c.key),
  ])
  const map: FieldConfigMap = {}
  for (const field_key of keys) {
    map[field_key] = {
      field_key,
      display_label: fallbackLabel(field_key),
      is_visible: true,
      is_required:
        ASSET_REQUIRED_MANUAL_FIELDS.has(field_key) || ASSET_REQUIRED_IMPORT_FIELDS.has(field_key),
    }
  }
  return map
}

async function loadFieldConfigMap(): Promise<FieldConfigMap> {
  if (cachedConfig) return cachedConfig
  if (!inflight) {
    inflight = getJson<{ fields: AssetFieldConfigEntry[] }>("/admin/assets/field-config")
      .then((res) => {
        const map: FieldConfigMap = {}
        for (const row of res.fields) {
          map[row.field_key] = row
        }
        cachedConfig = map
        return map
      })
      .catch(() => {
        cachedConfig = buildFallbackMap()
        return cachedConfig
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export function useAssetFieldConfig() {
  const [config, setConfig] = React.useState<FieldConfigMap | null>(cachedConfig)
  const [loading, setLoading] = React.useState(!cachedConfig)

  React.useEffect(() => {
    let active = true
    void loadFieldConfigMap().then((map) => {
      if (!active) return
      setConfig(map)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  const getLabel = React.useCallback(
    (fieldKey: string, fallback?: string) => {
      const row = config?.[fieldKey]
      if (row) return row.display_label
      return fallback ?? fallbackLabel(fieldKey)
    },
    [config],
  )

  const isVisible = React.useCallback(
    (fieldKey: string, defaultVisible = true) => {
      const row = config?.[fieldKey]
      if (!row) return defaultVisible
      return row.is_visible
    },
    [config],
  )

  const isRequired = React.useCallback(
    (fieldKey: string, defaultRequired = false) => {
      const row = config?.[fieldKey]
      if (!row) {
        return (
          defaultRequired ||
          ASSET_REQUIRED_MANUAL_FIELDS.has(fieldKey) ||
          ASSET_REQUIRED_IMPORT_FIELDS.has(fieldKey)
        )
      }
      return row.is_required
    },
    [config],
  )

  const filterVisibleKeys = React.useCallback(
    (keys: string[]) => keys.filter((k) => isVisible(k)),
    [isVisible],
  )

  return {
    loading,
    config,
    getLabel,
    isVisible,
    isRequired,
    filterVisibleKeys,
  }
}

export function buildImportGridColumns(config: FieldConfigMap | null) {
  return ASSET_IMPORT_GRID_COLUMNS.filter((col) => {
    const row = config?.[col.key]
    return row ? row.is_visible : true
  }).map((col) => {
    const row = config?.[col.key]
    return {
      ...col,
      label: row?.display_label ?? col.label,
      // Import required set is independent of create-form field config.
      required: ASSET_REQUIRED_IMPORT_FIELDS.has(col.key),
    }
  })
}
