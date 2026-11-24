import type { CityPlan, Street } from "./city-plan.ts";
import type { CountyPiece } from "./county-architecture.ts";

export const roadsidePlaces = [
  { id: "valley-tank", name: "Valley Water Tower", x: -640, z: -34, side: -1 },
  {
    id: "flats-elevator",
    name: "Flats Grain Elevator",
    x: -375,
    z: -916,
    side: -1,
  },
  { id: "grove-drive-in", name: "Starlight Drive-In", x: 330, z: 859, side: 1 },
] as const;

// Preserve the centerline and network junctions while tapering both shoulders
// back to the original width before reaching city streets and mountain roads.
export function surveyHighways(plan: CityPlan) {
  const valley = plan.streets.filter((s) => /^county-road-\d+$/.test(s.id));
  function widen(route: Street[], taper: number) {
    const lengths = route.map((s) =>
      Math.hypot(s.b[0] - s.a[0], s.b[2] - s.a[2]),
    );
    const total = lengths.reduce((sum, length) => sum + length, 0);
    const width = (meters: number) =>
      12 +
      7 * Math.max(0, Math.min(1, meters / taper, (total - meters) / taper));
    let meters = 0;
    for (const [i, s] of route.entries()) {
      s.endWidths = [width(meters), width(meters + lengths[i])];
      s.width = Math.max(...s.endWidths);
      meters += lengths[i];
    }
  }
  for (let i = 0; i < valley.length;) {
    let end = i;
    while (end + 1 < valley.length && valley[end].b === valley[end + 1].a)
      end++;
    widen(valley.slice(i, end + 1), 45);
    i = end + 1;
  }
  widen(
    plan.streets.filter((s) => s.id.startsWith("county-road-regional-1-")),
    95,
  );
  for (const site of roadsidePlaces) {
    const sources =
      site.id === "valley-tank"
        ? valley
        : plan.streets.filter((s) => s.id.startsWith("county-road-regional"));
    const distance = (s: Street) =>
      Math.hypot(s.a[0] - site.x, s.a[2] - site.z);
    const access = sources.reduce((best, road) =>
      distance(road) < distance(best) ? road : best,
    );
    // End at an open turning apron in front of each landmark.
    plan.streets.push({
      id: "county-road-turnout-" + site.id,
      class: "local",
      width: 9,
      a: access.a,
      b: [site.x, 0, site.z - 11 * site.side],
    });
    plan.landmarks.push({
      id: site.id,
      p: [site.x, 0, site.z],
      size: [26, 24, 12],
    });
  }
}

export function roadsideStructures() {
  const pieces: CountyPiece[] = [];
  for (const site of roadsidePlaces) {
    const add = (
      kind: string,
      piece: CountyPiece["piece"],
      x: number,
      bottom: number,
      z: number,
      w: number,
      h: number,
      d: number,
      tint: number,
    ) => {
      const box: CountyPiece = {
        buildingId: site.id,
        kind,
        piece,
        frontage: "works",
        tint,
        solid: true,
        p: [site.x + x, bottom + h / 2, site.z + z],
        s: [w, h, d],
      };
      pieces.push(box);
      return box;
    };
    // Revolved sections share triangle surfaces between hits, collision and
    // rendering. Shape names distinguish tapered roofs from straight barrels.
    const drum = (
      kind: string,
      x: number,
      bottom: number,
      r0: number,
      r1: number,
      h: number,
      tint: number,
    ) => {
      const radius = Math.max(r0, r1);
      const box = add(
        kind,
        "wall",
        x,
        bottom,
        0,
        radius * 2,
        h,
        radius * 2,
        tint,
      );
      const vertices: number[] = [],
        indices: number[] = [];
      for (const [dy, r] of [
        [0, r0],
        [h, r1],
      ]) {
        for (let i = 0; i < 16; i++) {
          const a = (i * Math.PI) / 8;
          vertices.push(
            box.p[0] + r * Math.cos(a),
            bottom + dy,
            box.p[2] + r * Math.sin(a),
          );
        }
      }
      for (let i = 0; i < 16; i++) {
        const j = (i + 1) % 16;
        indices.push(i, 16 + i, j, j, 16 + i, 16 + j);
        if (i > 0 && i < 15) indices.push(0, i, j, 16, 16 + j, 16 + i);
      }
      box.mesh = { vertices, indices };
    };
    if (site.id === "valley-tank") {
      for (const x of [-2.5, 2.5])
        for (const z of [-2.5, 2.5])
          add("tank-leg", "wall", x, -0.5, z, 0.65, 14.5, 0.65, 0x57696e);
      drum("tank-hopper", 0, 14, 3.65, 5.2, 2.5, 0x47726d);
      drum("tank-barrel", 0, 16.5, 5.2, 5.2, 5.2, 0x5b9591);
      drum("tank-cap", 0, 21.7, 5.2, 0.3, 1.9, 0xd0cabe);
    } else if (site.id === "flats-elevator") {
      for (const x of [-6.9, 6.9]) {
        drum("grain-bin", x, -0.5, 3.85, 3.85, 14.5, 0xc1bba9);
        drum("grain-cap", x, 14, 3.85, 0.35, 2.6, 0x9b624a);
      }
      add("grain-headhouse", "wall", 0, -0.5, 0, 5.8, 23, 5.6, 0xa5543e);
      add("conveyor", "roof", 0, 16.6, 0, 16, 1.15, 1.65, 0x8a8277);
      add("headhouse-cap", "roof", 0, 22.5, 0, 6.7, 1, 6.4, 0x535d64);
    } else {
      for (const x of [-8, 0, 8])
        add("screen-support", "wall", x, -0.5, 0, 0.8, 6.5, 1.1, 0x6e635b);
      add("screen-back", "wall", 0, 6, 0, 22, 10, 0.8, 0x805046);
      add("projection-surface", "wall", 0, 6.4, -0.43, 21, 9.2, 0.1, 0xe9dfc9);
      const marquee = add(
        "sign",
        "furniture",
        0,
        6.7,
        0.59,
        12,
        2.4,
        0.4,
        0xc97553,
      );
      marquee.sign = "STARLIGHT";
    }
  }
  return pieces;
}
