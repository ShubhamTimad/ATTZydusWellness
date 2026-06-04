import { cn } from "@/lib/utils"
import type { OrderLifecycleStep } from "@/lib/orders-types"

type Props = {
  steps: OrderLifecycleStep[]
  currentStepKey: string | null
  orderStatus?: string
  /** Compact ribbon for detail pages. */
  compact?: boolean
}

function mergeStatus(statuses: string[]): string {
  if (statuses.some((s) => s === "rejected")) return "rejected"
  if (statuses.some((s) => s === "active")) return "active"
  if (statuses.length > 0 && statuses.every((s) => s === "completed")) return "completed"
  if (statuses.some((s) => s === "completed")) return "active"
  return "pending"
}

/** Collapse backend micro-steps into five readable lifecycle phases. */
export function simplifyProgressSteps(steps: OrderLifecycleStep[]): OrderLifecycleStep[] {
  const pick = (prefix: string) => steps.filter((s) => s.key === prefix || s.key.startsWith(`${prefix}_`))

  const created = steps.find((s) => s.key === "created")
  const assigned = steps.find((s) => s.key === "assigned")
  const creationApproval = pick("creation_approval")
  const execution = steps.filter((s) => ["activated", "started", "verification"].includes(s.key))
  const closureSubmit = steps.find((s) => s.key === "closure_submitted")
  const closureApproval = pick("closure_approval")
  const done = steps.find((s) => s.key === "completed")

  const groups: { key: string; label: string; members: OrderLifecycleStep[] }[] = [
    { key: "created", label: "Created", members: [created, assigned].filter(Boolean) as OrderLifecycleStep[] },
    { key: "creation_approval", label: "Approval", members: creationApproval },
    { key: "verification", label: "Verification", members: execution },
    {
      key: "closure",
      label: "Closure",
      members: [...(closureSubmit ? [closureSubmit] : []), ...closureApproval],
    },
    { key: "completed", label: "Completed", members: done ? [done] : [] },
  ]

  return groups.map(({ key, label, members }) => {
    if (members.length === 0) {
      return { key, label, status: "pending", approver_slots: [] }
    }
    const status = mergeStatus(members.map((m) => m.status))
    const completedMembers = members.filter((m) => m.status === "completed")
    const lastDone = completedMembers[completedMembers.length - 1]
    const activeMember = members.find((m) => m.status === "active" || m.status === "rejected")
    const slots = members.flatMap((m) => m.approver_slots ?? [])
    const detail =
      activeMember?.detail ??
      (key === "verification" ? members.find((m) => m.key === "verification")?.detail : undefined)

    return {
      key,
      label,
      status,
      role_name: activeMember?.role_name ?? members.find((m) => m.role_name)?.role_name,
      actor_name: lastDone?.actor_name ?? activeMember?.actor_name,
      occurred_at: lastDone?.occurred_at,
      detail,
      approver_slots: slots.length > 0 ? slots : [],
    }
  })
}

function resolveCurrentKey(
  simplified: OrderLifecycleStep[],
  rawKey: string | null,
  orderStatus?: string,
): string | null {
  if (orderStatus === "rejected") {
    const rejectedStep = simplified.find((s) => s.status === "rejected")
    if (rejectedStep) return rejectedStep.key
  }
  if (!rawKey) return null
  if (rawKey.startsWith("creation")) return "creation_approval"
  if (["activated", "started", "verification"].includes(rawKey)) return "verification"
  if (rawKey.startsWith("closure")) return "closure"
  if (rawKey === "assigned" || rawKey === "created") return "created"
  if (rawKey === "completed") return "completed"
  return simplified.find((s) => s.status === "active" || s.status === "rejected")?.key ?? null
}

function chevronClip(isFirst: boolean, isLast: boolean, notch: number): string {
  const n = `${notch}px`
  if (isFirst && isLast) return "polygon(0 0, 100% 0, 100% 100%, 0 100%)"
  if (isFirst) return `polygon(0 0, calc(100% - ${n}) 0, 100% 50%, calc(100% - ${n}) 100%, 0 100%)`
  if (isLast) return `polygon(0 0, 100% 0, 100% 100%, 0 100%, ${n} 50%)`
  return `polygon(0 0, calc(100% - ${n}) 0, 100% 50%, calc(100% - ${n}) 100%, 0 100%, ${n} 50%)`
}

type VisualPhase = "completed" | "current" | "upcoming" | "rejected"

function resolveVisualPhase(
  step: OrderLifecycleStep,
  isCurrent: boolean,
  orderStatus?: string,
): VisualPhase {
  if (step.status === "rejected" || (orderStatus === "rejected" && isCurrent)) {
    return "rejected"
  }
  if (step.status === "completed") {
    return "completed"
  }
  if (isCurrent && step.status === "active") {
    return "current"
  }
  return "upcoming"
}

function segmentSurface(phase: VisualPhase): string {
  switch (phase) {
    case "completed":
      return "border border-zinc-200/90 bg-[linear-gradient(180deg,#f4f4f5_0%,#e4e4e7_100%)] text-zinc-600"
    case "current":
      return "border border-primary/30 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--primary)_72%,white)_0%,var(--primary)_100%)] text-primary-foreground shadow-sm"
    case "rejected":
      return "border border-destructive/40 bg-[linear-gradient(180deg,#fca5a5_0%,var(--destructive)_100%)] text-white shadow-sm"
    default:
      return "border border-zinc-200 bg-white text-zinc-500"
  }
}

export function OrderLifecycleStepper({ steps, currentStepKey, orderStatus, compact = false }: Props) {
  const simplified = simplifyProgressSteps(steps)
  const activeKey = resolveCurrentKey(simplified, currentStepKey, orderStatus)
  const notch = compact ? 10 : 16

  return (
    <div className={cn("overflow-x-auto", compact ? "pb-0" : "pb-1")}>
      <ol className={cn("flex", compact ? "min-w-[28rem]" : "min-w-[36rem]")}>
        {simplified.map((step, index) => {
          const isFirst = index === 0
          const isLast = index === simplified.length - 1
          const isCurrent = step.key === activeKey
          const phase = resolveVisualPhase(step, isCurrent, orderStatus)
          const label =
            phase === "rejected" && step.label !== "Completed" ? `${step.label}` : step.label

          return (
            <li
              key={step.key}
              className={cn(
                "relative flex-1",
                compact ? "min-w-[4.5rem]" : "min-w-[5.75rem]",
                index > 0 && (compact ? "-ml-2" : "-ml-3"),
              )}
              style={{ zIndex: simplified.length - index }}
              aria-current={isCurrent ? "step" : undefined}
              title={step.label}
            >
              <div
                className={cn(
                  "flex items-center justify-center text-center",
                  compact ? "min-h-[1.75rem] px-3 py-1" : "min-h-[3.25rem] flex-col px-5 py-2",
                  segmentSurface(phase),
                )}
                style={{ clipPath: chevronClip(isFirst, isLast, notch) }}
              >
                <span
                  className={cn(
                    "font-semibold leading-none",
                    compact ? "text-[10px] sm:text-[11px]" : "text-xs leading-tight sm:text-sm",
                  )}
                >
                  {label}
                </span>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
