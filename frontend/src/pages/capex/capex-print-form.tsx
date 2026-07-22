import * as React from "react"
import { Download, Printer, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { CapexApprovalStepLine, CapexFormDetail, CapexWorkflowRun } from "@/lib/capex-types"
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

function CapexHardcopySheet({ detail }: { detail: CapexFormDetail }) {
  const rows = formRows(detail)
  const signs = buildSignBlocks(detail)

  return (
    <div
      id="capex-hardcopy-print"
      className="box-border flex flex-col bg-white text-black"
      style={{
        width: A4_W,
        height: A4_H,
        padding: "20px 24px",
        fontFamily: '"Times New Roman", Times, Georgia, serif',
        fontSize: 14,
        lineHeight: 1.4,
      }}
    >
      <h1
        className="m-0 mb-1 text-center font-bold uppercase"
        style={{ fontSize: 22, letterSpacing: "0.05em" }}
      >
        Asset Capitalisation Form
      </h1>
      <p className="mb-4 text-center text-neutral-700" style={{ fontSize: 13 }}>
        {detail.form_number}
      </p>

      <table className="w-full table-fixed border-collapse" style={{ fontSize: 13.5 }}>
        <thead>
          <tr>
            <th
              className="border border-black bg-neutral-100 px-2.5 py-2 text-left font-bold"
              style={{ width: "11%" }}
            >
              Sr. No.
            </th>
            <th
              className="border border-black bg-neutral-100 px-2.5 py-2 text-left font-bold"
              style={{ width: "39%" }}
            >
              Particulars
            </th>
            <th
              className="border border-black bg-neutral-100 px-2.5 py-2 text-left font-bold"
              style={{ width: "50%" }}
            >
              Details
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.no}>
              <td className="border border-black px-2.5 py-2 text-center align-top">{r.no}</td>
              <td className="border border-black px-2.5 py-2 align-top">{r.particular}</td>
              <td className="break-words border border-black px-2.5 py-2 align-top">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-auto flex justify-between gap-5 pt-8">
        {signs.map((s) => (
          <div key={s.roleLabel} className="min-w-0 flex-1" style={{ fontSize: 12 }}>
            <div className="mb-2.5 font-bold leading-snug">{s.roleLabel}:</div>
            <div
              className={cn(
                "mb-2 border-b border-black px-0.5 pb-1",
                s.signed ? "text-neutral-900" : "text-transparent",
              )}
              style={{
                minHeight: 34,
                fontFamily: "Segoe Script, Brush Script MT, Apple Chancery, cursive",
                fontSize: 18,
                fontStyle: "italic",
              }}
            >
              {s.signed ? s.name || "Approved" : "\u00a0"}
            </div>
            <div className="mt-1">
              Name: <span className="font-semibold">{s.signed && s.name ? s.name : ""}</span>
            </div>
            <div className="mt-0.5">
              Date:{" "}
              <span className="font-semibold">{s.signed ? formatPrintDate(s.signedAt) : ""}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

type PreviewProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: CapexFormDetail
}

/** A4 preview sized so the full page (title → signatures) stays visible. */
export function CapexPrintPreviewDialog({ open, onOpenChange, detail }: PreviewProps) {
  const stageRef = React.useRef<HTMLDivElement>(null)
  const [scale, setScale] = React.useState(0.75)

  React.useLayoutEffect(() => {
    if (!open) return
    const stage = stageRef.current
    if (!stage) return

    const update = () => {
      // Leave room for padding so edges never clip.
      const padX = 48
      const padY = 40
      const sw = Math.max(stage.clientWidth - padX, 180)
      const sh = Math.max(stage.clientHeight - padY, 180)
      if (sw < 50 || sh < 50) return
      // Fit entire A4 into the stage (both axes), with a small safety margin.
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
    window.setTimeout(() => window.print(), 80)
  }, [])

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
          "print:fixed print:inset-0 print:h-auto print:max-h-none print:w-full print:max-w-none",
          "print:translate-x-0 print:translate-y-0 print:rounded-none print:border-0 print:bg-white print:shadow-none",
        )}
      >
        <DialogHeader className="!gap-0 shrink-0 !border-b border-border/80 !px-4 !py-1.5 text-left print:hidden">
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

        {/*
          items-start (not center): vertical centering clips the top when the page
          is slightly taller than the stage. overflow-auto keeps a scroll fallback.
        */}
        <div
          ref={stageRef}
          className="relative min-h-0 flex-1 overflow-auto bg-[#e8ebf0] print:bg-white print:overflow-visible"
        >
          <div className="flex min-h-full justify-center px-6 py-5 print:p-0">
            <div
              className="relative shrink-0 print:!h-auto print:!w-auto"
              style={{ width: slotW, height: slotH }}
            >
              <div
                className="origin-top-left shadow-[0_8px_30px_rgba(0,0,0,0.18)] ring-1 ring-black/10 print:shadow-none print:ring-0 print:!transform-none"
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

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/80 bg-card px-5 py-3 print:hidden">
          <p className="text-xs text-muted-foreground">
            Full page from title through signatures. Scroll if needed.
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={runPrint}
              title="Choose Save as PDF in the print dialog"
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
