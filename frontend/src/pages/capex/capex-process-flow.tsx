import { Check, X } from "lucide-react"

import type { CapexProgressStep } from "@/lib/capex-types"
import { cn } from "@/lib/utils"

type Props = {
  steps: CapexProgressStep[]
  currentStepKey: string
}

type Phase = "completed" | "current" | "upcoming" | "rejected"

function phaseFor(step: CapexProgressStep, currentStepKey: string): Phase {
  if (step.key === "rejected" || step.status === "rejected") return "rejected"
  if (step.status === "completed") return "completed"
  if (step.key === currentStepKey || step.status === "active") return "current"
  return "upcoming"
}

function connectorClass(
  from: Phase | null,
  to: Phase | null,
  edge: "left" | "right",
): string {
  if (edge === "left" && from == null) return "bg-transparent"
  if (edge === "right" && to == null) return "bg-transparent"
  // Bounce-back: active receive → rejected CF uses a red connector.
  if (
    (from === "current" && to === "rejected") ||
    (from === "rejected" && to === "current") ||
    (from === "completed" && to === "rejected") ||
    (from === "rejected" && to === "completed")
  ) {
    return "bg-destructive/70"
  }
  if (from === "completed" || to === "completed" || from === "rejected" || to === "rejected") {
    return "bg-primary/60"
  }
  return "bg-border"
}

/** Standard horizontal process flow: numbered nodes + connectors. */
export function CapexProcessFlow({ steps, currentStepKey }: Props) {
  return (
    <ol className="flex w-full min-w-0 items-start overflow-x-auto pb-1">
      {steps.map((step, index) => {
        const phase = phaseFor(step, currentStepKey)
        const isLast = index === steps.length - 1
        const prevPhase = index > 0 ? phaseFor(steps[index - 1]!, currentStepKey) : null
        const nextPhase = !isLast ? phaseFor(steps[index + 1]!, currentStepKey) : null

        return (
          <li
            key={`${step.key}-${index}`}
            className="flex min-w-[6.5rem] flex-1 flex-col items-center overflow-hidden sm:min-w-[7.5rem]"
            aria-current={phase === "current" ? "step" : undefined}
            title={step.detail ? `${step.label} — ${step.detail}` : step.label}
          >
            <div className="flex w-full items-center">
              <div
                className={cn("h-0.5 flex-1", connectorClass(prevPhase, phase, "left"))}
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
                  connectorClass(phase, nextPhase, "right"),
                )}
                aria-hidden
              />
            </div>
            <p
              className={cn(
                "mt-2 w-full px-1 text-center text-[11px] leading-snug sm:text-xs",
                "line-clamp-2 break-words",
                phase === "completed" && "font-medium text-foreground",
                phase === "current" && "font-semibold text-primary",
                phase === "upcoming" && "font-medium text-muted-foreground",
                phase === "rejected" && "font-semibold text-destructive",
              )}
            >
              {step.label}
            </p>
          </li>
        )
      })}
    </ol>
  )
}
