import { cn } from "@/lib/utils"

export function MultiCheckList({
  options,
  values,
  onChange,
  disabled,
  emptyLabel,
}: {
  options: { id: number; label: string }[]
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
    <div className={cn("max-h-56 space-y-1.5 overflow-y-auto rounded-md border border-border/70 p-2")}>
      {options.map((opt) => {
        const id = String(opt.id)
        const checked = selected.has(id)
        return (
          <label key={opt.id} className="flex cursor-pointer items-center gap-2 text-sm">
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
