import { architectureLadders, cityLot } from "./county-architecture.ts";
import { randomSeed, type V3, type City, type Box } from "./world.ts";
import type { Street } from "./city-plan.ts";
import {
  alongStreet,
  COUNTY,
  countyRoutes,
  elevation,
  LIMIT,
  planCounty,
  TOWNS,
  type CountyLot,
} from "./county-plan.ts";
export { COUNTY, LIMIT, TOWNS, elevation } from "./county-plan.ts";

export function countyBlocks(lots = planCounty().lots) {
  const blocks: Box[] = [];
  for (const { x, z, w, d, choice, variation } of lots) {
    const lot = cityLot(x, z, choice, variation);
    blocks.push(...lot);
    for (const [dx, dz] of [
      [-13.8, 10],
      [12, -13.8],
      [13.8, 8],
      ...(choice === 6
        ? [
            [2, 4],
            [-6, 7],
            [6, -7],
          ]
        : []),
    ]) {
      if (
        Math.abs(dx) > w / 2 - 1 ||
        Math.abs(dz) > d / 2 - 1 ||
        lot.some(
          (b) =>
            Math.abs(x + dx - b.p[0]) < b.s[0] / 2 + 1.6 &&
            Math.abs(z + dz - b.p[2]) < b.s[2] / 2 + 1.6,
        )
      )
        continue;
      blocks.push({
        p: [x + dx, 1.5, z + dz],
        s: [0.35, 3, 0.35],
        kind: "county-tree",
        solid: true,
      });
    }
    blocks.push({
      p: [x, 0.075, z],
      s: [w, 0.15, d],
      kind: "pavement",
      solid: true,
    });
  }
  return blocks;
}
export function countyLadders(boxes: Box[]) {
  return architectureLadders(boxes);
}
export function countyWorld(): City {
  const { plan, lots } = planCounty();
  const spaces = parkedCars(lots);
  const spawns: V3[] = spaces.map(({ p, yaw }) => [
    p[0] + 2.25 * Math.cos(yaw),
    p[1] + 0.05,
    p[2] - 2.25 * Math.sin(yaw),
  ]);
  const boxes = countyBlocks(lots),
    { nodes, links } = countyRoutes(plan.streets);
  // Keep non-solid road bounds available to city consumers. The oriented
  // surface and lane edges come from the matching street in the plan.
  for (const street of plan.streets) {
    const dx = street.b[0] - street.a[0],
      dz = street.b[2] - street.a[2];
    const length = Math.hypot(dx, dz);
    const p = alongStreet(street, 0.5);
    p[1] = 0.02;
    boxes.push({
      p,
      s: [
        Math.abs(dx) + (Math.abs(dz) / length) * street.width,
        0.04,
        Math.abs(dz) + (Math.abs(dx) / length) * street.width,
      ],
      kind: "road",
      solid: false,
    });
  }
  // Tile the terrain so rendering and physics only visit nearby patches.
  for (let tz = -LIMIT; tz < LIMIT; tz += 160)
    for (let tx = -LIMIT; tx < LIMIT; tx += 160) {
      const vertices: number[] = [],
        indices: number[] = [];
      let low = Infinity,
        high = -Infinity;
      for (let z = 0; z <= 8; z++)
        for (let x = 0; x <= 8; x++) {
          const px = tx + 20 * x,
            pz = tz + 20 * z,
            y = elevation(px, pz);
          low = Math.min(low, y);
          high = Math.max(high, y);
          vertices.push(px, y, pz);
          if (x < 8 && z < 8) {
            const i = z * 9 + x;
            indices.push(i, i + 9, i + 1, i + 1, i + 9, i + 10);
          }
        }
      if (high === low) {
        boxes.push({
          p: [tx + 80, low - 0.5, tz + 80],
          s: [160, 1, 160],
          kind: "ground",
          solid: true,
        });
      } else
        boxes.push({
          p: [tx + 80, (low + high) / 2, tz + 80],
          s: [160, high - low + 0.01, 160],
          kind: "ground",
          solid: true,
          mesh: { vertices, indices },
        });
    }
  boxes.forEach((box, i) => {
    if (box.piece) box.pieceId = i;
  });
  return {
    seed: COUNTY,
    district: 1,
    boxes,
    spawns,
    bounds: LIMIT,
    flightCeiling: 130,
    plan,
    buildings: [],
    beacons: [
      nodes[0],
      ...TOWNS.map((t) => {
        const main = plan.streets.find(
          (s) => s.class === "arterial" && Math.abs(s.a[0] - t) < 28,
        )!;
        return alongStreet(main, 0.5);
      }),
    ],
    nodes,
    links,
    bridges: [],
    blimps: [],
    platforms: [],
    aerialLinks: [],
    aerialEntries: [],
    streetNodes: [],
    roofLinks: [],
    dressing: [],
  };
}

export const VEHICLES = [
  "saloon",
  "minivan",
  "taxi",
  "delivery",
  "coupe",
] as const;
export type VehicleKind = (typeof VEHICLES)[number];
export interface CountyCar {
  patrol?: boolean;
  responding?: boolean;
  p: V3;
  yaw: number;
  kind: VehicleKind;
  driver: string | null;
}
export function parkedCars(lots = planCounty().lots): CountyCar[] {
  const rand = randomSeed(COUNTY + "-parking");
  const result: CountyCar[] = [];
  function curb(lot: CountyLot, road: Street, t: number, kind: VehicleKind) {
    const dx = road.b[0] - road.a[0],
      dz = road.b[2] - road.a[2];
    const side = Math.sign(dx * (lot.z - road.a[2]) - dz * (lot.x - road.a[0]));
    const p = alongStreet(road, t, side * (road.width / 2 - 1.25));
    const yaw = Math.atan2(dx, dz) + (side > 0 ? 0 : Math.PI);
    result.push({ p, yaw, kind, driver: null });
  }
  for (const town of TOWNS) {
    const district = lots.filter((l) => l.town === town);
    const cinema = district.find((l) => l.landmark === "cinema")!;
    const hall = district.find((l) => l.landmark === "hall")!;
    const market = district.find((l) => l.landmark === "market")!;
    curb(cinema, cinema.side, 0.45, "saloon");
    const candidates = district
      .filter((l) => !l.landmark)
      .map((l) => ({ l, rank: rand() }))
      .sort((a, b) => a.rank - b.rank)
      .map((e) => e.l);
    function place(kind: VehicleKind, designs: number[]) {
      const index = candidates.findIndex((l) => designs.includes(l.choice));
      const [lot] = candidates.splice(index < 0 ? 0 : index, 1);
      curb(lot, lot.front, 0.33 + rand() * 0.34, kind);
    }
    for (let j = 0; j < 3; j++) place("minivan", [1, 2]);
    for (let j = 0; j < 3; j++) place("saloon", [1, 4]);
    for (let j = 0; j < 2; j++) place("coupe", [3, 4]);
    for (let j = 0; j < 2; j++) place("delivery", [0, 2]);
    curb(hall, hall.front, 0.38, "taxi");
    curb(hall, hall.front, 0.6, "taxi");
    curb(cinema, cinema.front, 0.5, "taxi");
    result.push({
      kind: "delivery",
      p: [market.x + 6, 0.15, market.z + 2],
      yaw: Math.PI * 0.62,
      driver: null,
    });
  }
  return result;
}

// Traffic has its own seats. Player spawn positions and parked-car indices are stable.
export function countyCars(): CountyCar[] {
  const { plan, lots } = planCounty();
  const cars = parkedCars(lots);
  for (const [townIndex, town] of TOWNS.entries()) {
    const main = plan.streets.filter(
      (s) =>
        !s.id.startsWith("county-road-") &&
        s.class === "arterial" &&
        Math.sign(s.a[0]) === Math.sign(town),
    );
    const cinema = lots.find(
      (lot) => lot.town === town && lot.landmark === "cinema",
    )!;
    const routes = [main[0], main[2], main.at(-1)!, cinema.front];
    for (const [i, road] of routes.entries()) {
      const dir = i % 2 ? -1 : 1;
      const offset = dir * Math.min(road.width * 0.21, 2.8);
      const p = [0.16 + 0.13 * i, 0.18, 0.8, 0.32, 0.64]
        .map((t) => alongStreet(road, t, offset))
        .find((p) =>
          cars.every((c) => Math.hypot(c.p[0] - p[0], c.p[2] - p[2]) > 7),
        )!;
      p[1] = 0.08;
      const dx = road.b[0] - road.a[0],
        dz = road.b[2] - road.a[2];
      const serial = townIndex * routes.length + i;
      cars.push({
        kind: i === 2 ? "saloon" : VEHICLES[serial % VEHICLES.length],
        ...(i === 2 ? { patrol: true } : {}),
        driver: "civilian-driver-" + serial,
        p,
        yaw: Math.atan2(-dir * dx, -dir * dz),
      });
    }
  }
  return cars;
}
