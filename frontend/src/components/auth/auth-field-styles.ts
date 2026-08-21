/** Shared control classes for auth forms (login / forgot / reset). */
export const AUTH_INPUT_CLASS =
  "h-12 rounded-[10px] border border-input bg-background px-3.5 text-sm shadow-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 hover:border-border focus-visible:border-primary/45 focus-visible:shadow-[0_1px_3px_rgba(15,23,42,0.08)] focus-visible:ring-2 focus-visible:ring-primary/10"

export const AUTH_PASSWORD_CLASS = `${AUTH_INPUT_CLASS} pr-10`

export const AUTH_BUTTON_CLASS =
  "h-12 w-full rounded-[10px] text-sm font-semibold shadow-sm"
