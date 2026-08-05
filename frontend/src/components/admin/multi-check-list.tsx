import { cn } from "@/lib/utils"

export function MultiCheckList({
  options,
  values,
  onChange,
  disabled,
  emptyLabel,
}: {
  options: { id: number; label: string; title?: string }[]
  values: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  emptyLabel: string
}) {
  const selected = new Set(values)
  if (disabled) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>
  }
  if (options.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No options for the selected plant(s). You can continue without selecting any.
      </p>
    )
  }
  return (
    <div
      className={cn(
        "space-y-1.5 rounded-md border border-border/70 p-2",
        // Nested max-height scroll traps page scrolling on short viewports —
        // only constrain the list from md up.
        "md:max-h-56 md:overflow-y-auto",
      )}
    >
      {options.map((opt) => {
        const id = String(opt.id)
        const checked = selected.has(id)
        return (
          <label
            key={opt.id}
            className="flex cursor-pointer items-center gap-2 text-sm"
            title={opt.title}
          >
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={checked}
              onChange={() => {
                if (checked) onChange(values.filter((v) => v !== id))
                else onChange([...values, id])
              }}
            />
            <span className="min-w-0 truncate">{opt.label}</span>
          </label>
        )
      })}
    </div>
  )
}
