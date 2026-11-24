import { roadsideStructures } from "./county-highways.ts";
import { regionalTrees } from "./county-landcover.ts";
import type { SeatInteraction } from "./county-car-access.ts";
import { architectureLadders, cityLot } from "./county-architecture.ts";
import { randomSeed, type V3, type City, type Box } from "./world.ts";
import type { Street } from "./city-plan.ts";
import {
  alongStreet,
  COUNTY,
  countyRoutes,
  COUNTY_SETTLEMENTS,
  elevation,
  LIMIT,
  planCounty,
  terrainHeight,
  TOWNS,
  type CountyLot,
} from "./county-plan.ts";
export { COUNTY, LIMIT, TOWNS, elevation } from "./county-plan.ts";

// The physics box describes the solid stem. The renderer uses the same stem
// dimensions for both palm LODs and carries the broadleaf crown above traffic.
export function countyStreetTree(x: number, z: number) {
  const random = randomSeed(`county-street-tree/${x}/${z}`);
  const palm = Math.sin(x * 2.7 + z * 0.32) > -0.45;
  const height = palm ? 10.8 + 4.4 * random() : 8.3 + 3.4 * random();
  const trunkHeight = height * (palm ? 6.8 / 8.53 : 0.65);
  const diameter = (palm ? 0.56 : 0.39) + random() * (palm ? 0.15 : 0.17);
  const crownRadius = palm
    ? diameter * 9.2
    : height * (0.26 + random() * 0.066);
  const crownBase = height * (palm ? 0.57 : 0.45);
  return {
    palm,
    height,
    trunkHeight,
    diameter,
    crownRadius,
    crownBase,
    yaw: random() * Math.PI * 2,
  };
}

export function countyBlocks(lots = planCounty().lots) {
  const blocks: Box[] = [];
  const developed = lots.map((parcel) => ({
    parcel,
    pieces: cityLot(parcel.x, parcel.z, parcel.choice, parcel.variation),
  }));
  for (const {
    parcel: { x, z, w, d, choice },
    pieces: lot,
  } of developed) {
    // A back-lot tree can face the neighboring parcel's facade. Only inspect
    // pieces in parcels within a full mature canopy of this planting area.
    const nearby = developed.filter(
      ({ parcel: p }) =>
        Math.abs(x - p.x) <= (w + p.w) / 2 + 12 &&
        Math.abs(z - p.z) <= (d + p.d) / 2 + 12,
    );
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
      const tx = x + dx,
        tz = z + dz;
      const tree = countyStreetTree(tx, tz);
      const { trunkHeight, crownBase, height, crownRadius } = tree;
      const base = Math.max(0.15, terrainHeight(tx, tz));
      let clearance = crownRadius;
      for (const { pieces } of nearby) {
        for (const b of pieces) {
          if (
            b.p[1] + b.s[1] / 2 < base + crownBase ||
            b.p[1] - b.s[1] / 2 > base + height + 0.1
          )
            continue;
          const u = Math.max(0, Math.abs(tx - b.p[0]) - b.s[0] / 2),
            v = Math.max(0, Math.abs(tz - b.p[2]) - b.s[2] / 2);
          if (u < clearance + 0.18 && v < clearance + 0.18)
            clearance = Math.min(clearance, Math.hypot(u, v) - 0.18);
        }
      }
      // Street trees in narrow courts have a narrower crown and stem; retain
      // their mature height and the headroom under the first branches.
      if (clearance <= 0) continue;
      const diameter = (tree.diameter * clearance) / crownRadius;
      blocks.push({
        p: [tx, base + trunkHeight / 2, tz],
        s: [diameter, trunkHeight, diameter],
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
  const spawns: V3[] = spaces.map(({ p, yaw }) => {
    const x = p[0] - 2.25 * Math.cos(yaw);
    const z = p[2] + 2.25 * Math.sin(yaw);
    // Curbside players start on the sidewalk side of the car. Some city
    // blocks carry their raised concrete apron all the way to this point.
    const onApron = lots.some(
      (l) =>
        Math.abs(x - l.x) < l.w / 2 + 0.33 &&
        Math.abs(z - l.z) < l.d / 2 + 0.33,
    );
    return [x, (onApron ? 0.15 : p[1]) + 0.05, z];
  });
  const boxes = countyBlocks(lots),
    { nodes, links } = countyRoutes(plan.streets);
  // Keep non-solid road bounds available to city consumers. The oriented
  // surface and lane edges come from the matching street in the plan.
  for (const street of plan.streets) {
    const dx = street.b[0] - street.a[0],
      dz = street.b[2] - street.a[2];
    const length = Math.hypot(dx, dz);
    const p = alongStreet(street, 0.5);
    p[1] += 0.02;
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
  boxes.push(...regionalTrees(plan, LIMIT), ...roadsideStructures());
  boxes.forEach((box, i) => {
    if (box.piece) box.pieceId = i;
  });
  return {
    seed: COUNTY,
    district: 1,
    boxes,
    spawns,
    bounds: LIMIT,
    flightCeiling: 210,
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
      ...COUNTY_SETTLEMENTS.map(({ x, z }): V3 => [x, 0, z]),
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
  access?: "locked" | "secured" | "picked" | "open";
  interaction?: SeatInteraction;
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
      const index = candidates.findIndex((l) =>
        designs.includes(l.parkingChoice ?? l.choice),
      );
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
  const ranked = result
    .map((car) => ({ car, rank: rand() }))
    .sort((a, b) => a.rank - b.rank);
  const pickable = Math.round(ranked.length * 0.4);
  ranked.forEach(({ car }, i) => {
    car.access = i < pickable ? "locked" : "secured";
  });
  return result;
}

// Traffic has its own seats. Player spawn positions and parked-car indices are stable.
export function countyCars(): CountyCar[] {
  const { plan, lots } = planCounty();
  const cars = parkedCars(lots);
  for (const [townIndex, town] of TOWNS.entries()) {
    const main = plan.streets.filter(
      (s) =>
        (s.id.startsWith("mill-") || s.id.startsWith("terrace-")) &&
        s.class === "arterial" &&
        Math.sign(s.a[0]) === Math.sign(town),
    );
    const cinema = lots.find(
      (lot) => lot.town === town && lot.landmark === "cinema",
    )!;
    const regionalMain = (id: string) =>
      plan.streets.find((s) => s.id === id + "-main-1")!;
    const routes = [
      townIndex === 0 ? main[0] : regionalMain("red-mesa"),
      regionalMain(townIndex === 0 ? "saltbrush" : "laurel"),
      main.at(-1)!,
      cinema.front,
    ];
    for (const [i, road] of routes.entries()) {
      const dir = i % 2 ? -1 : 1;
      const offset = dir * Math.min(road.width * 0.21, 2.8);
      const p = [0.16 + 0.13 * i, 0.18, 0.8, 0.32, 0.64]
        .map((t) => alongStreet(road, t, offset))
        .find((p) =>
          cars.every((c) => Math.hypot(c.p[0] - p[0], c.p[2] - p[2]) > 7),
        )!;
      p[1] += 0.08;
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
  // A spare vehicle at each service station makes the outlying towns usable
  // return points. Append these after the stable spawn and civilian car slots.
  for (const [i, place] of COUNTY_SETTLEMENTS.entries()) {
    const station = lots.find((l) => l.town === place.x && l.choice === 9)!;
    cars.push({
      p: [station.x, 0.15, station.z + 6.8],
      yaw: Math.PI,
      kind: (["delivery", "coupe", "minivan"] as const)[i],
      access: "open",
      driver: null,
    });
  }
  return cars;
}
