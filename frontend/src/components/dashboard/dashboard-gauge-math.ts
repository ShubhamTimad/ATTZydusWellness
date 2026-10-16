/** Semicircle gauge geometry: angles run 180deg (left) through 90deg (top) to 0deg (right). */

export type DashboardSlice = {
  name: string
  value: number
  color: string
}

export const GAUGE = {
  r: 126,
  stroke: 22,
} as const

/** A round linecap overhangs its endpoint by half the stroke width. */
export const CAP_DEG = (GAUGE.stroke / 2 / GAUGE.r) * (180 / Math.PI)

/** Shortest span that still renders; below this an arc collapses and disappears. */
const MIN_SPAN_DEG = 0.5

export const GAUGE_CX = GAUGE.r + GAUGE.stroke / 2
export const GAUGE_CY = GAUGE_CX
export const GAUGE_WIDTH = GAUGE_CX * 2
export const GAUGE_HEIGHT = GAUGE_CY + GAUGE.stroke / 2

export function polar(deg: number) {
  const rad = (deg * Math.PI) / 180
  return { x: GAUGE_CX + GAUGE.r * Math.cos(rad), y: GAUGE_CY - GAUGE.r * Math.sin(rad) }
}

/** SVG y grows downward, so sweep=1 is the arc that passes over the top. */
export function arcPath(startDeg: number, endDeg: number) {
  const start = polar(startDeg)
  const end = polar(endDeg)
  const large = Math.abs(startDeg - endDeg) > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${GAUGE.r} ${GAUGE.r} 0 ${large} 1 ${end.x} ${end.y}`
}

export const GAUGE_TRACK_PATH = arcPath(180, 0)

/**
 * Segments share their boundary angle exactly, so each round cap laps over its
 * neighbour and the ring reads as one continuous band. Later slices paint last,
 * which is what puts the rounded edge on top at every junction.
 */
export function gaugeArcs(slices: DashboardSlice[]) {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0)
  const live = slices.filter((slice) => slice.value > 0)
  if (total <= 0 || live.length === 0) return []

  let cursor = 180

  return live.map((slice) => {
    const from = cursor
    cursor -= (slice.value / total) * 180
    const to = Math.min(cursor, from - MIN_SPAN_DEG)
    return { name: slice.name, color: slice.color, from, to, d: arcPath(from, to) }
  })
}
