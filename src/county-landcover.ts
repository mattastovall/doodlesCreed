import type { CityPlan } from "./city-plan.ts";
import { terrainHeight } from "./county-plan.ts";
import { randomSeed, type Box } from "./world.ts";

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const transition = (x: number) => x * x * (3 - 2 * x);
export function dryCountry(x: number, z: number) {
  return transition(clamp((-z - 275 + 70 * Math.sin(x / 210)) / 270));
}
export function landColor(x: number, z: number) {
  const dry = dryCountry(x, z);
  const woods = transition(clamp((z - 260) / 255));
  const tone = Math.sin(x / 89 + z / 110) * Math.cos(z / 66) * 8;
  return (
    (Math.round(240 + dry * 15 - woods * 52 + tone * woods) << 16) |
    (Math.round(248 - dry * 34 - woods * 28 + tone * woods) << 8) |
    Math.round(235 - dry * 65 - woods * 36 + tone * woods)
  );
}

export function clearOfLotsAndRoads(plan: CityPlan, x: number, z: number) {
  if (
    plan.parcels.some(
      (p) => Math.abs(x - p.x) < p.w / 2 + 6 && Math.abs(z - p.z) < p.d / 2 + 6,
    )
  )
    return false;
  return !plan.streets.some((s) => {
    const margin = s.width / 2 + 6;
    if (
      x < Math.min(s.a[0], s.b[0]) - margin ||
      x > Math.max(s.a[0], s.b[0]) + margin ||
      z < Math.min(s.a[2], s.b[2]) - margin ||
      z > Math.max(s.a[2], s.b[2]) + margin
    )
      return false;
    const dx = s.b[0] - s.a[0],
      dz = s.b[2] - s.a[2];
    const t = clamp(
      ((x - s.a[0]) * dx + (z - s.a[2]) * dz) / (dx * dx + dz * dz),
    );
    return (
      Math.hypot(x - s.a[0] - t * dx, z - s.a[2] - t * dz) < s.width / 2 + 6
    );
  });
}

// Declining density at the treeline leaves clearings. Rows in the lower
// valley follow the same orientation within each orchard parcel.
export function regionalTrees(plan: CityPlan, limit: number): Box[] {
  const random = randomSeed("switchback-groves");
  const result: Box[] = [];
  function plant(
    x: number,
    z: number,
    kind: string,
    height: number,
    width: number,
  ) {
    if (!clearOfLotsAndRoads(plan, x, z)) return;
    result.push({
      p: [x, terrainHeight(x, z) + height / 2, z],
      s: [width, height, width],
      kind,
      solid: true,
    });
  }
  for (let x = -limit + 15; x < limit - 15; x += 25)
    for (let z = 295; z < limit - 15; z += 25) {
      const px = x + (random() - 0.5) * 22,
        pz = z + (random() - 0.5) * 22;
      const density =
        0.38 +
        0.28 * Math.sin(px / 98 + pz / 85) +
        0.22 * Math.cos(pz / 59 - px / 111);
      if (random() > density * clamp((pz - 295) / 140)) continue;
      const height = 7 + random() * 9;
      plant(px, pz, "county-pine", height, height * 0.047);
    }
  for (const [cx, cz, angle] of [
    [-625, 177, -0.14],
    [-610, 286, -0.14],
    [590, 261, 0.32],
    [740, 210, 0.32],
  ]) {
    for (let row = -3; row <= 3; row++)
      for (let col = -5; col <= 5; col++) {
        const u = col * 9.3,
          v = row * 10.7;
        plant(
          cx + u * Math.cos(angle) - v * Math.sin(angle),
          cz + u * Math.sin(angle) + v * Math.cos(angle),
          "county-orchard",
          4 + random() * 0.9,
          0.4,
        );
      }
  }
  return result;
}
