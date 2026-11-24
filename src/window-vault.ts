import type { Box, V3 } from "./world.ts";

// County panes are axis-aligned. Reserve capsule clearance at both jambs
// and enough room under the lintel for the tucked phase of the vault.
export function windowPassage(box: Box, feet: V3, direction: V3) {
  if (box.kind !== "window" || box.piece !== "fixture") return;
  const normal = box.s[0] < box.s[2] ? 0 : 2,
    along = 2 - normal;
  const approach = direction[normal];
  if (Math.abs(approach) < 0.6) return;
  const travel = (box.p[normal] - feet[normal]) / approach;
  const sill = box.p[1] - box.s[1] / 2;
  if (
    travel < 0 ||
    travel > 1.65 ||
    sill > feet[1] + 1.45 ||
    feet[1] > sill + box.s[1] - 1.4
  )
    return;
  const beyond = travel + (box.s[normal] / 2 + 0.55) / Math.abs(approach);
  const crossing = feet[along] + travel * direction[along];
  if (
    Math.abs(crossing - box.p[along]) + 0.36 / Math.abs(approach) >=
    box.s[along] / 2
  )
    return;
  const base = Math.max(sill + 0.07, feet[1]);
  if (base + 1.3 >= sill + box.s[1]) return;
  const target: V3 = [
    feet[0] + beyond * direction[0],
    base,
    feet[2] + beyond * direction[2],
  ];
  const origin: V3 = [feet[0], Math.max(feet[1] + 0.75, sill + 0.25), feet[2]];
  return { target, origin, travel };
}
