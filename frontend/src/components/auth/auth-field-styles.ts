/** Shared control classes for auth forms (login / forgot / reset). */
export const AUTH_INPUT_CLASS =
  "h-12 rounded-[10px] border-2 border-neutral-300 bg-white px-3.5 text-sm text-foreground shadow-none transition-[border-color,box-shadow] placeholder:text-neutral-500 hover:border-neutral-400 focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_rgba(225,36,42,0.12)] focus-visible:ring-0"

export const AUTH_PASSWORD_CLASS = `${AUTH_INPUT_CLASS} pr-10`

export const AUTH_BUTTON_CLASS =
  "h-12 w-full rounded-[10px] text-sm font-semibold shadow-sm"

export const AUTH_LABEL_CLASS = "text-[13px] font-semibold text-foreground sm:text-sm"
