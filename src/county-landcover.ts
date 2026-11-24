import type { CityPlan } from "./city-plan.ts";
import {
  sampleCountyWater,
  sampleCountySediment,
  countyWaterBounds,
} from "./county-hydrology.ts";
import { LIMIT, terrainHeight } from "./county-plan.ts";
import { randomSeed, type Box } from "./world.ts";

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const transition = (x: number) => x * x * (3 - 2 * x);
// Interpolate seeded lattice values so a grove has irregular edges but remains
// stable across parcel generation order, clients and server restarts.
function patch(x: number, z: number, scale: number, seed: number) {
  const u = x / scale,
    v = z / scale;
  const i = Math.floor(u),
    j = Math.floor(v);
  function corner(dx: number, dz: number) {
    let h = Math.imul(i + dx, 0x1f1f1f1f) ^ Math.imul(j + dz, 0x45d9f3b) ^ seed;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const a = transition(u - i),
    b = transition(v - j);
  return (
    (1 - b) * ((1 - a) * corner(0, 0) + a * corner(1, 0)) +
    b * ((1 - a) * corner(0, 1) + a * corner(1, 1))
  );
}
function province(
  x: number,
  z: number,
  cx: number,
  cz: number,
  rx: number,
  rz: number,
) {
  return Math.exp(-(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2));
}

export function countyHabitat(x: number, z: number) {
  // Beyond the playable edge the rendered ridges have independent elevations.
  const inside = Math.abs(x) < LIMIT - 20 && Math.abs(z) < LIMIT - 20;
  const height = inside ? terrainHeight(x, z) : 30;
  const sx = inside
    ? (terrainHeight(x + 14, z) - terrainHeight(x - 14, z)) / 28
    : 0;
  const sz = inside
    ? (terrainHeight(x, z + 14) - terrainHeight(x, z - 14)) / 28
    : 0;
  const slope = Math.hypot(sx, sz);
  const water = sampleCountyWater(x, z);
  const marsh = water
    ? transition(clamp(1 - Math.max(0, water.shoreDistance) / 30)) *
      transition(clamp(1 - Math.max(0, height - water.surfaceY) / 10))
    : 0;
  const broad = patch(x, z, 255, 93451) - 0.5;
  const fine = patch(x, z, 72, 47841) - 0.5;
  const basins = Math.max(
    province(x, z, -765, -680, 690, 710),
    province(x, z, 690, -700, 850, 505),
  );
  const uplands = Math.max(
    province(x, z, -360, 700, 760, 460),
    province(x, z, 650, 520, 560, 700),
    province(x, z, -890, 190, 370, 410),
  );
  // Cool pole-facing slopes and sheltered foothills sustain trees farther
  // into dry country; sun-exposed faces break up forest on the same ridge.
  const aspect = Math.max(-1, Math.min(1, sz * 1.8));
  const dry = transition(
    clamp(
      0.22 +
        0.97 * basins -
        0.38 * uplands +
        broad * 0.74 +
        fine * 0.23 +
        aspect * 0.16 -
        marsh * 0.98,
    ),
  );
  const woods =
    transition(
      clamp(
        0.04 +
          0.98 * uplands -
          basins * 0.31 -
          broad * 0.91 +
          fine * 0.25 -
          aspect * 0.16 +
          Math.min(height / 400, 0.18) +
          0.34 * marsh,
      ),
    ) *
    (1 - 0.88 * transition(clamp((slope - 0.37) / 0.49)));
  return { dry, woods, marsh, slope };
}

export function dryCountry(x: number, z: number) {
  return countyHabitat(x, z).dry;
}
export function landColor(x: number, z: number, habitat = countyHabitat(x, z)) {
  const { dry, woods, marsh } = habitat;
  const tone = (patch(x, z, 45, 713) - 0.5) * 13;
  const channel = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n + tone)));
  return (
    (channel(238 + dry * 17 - woods * 51 - marsh * 25) << 16) |
    (channel(245 - dry * 38 - woods * 27 - marsh * 18) << 8) |
    channel(225 - dry * 65 - woods * 37 - marsh * 24)
  );
}

function submerged(x: number, z: number, y: number) {
  const w = sampleCountyWater(x, z);
  return !!w && w.surfaceY > y;
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
      submerged(x, z, terrainHeight(x, z)) ||
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
        const h = 4.1 + random() * 1.6;
        plant(
          cx + u * Math.cos(angle) - v * Math.sin(angle),
          cz + u * Math.sin(angle) + v * Math.cos(angle),
          "county-orchard",
          h,
          h * 0.07,
          4,
        );
      }
  const attempts = Math.ceil((2 * limit) ** 2 / 980);
  for (let i = 0; i < attempts; i++) {
    const x = (random() * 2 - 1) * limit,
      z = (random() * 2 - 1) * limit;
    const { woods, marsh, slope } = countyHabitat(x, z);
    if (slope > 0.8 || random() > woods * (1 - marsh)) continue;
    // The sheltered woodland carries mature canopy trees. Exposed ground
    // and young stands have shorter, more widely visible crowns.
    const maturity = random();
    const h = 8 + (11 + 11 * woods) * Math.sqrt(maturity) * (1 - 0.32 * slope);
    plant(x, z, "county-pine", h, h * 0.032, 4.2 + h * 0.23);
  }
  return trees;
}

export interface GroundPlant {
  x: number;
  y: number;
  z: number;
  kind: "yucca" | "sage" | "fern" | "reed" | "grass";
  size: number;
}

// This layer exists only on the client. Clumps follow a local parent plant,
// and the same footprint rules apply to every individual.
export function regionalUnderbrush(plan: CityPlan, limit: number) {
  const random = randomSeed("switchback-ground-cover");
  const space = new PlantSpacing(3);
  const plants: GroundPlant[] = [];
  for (let i = 0; i < Math.ceil((2 * limit) ** 2 / 7400); i++) {
    const cx = (random() * 2 - 1) * limit,
      cz = (random() * 2 - 1) * limit;
    const { dry, woods, marsh } = countyHabitat(cx, cz);
    if (random() > Math.max(woods, dry, 0.22) * (1 - marsh)) continue;
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
      const h = countyHabitat(x, z);
      if (h.marsh > 0.7 || submerged(x, z, terrainHeight(x, z))) continue;
      const kind =
        random() < h.woods
          ? "fern"
          : random() < h.dry
            ? random() < 0.34
              ? "yucca"
              : "sage"
            : "grass";
      const size =
        kind === "sage" ? 0.26 + random() * 0.55 : 0.5 + random() * 0.9;
      if (space.accept(x, z, size))
        plants.push({ x, y: terrainHeight(x, z), z, kind, size });
    }
  }
  // Narrow banks are easily missed by county-wide sampling. Seed colonies in
  // waterbody bounds, then check depth and bank moisture for each individual.
  for (const bounds of countyWaterBounds) {
    const width = bounds.maxX - bounds.minX,
      depth = bounds.maxZ - bounds.minZ;
    for (let i = 0; i < Math.ceil((width * depth) / 220); i++) {
      const cx = bounds.minX + random() * width,
        cz = bounds.minZ + random() * depth;
      const bank = sampleCountyWater(cx, cz);
      if (
        !bank ||
        Math.abs(bank.shoreDistance) > 12 ||
        patch(cx, cz, 29, 841) < 0.32
      )
        continue;
      for (let j = 0; j < 5; j++) {
        const x = cx + (random() - 0.5) * 9,
          z = cz + (random() - 0.5) * 9;
        if (
          Math.abs(x) >= limit ||
          Math.abs(z) >= limit ||
          !clearOfLotsAndRoads(plan, x, z)
        )
          continue;
        const water = sampleCountyWater(x, z),
          y = terrainHeight(x, z);
        if (
          !water ||
          Math.abs(water.shoreDistance) > 13 ||
          y < water.surfaceY - 0.35 ||
          y > water.surfaceY + 2.4
        )
          continue;
        // Fast, scoured gravel banks stay mostly open; reed colonies occupy quiet margins.
        if ((sampleCountySediment(x, z)?.gravel ?? 0) > 0.55) continue;
        const size = 0.84 + random() * 0.78;
        if (space.accept(x, z, size * 0.64))
          plants.push({ x, y, z, kind: "reed", size });
      }
    }
  }
  return plants;
}
