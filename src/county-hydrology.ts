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
    // Average the turn over roughly a channel width, so bars follow a bend
    // instead of changing abruptly at the joints between survey segments.
    const before = samples[Math.max(0, i - 3)],
      after = samples[Math.min(samples.length - 1, i + 4)];
    const ux = x - before[0],
      uz = z - before[1],
      vx = after[0] - ax,
      vz = after[1] - az;
    const turn = Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz);
    const curvature =
      (2 * turn) /
      Math.max(1, Math.hypot(after[0] - before[0], after[1] - before[1]));
    const len = Math.hypot(dx, dz);
    return { ax, az, dx, dz, len2: len * len, len, width, curvature };
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
): (CountyWaterSample & { bend: number }) | undefined {
  if (Math.abs(x + 335) < 160 && Math.abs(z + 590) < 140) {
    const distance = basinDistance(x + 335, z + 590, 45, 30, 1.3);
    if (distance <= margin)
      return { kind: "spring", surfaceY: 27, shoreDistance: distance, bend: 0 };
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
  let bend = 0;
  for (const { ax, az, dx, dz, len2, len, width, curvature } of channels) {
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
      const left = (dx * (z - az) - dz * (x - ax)) / len;
      // The inside of a left turn is left of flow; positive means deposition.
      bend =
        Math.tanh(curvature * width * 3) * Math.tanh(left / (width * 0.55));
    }
  }
  if (distance > margin) return;
  // Level changes finish before the channels meet either standing water body.
  const surfaceY =
    22 + 16 * downstreamRise(z, 555, 145) - 6 * downstreamRise(x, 72, 190);
  return { kind, surfaceY, shoreDistance: distance, bend };
}

export function sampleCountyWater(
  x: number,
  z: number,
): CountyWaterSample | undefined {
  return watershed(x, z, 30);
}

// A fan widens along the last reach into standing water. Its submerged lobes
// flank a central scour channel that stays connected to the main lake basin.
function deltaLobe(x: number, z: number) {
  const dx = x - 271,
    dz = z - 578;
  const run = -0.8 * dx + 0.6 * dz;
  if (run < 0 || run > 82) return 0;
  const span = 10 + 0.43 * run;
  const across = Math.abs(0.6 * dx + 0.8 * dz);
  return (
    smooth(run / 17) *
    smooth((82 - run) / 25) *
    smooth((span - across) / 9) *
    smooth((across - 3) / 8)
  );
}

function bedOffset(
  x: number,
  z: number,
  water: CountyWaterSample & { bend: number },
) {
  const { kind, bend, shoreDistance: d } = water;
  if (kind === "spring") {
    // A rocky lip encloses a steep-sided plunge pool at the spring vent.
    return d < 0
      ? -6.6 * smooth(-d / 22)
      : 0.15 * d + 1.5 * Math.exp(-((d - 9) ** 2) / 38) * smooth(d / 6);
  }
  if (kind === "marsh") {
    // The meandering runnel lies in a broad, gently shelving flat.
    const runnel = Math.exp(
      -(((z - 685 - 7 * Math.sin((x + 175) / 17)) / 10) ** 2),
    );
    return d < 0
      ? -(1.1 + 1.55 * runnel) * smooth(-d / 17)
      : d * 0.115 + 0.12 * Math.max(0, d - 15);
  }
  const delta = deltaLobe(x, z);
  if (kind === "lake") {
    // A wave-cut littoral shelf gives way to a steeper offshore face.
    const inside = Math.max(0, -d);
    const shelf =
      -0.11 * Math.min(inside, 16) - 7.9 * smooth((inside - 13) / 31);
    return d >= 0 ? 0.16 * d : Math.min(-0.08 * inside, shelf + 6.3 * delta);
  }
  if (d < 0) {
    const inside = -d;
    const scour = Math.min(5.4, inside * 0.32);
    return -scour * (1 - 0.76 * bend) + delta * Math.min(1.1, 0.11 * inside);
  }
  // Low point bars grade into a floodplain bench. Across the same bend the
  // current undercuts the outer bank and leaves a higher, steeper scarp.
  const scarp = 1 - 0.7 * bend;
  return scarp * (0.24 * Math.min(12, d) + 0.09 * Math.max(0, d - 12));
}

export function sampleCountySediment(x: number, z: number) {
  const water = watershed(x, z, 38);
  if (!water) return;
  const { kind, bend, shoreDistance: d } = water;
  const strength = 1 - smooth((d - 14) / 24);
  const delta = deltaLobe(x, z);
  let sand: number, silt: number;
  if (kind === "creek") {
    sand = 0.36 + 0.27 * bend - 0.06 * smooth(d / 15);
    silt = 0.13 + 0.08 * bend + 0.17 * smooth(d / 15);
  } else if (kind === "lake") {
    sand = 0.68 - 0.27 * smooth(-d / 28);
    silt = 0.15 + 0.38 * smooth(-d / 28);
  } else if (kind === "marsh") {
    sand = 0.12;
    silt = 0.82;
  } else {
    sand = 0.18 + 0.13 * smooth(d / 18);
    silt = 0.06;
  }
  sand += (0.83 - sand) * delta;
  silt += (0.15 - silt) * delta;
  return {
    sand: sand * strength,
    silt: silt * strength,
    gravel: (1 - sand - silt) * strength,
  };
}

export function watershedElevation(
  x: number,
  z: number,
  natural: number,
  roadClearance: number,
) {
  const water = watershed(x, z, 92);
  if (!water) return natural;
  const { shoreDistance: d, surfaceY } = water;
  const bed = surfaceY + bedOffset(x, z, water);
  const blend = smooth((d - 32) / 60);
  // Exclude the surveyed road and settlement pads even at the feathered edge.
  const clearance = smooth((roadClearance - 28) / 15);
  return natural + (bed - natural) * (1 - blend) * clearance;
}
