import { TAKEDA_LOGO_SRC } from "@/components/layout/app-brand-mark"
import {
  capexStatusLabel,
  type CapexApprovalStepLine,
  type CapexFormDetail,
  type CapexWorkflowRun,
} from "@/lib/capex-types"

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

/** Opens the native system print dialog (printer or Save as PDF). No custom preview. */
export function printCapexForm(detail: CapexFormDetail): void {
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

  /* Keep header/footer copy in sync with backend/modules/reports/pdf_chrome.py */
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>&#8203;</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 14mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #111827;
      font-family: "Times New Roman", Times, Georgia, serif;
      font-size: 11pt;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    table.chrome { width: 100%; border-collapse: collapse; }
    table.chrome > thead > tr > td,
    table.chrome > tfoot > tr > td { padding: 0; }
    .doc-header {
      padding: 0 2px 10px;
      margin: 0 0 14px;
      border-bottom: 2px solid #E1242A;
      font-family: Helvetica, Arial, sans-serif;
    }
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
    .brand-text .product {
      font-size: 8pt;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #6B7280;
      font-weight: 600;
    }
    .brand-text .title {
      margin-top: 2px;
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
    .form-body { margin: 0 0 8px; }
    table.form {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 10.5pt;
    }
    table.form th, table.form td {
      border: 1px solid #111;
      padding: 8px 10px;
      vertical-align: top;
      word-wrap: break-word;
      overflow-wrap: anywhere;
    }
    table.form th {
      background: #ececec;
      font-weight: 700;
      text-align: left;
      font-size: 10pt;
      padding: 9px 10px;
    }
    table.form tbody tr td {
      min-height: 1.6em;
    }
    .c-no { width: 12%; text-align: center; }
    .c-part { width: 38%; }
    .c-det { width: 50%; }
    .sigs {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 18px;
      margin: 28px 2px 0;
      padding: 8px 0 4px;
      page-break-inside: avoid;
    }
    .sig-block {
      flex: 1 1 0;
      min-width: 0;
      font-size: 9.5pt;
      overflow: hidden;
      padding: 0 2px;
    }
    .sig-label {
      font-weight: 700;
      margin-bottom: 10px;
      font-size: 9.5pt;
      line-height: 1.3;
    }
    .sig-mark {
      min-height: 32px;
      font-family: "Segoe Script", "Brush Script MT", "Apple Chancery", cursive;
      font-size: 14pt;
      font-style: italic;
      border-bottom: 1px solid #111;
      margin-bottom: 8px;
      padding-bottom: 4px;
    }
    .sig-mark.empty { color: transparent; }
    .sig-line {
      margin-top: 4px;
      line-height: 1.4;
    }
    .doc-footer {
      margin-top: 12px;
      padding: 8px 2px 0;
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
  <table class="chrome">
    <thead>
      <tr><td>
        <header class="doc-header">
          <div class="doc-header-row">
            <div class="brand">
              <div class="brand-logo">
                <img src="${escapeHtml(logoUrl)}" alt="Takeda" />
              </div>
              <div class="brand-text">
                <div class="product">Asset Tagging &amp; Tracking</div>
                <div class="title">Asset Capitalisation Form</div>
                <div class="sub">${escapeHtml(detail.form_number)} · ${status}</div>
              </div>
            </div>
            <div class="meta">
              <div>Generated: <strong>${escapeHtml(printedAt)}</strong></div>
              <div>Confidential — internal use only</div>
            </div>
          </div>
        </header>
      </td></tr>
    </thead>
    <tbody>
      <tr><td>
        <div class="form-body">
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
        </div>
        <div class="sigs">${signCols}</div>
      </td></tr>
    </tbody>
    <tfoot>
      <tr><td>
        <footer class="doc-footer">
          <div class="left">
            <div><strong>Takeda · Asset Tagging &amp; Tracking</strong></div>
            <div>Confidential — internal use only</div>
          </div>
          <div class="right">
            <div>System-generated</div>
          </div>
        </footer>
      </td></tr>
    </tfoot>
  </table>
</body>
</html>`

  const FRAME_ID = "capex-print-frame"
  let iframe = document.getElementById(FRAME_ID) as HTMLIFrameElement | null
  if (!iframe) {
    iframe = document.createElement("iframe")
    iframe.id = FRAME_ID
    iframe.setAttribute("aria-hidden", "true")
    iframe.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none"
    document.body.appendChild(iframe)
  }

  const win = iframe.contentWindow
  const doc = iframe.contentDocument
  if (!win || !doc) {
    throw new Error("Unable to prepare the print document.")
  }

  doc.open()
  doc.write(html)
  doc.close()
  // Empty <title> falls back to the parent app title ("Takeda") in Chrome print headers.
  doc.title = "\u200B"

  const trigger = () => {
    try {
      win.focus()
      win.print()
    } catch {
      throw new Error("Unable to open the system print dialog.")
    }
  }

  if (doc.readyState === "complete") {
    window.setTimeout(trigger, 150)
  } else {
    win.addEventListener("load", () => window.setTimeout(trigger, 150), { once: true })
  }
}
