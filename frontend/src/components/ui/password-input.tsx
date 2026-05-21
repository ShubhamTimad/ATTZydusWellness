import * as React from "react"
import { Eye } from "lucide-react"

import { cn } from "@/lib/utils"

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type">

/** Password field with eye control — plain text only while the button is held. */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, disabled, ...props }, ref) {
    const [visible, setVisible] = React.useState(false)

    const hide = React.useCallback(() => setVisible(false), [])

    return (
      <div className="relative">
        <input
          ref={ref}
          type={visible ? "text" : "password"}
          data-slot="input"
          disabled={disabled}
          className={cn(
            "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent py-1 pr-9 pl-2.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-black focus-visible:ring-3 focus-visible:ring-black/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
            className,
          )}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label="Hold to show password"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          onMouseDown={(e) => {
            e.preventDefault()
            if (!disabled) setVisible(true)
          }}
          onMouseUp={hide}
          onMouseLeave={hide}
          onTouchStart={(e) => {
            e.preventDefault()
            if (!disabled) setVisible(true)
          }}
          onTouchEnd={hide}
          onTouchCancel={hide}
        >
          <Eye className="size-4" aria-hidden />
        </button>
      </div>
    )
  },
)
