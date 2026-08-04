import { Check, X } from "lucide-react"

import type { OrderLifecycleStep } from "@/lib/orders-types"
import { cn } from "@/lib/utils"

type Props = {
  steps: OrderLifecycleStep[]
  currentStepKey: string | null
  orderStatus?: string
}

type Phase = "completed" | "current" | "upcoming" | "rejected"

/** Fallback when backend does not send current_step_key. */
const STATUS_TO_STEP_KEY: Record<string, string> = {
  draft: "order_created",
  pending_approval: "approved",
  // After closure approval, next action is Close.
  approved: "closed",
  assigned: "assigned",
  in_progress: "in_progress",
  pending_closure_approval: "closure_approved",
  completed: "closure_approved",
  closed: "closed",
  rejected: "rejected",
}

function resolveActiveKey(orderStatus?: string, fallbackKey?: string | null): string | null {
  if (fallbackKey) return fallbackKey
  if (orderStatus && STATUS_TO_STEP_KEY[orderStatus]) return STATUS_TO_STEP_KEY[orderStatus]
  return null
}

function phaseFor(
  step: OrderLifecycleStep,
  stepIndex: number,
  steps: OrderLifecycleStep[],
  activeKey: string | null,
  orderStatus?: string,
): Phase {
  if (orderStatus === "rejected") {
    // Trust backend phases — do not paint Approved/Closed as done via activeIdx.
    if (step.key === "rejected" || step.status === "rejected") return "rejected"
    if (step.status === "completed") return "completed"
    if (step.status === "active") return "current"
    return "upcoming"
  }
  if (step.status === "rejected") return "rejected"

  // CapEx-style: trust backend status first so Closed / finished steps show checkmarks.
  if (step.status === "completed") return "completed"

  // Closed order with a stale "active" payload still renders as done.
  if (orderStatus === "closed") {
    const activeIdx = activeKey ? steps.findIndex((s) => s.key === activeKey) : steps.length - 1
    if (activeIdx < 0 || stepIndex <= activeIdx) return "completed"
    return "upcoming"
  }

  if (step.key === activeKey || step.status === "active") return "current"

  const activeIdx = activeKey ? steps.findIndex((s) => s.key === activeKey) : -1
  if (activeIdx >= 0 && stepIndex < activeIdx) return "completed"
  return "upcoming"
}

function displayLabel(step: OrderLifecycleStep, orderStatus?: string, isCurrent?: boolean): string {
  if (step.key === "rejected") return "Rejected"
  if (isCurrent && orderStatus === "pending_approval" && step.key === "approved") {
    return "Pending approval"
  }
  if (
    isCurrent &&
    (orderStatus === "completed" || orderStatus === "pending_closure_approval") &&
    step.key === "closure_approved"
  ) {
    return "Pending approval"
  }
  if (isCurrent && orderStatus === "draft" && step.key === "order_created") {
    return "Draft"
  }
  if (step.key === "order_created") {
    return orderStatus === "draft" ? "Draft" : "Order created"
  }
  if (step.key === "in_progress") return "In progress"
  if (step.key === "closure_approved") {
    if (
      orderStatus === "completed" ||
      orderStatus === "pending_closure_approval" ||
      step.status === "active"
    ) {
      return "Pending approval"
    }
    return "Approved"
  }
  // Prefer backend label; normalize accidental ALL CAPS.
  const raw = (step.label || step.key).trim()
  if (raw === raw.toUpperCase() && raw.length > 1) {
    return raw.charAt(0) + raw.slice(1).toLowerCase()
  }
  return raw
}

/** CapEx-style horizontal process flow: numbered nodes + connectors. */
export function OrderLifecycleStepper({ steps, currentStepKey, orderStatus }: Props) {
  const displaySteps = steps.filter(
    (s) => s.key !== "rejected" || orderStatus === "rejected" || orderStatus === "in_rework",
  )
  const activeKey = resolveActiveKey(orderStatus, currentStepKey)

  return (
    <ol className="flex w-full min-w-0 items-start overflow-x-auto pb-1">
      {displaySteps.map((step, index) => {
        const phase = phaseFor(step, index, displaySteps, activeKey, orderStatus)
        const isLast = index === displaySteps.length - 1
        const prevPhase =
          index > 0 ? phaseFor(displaySteps[index - 1]!, index - 1, displaySteps, activeKey, orderStatus) : null
        const leftFilled =
          index > 0 && (prevPhase === "completed" || phase === "completed" || phase === "rejected")
        const rightFilled = !isLast && phase === "completed"
        const isCurrent = phase === "current"

        return (
          <li
            key={step.key}
            className="flex min-w-[5.25rem] flex-1 flex-col items-center sm:min-w-[6rem]"
            aria-current={isCurrent ? "step" : undefined}
            title={
              step.detail
                ? `${displayLabel(step, orderStatus, isCurrent)} — ${step.detail}`
                : displayLabel(step, orderStatus, isCurrent)
            }
          >
            <div className="flex w-full items-center">
              <div
                className={cn(
                  "h-0.5 flex-1",
                  index === 0 ? "bg-transparent" : leftFilled ? "bg-primary/60" : "bg-border",
                )}
                aria-hidden
              />
              <div
                className={cn(
                  "relative z-[1] flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold",
                  phase === "completed" && "border-primary bg-primary text-primary-foreground",
                  phase === "current" &&
                    "border-primary bg-background text-primary shadow-[0_0_0_4px] shadow-primary/15",
                  phase === "upcoming" && "border-border bg-muted/40 text-muted-foreground",
                  phase === "rejected" && "border-destructive bg-destructive text-white",
                )}
              >
                {phase === "completed" ? (
                  <Check className="size-4" strokeWidth={2.5} aria-hidden />
                ) : phase === "rejected" ? (
                  <X className="size-4" strokeWidth={2.5} aria-hidden />
                ) : (
                  <span>{index + 1}</span>
                )}
              </div>
              <div
                className={cn(
                  "h-0.5 flex-1",
                  isLast ? "bg-transparent" : rightFilled ? "bg-primary/60" : "bg-border",
                )}
                aria-hidden
              />
            </div>
            <p
              className={cn(
                "mt-2 max-w-[9.5rem] px-1 text-center text-[11px] leading-snug sm:text-xs",
                phase === "completed" && "font-medium text-foreground",
                phase === "current" && "font-semibold text-primary",
                phase === "upcoming" && "font-medium text-muted-foreground",
                phase === "rejected" && "font-semibold text-destructive",
              )}
            >
              {displayLabel(step, orderStatus, isCurrent)}
            </p>
          </li>
        )
      })}
    </ol>
  )
}
