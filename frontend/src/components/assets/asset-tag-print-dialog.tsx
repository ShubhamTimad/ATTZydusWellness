import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Barcode, ExternalLink, Printer, QrCode, RotateCw } from "lucide-react"
import QRCode from "qrcode"
import JsBarcode from "jsbarcode"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { postJson } from "@/lib/api"
import { encryptTagCode } from "@/lib/tag-crypto"
import { useScanningProcess } from "@/lib/use-scanning-process"
import { cn } from "@/lib/utils"
import type { AssetDetail, AssetListItem } from "@/lib/assets-types"

export type LabelFormat = "compact" | "standard" | "large"
export type TagCodeType = "qr" | "barcode"

export type AssetPrintItem = {
  id: number
  asset_name: string
  asset_code: string
  combined_asset_number: string | null
  rfid_code: string | null
  category_name: string | null
  plant_name: string | null
  plant_code: string | null
  functional_location: string | null
  actual_location: string | null
  asset_class: string | null
  serial_no: string | null
  print_count: number
  last_printed_at: string | null
  last_printed_by: number | null
  last_printed_by_name: string | null
  last_reprint_reason: string | null
  lifecycle_status: string
  approval_status: string
  created_at: string
}

export function mapAssetListItemToPrintItem(
  item: AssetListItem | AssetPrintItem | AssetDetail | Record<string, any>,
): AssetPrintItem {
  if ("print_count" in item && typeof item.print_count === "number") {
    return item as AssetPrintItem
  }
  const row = item as any
  const loc = row.location || {}
  return {
    id: row.id,
    asset_name: row.asset_name,
    asset_code: row.asset_code,
    combined_asset_number: row.combined_asset_number ?? null,
    rfid_code: row.rfid_code ?? null,
    category_name: row.category_name ?? null,
    plant_name: row.plant_name ?? loc.plant_name ?? null,
    plant_code: row.plant_code ?? loc.plant_code ?? null,
    functional_location: row.functional_location ?? loc.functional_location ?? null,
    actual_location: row.actual_location ?? loc.actual_location ?? null,
    asset_class: row.asset_class_name ?? row.asset_class ?? null,
    serial_no: row.serial_no ?? null,
    print_count: row.print_count ?? 0,
    last_printed_at: row.last_printed_at ?? null,
    last_printed_by: null,
    last_printed_by_name: null,
    last_reprint_reason: null,
    lifecycle_status: row.lifecycle_status ?? "",
    approval_status: row.approval_status ?? "",
    created_at: row.created_at ?? "",
  }
}

export function getAssetEncodedValue(
  asset: AssetPrintItem,
  _encodingField: string = "combined_asset_number",
): { value: string; label: string } {
  return {
    value: (asset.combined_asset_number || "").trim(),
    label: "Combined Asset Number",
  }
}

/**
 * Individual physical tag sticker component supporting dedicated QR code or Barcode.
 */
export function AssetTagSticker({
  asset,
  codeType = "qr",
  format = "standard",
  isReprint = false,
  encodingField,
}: {
  asset: AssetPrintItem
  codeType?: TagCodeType
  format?: LabelFormat
  isReprint?: boolean
  encodingField?: string
}) {
  const { barcodeQrField } = useScanningProcess()
  const activeEncodingField = encodingField || barcodeQrField || "combined_asset_number"
  const { value: codeValue, label: fieldLabel } = getAssetEncodedValue(asset, activeEncodingField)
  const encryptedCode = React.useMemo(() => {
    return encryptTagCode(codeValue)
  }, [codeValue])

  const [qrDataUrl, setQrDataUrl] = React.useState<string>("")
  const barcodeRef = React.useRef<SVGSVGElement | null>(null)

  const showQr = codeType === "qr"
  const showBarcode = codeType === "barcode"

  React.useEffect(() => {
    const valueToEncode = encryptedCode || codeValue
    if (showQr && valueToEncode) {
      QRCode.toDataURL(valueToEncode, {
        width: format === "compact" ? 110 : format === "large" ? 160 : 130,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(""))
    }
  }, [encryptedCode, codeValue, showQr, format])

  React.useEffect(() => {
    const valueToEncode = encryptedCode || codeValue
    if (showBarcode && barcodeRef.current && valueToEncode) {
      try {
        JsBarcode(barcodeRef.current, valueToEncode, {
          format: "CODE128",
          width: format === "compact" ? 1.2 : format === "large" ? 1.8 : 1.5,
          height: format === "compact" ? 36 : format === "large" ? 52 : 44,
          displayValue: true,
          font: "monospace",
          fontSize: format === "compact" ? 9 : 11,
          textMargin: 3,
          margin: 3,
        })
      } catch {
        // ignore invalid characters if any
      }
    }
  }, [encryptedCode, codeValue, showBarcode, format, codeType])

  return (
    <div
      className={cn(
        "asset-tag-sticker relative flex flex-col justify-between border-2 border-dashed border-neutral-300 dark:border-neutral-700 bg-white text-black p-3.5 rounded-lg shadow-sm print:shadow-none print:border-black print:p-2.5",
        format === "compact" && (codeType === "barcode" ? "w-[280px] min-h-[145px]" : "w-[280px] min-h-[155px]"),
        format === "standard" && (codeType === "barcode" ? "w-[340px] min-h-[165px]" : "w-[340px] min-h-[180px]"),
        format === "large" && (codeType === "barcode" ? "w-[400px] min-h-[195px]" : "w-[400px] min-h-[210px]"),
      )}
      style={{ breakInside: "avoid", pageBreakInside: "avoid" }}
    >
      {/* Header with Brand & Plant */}
      <div className="flex items-center justify-between border-b border-neutral-300 pb-1.5 print:border-black">
        <div className="flex items-center gap-1.5">
          <div className="h-4 w-4 rounded-sm bg-neutral-900 flex items-center justify-center text-[9px] font-black text-white">
            Z
          </div>
          <span className="text-[11px] font-bold tracking-wider uppercase text-neutral-800">
            ZYDUS ASSET TRACKING
          </span>
        </div>
        <span className="text-[10px] font-semibold text-neutral-700 bg-neutral-100 px-1.5 py-0.5 rounded print:bg-transparent print:border print:border-black">
          {asset.plant_code || asset.plant_name || "PLANT"}
        </span>
      </div>

      {/* Case 1: QR CODE ONLY (Clean, uncluttered, no barcode) */}
      {codeType === "qr" && (
        <div className="flex items-center gap-3 py-2.5 flex-1">
          <div className="shrink-0 flex flex-col items-center">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`QR ${asset.asset_code}`}
                className={cn(
                  "border border-neutral-200 p-0.5 rounded shadow-2xs",
                  format === "compact" ? "h-22 w-22" : format === "large" ? "h-32 w-32" : "h-26 w-26",
                )}
              />
            ) : (
              <div className="h-24 w-24 bg-neutral-100 flex items-center justify-center text-[10px] text-neutral-400">
                Generating QR…
              </div>
            )}
            <span className="text-[8px] font-mono font-bold text-neutral-500 mt-0.5">SCAN QR</span>
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <div>
              <span className="text-[9px] font-semibold text-neutral-400 uppercase tracking-wider block">
                {fieldLabel}
              </span>
              <span className="font-mono text-base font-bold tracking-tight text-neutral-900 block truncate">
                {codeValue}
              </span>
            </div>

            <div>
              <span className="text-[9px] font-semibold text-neutral-400 uppercase tracking-wider block">
                Asset Name
              </span>
              <p className="text-xs font-semibold text-neutral-800 line-clamp-2 leading-tight">
                {asset.asset_name}
              </p>
            </div>

            <div className="text-[10px] text-neutral-600 flex flex-col gap-0.5">
              {asset.functional_location && (
                <span className="truncate">
                  <strong className="text-neutral-700">Loc:</strong> {asset.functional_location}
                </span>
              )}
              {asset.category_name && (
                <span className="truncate">
                  <strong className="text-neutral-700">Cat:</strong> {asset.category_name}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Case 2: BARCODE ONLY (Clean, wide horizontal barcode, no QR code) */}
      {codeType === "barcode" && (
        <div className="flex flex-col justify-center gap-2 py-2 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <span className="text-[9px] font-semibold text-neutral-400 uppercase tracking-wider block">
                {fieldLabel}
              </span>
              <span className="font-mono text-base font-bold tracking-tight text-neutral-900 block truncate">
                {codeValue}
              </span>
            </div>
            {asset.functional_location && (
              <span className="text-[10px] text-neutral-600 text-right shrink-0 max-w-[130px] truncate">
                <strong className="text-neutral-700">Loc:</strong> {asset.functional_location}
              </span>
            )}
          </div>

          <div>
            <span className="text-[9px] font-semibold text-neutral-400 uppercase tracking-wider block">
              Asset Name
            </span>
            <p className="text-xs font-semibold text-neutral-800 line-clamp-1 leading-tight">
              {asset.asset_name}
            </p>
          </div>

          <div className="flex flex-col items-center justify-center pt-1">
            <svg ref={barcodeRef} className="max-w-full" />
          </div>
        </div>
      )}

      {/* Footer Meta / Audit */}
      <div className="flex items-center justify-between text-[8px] text-neutral-500 pt-1 border-t border-neutral-100 print:border-black">
        <span>RFID: {asset.rfid_code || "N/A"}</span>
        {isReprint && asset.last_reprint_reason ? (
          <span className="font-semibold text-amber-700 print:text-black">
            Reprint #{asset.print_count + 1} ({asset.last_reprint_reason})
          </span>
        ) : (
          <span>Tag #{asset.id}</span>
        )}
      </div>
    </div>
  )
}

export type AssetTagPrintDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  assets: (AssetListItem | AssetPrintItem | AssetDetail | any)[]
  onPrinted?: () => void
}

export function AssetTagPrintDialog({
  open,
  onOpenChange,
  assets,
  onPrinted,
}: AssetTagPrintDialogProps) {
  const navigate = useNavigate()
  const { barcodeEnabled, qrEnabled, barcodeQrField } = useScanningProcess()

  const [selectedCodeType, setSelectedCodeType] = React.useState<TagCodeType>("qr")
  const [labelFormat, setLabelFormat] = React.useState<LabelFormat>("standard")
  const [isMarkingPrinted, setIsMarkingPrinted] = React.useState(false)

  // Sync default code type with global scanning mode
  React.useEffect(() => {
    if (barcodeEnabled && !qrEnabled) {
      setSelectedCodeType("barcode")
    } else {
      setSelectedCodeType("qr")
    }
  }, [barcodeEnabled, qrEnabled])

  const printItems = React.useMemo(
    () => assets.map(mapAssetListItemToPrintItem),
    [assets],
  )

  const handleExecutePrint = async () => {
    if (!printItems.length) return

    setIsMarkingPrinted(true)
    try {
      await postJson("/admin/assets/printing/mark-printed", {
        asset_ids: printItems.map((a) => a.id),
        print_type: "initial",
      })
      toast.success(
        `Printed ${printItems.length} asset tag${printItems.length === 1 ? "" : "s"}.`,
      )
      onPrinted?.()
    } catch {
      // Still proceed with physical printing even if status log fails
    } finally {
      setIsMarkingPrinted(false)
    }

    // Trigger browser print dialog
    window.print()
  }

  const handleGoToTagPrinting = () => {
    onOpenChange(false)
    const ids = printItems.map((a) => a.id).join(",")
    navigate(`/dashboard/tag-printing?ids=${ids}`)
  }

  return (
    <>
      {/* Printable Area - Styles ensure only this element prints when window.print() is executed */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #asset-printable-labels, #asset-printable-labels * {
            visibility: visible !important;
          }
          #asset-printable-labels {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 10px !important;
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 12px !important;
            background: white !important;
          }
        }
      `}</style>

      {/* Hidden container for print-to-paper execution */}
      <div id="asset-printable-labels" className="hidden print:flex">
        {printItems.map((asset) => (
          <AssetTagSticker
            key={asset.id}
            asset={asset}
            codeType={selectedCodeType}
            format={labelFormat}
            encodingField={barcodeQrField}
          />
        ))}
      </div>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="shrink-0 px-6 pt-5 pb-3 border-b border-border/80">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Printer className="h-5 w-5 text-primary" />
                <DialogTitle>Tag Sticker Print Preview</DialogTitle>
              </div>
              <span className="text-xs bg-muted px-2.5 py-1 rounded font-medium text-muted-foreground mr-6">
                {printItems.length} {printItems.length === 1 ? "Label" : "Labels"} Ready
              </span>
            </div>
          </DialogHeader>

          {/* Controls Bar: Tag Code Type & Sticker Label Size */}
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3 border-b border-border/60 text-xs bg-muted/20">
            {/* Tag Code Type Selection */}
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Tag Code:</span>
              <div className="flex items-center gap-1 rounded-md border border-border p-0.5 bg-muted/40">
                <button
                  type="button"
                  onClick={() => setSelectedCodeType("qr")}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    selectedCodeType === "qr"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <QrCode className="h-3.5 w-3.5" />
                  QR Code
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCodeType("barcode")}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    selectedCodeType === "barcode"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Barcode className="h-3.5 w-3.5" />
                  Barcode
                </button>
              </div>
            </div>

            {/* Sticker Label Size Selection */}
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Sticker Label Size:</span>
              <div className="flex items-center gap-1 rounded-md border border-border p-0.5 bg-muted/40">
                <button
                  type="button"
                  onClick={() => setLabelFormat("compact")}
                  className={cn(
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    labelFormat === "compact"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Compact (50x25mm)
                </button>
                <button
                  type="button"
                  onClick={() => setLabelFormat("standard")}
                  className={cn(
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    labelFormat === "standard"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Standard (75x50mm)
                </button>
                <button
                  type="button"
                  onClick={() => setLabelFormat("large")}
                  className={cn(
                    "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                    labelFormat === "large"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Large (100x50mm)
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
              {(() => {
                const firstVal = printItems[0] ? getAssetEncodedValue(printItems[0], barcodeQrField).value : ""
                const encVal = firstVal ? encryptTagCode(firstVal) : ""
                return (
                  <>
                    <span>
                      Encoded ({printItems[0] ? getAssetEncodedValue(printItems[0], barcodeQrField).label : "Field"}):{" "}
                      <strong>{firstVal || "—"}</strong>
                    </span>
                    {encVal && (
                      <span className="text-[11px] font-mono bg-muted/80 text-foreground px-2 py-0.5 rounded border border-border/60">
                        Tag Code: {encVal}
                      </span>
                    )}
                  </>
                )
              })()}
            </div>
          </div>

          {/* Interactive Sticker Preview Area */}
          <div className="flex-1 overflow-y-auto p-6 m-6 bg-neutral-100/70 dark:bg-neutral-900/50 rounded-lg border border-border/40 flex flex-wrap gap-4 items-center justify-center">
            {printItems.map((asset) => (
              <AssetTagSticker
                key={asset.id}
                asset={asset}
                codeType={selectedCodeType}
                format={labelFormat}
                encodingField={barcodeQrField}
              />
            ))}
          </div>

          {/* Modal Footer Actions */}
          <DialogFooter className="shrink-0 px-6 py-4 border-t border-border/80 flex items-center justify-between sm:justify-between w-full">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleGoToTagPrinting}
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in Tag Printing Page
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isMarkingPrinted}
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
              <Button
                type="button"
                variant="default"
                disabled={isMarkingPrinted || printItems.length === 0}
                onClick={handleExecutePrint}
                className="gap-2 bg-primary text-primary-foreground"
              >
                {isMarkingPrinted ? (
                  <>
                    <RotateCw className="h-4 w-4 animate-spin" />
                    Updating Print Queue…
                  </>
                ) : (
                  <>
                    <Printer className="h-4 w-4" />
                    Print ({printItems.length} {printItems.length === 1 ? "Tag" : "Tags"})
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
