import { Label } from "@/components/ui/label"
import type { TagColorMaster } from "@/lib/masters-types"
import { cn } from "@/lib/utils"

const FALLBACK_HEX = "#94a3b8"

export function tagColorHex(c: Pick<TagColorMaster, "color_hex">) {
  return c.color_hex?.trim() || FALLBACK_HEX
}

export function TagColorSwatch({
  colorHex,
  className,
  size = "md",
}: {
  colorHex?: string | null
  className?: string
  size?: "sm" | "md" | "lg"
}) {
  const sizeClass = size === "sm" ? "size-4" : size === "lg" ? "size-8" : "size-6"
  return (
    <span
      className={cn("inline-block shrink-0 rounded-full border border-border/60", sizeClass, className)}
      style={{ backgroundColor: colorHex?.trim() || FALLBACK_HEX }}
      aria-hidden
    />
  )
}

type TagColorPickerProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  tagColors: TagColorMaster[]
  disabled?: boolean
}

export function TagColorPicker({
  id = "tag-color",
  value,
  onChange,
  tagColors,
  disabled = false,
}: TagColorPickerProps) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label="Tag color"
      className={cn("flex flex-wrap gap-2", disabled && "pointer-events-none opacity-50")}
    >
      {tagColors.map((c) => {
        const selected = String(c.id) === value
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c.name}
            title={c.name}
            disabled={disabled}
            onClick={() => onChange(String(c.id))}
            className={cn(
              "size-8 rounded-full border-2 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              selected
                ? "border-primary ring-2 ring-primary/25"
                : "border-border/80 hover:border-border hover:shadow-sm",
            )}
            style={{ backgroundColor: tagColorHex(c) }}
          />
        )
      })}
    </div>
  )
}

type TagColorSelectProps = {
  id?: string
  label?: string
  value: string
  onChange: (value: string) => void
  tagColors: TagColorMaster[]
  disabled?: boolean
  placeholder?: string
}

export function TagColorSelect({
  id = "tag-color",
  label = "Tag color",
  value,
  onChange,
  tagColors,
  disabled = false,
}: TagColorSelectProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <TagColorPicker id={id} value={value} onChange={onChange} tagColors={tagColors} disabled={disabled} />
      {value ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <TagColorSwatch
            size="sm"
            colorHex={tagColors.find((c) => String(c.id) === value)?.color_hex}
          />
          Physical tag color for RFID-tagged assets.
        </div>
      ) : null}
    </div>
  )
}
