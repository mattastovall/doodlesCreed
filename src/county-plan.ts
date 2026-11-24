import { surveyHighways } from "./county-highways.ts";
import { randomSeed, type V3 } from "./world.ts";
import type { CityPlan, NeighborhoodId, Street } from "./city-plan.ts";

export const COUNTY = "switchback-county";
export const TOWNS = [-320, 320];
export const LIMIT = 1120;
export const COUNTY_SETTLEMENTS = [
  {
    id: "saltbrush",
    name: "Saltbrush Junction",
    x: -810,
    z: -820,
    biome: "desert",
  },
  { id: "red-mesa", name: "Red Mesa", x: 780, z: -820, biome: "mesa" },
  { id: "laurel", name: "Laurel Grove", x: 0, z: 880, biome: "woodland" },
] as const;
type XZ = [number, number];
const westGate: XZ = [-790, valleyZ(-790)],
  eastGate: XZ = [790, valleyZ(790)];
// Each loop enters the settlement on its main street. The northern freight
// road cuts between two mesas; the southern ridge route returns via the grove.
const controlTracks: XZ[][] = [
  [
    westGate,
    [-940, -145],
    [-990, -365],
    [-922, -485],
    [-953, -610],
    [-935, -745],
    [-906, -820],
  ],
  [
    [-714, -820],
    [-490, -900],
    [-260, -875],
    [-80, -735],
    [155, -685],
    [340, -752],
    [560, -856],
    [684, -820],
  ],
  [
    [876, -820],
    [990, -715],
    [1008, -480],
    [892, -365],
    [955, -245],
    [906, -120],
    eastGate,
  ],
  [
    westGate,
    [-905, 155],
    [-810, 345],
    [-605, 420],
    [-470, 565],
    [-490, 657],
    [-346, 790],
    [-96, 880],
  ],
  [
    [96, 880],
    [345, 829],
    [517, 710],
    [467, 615],
    [610, 490],
    [833, 400],
    [940, 228],
    eastGate,
  ],
];
// Round surveyed bends before cutting the terrain corridor. The road paint,
// civilian routes and terrain all follow this same sampled centerline.
function roundBends(track: XZ[]): XZ[] {
  const points = [track[0]];
  for (let i = 1; i < track.length - 1; i++) {
    const prev = track[i - 1],
      corner = track[i],
      next = track[i + 1];
    const before = Math.hypot(prev[0] - corner[0], prev[1] - corner[1]);
    const after = Math.hypot(next[0] - corner[0], next[1] - corner[1]);
    const trim = Math.min(65, before * 0.36, after * 0.36);
    const a: XZ = [
      corner[0] + ((prev[0] - corner[0]) * trim) / before,
      corner[1] + ((prev[1] - corner[1]) * trim) / before,
    ];
    const b: XZ = [
      corner[0] + ((next[0] - corner[0]) * trim) / after,
      corner[1] + ((next[1] - corner[1]) * trim) / after,
    ];
    for (let j = 0; j <= 5; j++) {
      const t = j / 5,
        u = 1 - t;
      points.push([
        u * u * a[0] + 2 * u * t * corner[0] + t * t * b[0],
        u * u * a[1] + 2 * u * t * corner[1] + t * t * b[1],
      ]);
    }
  }
  points.push(track[track.length - 1]);
  return points;
}
const countyTracks = controlTracks.map(roundBends);
const gradeBreaks = [-740, -560, -400, -160, -60, 60, 220, 440, 580, 760];
const grades = [0, 17, 26, 8, 0, 0, 11, 32, 19, 0];
function routeGrade(z: number) {
  for (let i = 1; i < gradeBreaks.length; i++)
    if (z >= gradeBreaks[i - 1] && z <= gradeBreaks[i])
      return (
        grades[i - 1] +
        ((grades[i] - grades[i - 1]) * (z - gradeBreaks[i - 1])) /
          (gradeBreaks[i] - gradeBreaks[i - 1])
      );
  return 0;
}
const trackEdges = countyTracks.flatMap((track) =>
  track.slice(1).map((b, i) => {
    const a = track[i],
      dx = b[0] - a[0],
      dz = b[1] - a[1];
    return {
      a,
      dx,
      dz,
      len2: dx * dx + dz * dz,
      minX: Math.min(a[0], b[0]) - 145,
      maxX: Math.max(a[0], b[0]) + 145,
      minZ: Math.min(a[1], b[1]) - 145,
      maxZ: Math.max(a[1], b[1]) + 145,
    };
  }),
);

// The valley floor sets the course of the county road even beyond the towns.
function valleyZ(x: number) {
  const town = x < 0 ? TOWNS[0] : TOWNS[1];
  const rise = Math.min(1, Math.max(0, (Math.abs(x - town) - 130) / 95));
  const meander =
    (x < 0 ? 0.3 : 0.52) + (x < 0 ? 0.7 : 0.48) * rise * rise * (3 - 2 * rise);
  return meander * (29 * Math.sin(x / 91) + 16 * Math.sin(x / 57));
}
export function elevation(x: number, z: number) {
  const valleyShoulder = Math.max(0, Math.abs(z - valleyZ(x)) - 42) / 150;
  const townShoulder = Math.min(
    ...TOWNS.map(
      (t) =>
        Math.max(0, Math.max(Math.abs(x - t) - 280, Math.abs(z) - 285)) / 100,
    ),
  );
  const hills = Math.min(1, valleyShoulder, townShoulder);
  const oldHills =
    hills * hills * (38 + 23 * Math.sin(x / 93) + 15 * Math.cos(z / 72));
  if (townShoulder === 0) return 0;
  if (hills === 0 && Math.abs(x) < 600 && Math.abs(z) < 220) return oldHills;
  let distance = 145;
  for (const town of COUNTY_SETTLEMENTS)
    distance = Math.min(
      distance,
      Math.hypot(
        Math.max(0, Math.abs(town.x - x) - 125),
        Math.max(
          0,
          z - town.z - 92,
          town.z - z - (town.id === "red-mesa" ? 240 : 92),
        ),
      ),
    );
  for (const e of trackEdges) {
    if (x < e.minX || x > e.maxX || z < e.minZ || z > e.maxZ) continue;
    const u = Math.max(
      0,
      Math.min(1, ((x - e.a[0]) * e.dx + (z - e.a[1]) * e.dz) / e.len2),
    );
    distance = Math.min(
      distance,
      Math.hypot(x - e.a[0] - e.dx * u, z - e.a[1] - e.dz * u),
    );
  }
  const t = Math.max(0, Math.min(1, (distance - 42) / 103));
  const blend = t * t * (3 - 2 * t);
  const mesa = (cx: number, cz: number, rx: number, rz: number) => {
    const slope = Math.max(
      0,
      Math.min(1, (1 - Math.hypot((x - cx) / rx, (z - cz) / rz)) * 3),
    );
    return slope * slope * (3 - 2 * slope);
  };
  const relief =
    96 * mesa(420, -520, 300, 185) +
    96 * Math.exp(-(((x + 120) / 410) ** 2 + ((z - 540) / 150) ** 2)) +
    70 * mesa(-620, -560, 220, 150);
  return routeGrade(z) * (1 - blend) + (oldHills + hills * relief) * blend;
}

// Shared sampling follows the exact diagonal used by the terrain collider.
const terrainSamples = new Map<number, number>();
function sampledElevation(x: number, z: number) {
  if (Math.abs(x) > LIMIT || Math.abs(z) > LIMIT) return elevation(x, z);
  const key = ((x + LIMIT) / 20) * ((2 * LIMIT) / 20 + 1) + (z + LIMIT) / 20;
  let height = terrainSamples.get(key);
  if (height === undefined) {
    height = elevation(x, z);
    terrainSamples.set(key, height);
  }
  return height;
}
export function terrainHeight(x: number, z: number) {
  const left = Math.floor(x / 20) * 20,
    top = Math.floor(z / 20) * 20;
  const u = (x - left) / 20,
    v = (z - top) / 20;
  const b = sampledElevation(left + 20, top),
    c = sampledElevation(left, top + 20);
  return u + v < 1
    ? (1 - u - v) * sampledElevation(left, top) + u * b + v * c
    : (u + v - 1) * sampledElevation(left + 20, top + 20) +
        (1 - v) * b +
        (1 - u) * c;
}

export interface CountyLot {
  town: number;
  x: number;
  z: number;
  w: number;
  d: number;
  choice: number;
  parkingChoice?: number;
  variation: number;
  front: Street;
  side: Street;
  landmark?: "hall" | "cinema" | "market";
}
export const ruralRoad = (s: Street) => s.id.startsWith("county-road-");
export function alongStreet(s: Street, t: number, offset = 0): V3 {
  const dx = s.b[0] - s.a[0],
    dz = s.b[2] - s.a[2],
    length = Math.hypot(dx, dz);
  return [
    s.a[0] + dx * t - (dz / length) * offset,
    s.id.startsWith("county-road-regional")
      ? routeGrade(s.a[2] + dz * t + (dx / length) * offset)
      : s.a[1] + (s.b[1] - s.a[1]) * t,
    s.a[2] + dz * t + (dx / length) * offset,
  ];
}

// Grow each row back from the main street. Wide freight parcels often absorb
// a cross street; the eastern terraces keep shorter frontages around the
// market and more breathing room uphill. Every block retains through frontage.
function rowBoundaries(west: boolean, row: number, xs: number[], seed: string) {
  const rand = randomSeed(seed + (west ? "-mill-" : "-terrace-") + row);
  const edgeDistance = Math.min(Math.abs(row - 3), Math.abs(row - 4));
  const fringe = () => Math.floor(edgeDistance * (0.35 + rand() * 0.48));
  const first = fringe(),
    end = xs.length - 1 - fringe();
  const boundaries = [first];
  for (let i = first + 1; i < end; i++) {
    const previous = boundaries[boundaries.length - 1];
    const core = edgeDistance < 2 && i >= 2 && i <= 6;
    const mergeChance = west && i < 3 ? 0.58 : 0.17 + edgeDistance * 0.08;
    if (core || xs[i + 1] - xs[previous] > 130 || rand() > mergeChance)
      boundaries.push(i);
  }
  boundaries.push(end);
  return boundaries;
}

const lotKinds = [
  "works",
  "rowhouses",
  "arcade",
  "cinema",
  "exchange",
  "hall",
  "square",
  "bungalows",
  "motor-court",
  "service-station",
  "walkup",
  "ore-headframe",
  "fire-lookout",
  "high-street",
  "ranch-house",
  "meridian-building",
  "bank-tower",
];
function lotFloors(choice: number, variation: number) {
  return [
    2,
    2,
    4 + Math.floor(variation * 3),
    3,
    7 + 2 * Math.floor(variation * 3),
    5,
    1,
    1,
    2,
    1,
    3 + Math.floor(variation * 3),
    4,
    5,
    3,
    1,
    14,
    16,
  ][choice];
}

export function planCounty(seed = COUNTY) {
  const plan: CityPlan = {
    streets: [],
    blocks: [],
    parcels: [],
    bridges: [],
    landmarks: [],
  };
  const lots: CountyLot[] = [];
  const gateways: V3[] = [];
  for (const town of TOWNS) {
    const west = town < 0;
    // Freight yards grew on a narrow rectilinear survey. The eastern terraces
    // fan apart away from the market, joined by short streets across the slope.
    const xs = west
      ? [-234, -167, -100, -51, 0, 46, 92, 150, 226]
      : [-226, -160, -102, -54, -5, 42, 89, 147, 222];
    const zs = west
      ? [-238, -162, -94, -45, 0, 45, 92, 153, 232]
      : [-230, -156, -94, -46, 0, 47, 95, 157, 227];
    const spans = zs.slice(1).map((_, j) => rowBoundaries(west, j, xs, seed));
    const points: V3[][] = zs.map((v, j) =>
      xs.map((u, i) => {
        const spread = west ? 1 : 1 + 0.0004 * v;
        const skew = west
          ? i === 4
            ? 0
            : v * 0.035 * Math.sin(i)
          : v * 0.065 + Math.sin(v / 65) * 4;
        const x = town + u * spread + skew;
        // Both main streets follow the same valley as the inter-town highway.
        const terrace = west
          ? v * 0.025 * Math.sin(i)
          : v * 0.04 * Math.sin(i * 1.1 + j * 0.35);
        return [x, 0, valleyZ(x) + v + terrace];
      }),
    );
    gateways.push(points[4][0], points[4][xs.length - 1]);
    const streets = new Map<string, Street>();
    function segment(i: number, j: number, horizontal: boolean) {
      const id = `${west ? "mill" : "terrace"}-${horizontal ? "h" : "v"}${i}-${j}`;
      const existing = streets.get(id);
      if (existing) return existing;
      const arterial = horizontal && j === 4;
      const collector = horizontal ? j === (west ? 3 : 5) : i === 4;
      const width = arterial ? 14 : collector ? 11 : west ? 8.6 : 7.6;
      const street: Street = {
        id,
        a: points[j][i],
        b: points[j + Number(!horizontal)][i + Number(horizontal)],
        width,
        class: arterial ? "arterial" : "local",
      };
      streets.set(id, street);
      plan.streets.push(street);
      return street;
    }
    spans.forEach((boundaries, j) =>
      boundaries.slice(1).forEach((end, k) => {
        const start = boundaries[k];
        const left = segment(start, j, false),
          right = segment(end, j, false);
        const north: Street[] = [],
          south: Street[] = [];
        for (let i = start; i < end; i++) {
          north.push(segment(i, j, true));
          south.push(segment(i, j + 1, true));
        }
        const id = `${west ? "mill" : "terrace"}-block-${j}-${start}`;
        const rand = randomSeed(seed + id);
        const boundary = [left, right, ...north, ...south];
        const vertices = boundary.flatMap((s) => [s.a, s.b]);
        const neighborhood: NeighborhoodId = west
          ? start < 2
            ? "works"
            : "market"
          : Math.abs(j - 3.5) <= 1.5
            ? "press"
            : "heights";
        const blockRing = Math.max(
          Math.abs((start + end - 1) / 2 - 3.5),
          Math.abs(j - 3.5),
        );
        plan.blocks.push({
          id,
          district:
            blockRing < 2 ? "Downtown" : blockRing < 3 ? "Suburbs" : "Fringe",
          neighborhood,
          minX: Math.min(...vertices.map((p) => p[0])),
          maxX: Math.max(...vertices.map((p) => p[0])),
          minZ: Math.min(...vertices.map((p) => p[2])),
          maxZ: Math.max(...vertices.map((p) => p[2])),
        });
        // A merged block retains separate addresses along its through street.
        for (let n = 0; n < end - start; n++) {
          const front = south[n],
            back = north[n];
          const fy = 0.46 + rand() * 0.1,
            fx = 0.46 + rand() * 0.08;
          const a = alongStreet(front, fx),
            b = alongStreet(back, fx);
          const x = b[0] + (a[0] - b[0]) * fy,
            z = b[2] + (a[2] - b[2]) * fy;
          const column = start + n;
          const ring = Math.max(Math.abs(column - 3.5), Math.abs(j - 3.5));
          const landmark =
            j === 4 && column === 3
              ? "hall"
              : j === 4 && column === 4
                ? "market"
                : j === 5 && column === 4
                  ? "cinema"
                  : undefined;
          // Short downtown frontages give way to broad plots with a single
          // detached house. Freight sheds line the western approach.
          const palette =
            ring < 2
              ? west
                ? [13, 2, 13, 10, 4]
                : [4, 2, 13, 4, 10]
              : ring < 3
                ? west && column <= 2
                  ? [0, 0, 1, 8]
                  : [1, 7, 10, 1, 13]
                : Math.abs(j - 3.5) === 0.5
                  ? [9, 8, 14]
                  : [14, 14, 14, 7];
          const choice =
            j === 3 && column === 4
              ? west
                ? 15
                : 16
              : landmark === "hall"
                ? 5
                : landmark === "market"
                  ? 6
                  : landmark === "cinema"
                    ? 3
                    : palette[Math.floor(rand() * palette.length)];
          // Inscribe the paved apron between the four road rights-of-way. The
          // separating axis projects the axis-aligned pad onto each road normal.
          let w = Math.min(45, Math.abs(front.b[0] - front.a[0]) - 13),
            d = Math.min(43, Math.abs(a[2] - b[2]) - 12);
          for (const s of boundary) {
            const dx = s.b[0] - s.a[0],
              dz = s.b[2] - s.a[2],
              len = Math.hypot(dx, dz);
            const clearance =
              Math.abs(dx * (z - s.a[2]) - dz * (x - s.a[0])) / len -
              s.width / 2 -
              0.7;
            const ratio = Math.min(
              1,
              (clearance * 2 * len) / (Math.abs(dz) * w + Math.abs(dx) * d),
            );
            w *= ratio;
            d *= ratio;
          }
          if (choice === 14) {
            w = Math.min(w, 23);
            d = Math.min(d, 24);
          }
          const lot = {
            town,
            x,
            z,
            w,
            d,
            choice,
            variation: rand(),
            front,
            side: n === 0 ? left : right,
            landmark,
          } satisfies CountyLot;
          lots.push(lot);
          plan.parcels.push({
            id: `${id}-p${n}`,
            blockId: id,
            x,
            z,
            w,
            d,
            facing: 0,
            streetId: front.id,
            neighborhood,
            kind: lotKinds[choice],
            floors: lotFloors(choice, lot.variation),
          });
          if (choice === 15 || choice === 16)
            plan.landmarks.push({
              id: lotKinds[choice],
              p: [x, 0, z],
              size: [w, choice === 15 ? 65 : 72, d],
            });
          if (landmark)
            plan.landmarks.push({
              id: `${id}-${landmark}`,
              p: [x, 0, z],
              size: [w, 0, d],
            });
        }
      }),
    );
  }
  function highway(a: V3, b: V3) {
    const steps = Math.ceil((b[0] - a[0]) / 25);
    let previous = a;
    for (let i = 1; i <= steps; i++) {
      const x = a[0] + ((b[0] - a[0]) * i) / steps;
      const next: V3 = i === steps ? b : [x, 0, valleyZ(x)];
      plan.streets.push({
        id: `county-road-${plan.streets.length}`,
        a: previous,
        b: next,
        width: 12,
        class: "arterial",
      });
      previous = next;
    }
  }
  highway([-790, 0, valleyZ(-790)], gateways[0]);
  highway(gateways[1], gateways[2]);
  highway(gateways[3], [790, 0, valleyZ(790)]);
  function street(id: string, a: XZ, b: XZ, width: number, arterial: boolean) {
    const road: Street = {
      id,
      a: [a[0], routeGrade(a[1]), a[1]],
      b: [b[0], routeGrade(b[1]), b[1]],
      width,
      class: arterial ? "arterial" : "local",
    };
    plan.streets.push(road);
    return road;
  }
  for (const [r, track] of countyTracks.entries()) {
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1],
        b = track[i],
        dx = b[0] - a[0],
        dz = b[1] - a[1];
      const steps = Math.ceil(Math.hypot(dx, dz) / 65);
      const ts = Array.from({ length: steps }, (_, j) => (j + 1) / steps);
      for (const z of gradeBreaks) {
        const t = (z - a[1]) / dz;
        if (t > 0 && t < 1) ts.push(t);
      }
      let prev = a;
      for (const [j, t] of [...new Set(ts)].sort((a, b) => a - b).entries()) {
        const next: XZ = t === 1 ? b : [a[0] + dx * t, a[1] + dz * t];
        street(`county-road-regional-${r}-${i}-${j}`, prev, next, 11, true);
        prev = next;
      }
    }
  }
  for (const place of COUNTY_SETTLEMENTS) {
    const { x, z, id } = place;
    const rand = randomSeed(seed + id);
    // Two parallel back streets make eight frontages and a local driving loop.
    const designs =
      id === "saltbrush"
        ? [0, 8, 9, 7, 1, 8, 2, 0]
        : id === "red-mesa"
          ? [9, 11, 8, 1, 7, 0, 2, 7]
          : [7, 10, 8, 12, 1, 7, 9, 10];
    for (let i = 0; i < 4; i++) {
      const left = x - 96 + i * 48,
        right = left + 48;
      const front = street(`${id}-main-${i}`, [left, z], [right, z], 12, true);
      for (const [j, sign] of [-1, 1].entries()) {
        const endZ = z + sign * 56;
        const side = street(
          `${id}-side-${i}-${j}`,
          [left, z],
          [left, endZ],
          8,
          false,
        );
        street(`${id}-back-${i}-${j}`, [left, endZ], [right, endZ], 8, false);
        if (i === 3)
          street(`${id}-side-end-${j}`, [right, z], [right, endZ], 8, false);
        develop(
          front,
          side,
          left,
          right,
          z,
          endZ,
          designs[i + 4 * j],
          `block-${i}-${j}`,
          id === "laurel" ? "heights" : "works",
        );
      }
    }

    if (id === "red-mesa") {
      // The freight road backs onto a wider boulevard. Shorter successive
      // rows form the civic square, exchange frontage and northern court.
      const rows = [
        { first: 0, designs: [0, 5, 6, 4], depth: 58 },
        { first: 1, designs: [2, 4, 10], depth: 62 },
        { first: 1, designs: [1, 3], depth: 54 },
      ];
      let south = z - 56;
      for (const [row, layout] of rows.entries()) {
        const north = south - layout.depth;
        for (const [col, choice] of layout.designs.entries()) {
          const left = x - 96 + (layout.first + col) * 48,
            right = left + 48;
          const front = street(
            `${id}-civic-ave-${row}-${col}`,
            [left, north],
            [right, north],
            row === 0 ? 14 : 9,
            row === 0,
          );
          const side = street(
            `${id}-civic-side-${row}-${col}`,
            [left, south],
            [left, north],
            col === 1 ? 11 : 8,
            false,
          );
          if (col === layout.designs.length - 1)
            street(
              `${id}-civic-end-${row}`,
              [right, south],
              [right, north],
              8,
              false,
            );
          const lot = develop(
            front,
            side,
            left,
            right,
            south,
            north,
            choice,
            `civic-${row}-${col}`,
            choice === 0 ? "works" : "market",
          );
          if (choice === 6)
            plan.landmarks.push({
              id: "red-mesa-civic-square",
              p: [lot.x, 0, lot.z],
              size: [lot.w, 0, lot.d],
            });
        }
        south = north;
      }
    }

    function develop(
      front: Street,
      side: Street,
      left: number,
      right: number,
      startZ: number,
      endZ: number,
      choice: number,
      suffix: string,
      neighborhood: NeighborhoodId,
    ) {
      const blockId = id + "-" + suffix;
      const lot = {
        town: x,
        x: (left + right) / 2,
        z: (startZ + endZ) / 2,
        w: right - left - 11,
        d: Math.abs(endZ - startZ) - 15,
        front,
        side,
        choice,
        variation: rand(),
      };
      lots.push(lot);
      plan.blocks.push({
        id: blockId,
        minX: left,
        maxX: right,
        minZ: Math.min(startZ, endZ),
        maxZ: Math.max(startZ, endZ),
        neighborhood,
      });
      if (choice === 11 || choice === 12)
        plan.landmarks.push({
          id: id + "-" + lotKinds[choice],
          p: [lot.x, 0, lot.z],
          size: [lot.w, 28, lot.d],
        });
      plan.parcels.push({
        id: blockId + "-p0",
        blockId,
        x: lot.x,
        z: lot.z,
        w: lot.w,
        d: lot.d,
        facing: 0,
        streetId: front.id,
        neighborhood,
        kind: lotKinds[choice],
        floors: lotFloors(choice, lot.variation),
      });
      return lot;
    }
  }
  surveyHighways(plan);
  return { plan, lots };
}

export function countyRoutes(streets: Street[]) {
  const nodes: V3[] = [],
    links: [number, number][] = [];
  const junctions = new Map<string, number>();
  function junction(p: V3) {
    const key = p.join(","),
      known = junctions.get(key);
    if (known !== undefined) return known;
    const i = nodes.push([p[0], p[1] + 0.07, p[2]]) - 1;
    junctions.set(key, i);
    return i;
  }
  for (const s of streets) {
    const a = junction(s.a),
      b = junction(s.b);
    if (ruralRoad(s)) {
      links.push([a, b]);
      continue;
    }
    for (const sign of [-1, 1]) {
      let previous = a;
      for (const t of [0.28, 0.53, 0.76]) {
        const p = alongStreet(s, t, sign * (s.width / 2 - 0.65));
        p[1] += 0.07;
        const i = nodes.push(p) - 1;
        links.push([previous, i]);
        previous = i;
      }
      links.push([previous, b]);
    }
  }
  return { nodes, links };
}
