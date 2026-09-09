import { currentBrandLogoSrc } from "@/components/layout/app-brand-mark"
import { getJson } from "@/lib/api"
import {
  capexStatusLabel,
  type CapexApprovalStepLine,
  type CapexFormDetail,
  type CapexWorkflowRun,
} from "@/lib/capex-types"

type DocumentFormatSettings = {
  org_name: string
  product_name?: string
  confidential_line: string
  signatures: { capex: boolean }
}

const DEFAULT_DOCUMENT_FORMAT: DocumentFormatSettings = {
  org_name: "Takeda",
  confidential_line: "Confidential — internal use only",
  signatures: { capex: true },
}

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

function formatPrintDate(value: string | Date | null | undefined): string {
  if (value == null || value === "") return ""
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-")
    return `${d}/${m}/${y}`
  }
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return typeof value === "string" ? value : ""
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  return `${dd}/${mm}/${d.getFullYear()}`
}

function formatPrintDateTime(d = new Date()): string {
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
  return `${formatPrintDate(d)} ${time}`
}

function costCenterDetail(detail: CapexFormDetail): string {
  const code = (detail.cost_center_code ?? "").trim()
  const name = (detail.cost_center_name ?? "").trim()
  if (code && name) return `${code} — ${name}`
  return code || name || "—"
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

function approveFromStep(step: CapexApprovalStepLine | undefined): SignBlock {
  const action = step?.actions.find((a) => {
    const x = a.action.toLowerCase()
    return x === "approve" || x === "approved"
  })
  const roleName = step?.approver_role_name?.trim() || "Approver"
  return {
    roleLabel: roleName,
    name: action?.actor_display_name?.trim() || step?.assigned_user_name?.trim() || null,
    signedAt: action?.created_at ?? null,
    signed: Boolean(action),
  }
}

function buildSignBlocks(detail: CapexFormDetail): SignBlock[] {
  const steps = stepsForPrint(detail).filter(
    (s) => (s.step_kind || "approve").toLowerCase() === "approve",
  )
  const blocks: SignBlock[] = [
    {
      roleLabel: "Signature of User",
      name: detail.created_by_name,
      signedAt: detail.created_at,
      signed: Boolean(detail.created_by_name),
    },
  ]
  for (const step of steps) {
    const base = approveFromStep(step)
    blocks.push({
      ...base,
      roleLabel: `Signature of ${base.roleLabel}`,
    })
  }
  return blocks
}

function formRows(detail: CapexFormDetail) {
  return [
    { no: 1, particular: "Asset Name", detail: dash(detail.asset_name) },
    { no: 2, particular: "User Equipment Tag No.", detail: dash(detail.equipment_tag_no) },
    { no: 3, particular: "Asset Specifications", detail: dash(detail.asset_specifications) },
    { no: 4, particular: "Party Name", detail: dash(detail.party_name) },
    { no: 5, particular: "Department", detail: dash(detail.department) },
    { no: 6, particular: "Cost Center", detail: costCenterDetail(detail) },
    { no: 7, particular: "Location of Installation", detail: dash(detail.installation_location) },
    { no: 8, particular: "Department Head Name", detail: dash(detail.department_head) },
    {
      no: 9,
      particular: "Comment on the Functioning of Asset",
      detail: dash(detail.functioning_comment),
    },
    {
      no: 10,
      particular: "Date of Installation",
      detail: detail.installation_date ? formatPrintDate(detail.installation_date) : "—",
    },
    { no: 11, particular: "AUC Code", detail: dash(detail.auc_code) },
    {
      no: 12,
      particular: "Useful Life of Asset (Years)",
      detail: dash((detail.useful_life ?? "").replace(/\D/g, "") || detail.useful_life),
    },
  ]
}

/** Opens the native system print dialog (printer or Save as PDF). No custom preview. */
export async function printCapexForm(detail: CapexFormDetail): Promise<void> {
  const printedAt = formatPrintDateTime()
  const rows = formRows(detail)
  const [chrome, me] = await Promise.all([
    getJson<DocumentFormatSettings>("/admin/settings/document-format").catch(
      () => DEFAULT_DOCUMENT_FORMAT,
    ),
    getJson<{ full_name?: string }>("/me").catch(() => ({ full_name: "" })),
  ])
  const org = escapeHtml(chrome.org_name.trim() || DEFAULT_DOCUMENT_FORMAT.org_name)
  const confidential = escapeHtml(
    chrome.confidential_line.trim() || DEFAULT_DOCUMENT_FORMAT.confidential_line,
  )
  const generatedBy = escapeHtml((me.full_name || "").trim())
  const showSigns = chrome.signatures?.capex !== false
  const signs = showSigns ? buildSignBlocks(detail) : []
  const logoUrl = new URL(currentBrandLogoSrc(), window.location.origin).href
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

  /* Keep header/footer copy in sync with backend/modules/reports/pdf_chrome.py.
     Sheet fills A4; signatures+confidential sit at the bottom of page 1. */
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>&#8203;</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0 14mm;
      min-height: 297mm;
      height: 297mm;
      background: #fff;
      color: #111827;
      font-family: "Times New Roman", Times, Georgia, serif;
      font-size: 11pt;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet {
      display: flex;
      flex-direction: column;
      min-height: 297mm;
      height: 100%;
    }
    table.print {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    table.print > thead { display: table-header-group; }
    table.print > tbody > tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .banner {
      padding: 12mm 0 8px;
      border-bottom: 2px solid #E1242A;
      font-family: Helvetica, Arial, sans-serif;
    }
    .gap { height: 12px; }
    .doc-header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .brand {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      min-width: 0;
      flex: 1;
    }
    .brand-logo img {
      height: 36px;
      width: auto;
      max-width: 120px;
      object-fit: contain;
      object-position: left top;
      display: block;
    }
    .brand-text .title {
      font-size: 12pt;
      font-weight: 700;
      color: #111827;
      line-height: 1.25;
    }
    .brand-text .sub {
      margin-top: 2px;
      font-size: 8.5pt;
      color: #6B7280;
    }
    .meta {
      font-size: 8.5pt;
      text-align: right;
      line-height: 1.4;
      flex-shrink: 0;
      color: #6B7280;
    }
    .meta strong { color: #111827; font-weight: 650; }
    th.col, td.c-no, td.c-part, td.c-det {
      border: 1px solid #111;
      padding: 8px 10px;
      vertical-align: top;
      word-wrap: break-word;
      overflow-wrap: anywhere;
    }
    th.col {
      background: #ececec;
      font-weight: 700;
      text-align: left;
      font-size: 10pt;
      padding: 9px 10px;
    }
    .c-no { width: 12%; text-align: center; }
    .c-part { width: 38%; }
    .c-det { width: 50%; }
    .spacer { flex: 1 1 auto; min-height: 12px; }
    .bottom {
      flex: 0 0 auto;
      padding-top: 16px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .sigs {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 14px;
      font-family: Helvetica, Arial, sans-serif;
      padding-bottom: 14px;
    }
    .sig-block {
      flex: 1 1 0;
      min-width: 0;
      font-size: 8.5pt;
      overflow: hidden;
      padding: 0 2px;
    }
    .sig-label {
      font-weight: 700;
      margin-bottom: 8px;
      font-size: 8pt;
      line-height: 1.3;
    }
    .sig-mark {
      min-height: 22px;
      font-family: Times, "Times New Roman", Georgia, serif;
      font-size: 11pt;
      font-style: italic;
      border-bottom: 1px solid #111;
      margin-bottom: 6px;
      padding-bottom: 2px;
    }
    .sig-mark.empty { color: transparent; }
    .sig-line { margin-top: 4px; line-height: 1.4; }
    .doc-footer {
      padding: 8px 0 12mm;
      border-top: 0.6pt solid #D1D5DB;
      font-family: Helvetica, Arial, sans-serif;
      font-size: 8pt;
      color: #6B7280;
      display: flex;
      justify-content: space-between;
      gap: 14px;
      line-height: 1.4;
    }
    .doc-footer .left { min-width: 0; }
    .doc-footer .right { text-align: right; flex-shrink: 0; }
    .doc-footer strong { color: #111827; font-size: 8.5pt; }
  </style>
</head>
<body>
  <div class="sheet">
    <header class="banner">
      <div class="doc-header-row">
        <div class="brand">
          <div class="brand-logo">
            <img src="${escapeHtml(logoUrl)}" alt="" />
          </div>
          <div class="brand-text">
            <div class="title">Asset Capitalization Form</div>
            <div class="sub">${escapeHtml(detail.form_number)} · ${status}</div>
          </div>
        </div>
        <div class="meta">
          <div>Generated At: <strong>${escapeHtml(printedAt)}</strong></div>
        </div>
      </div>
    </header>
    <div class="gap"></div>
    <table class="print">
      <thead>
        <tr>
          <th class="col c-no">Sr. No.</th>
          <th class="col c-part">Particulars</th>
          <th class="col c-det">Details</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
    <div class="spacer" aria-hidden="true"></div>
    <div class="bottom">
      ${showSigns ? `<div class="sigs">${signCols}</div>` : ""}
      <div class="doc-footer">
        <div class="left">
          <div><strong>${org}</strong></div>
          <div>${confidential}</div>
        </div>
        <div class="right">
          <div>${generatedBy ? `Generated by ${generatedBy}` : "Generated by —"}</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`

  const FRAME_ID = "capex-print-frame"
  const HIDDEN =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none"
  const A4 =
    "position:fixed;left:0;top:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;z-index:-1"
  let iframe = document.getElementById(FRAME_ID) as HTMLIFrameElement | null
  if (!iframe) {
    iframe = document.createElement("iframe")
    iframe.id = FRAME_ID
    iframe.setAttribute("aria-hidden", "true")
    document.body.appendChild(iframe)
  }
  iframe.style.cssText = A4

  const win = iframe.contentWindow
  const doc = iframe.contentDocument
  if (!win || !doc) {
    throw new Error("Unable to prepare the print document.")
  }

  doc.open()
  doc.write(html)
  doc.close()
  doc.title = "\u200B"

  const trigger = () => {
    try {
      win.focus()
      win.print()
    } catch {
      throw new Error("Unable to open the system print dialog.")
    } finally {
      iframe.style.cssText = HIDDEN
    }
  }

  const start = () => {
    const img = doc.querySelector(".brand-logo img") as HTMLImageElement | null
    if (img && !img.complete) {
      img.addEventListener("load", () => window.setTimeout(trigger, 50), { once: true })
      img.addEventListener("error", () => window.setTimeout(trigger, 50), { once: true })
      return
    }
    window.setTimeout(trigger, 50)
  }

  if (doc.readyState === "complete") start()
  else win.addEventListener("load", start, { once: true })
}
