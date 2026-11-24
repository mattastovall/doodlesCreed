// All coordinates are county metres. The creek follows a surveyed downhill
// course; its receiving lake, outlet and marsh share the same level at joins.
export type CountyWaterKind = "creek" | "lake" | "marsh" | "spring";
export interface CountyWaterSample {
  kind: CountyWaterKind;
  surfaceY: number;
  /** Negative inside the design shoreline. Mesh depth uses the actual terrain. */
  shoreDistance: number;
}

export const countyWaterBounds = [
  { minX: -280, maxX: 400, minZ: 340, maxZ: 780 },
  { minX: -440, maxX: -220, minZ: -680, maxZ: -500 },
] as const;

const clamp = (t: number) => Math.min(1, Math.max(0, t));
function smooth(t: number) {
  t = clamp(t);
  return t * t * (3 - 2 * t);
}

// Interpolate at the terrain mesh spacing. A sum of linear X and Z profiles
// lies on exactly the same plane as the rendered water within either triangle.
function downstreamRise(coordinate: number, flatEnd: number, length: number) {
  const edge = Math.floor(coordinate / 20) * 20;
  const t = (coordinate - edge) / 20;
  return (
    (1 - t) * smooth((flatEnd - edge) / length) +
    t * smooth((flatEnd - edge - 20) / length)
  );
}

type Point = [number, number];
function stream(points: Point[], width: number) {
  const samples: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[Math.max(0, i - 2)],
      b = points[i - 1];
    const c = points[i],
      d = points[Math.min(i + 1, points.length - 1)];
    for (let step = 1; step <= 6; step++) {
      const t = step / 6;
      const coordinate = (k: number) =>
        b[k] +
        0.5 *
          t *
          (c[k] -
            a[k] +
            t *
              (2 * a[k] -
                5 * b[k] +
                4 * c[k] -
                d[k] +
                t * (3 * (b[k] - c[k]) + d[k] - a[k])));
      samples.push([coordinate(0), coordinate(1)]);
    }
  }
  return samples.slice(1).map(([x, z], i) => {
    const [ax, az] = samples[i];
    const dx = x - ax,
      dz = z - az;
    return { ax, az, dx, dz, len2: dx * dx + dz * dz, width };
  });
}

const channels = [
  ...stream(
    [
      [290, 410],
      [267, 441],
      [280, 477],
      [312, 501],
      [312, 532],
      [284, 550],
      [269, 584],
      [236, 605],
    ],
    18,
  ),
  ...stream(
    [
      [128, 637],
      [90, 644],
      [69, 668],
      [42, 676],
      [10, 663],
      [-25, 669],
      [-50, 682],
      [-82, 681],
      [-110, 670],
      [-141, 677],
      [-170, 690],
    ],
    19,
  ),
];

function basinDistance(
  x: number,
  z: number,
  rx: number,
  rz: number,
  phase: number,
) {
  const angle = Math.atan2(z / rz, x / rx);
  const shoreline =
    1 +
    0.09 * Math.sin(3 * angle + phase) +
    0.065 * Math.cos(5 * angle - phase);
  return (
    Math.hypot(x, z) -
    shoreline * Math.hypot(rx * Math.cos(angle), rz * Math.sin(angle))
  );
}

function watershed(
  x: number,
  z: number,
  margin: number,
): CountyWaterSample | undefined {
  if (Math.abs(x + 335) < 160 && Math.abs(z + 590) < 140) {
    const distance = basinDistance(x + 335, z + 590, 45, 30, 1.3);
    if (distance <= margin)
      return { kind: "spring", surfaceY: 27, shoreDistance: distance };
  }
  if (x < -320 || x > 450 || z < 300 || z > 850) return;
  // A tilted basin produces a narrow eastern cove and a broad western beach.
  const lakeX = x - 200,
    lakeZ = z - 635;
  let distance = basinDistance(lakeX, lakeZ + lakeX * 0.23, 108, 55, 0.45);
  let kind: CountyWaterKind = "lake";
  const marsh = basinDistance(x + 170, z - 690, 54, 32, 2.6);
  if (marsh < distance) {
    kind = "marsh";
    distance = marsh;
  }
  for (const { ax, az, dx, dz, len2, width } of channels) {
    if (
      Math.abs(x - ax) > margin + width + 16 ||
      Math.abs(z - az) > margin + width + 16
    )
      continue;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / len2);
    const channel = Math.hypot(x - ax - dx * t, z - az - dz * t) - width;
    if (channel < distance) {
      kind = "creek";
      distance = channel;
    }
  }
  if (distance > margin) return;
  // Level changes finish before the channels meet either standing water body.
  const surfaceY =
    22 + 16 * downstreamRise(z, 555, 145) - 6 * downstreamRise(x, 72, 190);
  return { kind, surfaceY, shoreDistance: distance };
}

export function sampleCountyWater(x: number, z: number) {
  return watershed(x, z, 30);
}

export function watershedElevation(
  x: number,
  z: number,
  natural: number,
  roadClearance: number,
) {
  const water = watershed(x, z, 92);
  if (!water) return natural;
  const { shoreDistance: d, surfaceY, kind } = water;
  const maxDepth = { lake: 9.5, creek: 3.8, marsh: 2.1, spring: 5.5 }[kind];
  const bed = surfaceY + (d < 0 ? Math.max(-maxDepth, d * 0.23) : d * 0.19);
  const blend = smooth((d - 32) / 60);
  // Exclude the surveyed road and settlement pads even at the feathered edge.
  const clearance = smooth((roadClearance - 28) / 15);
  return natural + (bed - natural) * (1 - blend) * clearance;
}
