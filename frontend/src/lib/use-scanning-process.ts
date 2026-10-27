import * as React from "react"
import { getJson } from "@/lib/api"
import { setTagCryptoKey } from "@/lib/tag-crypto"

export type ScanningProcessSettings = {
  process_mode: string
  label: string
  rfid_enabled: boolean
  barcode_enabled: boolean
  qr_enabled: boolean
  description: string
  barcode_qr_field?: string
  tag_crypto_key?: string
}

let cachedSettings: ScanningProcessSettings | null = null
let fetchPromise: Promise<ScanningProcessSettings | null> | null = null

export function getCachedScanningSettings(): ScanningProcessSettings | null {
  return cachedSettings
}

export function setCachedScanningSettings(settings: ScanningProcessSettings) {
  cachedSettings = settings
  if (settings.tag_crypto_key) {
    setTagCryptoKey(settings.tag_crypto_key)
  }
  window.dispatchEvent(new CustomEvent("scanning-process-updated", { detail: settings }))
}

export function useScanningProcess() {
  const [settings, setSettings] = React.useState<ScanningProcessSettings | null>(cachedSettings)
  const [isLoading, setIsLoading] = React.useState(!cachedSettings)

  const fetchSettings = React.useCallback(async (force = false) => {
    if (cachedSettings && !force) {
      setSettings(cachedSettings)
      setIsLoading(false)
      return
    }

    if (!fetchPromise || force) {
      fetchPromise = getJson<ScanningProcessSettings>("/admin/settings/scanning-process")
        .then((data) => {
          cachedSettings = data
          if (data?.tag_crypto_key) {
            setTagCryptoKey(data.tag_crypto_key)
          }
          return data
        })
        .catch(() => null)
        .finally(() => {
          fetchPromise = null
        })
    }

    const data = await fetchPromise
    setSettings(data)
    setIsLoading(false)
  }, [])

  React.useEffect(() => {
    fetchSettings()

    const onUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<ScanningProcessSettings>
      if (customEvent.detail) {
        setSettings(customEvent.detail)
      } else {
        fetchSettings(true)
      }
    }

    window.addEventListener("scanning-process-updated", onUpdate)
    return () => {
      window.removeEventListener("scanning-process-updated", onUpdate)
    }
  }, [fetchSettings])

  // Defaults to true when loading so menu is visible while checking,
  // but if settings loaded and neither barcode nor qr is enabled (e.g. rfid_only), returns false.
  const barcodeOrQrEnabled = settings
    ? Boolean(settings.barcode_enabled || settings.qr_enabled)
    : true

  return {
    settings,
    isLoading,
    barcodeOrQrEnabled,
    barcodeEnabled: Boolean(settings?.barcode_enabled),
    qrEnabled: Boolean(settings?.qr_enabled),
    rfidEnabled: Boolean(settings?.rfid_enabled),
    barcodeQrField: settings?.barcode_qr_field || "combined_asset_number",
    refresh: () => fetchSettings(true),
  }
}
