import * as React from "react"
import { Download, Printer, X } from "lucide-react"
import { toast } from "sonner"

import { TAKEDA_LOGO_SRC } from "@/components/layout/app-brand-mark"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  capexStatusLabel,
  type CapexApprovalStepLine,
  type CapexFormDetail,
  type CapexWorkflowRun,
} from "@/lib/capex-types"
import { cn } from "@/lib/utils"

/** Screen A4 at 96dpi (210mm × 297mm). */
const A4_W = 794
const A4_H = 1123

type SignBlock = {
  roleLabel: string
  name: string | null
  signedAt: string | null
  signed: boolean
}

function dash(v: string | null | undefined): string {
  const s = (v ?? "").trim()
  return s || "—"
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function formatPrintDate(iso: string | null | undefined): string {
  if (!iso) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-")
    return `${d}.${m}.${y}`
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const yyyy = d.getFullYear()
  return `${dd}.${mm}.${yyyy}`
}

function formatPrintDateTime(d = new Date()): string {
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, "0")
  const mi = String(d.getMinutes()).padStart(2, "0")
  return `${dd}.${mm}.${yyyy} ${hh}:${mi}`
}

function stepsForPrint(detail: CapexFormDetail): CapexApprovalStepLine[] {
  const runs = detail.approval_panel?.workflow_runs
  if (runs && runs.length > 0) {
    const approved = [...runs].reverse().find((r) => r.request_status === "approved")
    const pick: CapexWorkflowRun =
      approved ?? runs.find((r) => r.is_current) ?? runs[runs.length - 1]
    return pick.workflow_steps
  }
  return detail.approval_panel?.workflow_steps ?? []
}

function approveFromRole(steps: CapexApprovalStepLine[], roleName: string): SignBlock {
  const step = steps.find((s) => s.approver_role_name === roleName)
  const action = step?.actions.find((a) => {
    const x = a.action.toLowerCase()
    return x === "approve" || x === "approved"
  })
  return {
    roleLabel: roleName,
    name: action?.actor_display_name?.trim() || step?.assigned_user_name?.trim() || null,
    signedAt: action?.created_at ?? null,
    signed: Boolean(action),
  }
}

function buildSignBlocks(detail: CapexFormDetail): SignBlock[] {
  const steps = stepsForPrint(detail)
  const blocks: SignBlock[] = [
    {
      roleLabel: "Signature of User",
      name: detail.created_by_name,
      signedAt: detail.created_at,
      signed: Boolean(detail.created_by_name),
    },
    {
      ...approveFromRole(steps, "Department HOD"),
      roleLabel: "Signature of HOD",
    },
  ]

  const engStep = steps.find((s) => s.approver_role_name === "Engineering")
  if (detail.requires_engineering || engStep) {
    blocks.push({
      ...approveFromRole(steps, "Engineering"),
      roleLabel: "Signature of Engineering (if Applicable)",
    })
  }

  blocks.push({
    ...approveFromRole(steps, "Central Finance"),
    roleLabel: "Signature of Central Finance",
  })

  return blocks
}

function formRows(detail: CapexFormDetail) {
  return [
    { no: 1, particular: "Name of the Asset", detail: dash(detail.asset_name) },
    { no: 2, particular: "User Equipment Tag No.", detail: dash(detail.equipment_tag_no) },
    { no: 3, particular: "Asset Specifications", detail: dash(detail.asset_specifications) },
    { no: 4, particular: "Name of the party", detail: dash(detail.party_name) },
    { no: 5, particular: "Department", detail: dash(detail.department) },
    { no: 6, particular: "Location of Installation", detail: dash(detail.installation_location) },
    { no: 7, particular: "Name of the Department Head", detail: dash(detail.department_head) },
    {
      no: 8,
      particular: "Comment on the functioning of the Asset",
      detail: dash(detail.functioning_comment),
    },
    {
      no: 9,
      particular: "Date of Installation",
      detail: detail.installation_date ? formatPrintDate(detail.installation_date) : "—",
    },
    { no: 10, particular: "AUC code", detail: dash(detail.auc_code) },
    { no: 11, particular: "Useful life of assets", detail: dash(detail.useful_life) },
  ]
}

function DocumentHeader({ detail, printedAt }: { detail: CapexFormDetail; printedAt: string }) {
  return (
    <header className="mb-3 shrink-0 border-b-2 border-black pb-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <img
            src={TAKEDA_LOGO_SRC}
            alt="Takeda"
            className="h-9 w-auto shrink-0 object-contain object-left"
            style={{ maxWidth: 110 }}
          />
          <div className="min-w-0 pt-0.5" style={{ fontFamily: "system-ui, sans-serif" }}>
            <div className="text-[12px] font-bold leading-tight text-neutral-900">Takeda</div>
            <div className="text-[9px] leading-snug text-neutral-600">Asset Tracking &amp; Tagging</div>
            <div className="mt-0.5 text-[8px] text-neutral-500">Controlled document</div>
          </div>
        </div>
        <div
          className="max-w-[42%] shrink-0 text-right text-[9px] leading-relaxed text-neutral-700"
          style={{ fontFamily: "system-ui, sans-serif" }}
        >
          <div className="break-words">
            <span className="text-neutral-500">Print date:</span>{" "}
            <span className="font-semibold text-neutral-900">{printedAt}</span>
          </div>
          <div className="break-all">
            <span className="text-neutral-500">Form no:</span>{" "}
            <span className="font-semibold text-neutral-900">{detail.form_number}</span>
          </div>
          <div>
            <span className="text-neutral-500">Status:</span>{" "}
            <span className="font-semibold text-neutral-900">{capexStatusLabel(detail.status)}</span>
          </div>
        </div>
      </div>
      <h1
        className="m-0 mt-2.5 text-center font-bold uppercase text-neutral-900"
        style={{ fontSize: 17, letterSpacing: "0.05em" }}
      >
        Asset Capitalisation Form
      </h1>
    </header>
  )
}

function DocumentFooter({ detail, printedAt }: { detail: CapexFormDetail; printedAt: string }) {
  return (
    <footer
      className="mt-3 shrink-0 border-t border-neutral-400 pt-2"
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      <div className="flex items-end justify-between gap-3 text-[8.5px] leading-snug text-neutral-600">
        <div className="min-w-0">
          <div className="font-semibold text-neutral-800">Takeda · Asset Tracking &amp; Tagging</div>
          <div className="break-words">
            Confidential — internal use only. {detail.form_number}. Printed {printedAt}.
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div>Page 1 of 1</div>
          <div>System-generated hardcopy</div>
        </div>
      </div>
    </footer>
  )
}

function CapexHardcopySheet({ detail }: { detail: CapexFormDetail }) {
  const rows = formRows(detail)
  const signs = buildSignBlocks(detail)
  const printedAt = formatPrintDateTime()

  return (
    <div
      className="box-border flex flex-col bg-white text-black"
      style={{
        width: A4_W,
        height: A4_H,
        padding: "16px 20px 12px",
        fontFamily: '"Times New Roman", Times, Georgia, serif',
        fontSize: 14,
        lineHeight: 1.35,
      }}
    >
      <DocumentHeader detail={detail} printedAt={printedAt} />

      <table className="w-full table-fixed border-collapse" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th
              className="border border-black bg-neutral-100 px-2 py-1.5 text-left font-bold"
              style={{ width: "11%" }}
            >
              Sr. No.
            </th>
            <th
              className="border border-black bg-neutral-100 px-2 py-1.5 text-left font-bold"
              style={{ width: "39%" }}
            >
              Particulars
            </th>
            <th
              className="border border-black bg-neutral-100 px-2 py-1.5 text-left font-bold"
              style={{ width: "50%" }}
            >
              Details
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.no}>
              <td className="border border-black px-2 py-1.5 text-center align-top">{r.no}</td>
              <td className="border border-black px-2 py-1.5 align-top">{r.particular}</td>
              <td className="break-words border border-black px-2 py-1.5 align-top">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-auto flex justify-between gap-3 pt-5">
        {signs.map((s) => (
          <div key={s.roleLabel} className="min-w-0 flex-1 overflow-hidden" style={{ fontSize: 10.5 }}>
            <div className="mb-1.5 font-bold leading-snug">{s.roleLabel}:</div>
            <div
              className={cn(
                "mb-1.5 border-b border-black px-0.5 pb-1",
                s.signed ? "text-neutral-900" : "text-transparent",
              )}
              style={{
                minHeight: 28,
                fontFamily: "Segoe Script, Brush Script MT, Apple Chancery, cursive",
                fontSize: 15,
                fontStyle: "italic",
              }}
            >
              {s.signed ? s.name || "Approved" : "\u00a0"}
            </div>
            <div className="mt-1 break-words">
              Name: <span className="font-semibold">{s.signed && s.name ? s.name : ""}</span>
            </div>
            <div className="mt-0.5">
              Date:{" "}
              <span className="font-semibold">{s.signed ? formatPrintDate(s.signedAt) : ""}</span>
            </div>
          </div>
        ))}
      </div>

      <DocumentFooter detail={detail} printedAt={printedAt} />
    </div>
  )
}

/** Clean A4 print document — avoids dialog transform clipping in browser print. */
function openCapexPrintDocument(detail: CapexFormDetail): void {
  const printedAt = formatPrintDateTime()
  const rows = formRows(detail)
  const signs = buildSignBlocks(detail)
  const logoUrl = new URL(TAKEDA_LOGO_SRC, window.location.origin).href
  const status = escapeHtml(capexStatusLabel(detail.status))

  const tableRows = rows
    .map(
      (r) => `<tr>
      <td class="c-no">${r.no}</td>
      <td class="c-part">${escapeHtml(r.particular)}</td>
      <td class="c-det">${escapeHtml(r.detail)}</td>
    </tr>`,
    )
    .join("")

  const signCols = signs
    .map((s) => {
      const mark = s.signed
        ? `<div class="sig-mark">${escapeHtml(s.name || "Approved")}</div>`
        : `<div class="sig-mark empty">&nbsp;</div>`
      const name = s.signed && s.name ? escapeHtml(s.name) : ""
      const date = s.signed ? formatPrintDate(s.signedAt) : ""
      return `<div class="sig-block">
      <div class="sig-label">${escapeHtml(s.roleLabel)}:</div>
      ${mark}
      <div class="sig-line">Name: <strong>${name}</strong></div>
      <div class="sig-line">Date: <strong>${date}</strong></div>
    </div>`
    })
    .join("")

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(detail.form_number)} — Asset Capitalisation Form</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #111;
      font-family: "Times New Roman", Times, Georgia, serif;
      font-size: 11pt;
      line-height: 1.35;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 100%;
      min-height: calc(297mm - 24mm);
      display: flex;
      flex-direction: column;
    }
    .doc-header {
      border-bottom: 2px solid #111;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .doc-header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }
    .brand {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      min-width: 0;
      flex: 1;
    }
    .brand img { height: 36px; width: auto; max-width: 110px; object-fit: contain; }
    .brand-text { font-family: system-ui, sans-serif; }
    .brand-text .name { font-size: 11pt; font-weight: 700; }
    .brand-text .sub { font-size: 8pt; color: #555; }
    .brand-text .tag { font-size: 7.5pt; color: #777; margin-top: 1px; }
    .meta {
      font-family: system-ui, sans-serif;
      font-size: 8pt;
      text-align: right;
      line-height: 1.45;
      max-width: 42%;
      flex-shrink: 0;
    }
    .meta strong { color: #111; }
    .meta span { color: #666; }
    h1 {
      margin: 10px 0 0;
      text-align: center;
      font-size: 14pt;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    table.form {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 10pt;
    }
    table.form th, table.form td {
      border: 1px solid #111;
      padding: 5px 7px;
      vertical-align: top;
      word-wrap: break-word;
      overflow-wrap: anywhere;
    }
    table.form th {
      background: #f0f0f0;
      font-weight: 700;
      text-align: left;
      font-size: 9.5pt;
    }
    .c-no { width: 11%; text-align: center; }
    .c-part { width: 39%; }
    .c-det { width: 50%; }
    .sigs {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-top: auto;
      padding-top: 22px;
      page-break-inside: avoid;
    }
    .sig-block {
      flex: 1 1 0;
      min-width: 0;
      font-size: 8.5pt;
      overflow: hidden;
    }
    .sig-label { font-weight: 700; margin-bottom: 6px; }
    .sig-mark {
      min-height: 26px;
      font-family: "Segoe Script", "Brush Script MT", "Apple Chancery", cursive;
      font-size: 13pt;
      font-style: italic;
      border-bottom: 1px solid #111;
      margin-bottom: 6px;
      padding-bottom: 2px;
    }
    .sig-mark.empty { color: transparent; }
    .sig-line { margin-top: 2px; }
    .doc-footer {
      margin-top: 12px;
      padding-top: 6px;
      border-top: 1px solid #999;
      font-family: system-ui, sans-serif;
      font-size: 7.5pt;
      color: #555;
      display: flex;
      justify-content: space-between;
      gap: 10px;
    }
    .doc-footer .left { min-width: 0; }
    .doc-footer .right { text-align: right; flex-shrink: 0; }
    .doc-footer strong { color: #222; }
  </style>
</head>
<body>
  <div class="page">
    <header class="doc-header">
      <div class="doc-header-top">
        <div class="brand">
          <img src="${escapeHtml(logoUrl)}" alt="Takeda" />
          <div class="brand-text">
            <div class="name">Takeda</div>
            <div class="sub">Asset Tracking &amp; Tagging</div>
            <div class="tag">Controlled document</div>
          </div>
        </div>
        <div class="meta">
          <div><span>Print date:</span> <strong>${escapeHtml(printedAt)}</strong></div>
          <div><span>Form no:</span> <strong>${escapeHtml(detail.form_number)}</strong></div>
          <div><span>Status:</span> <strong>${status}</strong></div>
        </div>
      </div>
      <h1>Asset Capitalisation Form</h1>
    </header>

    <table class="form">
      <thead>
        <tr>
          <th class="c-no">Sr. No.</th>
          <th class="c-part">Particulars</th>
          <th class="c-det">Details</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>

    <div class="sigs">${signCols}</div>

    <footer class="doc-footer">
      <div class="left">
        <div><strong>Takeda · Asset Tracking &amp; Tagging</strong></div>
        <div>Confidential — internal use only. ${escapeHtml(detail.form_number)}. Printed ${escapeHtml(printedAt)}.</div>
      </div>
      <div class="right">
        <div>Page 1 of 1</div>
        <div>System-generated hardcopy</div>
      </div>
    </footer>
  </div>
  <script>
    window.addEventListener("load", function () {
      setTimeout(function () { window.focus(); window.print(); }, 200);
    });
  </script>
</body>
</html>`

  const w = window.open("", "_blank", "noopener,noreferrer")
  if (!w) {
    throw new Error("Pop-up blocked. Allow pop-ups to print or save as PDF.")
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
}

type PreviewProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: CapexFormDetail
}

/** On-screen A4 preview; Print / Save as PDF use a clean print document. */
export function CapexPrintPreviewDialog({ open, onOpenChange, detail }: PreviewProps) {
  const stageRef = React.useRef<HTMLDivElement>(null)
  const [scale, setScale] = React.useState(0.75)

  React.useLayoutEffect(() => {
    if (!open) return
    const stage = stageRef.current
    if (!stage) return

    const update = () => {
      const padX = 48
      const padY = 40
      const sw = Math.max(stage.clientWidth - padX, 180)
      const sh = Math.max(stage.clientHeight - padY, 180)
      if (sw < 50 || sh < 50) return
      const next = Math.min(sw / A4_W, sh / A4_H) * 0.96
      setScale(Number.isFinite(next) && next > 0.25 ? next : 0.75)
    }

    const id1 = window.requestAnimationFrame(() => {
      update()
      window.requestAnimationFrame(update)
    })
    const ro = new ResizeObserver(update)
    ro.observe(stage)
    window.addEventListener("resize", update)
    return () => {
      window.cancelAnimationFrame(id1)
      ro.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [open])

  const runPrint = React.useCallback(() => {
    try {
      openCapexPrintDocument(detail)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to open print document.")
    }
  }, [detail])

  const slotW = Math.round(A4_W * scale)
  const slotH = Math.round(A4_H * scale)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex h-[min(96vh,1100px)] w-[min(96vw,920px)] flex-col gap-0 overflow-hidden p-0",
          "max-w-none sm:max-w-none md:max-w-none lg:max-w-none",
          "rounded-2xl border border-border/70 bg-card shadow-2xl",
        )}
      >
        <DialogHeader className="!gap-0 shrink-0 !border-b border-border/80 !px-4 !py-1.5 text-left">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <DialogTitle className="text-sm font-semibold tracking-tight">
                Print preview
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {detail.form_number} · A4
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 shrink-0 rounded-full"
              onClick={() => onOpenChange(false)}
              aria-label="Close preview"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </DialogHeader>

        <div ref={stageRef} className="relative min-h-0 flex-1 overflow-auto bg-[#e8ebf0]">
          <div className="flex min-h-full justify-center px-6 py-5">
            <div className="relative shrink-0" style={{ width: slotW, height: slotH }}>
              <div
                className="origin-top-left shadow-[0_8px_30px_rgba(0,0,0,0.18)] ring-1 ring-black/10"
                style={{
                  width: A4_W,
                  height: A4_H,
                  transform: `scale(${scale})`,
                }}
              >
                <CapexHardcopySheet detail={detail} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/80 bg-card px-5 py-3">
          <p className="text-xs text-muted-foreground">
            Preview on screen, then print or save as PDF.
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={runPrint}
              title="Opens a clean print page — choose Save as PDF in the dialog"
            >
              <Download className="mr-1.5 size-4" aria-hidden />
              Save as PDF
            </Button>
            <Button type="button" onClick={runPrint}>
              <Printer className="mr-1.5 size-4" aria-hidden />
              Print
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
