import { randomSeed, type V3 } from "./world.ts";
export type NeighborhoodId = "works" | "market" | "heights" | "press";
export interface Neighborhood {
  id: NeighborhoodId;
  name: string;
  floors: [number, number];
  kind: string;
  setback: number;
  accent: string;
}
export const NEIGHBORHOODS: Neighborhood[] = [
  {
    id: "works",
    name: "INKWORKS",
    floors: [2, 3],
    kind: "warehouse",
    setback: 1,
    accent: "#7a568e",
  },
  {
    id: "market",
    name: "OLD PAPER MARKET",
    floors: [3, 5],
    kind: "shop",
    setback: 0.8,
    accent: "#bd782d",
  },
  {
    id: "heights",
    name: "BLUEBIRD HEIGHTS",
    floors: [5, 9],
    kind: "apartment",
    setback: 1,
    accent: "#32836d",
  },
  {
    id: "press",
    name: "THE PRESS QUARTER",
    floors: [8, 12],
    kind: "office",
    setback: 1,
    accent: "#3247b7",
  },
];
export interface Street {
  id: string;
  a: V3;
  b: V3;
  width: number;
  endWidths?: [number, number];
  class: "arterial" | "local";
}
export interface Parcel {
  id: string;
  blockId: string;
  x: number;
  z: number;
  w: number;
  d: number;
  facing: number;
  streetId: string;
  neighborhood: NeighborhoodId;
  floors: number;
  kind: string;
}
export interface CityPlan {
  bridges: { a: string; b: string }[];
  streets: Street[];
  parcels: Parcel[];
  blocks: {
    id: string;
    district?: "Downtown" | "Suburbs" | "Fringe";
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    neighborhood: NeighborhoodId;
  }[];
  landmarks: { id: string; p: V3; size: V3 }[];
}
export interface CityOverrides {
  blockSeeds?: Record<string, string>;
  buildings?: Record<string, { floors?: number; name?: string }>;
}
export function planCity(
  seed: string,
  district: number,
  overrides: CityOverrides = {},
): CityPlan {
  const rand = randomSeed(`${seed}:${district}:streets`);
  // Stable arterial at x/z=15 protects the authored plaza and gives every district a compass.
  const axis = () =>
    Array.from(
      { length: 9 },
      (_, i) => 15 + (i - 4) * 66 + (i === 4 ? 0 : (rand() - 0.5) * 3),
    );
  const xs = axis(),
    zs = axis();
  const width = (i: number) => (i === 4 ? 10 : 6);
  const streets: Street[] = [],
    parcels: Parcel[] = [],
    blocks: CityPlan["blocks"] = [];
  for (let i = 0; i < 9; i++)
    for (let j = 0; j < 8; j++) {
      streets.push({
        id: `v${i}-${j}`,
        a: [xs[i], 0, zs[j]],
        b: [xs[i], 0, zs[j + 1]],
        width: i === 4 ? 10 : 6,
        class: i === 4 ? "arterial" : "local",
      });
      streets.push({
        id: `h${i}-${j}`,
        a: [xs[j], 0, zs[i]],
        b: [xs[j + 1], 0, zs[i]],
        width: i === 4 ? 10 : 6,
        class: i === 4 ? "arterial" : "local",
      });
    }
  for (let iz = 0; iz < 8; iz++)
    for (let ix = 0; ix < 8; ix++) {
      const id = `block-${ix}-${iz}`,
        r = randomSeed(
          `${seed}:${district}:${id}:${overrides.blockSeeds?.[id] || ""}`,
        );
      const n = NEIGHBORHOODS[ix < 2 ? 0 : iz >= 4 ? 1 : ix >= 4 ? 2 : 3];
      const minX = xs[ix] + width(ix) / 2 + 1.5,
        maxX = xs[ix + 1] - width(ix + 1) / 2 - 1.5;
      const minZ = zs[iz] + width(iz) / 2 + 1.5,
        maxZ = zs[iz + 1] - width(iz + 1) / 2 - 1.5;
      blocks.push({ id, minX, maxX, minZ, maxZ, neighborhood: n.id });
      // Two street-facing rows, each with two lots, separated by a continuous rear alley.
      const lotW = (maxX - minX) / 2;
      for (let row = 0; row < 2; row++)
        for (let k = 0; k < 2; k++) {
          const frontNorth = row === 0;
          const w = lotW - 2 * n.setback;
          const d = (maxZ - minZ - 3) / 2 - n.setback;
          const x = minX + lotW * (k + 0.5),
            z = frontNorth
              ? minZ + n.setback + d / 2
              : maxZ - n.setback - d / 2;
          parcels.push({
            id: `${id}-lot-${row * 2 + k}`,
            blockId: id,
            x,
            z,
            w,
            d,
            facing: frontNorth ? 2 : 0,
            streetId: `h${frontNorth ? iz : iz + 1}-${ix}`,
            neighborhood: n.id,
            floors:
              n.floors[0] + Math.floor(r() * (n.floors[1] - n.floors[0] + 1)),
            kind: n.kind,
          });
        }
    }
  // Sparse landmark towers and paired roof elevations give bridges clean, level landings.
  for (const p of parcels)
    if (
      p.neighborhood === "press" &&
      p.id.endsWith("lot-0") &&
      Number(p.blockId.split("-")[1]) % 2 === 0
    )
      p.floors = 16;
  const bridges: CityPlan["bridges"] = [],
    used = new Set<string>();
  const pair = (a: string, b: string) => {
    const first = parcels.find((p) => p.id === a),
      second = parcels.find((p) => p.id === b);
    if (
      !first ||
      !second ||
      used.has(a) ||
      used.has(b) ||
      overrides.buildings?.[a] ||
      overrides.buildings?.[b]
    )
      return;
    first.floors = second.floors =
      first.neighborhood === "press"
        ? 16
        : first.neighborhood === "heights"
          ? 9
          : first.neighborhood === "market"
            ? 5
            : 3;
    bridges.push({ a, b });
    used.add(a);
    used.add(b);
  };
  for (let iz = 0; iz < 8; iz++)
    for (let ix = 0; ix < 8; ix++) {
      if ((ix + iz) % 2 === 0)
        pair(`block-${ix}-${iz}-lot-0`, `block-${ix}-${iz}-lot-2`);
      if (iz < 7 && (ix + iz) % 3 === 0)
        pair(`block-${ix}-${iz}-lot-3`, `block-${ix}-${iz + 1}-lot-1`);
    }
  return {
    bridges,
    streets,
    parcels,
    blocks,
    landmarks: [{ id: "training-plaza", p: [15, 0, 24], size: [12, 0, 12] }],
  };
}
