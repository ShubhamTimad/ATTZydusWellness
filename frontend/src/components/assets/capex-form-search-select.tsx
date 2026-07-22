import * as React from "react"
import { createPortal } from "react-dom"
import { Check, ChevronsUpDown, Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getJson } from "@/lib/api"
import type { CapexFormListItem, CapexFormListResponse } from "@/lib/capex-types"
import { cn } from "@/lib/utils"

export type CapexFormOption = {
  id: number
  form_number: string
  asset_name: string
}

type Props = {
  id?: string
  value: string
  disabled?: boolean
  /** When editing an asset, include its currently linked form in the list. */
  forAssetId?: number | null
  onChange: (formId: string, option: CapexFormOption | null) => void
  className?: string
}

/** Searchable dropdown of approved CapEx forms available to link to an asset. */
export function CapexFormSearchSelect({
  id,
  value,
  disabled,
  forAssetId,
  onChange,
  className,
}: Props) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [options, setOptions] = React.useState<CapexFormOption[]>([])
  const [selected, setSelected] = React.useState<CapexFormOption | null>(null)
  const [panelStyle, setPanelStyle] = React.useState<React.CSSProperties>({})

  const selectedId = value.trim() ? Number(value) : null

  const updatePanelPosition = React.useCallback(() => {
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = Math.max(r.width, 280)
    const left = Math.min(r.left, window.innerWidth - width - 8)
    setPanelStyle({
      position: "fixed",
      top: r.bottom + 4,
      left: Math.max(8, left),
      width,
      zIndex: 80,
    })
  }, [])

  React.useEffect(() => {
    if (!open) return
    updatePanelPosition()
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("resize", updatePanelPosition)
    window.addEventListener("scroll", updatePanelPosition, true)
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("resize", updatePanelPosition)
      window.removeEventListener("scroll", updatePanelPosition, true)
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, updatePanelPosition])

  React.useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      setLoading(true)
      const q = new URLSearchParams({
        available_for_asset: "true",
        page: "1",
        page_size: "50",
      })
      if (forAssetId) q.set("for_asset_id", String(forAssetId))
      if (query.trim()) q.set("search", query.trim())
      void getJson<CapexFormListResponse>(`/admin/capitalization-forms?${q}`)
        .then((res) => {
          setOptions(
            res.items.map((i: CapexFormListItem) => ({
              id: i.id,
              form_number: i.form_number,
              asset_name: i.asset_name,
            })),
          )
        })
        .catch(() => setOptions([]))
        .finally(() => setLoading(false))
    }, 250)
    return () => window.clearTimeout(t)
  }, [open, query, forAssetId])

  React.useEffect(() => {
    if (selectedId == null) {
      setSelected(null)
      return
    }
    if (selected?.id === selectedId) return
    const fromOptions = options.find((o) => o.id === selectedId)
    if (fromOptions) {
      setSelected(fromOptions)
      return
    }
    void getJson<{ id: number; form_number: string; asset_name: string }>(
      `/admin/capitalization-forms/${selectedId}`,
    )
      .then((d) =>
        setSelected({ id: d.id, form_number: d.form_number, asset_name: d.asset_name }),
      )
      .catch(() => setSelected(null))
  }, [selectedId, options, selected?.id])

  function pick(option: CapexFormOption | null) {
    setSelected(option)
    onChange(option ? String(option.id) : "", option)
    setOpen(false)
    setQuery("")
  }

  const label = selected
    ? `${selected.form_number} — ${selected.asset_name}`
    : "Search CapEx form number…"

  const panel =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            style={panelStyle}
            className="overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
          >
            <div className="relative border-b border-border/70 p-2">
              <Search
                className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type form number or asset name…"
                className="h-8 pl-9"
                aria-label="Search capitalization forms"
              />
            </div>
            <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
              {loading ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">Loading…</li>
              ) : options.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">No approved forms available.</li>
              ) : (
                options.map((o) => {
                  const isSelected = selectedId === o.id
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={cn(
                          "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60",
                          isSelected && "bg-muted/40",
                        )}
                        onClick={() => pick(o)}
                      >
                        <Check
                          className={cn(
                            "mt-0.5 size-4 shrink-0",
                            isSelected ? "opacity-100" : "opacity-0",
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0">
                          <span className="block font-medium text-foreground">{o.form_number}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {o.asset_name}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })
              )}
            </ul>
          </div>,
          document.body,
        )
      : null

  return (
    <div ref={rootRef} className={cn("min-w-0", className)}>
      <div className="flex gap-2">
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="listbox"
          className={cn(
            "h-9 min-w-0 flex-1 justify-between px-3 font-normal",
            !selected && "text-muted-foreground",
          )}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="truncate text-left">{label}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" aria-hidden />
        </Button>
        {selected ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0"
            disabled={disabled}
            aria-label="Clear capitalization form"
            onClick={() => pick(null)}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
      {panel}
    </div>
  )
}
