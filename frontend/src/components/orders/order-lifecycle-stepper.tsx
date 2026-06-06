import { cn } from "@/lib/utils"
import type { OrderLifecycleStep } from "@/lib/orders-types"

type Props = {
  steps: OrderLifecycleStep[]
  currentStepKey: string | null
  orderStatus?: string
  /** Compact ribbon for detail pages. */
  compact?: boolean
}

/** Must match backend order status → highlighted timeline segment. */
const STATUS_TO_STEP_KEY: Record<string, string> = {
  draft: "order_created",
  pending_approval: "approved",
  approved: "approved",
  assigned: "assigned",
  in_progress: "in_progress",
  pending_closure_approval: "completed",
  completed: "completed",
  closed: "closed",
  rejected: "rejected",
}

const STEP_ORDER = [
  "order_created",
  "approved",
  "assigned",
  "in_progress",
  "completed",
  "closed",
] as const

function chevronClip(isFirst: boolean, isLast: boolean, notch: number): string {
  const n = `${notch}px`
  if (isFirst && isLast) return "polygon(0 0, 100% 0, 100% 100%, 0 100%)"
  if (isFirst) return `polygon(0 0, calc(100% - ${n}) 0, 100% 50%, calc(100% - ${n}) 100%, 0 100%)`
  if (isLast) return `polygon(0 0, 100% 0, 100% 100%, 0 100%, ${n} 50%)`
  return `polygon(0 0, calc(100% - ${n}) 0, 100% 50%, calc(100% - ${n}) 100%, 0 100%, ${n} 50%)`
}

type VisualPhase = "completed" | "current" | "upcoming" | "rejected"

function resolveActiveKey(orderStatus?: string, fallbackKey?: string | null): string | null {
  if (orderStatus && STATUS_TO_STEP_KEY[orderStatus]) {
    return STATUS_TO_STEP_KEY[orderStatus]
  }
  return fallbackKey ?? null
}

function resolveVisualPhase(step: OrderLifecycleStep, activeKey: string | null, orderStatus?: string): VisualPhase {
  if (orderStatus === "rejected" && step.key === "rejected") {
    return "rejected"
  }
  if (step.key === activeKey) {
    return "current"
  }
  const stepIdx = STEP_ORDER.indexOf(step.key as (typeof STEP_ORDER)[number])
  const activeIdx = activeKey
    ? STEP_ORDER.indexOf(activeKey as (typeof STEP_ORDER)[number])
    : -1
  if (stepIdx >= 0 && activeIdx >= 0 && stepIdx < activeIdx) {
    return "completed"
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

function displayLabel(step: OrderLifecycleStep, orderStatus?: string, isCurrent?: boolean): string {
  if (step.key === "rejected") return "REJECTED"
  if (isCurrent && orderStatus === "pending_approval" && step.key === "approved") {
    return "PENDING APPROVAL"
  }
  if (isCurrent && orderStatus === "pending_closure_approval" && step.key === "completed") {
    return "PENDING CLOSURE"
  }
  if (isCurrent && orderStatus === "draft" && step.key === "order_created") {
    return "DRAFT"
  }
  return step.label.toUpperCase()
}

export function OrderLifecycleStepper({ steps, currentStepKey, orderStatus, compact = false }: Props) {
  const displaySteps = steps.filter((s) => s.key !== "rejected" || orderStatus === "rejected")
  const activeKey = resolveActiveKey(orderStatus, currentStepKey)
  const notch = compact ? 10 : 16

  return (
    <div className={cn("overflow-x-auto", compact ? "pb-0" : "pb-1")}>
      <ol className={cn("flex", compact ? "min-w-[32rem]" : "min-w-[42rem]")}>
        {displaySteps.map((step, index) => {
          const isFirst = index === 0
          const isLast = index === displaySteps.length - 1
          const isCurrent = step.key === activeKey
          const phase = resolveVisualPhase(step, activeKey, orderStatus)

          return (
            <li
              key={step.key}
              className={cn(
                "relative flex-1",
                compact ? "min-w-[4.25rem]" : "min-w-[5.5rem]",
                index > 0 && (compact ? "-ml-2" : "-ml-3"),
              )}
              style={{ zIndex: displaySteps.length - index }}
              aria-current={isCurrent ? "step" : undefined}
              title={step.detail ?? step.label}
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
                  {displayLabel(step, orderStatus, isCurrent)}
                </span>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
