import * as T from "three";
import { randomSeed } from "./world.ts";

// A single opaque mesh per silhouette. Leaflets are folded along their midrib
// so they catch sunlight on opposite faces without alpha sorting or overdraw.
export function palmGeometry(distant = false) {
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  const rng = randomSeed("county-date-palm");
  function point(x: number, y: number, z: number, color: T.Color) {
    colors.push(color.r, color.g, color.b);
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  }
  const bark = new T.Color();
  const rings = distant ? 3 : 24;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings,
      r = (0.23 - 0.085 * t) * (j % 2 ? 1.09 : 1);
    bark.setHex(j % 2 ? 0x998776 : 0x766b60);
    for (let i = 0; i < 9; i++) {
      const a = (i * Math.PI * 2) / 9;
      point(0.35 * t * t + r * Math.cos(a), 6.8 * t, r * Math.sin(a), bark);
      if (j) {
        const lo = (j - 1) * 9 + i,
          next = (j - 1) * 9 + ((i + 1) % 9);
        indices.push(lo, lo + 9, next, next, lo + 9, next + 9);
      }
    }
  }
  for (let k = 0; k < 14; k++) {
    const a = k * 2.39996,
      dx = Math.cos(a),
      dz = Math.sin(a),
      len = 2.55 + rng() * 1.1;
    const lift = k < 9 ? 1.1 + rng() * 0.45 : 2.2 + rng() * 0.5,
      sag = k < 9 ? 2.45 : 2.0;
    const leaf = new T.Color().setHex(
      [0x477156, 0x628361, 0x698751, 0x366b55][k % 4],
    );
    // At this scale a folded blade preserves each arching frond silhouette.
    if (distant) {
      const start = point(0.35, 6.77, 0, leaf);
      const middle = point(
        0.35 + dx * len * 0.53,
        6.77 + lift * 0.8,
        dz * len * 0.53,
        leaf,
      );
      const left = point(
        0.35 + dx * len * 0.53 - dz * 0.55,
        6.46 + lift * 0.65,
        dz * len * 0.53 + dx * 0.55,
        leaf,
      );
      const right = point(
        0.35 + dx * len * 0.53 + dz * 0.55,
        6.46 + lift * 0.65,
        dz * len * 0.53 - dx * 0.55,
        leaf,
      );
      const tip = point(
        0.35 + dx * len,
        6.77 + lift * 0.81 - sag,
        dz * len,
        leaf,
      );
      indices.push(
        start,
        left,
        middle,
        start,
        middle,
        right,
        left,
        tip,
        middle,
        middle,
        tip,
        right,
      );
      continue;
    }
    let lastA = 0,
      lastB = 0;
    for (let j = 0; j <= 16; j++) {
      const t = j / 16,
        along = t * len,
        x = 0.35 + dx * along,
        z = dz * along,
        y = 6.77 + lift * Math.sin(t * Math.PI * 0.7) - sag * t * t;
      const a0 = point(x - dz * 0.025, y, z + dx * 0.025, leaf),
        b0 = point(x + dz * 0.025, y, z - dx * 0.025, leaf);
      if (j) indices.push(lastA, a0, b0, lastA, b0, lastB);
      lastA = a0;
      lastB = b0;
      if (!j) continue;
      for (const side of [-1, 1]) {
        const span =
          (0.16 + 0.69 * Math.sin(Math.PI * Math.pow(t, 0.8))) * side;
        const f = 0.32 + 0.23 * t,
          tip = point(
            x + dx * f - dz * span,
            y - 0.22 - 0.45 * Math.abs(span),
            z + dz * f + dx * span,
            leaf,
          );
        const root = point(x - dx * 0.11, y, z - dz * 0.11, leaf);
        const ridge = point(
          x + dx * 0.11 - dz * span * 0.48,
          y - 0.045,
          z + dz * 0.11 + dx * span * 0.48,
          leaf,
        );
        const heel = point(x + dx * 0.13, y - 0.05, z + dz * 0.13, leaf);
        indices.push(root, ridge, tip, ridge, heel, tip);
      }
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
