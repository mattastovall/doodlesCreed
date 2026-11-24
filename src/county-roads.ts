import * as T from "three";
import type { Street } from "./city-plan.ts";
import { alongStreet, ruralRoad, terrainHeight } from "./county-plan.ts";
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
      const width = street.endWidths?.[p === street.a ? 0 : 1] ?? street.width;
      const existing = junctions.get(key);
      if (existing) {
        existing.arms.push(street);
        existing.width = Math.max(existing.width, width);
        existing.urban ||= !ruralRoad(street);
      } else
        junctions.set(key, {
          p,
          arms: [street],
          width,
          urban: !ruralRoad(street),
        });
    }
  // Regional grades change at terrain grid rows. Split painted surfaces at
  // those rows so the asphalt, shoulder and lines sit on the collision mesh.
  function pavedPolygon(
    out: number[],
    points: V3[],
    offset: number,
    graded: boolean,
  ) {
    function emit(poly: V3[]) {
      for (let i = 2; i < poly.length; i++)
        for (const p of [poly[0], poly[i - 1], poly[i]])
          out.push(
            p[0],
            offset + (graded ? terrainHeight(p[0], p[2]) : p[1]),
            p[2],
          );
    }
    if (!graded) {
      emit(points);
      return;
    }
    let polygon = points;
    const zs = points.map((p) => p[2]),
      end = Math.max(...zs);
    for (
      let z = (Math.floor(Math.min(...zs) / 20) + 1) * 20;
      z < end;
      z += 20
    ) {
      const below: V3[] = [],
        above: V3[] = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i],
          b = polygon[(i + 1) % polygon.length];
        if (a[2] <= z) below.push(a);
        if (a[2] >= z) above.push(a);
        if ((a[2] < z && b[2] > z) || (a[2] > z && b[2] < z)) {
          const t = (z - a[2]) / (b[2] - a[2]);
          const p: V3 = [a[0] + (b[0] - a[0]) * t, 0, z];
          below.push(p);
          above.push(p);
        }
      }
      emit(below);
      polygon = above;
    }
    emit(polygon);
  }
  function strip(
    out: number[],
    s: Street,
    from: number,
    to: number,
    left: number,
    right: number,
    y: number,
    leftEnd = left,
    rightEnd = right,
  ) {
    const a = alongStreet(s, from, left),
      b = alongStreet(s, to, leftEnd),
      c = alongStreet(s, to, rightEnd),
      d = alongStreet(s, from, right);
    pavedPolygon(out, [a, b, c, d], y, s.id.startsWith("county-road-regional"));
  }
  function circle(out: number[], p: V3, r: number, y: number, graded: boolean) {
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8,
        b = ((i + 1) * Math.PI) / 8;
      pavedPolygon(
        out,
        [
          p,
          [p[0] + Math.cos(b) * r, p[1], p[2] + Math.sin(b) * r],
          [p[0] + Math.cos(a) * r, p[1], p[2] + Math.sin(a) * r],
        ],
        y,
        graded,
      );
    }
  }
  const lamps: V3[] = [];
  const routeStation = new Map<string, number>();
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
    const station = routeStation.get(s.a.join(",")) ?? 0;
    if (s.endWidths) routeStation.set(s.b.join(","), station + len);
    const shoulder = rural ? 0.85 : s.width >= 11 ? 2.25 : 1.45;
    const [widthA, widthB] = s.endWidths ?? [s.width, s.width];
    const halfWidth = (t: number) => (widthA + (widthB - widthA) * t) / 2;
    strip(
      shoulders,
      s,
      0,
      1,
      widthA / 2 + shoulder,
      -widthA / 2 - shoulder,
      0.035,
      widthB / 2 + shoulder,
      -widthB / 2 - shoulder,
    );
    strip(
      asphalt,
      s,
      0,
      1,
      widthA / 2,
      -widthA / 2,
      0.048,
      widthB / 2,
      -widthB / 2,
    );
    function stripe(
      out: number[],
      start: number,
      finish: number,
      lateral: (t: number) => number,
      radius: number,
      height: number,
    ) {
      const a = start / len,
        b = finish / len;
      strip(
        out,
        s,
        a,
        b,
        lateral(a) + radius,
        lateral(a) - radius,
        height,
        lateral(b) + radius,
        lateral(b) - radius,
      );
    }
    if (s.class === "arterial" && to > from) {
      for (const side of [-1, 1]) {
        const median = (t: number) =>
          side * (0.13 + (s.endWidths ? (halfWidth(t) - 6) * 0.26 : 0));
        stripe(center, from, to, median, 0.055, 0.059);
        if (rural)
          stripe(
            paint,
            from,
            to,
            (t) => side * (halfWidth(t) - 0.6),
            0.065,
            0.06,
          );
        if (s.endWidths) {
          // The added outside lane opens from the shoulder as pavement widens.
          for (
            let dash = Math.floor((station + from) / 9) * 9 - station;
            dash < to;
            dash += 9
          ) {
            const meters = Math.max(from, dash),
              finish = Math.min(to, dash + 3);
            if (finish <= meters || halfWidth(meters / len) < 6.8) continue;
            stripe(
              paint,
              meters,
              finish,
              (t) => side * (5.4 - (halfWidth(t) - 6) * 0.12),
              0.08,
              0.06,
            );
          }
        }
      }
      if (s.endWidths) {
        // Diagonal hatching widens with the painted median. It stops at every
        // turnout so both directions can enter and leave without a barrier.
        for (
          let d = Math.ceil((station + from + 1.2) / 5) * 5 - station;
          d + 1.2 < to;
          d += 5
        ) {
          const spread = (halfWidth(d / len) - 6) * 0.26;
          if (spread < 0.4) continue;
          strip(
            paint,
            s,
            (d - 1) / len,
            (d + 1) / len,
            -spread + 0.08,
            -spread - 0.08,
            0.06,
            spread + 0.08,
            spread - 0.08,
          );
        }
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
  for (const { p, width, urban, arms } of junctions.values()) {
    const graded = arms.some((s) => s.id.startsWith("county-road-regional"));
    circle(shoulders, p, width / 2 + (urban ? 1.45 : 0.85), 0.035, graded);
    circle(asphalt, p, width / 2, 0.048, graded);
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
