import { Checkbox } from "@/components/ui/checkbox"
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
  const box = "rounded-lg border border-border/70 bg-background"

  if (options.length === 0) {
    return (
      <div className={cn(box, "px-3 py-8 text-center text-xs text-muted-foreground")}>
        {disabled
          ? emptyLabel
          : "No options for the selected plant"}
      </div>
    )
  }

  return (
    <div className={cn(box, "md:max-h-56 md:overflow-y-auto", disabled && "bg-muted/20")}>
      {options.map((opt) => {
        const id = String(opt.id)
        const checked = selected.has(id)
        return (
          <label
            key={opt.id}
            title={opt.title}
            className={cn(
              "flex cursor-pointer items-center gap-2.5 border-b border-border/40 px-3 py-2 text-sm last:border-b-0",
              checked && "bg-primary/5",
              disabled ? "cursor-not-allowed" : "hover:bg-muted/30",
            )}
          >
            <Checkbox
              checked={checked}
              disabled={disabled}
              onCheckedChange={() => {
                if (disabled) return
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
