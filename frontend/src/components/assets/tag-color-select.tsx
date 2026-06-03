import { adminSelectClass } from "@/components/layout/admin-ui"
import { Label } from "@/components/ui/label"
import type { TagColorMaster } from "@/lib/masters-types"
import { tagColorLabel } from "@/lib/use-asset-masters"

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
  placeholder = "Select tag color…",
}: TagColorSelectProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <select
        id={id}
        className={adminSelectClass}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {tagColors.map((c) => (
          <option key={c.id} value={String(c.id)}>
            {tagColorLabel(c)}
          </option>
        ))}
      </select>
      {value ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className="inline-block size-3 rounded-full border border-border/60"
            style={{
              backgroundColor:
                tagColors.find((c) => String(c.id) === value)?.color_hex ?? "#94a3b8",
            }}
            aria-hidden
          />
          Physical tag color for RFID-tagged assets.
        </div>
      ) : null}
    </div>
  )
}
