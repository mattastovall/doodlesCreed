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

type Obstacle = (x: number, z: number) => boolean;

// Each immutable generated plan owns its index. The broad phase covers the
// entire padded road segment, including its two circular end caps.
const exclusions = new WeakMap<CityPlan, Map<string, Obstacle[]>>();
function buildExclusions(plan: CityPlan) {
  const cells = new Map<string, Obstacle[]>();
  function insert(
    left: number,
    right: number,
    top: number,
    bottom: number,
    hit: Obstacle,
  ) {
    for (let i = Math.floor(left / 48); i <= Math.floor(right / 48); i++)
      for (let j = Math.floor(top / 48); j <= Math.floor(bottom / 48); j++) {
        const key = i + "," + j;
        const list = cells.get(key);
        if (list) list.push(hit);
        else cells.set(key, [hit]);
      }
  }
  function rectangle(cx: number, cz: number, width: number, depth: number) {
    const w = width / 2 + 6,
      d = depth / 2 + 6;
    insert(
      cx - w,
      cx + w,
      cz - d,
      cz + d,
      (x, z) => Math.abs(x - cx) < w && Math.abs(z - cz) < d,
    );
  }
  for (const p of plan.parcels) rectangle(p.x, p.z, p.w, p.d);
  for (const { p, size } of plan.landmarks)
    rectangle(p[0], p[2], size[0], size[2]);
  for (const { a, b, width } of plan.streets) {
    const dx = b[0] - a[0],
      dz = b[2] - a[2];
    const len2 = dx * dx + dz * dz,
      r = width / 2 + 6;
    insert(
      Math.min(a[0], b[0]) - r,
      Math.max(a[0], b[0]) + r,
      Math.min(a[2], b[2]) - r,
      Math.max(a[2], b[2]) + r,
      (x, z) => {
        const u = x - a[0],
          v = z - a[2],
          t = len2 ? clamp((u * dx + v * dz) / len2) : 0;
        return (u - t * dx) ** 2 + (v - t * dz) ** 2 < r * r;
      },
    );
  }
  exclusions.set(plan, cells);
  return cells;
}
export function clearOfLotsAndRoads(plan: CityPlan, x: number, z: number) {
  const cells = exclusions.get(plan) ?? buildExclusions(plan);
  const nearby = cells.get(Math.floor(x / 48) + "," + Math.floor(z / 48));
  return !nearby?.some((hit) => hit(x, z));
}

// Store each accepted disk in every overlapped bucket. Only nine nearby
// buckets need inspection for candidates with radius <= the bucket width.
class PlantSpacing {
  private cells = new Map<string, { x: number; z: number; radius: number }[]>();
  constructor(private width: number) {}
  accept(x: number, z: number, radius: number) {
    const left = Math.floor((x - radius) / this.width),
      right = Math.floor((x + radius) / this.width);
    const top = Math.floor((z - radius) / this.width),
      bottom = Math.floor((z + radius) / this.width);
    for (let i = left; i <= right; i++)
      for (let j = top; j <= bottom; j++)
        if (
          this.cells
            .get(i + "," + j)
            ?.some(
              (p) => (x - p.x) ** 2 + (z - p.z) ** 2 < (radius + p.radius) ** 2,
            )
        )
          return false;
    const p = { x, z, radius };
    for (let i = left; i <= right; i++)
      for (let j = top; j <= bottom; j++) {
        const key = i + "," + j,
          list = this.cells.get(key);
        if (list) list.push(p);
        else this.cells.set(key, [p]);
      }
    return true;
  }
}

function woodland(x: number, z: number) {
  const groves =
    0.47 + 0.3 * Math.sin(x / 98 + z / 85) + 0.23 * Math.cos(z / 59 - x / 111);
  return transition(clamp((z - 275) / 150)) * groves;
}

export function regionalTrees(plan: CityPlan, limit: number): Box[] {
  const random = randomSeed("switchback-groves");
  const trees: Box[] = [];
  const space = new PlantSpacing(12);
  function plant(
    x: number,
    z: number,
    kind: string,
    height: number,
    width: number,
    radius: number,
  ) {
    if (
      Math.abs(x) >= limit - 4 ||
      Math.abs(z) >= limit - 4 ||
      !clearOfLotsAndRoads(plan, x, z) ||
      !space.accept(x, z, radius)
    )
      return;
    trees.push({
      p: [x, terrainHeight(x, z) + height / 2, z],
      s: [width, height, width],
      kind,
      solid: true,
    });
  }
  // Establish the managed orchards first so wild trees respect their spacing.
  for (const [cx, cz, angle] of [
    [-625, 177, -0.14],
    [-610, 286, -0.14],
    [590, 261, 0.32],
    [740, 210, 0.32],
  ])
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
          4,
        );
      }
  const depth = Math.max(0, limit - 275);
  const attempts = Math.ceil((2 * limit * depth) / 420);
  for (let i = 0; i < attempts; i++) {
    const x = (random() * 2 - 1) * limit,
      z = 275 + random() * depth;
    if (random() > woodland(x, z)) continue;
    const y = terrainHeight(x, z);
    const slope =
      Math.hypot(terrainHeight(x + 4, z) - y, terrainHeight(x, z + 4) - y) / 4;
    if (slope > 0.8 || random() > 1 - clamp(slope - 0.18)) continue;
    const h = 7 + random() * 9;
    plant(x, z, "county-pine", h, h * 0.047, 4.2 + h * 0.23);
  }
  return trees;
}

export interface GroundPlant {
  x: number;
  y: number;
  z: number;
  kind: "yucca" | "sage" | "fern";
  size: number;
}

// This layer exists only on the client. Clumps follow a local parent plant,
// and the same footprint rules apply to every individual.
export function regionalUnderbrush(plan: CityPlan, limit: number) {
  const random = randomSeed("switchback-ground-cover");
  const space = new PlantSpacing(3);
  const plants: GroundPlant[] = [];
  for (let i = 0; i < Math.ceil((2 * limit) ** 2 / 4400); i++) {
    const cx = (random() * 2 - 1) * limit,
      cz = (random() * 2 - 1) * limit;
    const dry = dryCountry(cx, cz),
      woods = woodland(cx, cz);
    const forest = woods > dry;
    if (random() > (forest ? woods : dry)) continue;
    const count = 3 + Math.floor(random() * 7);
    for (let j = 0; j < count; j++) {
      const angle = random() * 2 * Math.PI,
        radius = 17 * Math.sqrt(random());
      const x = cx + Math.cos(angle) * radius,
        z = cz + Math.sin(angle) * radius;
      if (
        Math.abs(x) >= limit ||
        Math.abs(z) >= limit ||
        !clearOfLotsAndRoads(plan, x, z)
      )
        continue;
      const kind = forest ? "fern" : random() < 0.34 ? "yucca" : "sage";
      const size =
        kind === "sage" ? 0.26 + random() * 0.55 : 0.5 + random() * 0.9;
      if (space.accept(x, z, size))
        plants.push({ x, y: terrainHeight(x, z), z, kind, size });
    }
  }
  return plants;
}
