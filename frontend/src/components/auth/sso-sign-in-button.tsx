import { AUTH_BUTTON_CLASS } from "@/components/auth/auth-field-styles"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** Official-style Microsoft four-square mark (brand colors). */
function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 21 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  )
}

type SsoSignInButtonProps = {
  label?: string | null
  portal: "user" | "admin"
  href: string
  disabled?: boolean
}

export function SsoSignInButton({ label, portal, href, disabled }: SsoSignInButtonProps) {
  const text = (label ?? "").trim() || "Sign in with SSO"
  const isMicrosoft = /microsoft|entra|azure/i.test(text)

  return (
    <div className="space-y-3 pt-0.5">
      <div className="relative flex items-center gap-3 py-0.5">
        <span className="h-px flex-1 bg-border/80" />
        <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          or
        </span>
        <span className="h-px flex-1 bg-border/80" />
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        className={cn(
          AUTH_BUTTON_CLASS,
          "group relative gap-3 border-2 border-neutral-300 bg-white font-semibold text-neutral-900",
          "shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
          "hover:border-neutral-400 hover:bg-neutral-50 hover:text-neutral-950",
          "focus-visible:border-neutral-400 focus-visible:ring-2 focus-visible:ring-neutral-300/60",
          "active:scale-[0.99] disabled:opacity-60",
        )}
        onClick={() => {
          window.location.href = href
        }}
        aria-label={text}
        data-sso-portal={portal}
      >
        {isMicrosoft ? (
          <MicrosoftLogo className="size-5 shrink-0 transition-transform group-hover:scale-105" />
        ) : (
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-neutral-900 text-[10px] font-bold text-white"
            aria-hidden
          >
            SSO
          </span>
        )}
        <span className="truncate">{text}</span>
      </Button>
    </div>
  )
}
