/** Run: node src/components/dashboard/dashboard-gauge-math.check.ts */
import assert from "node:assert/strict"

import {
  GAUGE_CY,
  GAUGE_HEIGHT,
  GAUGE_TRACK_PATH,
  gaugeArcs,
  polar,
} from "./dashboard-gauge-math.ts"

// The arc must bow over the top, so 90deg sits above the centre line.
assert.ok(polar(90).y < GAUGE_CY, "top of gauge must be above centre")
assert.ok(polar(90).y >= 0 && GAUGE_CY <= GAUGE_HEIGHT, "arc must fit the viewBox")

// sweep flag 1 keeps the arc on the upper half; flag 0 would dip below.
assert.match(GAUGE_TRACK_PATH, / 0 1 /, "track must use sweep=1")

const half = gaugeArcs([
  { name: "Open", value: 5, color: "#f00" },
  { name: "Closed", value: 5, color: "#0f0" },
])
assert.equal(half.length, 2, "two non-zero slices render two arcs")
assert.ok(
  half.every((arc) => / 0 1 /.test(arc.d)),
  "every segment must arc over the top",
)

// Neighbours must meet exactly so their round caps lap over each other; any
// daylight here shows as bare track cutting through the ring.
assert.equal(half[0].to, half[1].from, "segments must share their boundary angle")
assert.equal(half[0].from, 180, "first segment starts at the left end")
assert.equal(half.at(-1)?.to, 0, "last segment finishes at the right end")

// A sliver still renders rather than collapsing to nothing.
const sliver = gaugeArcs([
  { name: "Pending", value: 1, color: "#f00" },
  { name: "Done", value: 999, color: "#0f0" },
])
assert.equal(sliver.length, 2, "tiny slices must still render")
assert.ok(
  sliver.every((arc) => arc.from > arc.to),
  "arcs must always sweep from a higher angle to a lower one",
)

// Empty data draws the track only.
assert.deepEqual(gaugeArcs([{ name: "Open", value: 0, color: "#f00" }]), [])

console.log("dashboard gauge math ok")
