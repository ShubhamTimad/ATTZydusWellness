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

/** Standard horizontal process flow: numbered nodes + connectors. */
export function CapexProcessFlow({ steps, currentStepKey }: Props) {
  return (
    <ol className="flex w-full min-w-0 items-start overflow-x-auto pb-1">
      {steps.map((step, index) => {
        const phase = phaseFor(step, currentStepKey)
        const isLast = index === steps.length - 1
        const prevPhase = index > 0 ? phaseFor(steps[index - 1], currentStepKey) : null
        const leftFilled = index > 0 && (prevPhase === "completed" || phase === "completed" || phase === "rejected")
        const rightFilled = !isLast && phase === "completed"

        return (
          <li
            key={step.key}
            className={cn("flex min-w-[5.25rem] flex-1 flex-col items-center sm:min-w-[6rem]")}
            aria-current={phase === "current" ? "step" : undefined}
            title={step.detail ? `${step.label} — ${step.detail}` : step.label}
          >
            <div className="flex w-full items-center">
              <div
                className={cn("h-0.5 flex-1", index === 0 ? "bg-transparent" : leftFilled ? "bg-primary/60" : "bg-border")}
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
                className={cn("h-0.5 flex-1", isLast ? "bg-transparent" : rightFilled ? "bg-primary/60" : "bg-border")}
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
              {step.label}
            </p>
          </li>
        )
      })}
    </ol>
  )
}
