import * as T from "three";
import type { Street } from "./city-plan.ts";
import { alongStreet, ruralRoad } from "./county-plan.ts";
import type { V3 } from "./world.ts";

// The shoulders, crossings, light poles and lanes all use the same surveyed
// centerlines as parked vehicles and pedestrian navigation.
export function drawCountyRoads(
  group: T.Group,
  streets: Street[],
  textures: { asphalt: T.Texture; concrete: T.Texture },
) {
  const shoulders: number[] = [],
    asphalt: number[] = [],
    paint: number[] = [],
    center: number[] = [];
  const junctions = new Map<
    string,
    { p: V3; arms: Street[]; width: number; urban: boolean }
  >();
  for (const street of streets)
    for (const p of [street.a, street.b]) {
      const key = p.join(",");
      const existing = junctions.get(key);
      if (existing) {
        existing.arms.push(street);
        existing.width = Math.max(existing.width, street.width);
        existing.urban ||= !ruralRoad(street);
      } else
        junctions.set(key, {
          p,
          arms: [street],
          width: street.width,
          urban: !ruralRoad(street),
        });
    }
  function strip(
    out: number[],
    s: Street,
    from: number,
    to: number,
    left: number,
    right: number,
    y: number,
  ) {
    const a = alongStreet(s, from, left),
      b = alongStreet(s, to, left),
      c = alongStreet(s, to, right),
      d = alongStreet(s, from, right);
    for (const p of [a, b, c, a, c, d]) out.push(p[0], y, p[2]);
  }
  function circle(out: number[], p: V3, r: number, y: number) {
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8,
        b = ((i + 1) * Math.PI) / 8;
      out.push(
        p[0],
        y,
        p[2],
        p[0] + Math.cos(b) * r,
        y,
        p[2] + Math.sin(b) * r,
        p[0] + Math.cos(a) * r,
        y,
        p[2] + Math.sin(a) * r,
      );
    }
  }
  const lamps: V3[] = [];
  for (const s of streets) {
    const rural = ruralRoad(s),
      half = s.width / 2;
    const len = Math.hypot(s.a[0] - s.b[0], s.a[2] - s.b[2]);
    const start = junctions.get(s.a.join(","))!,
      finish = junctions.get(s.b.join(","))!;
    const clipped = (j: typeof start) =>
      j.arms.length > 2 ? j.width / 2 + 1 : 0;
    const from = clipped(start),
      to = len - clipped(finish);
    const shoulder = rural ? 0.85 : s.width >= 11 ? 2.25 : 1.45;
    strip(shoulders, s, 0, 1, half + shoulder, -half - shoulder, 0.035);
    strip(asphalt, s, 0, 1, half, -half, 0.048);
    if (s.class === "arterial") {
      const gap = 0.13;
      for (const offset of [-gap, gap])
        strip(
          center,
          s,
          from / len,
          to / len,
          offset + 0.055,
          offset - 0.055,
          0.059,
        );
      if (rural)
        for (const side of [-1, 1]) {
          const offset = side * (half - 0.6);
          strip(
            paint,
            s,
            from / len,
            to / len,
            offset + 0.065,
            offset - 0.065,
            0.06,
          );
        }
    } else if (s.width >= 10) {
      for (let distance = from + 3; distance + 3 < to; distance += 9)
        strip(
          paint,
          s,
          distance / len,
          (distance + 3) / len,
          0.085,
          -0.085,
          0.06,
        );
    }
    if (rural) continue;
    // Painted crossings belong to junctions on the main shopping streets.
    for (const [junction, direction] of [
      [start, 1],
      [finish, -1],
    ] as const) {
      if (
        junction.arms.length < 3 ||
        !junction.arms.some((arm) => arm.class === "arterial")
      )
        continue;
      const distance = junction.width / 2 + 2.5;
      const t = direction === 1 ? distance / len : 1 - distance / len;
      for (let offset = -half + 1; offset < half - 0.5; offset += 1.13)
        strip(
          paint,
          s,
          t - 1.1 / len,
          t + 1.1 / len,
          offset + 0.24,
          offset - 0.24,
          0.065,
        );
    }
    if (s.width >= 10) {
      lamps.push(alongStreet(s, 0.24, half + 1));
      if (s.class === "arterial") lamps.push(alongStreet(s, 0.74, -half - 1));
    }
  }
  for (const { p, width, urban } of junctions.values()) {
    circle(shoulders, p, width / 2 + (urban ? 1.45 : 0.85), 0.035);
    circle(asphalt, p, width / 2, 0.048);
  }
  for (const [positions, tint] of [
    [shoulders, 0xffffff],
    [asphalt, 0xffffff],
    [paint, 0xfbf9f1],
    [center, 0xe5b45b],
  ] as const) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(positions, 3),
    );
    const map =
      positions === asphalt
        ? textures.asphalt
        : positions === shoulders
          ? textures.concrete
          : null;
    if (map) {
      const uv: number[] = [];
      for (let i = 0; i < positions.length; i += 3)
        uv.push(positions[i] * 0.23, positions[i + 2] * 0.23);
      geometry.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    }
    const normals = new Float32Array(positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute("normal", new T.BufferAttribute(normals, 3));
    const mesh = new T.Mesh(
      geometry,
      new T.MeshLambertMaterial({ color: tint, map }),
    );
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return lamps;
}
