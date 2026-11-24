import type { Ladder } from "./rust-blockout.ts";
import type { Box, V3 } from "./world.ts";

export type Facade = "works" | "shops" | "homes" | "glass" | "civic" | "clock";
type Piece = NonNullable<Box["piece"]>;
export interface CountyPiece extends Box {
  piece: Piece;
  buildingId: string;
  frontage: Facade;
  face?: "front" | "back" | "left" | "right";
  sign?: string;
  tint?: number;
  ladder?: Ladder;
  closedDoor?: { p: V3; s: V3 };
}
export function isCountyPiece(box: Box): box is CountyPiece {
  return !!box.piece && "frontage" in box;
}

export function architectureLadders(boxes: Box[]) {
  return boxes.flatMap((box) =>
    isCountyPiece(box) && box.ladder ? [box.ladder] : [],
  );
}

interface Storey {
  x: number;
  z: number;
  w: number;
  d: number;
  base: number;
  top: number;
  style: Facade;
  frame?: "steel" | "timber";
}
interface Wing {
  dx: number;
  dz: number;
  w: number;
  d: number;
  top: number;
  floors: number;
  style: Facade;
  frame?: "steel" | "timber";
}
interface ShellOptions {
  sign?: string;
  pitch?: { bays: number; rise: number; ridge: number };
  frontPortal?: boolean;
  backPortal?: boolean;
  theatre?: boolean;
  stoop?: boolean;
  porch?: number;
  roofSign?: string;
}

// Trusses and sheaves use the same triangular surfaces for ray hits, capsule
// movement and drawing. The open spaces between steel or timber members are real.
function landmarkFrame(
  box: CountyPiece,
  wheel = false,
): NonNullable<Box["mesh"]> {
  const vertices: number[] = [],
    indices: number[] = [];
  const [x, y, z] = box.p,
    [w, h, d] = box.s;
  function beam(u0: number, v0: number, u1: number, v1: number, width: number) {
    const len = Math.hypot(u1 - u0, v1 - v0);
    const du = ((-(v1 - v0) / len) * width) / 2,
      dv = (((u1 - u0) / len) * width) / 2;
    const start = vertices.length / 3;
    for (const side of [-0.5, 0.5])
      for (const [u, v] of [
        [u0 - du, v0 - dv],
        [u1 - du, v1 - dv],
        [u1 + du, v1 + dv],
        [u0 + du, v0 + dv],
      ]) {
        if (wheel) vertices.push(x + u, y + v, z + side * d);
        else vertices.push(x - side * w, y + v, z + u);
      }
    for (const i of [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2,
      3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    ])
      indices.push(start + i);
  }
  if (wheel) {
    const r = w * 0.46;
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8,
        b = ((i + 1) * Math.PI) / 8;
      beam(
        r * Math.cos(a),
        r * Math.sin(a),
        r * Math.cos(b),
        r * Math.sin(b),
        0.28,
      );
      if (i % 2 === 0) beam(0, 0, r * Math.cos(a), r * Math.sin(a), 0.16);
    }
    for (const side of [-1, 1]) beam(side * 0.9, -h / 2 + 0.05, 0, 0, 0.22);
  } else {
    const post = box.kind === "timber-truss" ? 0.56 : 0.39;
    const zEdge = (d - post) / 2,
      hEdge = (h - post) / 2;
    for (const side of [-1, 1]) {
      beam(side * zEdge, -h / 2, side * zEdge, h / 2, post);
      beam(-zEdge, side * hEdge, zEdge, side * hEdge, post);
      beam(-zEdge, side * hEdge, zEdge, -side * hEdge, post * 0.6);
    }
  }
  return { vertices, indices };
}

// Wall panels, glass, fittings and slabs are ordinary world boxes. The same
// array therefore defines client collision, hits on the server and rendering.
export function cityLot(
  x: number,
  z: number,
  design: number,
  variation: number,
): CountyPiece[] {
  const pieces: CountyPiece[] = [];
  const tier = Math.min(2, Math.floor(variation * 3));
  const shell = (id: string, wings: Wing[], options: ShellOptions = {}) => {
    const buildingId = `${x},${z}/${id}`;
    const storeys: Storey[] = [];
    let base = 0.2;
    for (const wing of wings) {
      const h = (wing.top - base) / wing.floors;
      for (let f = 0; f < wing.floors; f++)
        storeys.push({
          x: x + wing.dx,
          z: z + wing.dz,
          w: wing.w,
          d: wing.d,
          base: base + f * h,
          top: base + (f + 1) * h,
          style: wing.style,
          frame: wing.frame,
        });
      base = wing.top;
    }

    let arriving: Ladder | undefined;
    for (const [index, room] of storeys.entries()) {
      const landing = arriving;
      const { x: cx, z: cz, w, d, base, top, style } = room;
      const thick = 0.26,
        slab = 0.2;
      const left = cx - w / 2,
        right = cx + w / 2;
      const rear = cz - d / 2,
        front = cz + d / 2;
      const ceiling = top - slab;
      const add = (piece: Piece, kind: string, p: V3, s: V3) => {
        const box: CountyPiece = {
          piece,
          kind,
          p,
          s,
          solid: true,
          buildingId,
          frontage: style,
        };
        if (piece === "door") box.closedDoor = { p: [...p], s: [...s] };
        pieces.push(box);
        return box;
      };
      // Lower storeys supply the walking surface for the next one, including
      // their accessible terraces at setbacks. Only the first needs a foundation.
      if (!index) add("floor", "foundation", [cx, base / 2, cz], [w, base, d]);

      const doorWidth = Math.min(1.85, w * 0.36);
      const doorHeight = Math.min(2.48, ceiling - base - 0.2);
      function side(
        face: NonNullable<CountyPiece["face"]>,
        entry = false,
        portal = false,
      ) {
        const alongX = face === "front" || face === "back";
        const fixed =
          face === "front"
            ? front - thick / 2
            : face === "back"
              ? rear + thick / 2
              : face === "left"
                ? left + thick / 2
                : right - thick / 2;
        const lo = alongX ? left : rear + thick;
        const hi = alongX ? right : front - thick;
        function panel(
          start: number,
          end: number,
          y0: number,
          y1: number,
          glass = false,
        ) {
          if (end - start < 0.02 || y1 - y0 < 0.02) return;
          const length = end - start,
            mid = (start + end) / 2;
          const thickness = glass ? 0.08 : thick;
          const b = add(
            glass ? "fixture" : "wall",
            glass ? "window" : "exterior",
            [alongX ? mid : fixed, (y0 + y1) / 2, alongX ? fixed : mid],
            [alongX ? length : thickness, y1 - y0, alongX ? thickness : length],
          );
          b.face = face;
        }

        if (entry || portal) {
          const openingRight = cx + doorWidth / 2;
          if (id === "kiosk") panel(openingRight, hi, base, ceiling);
          else bays(openingRight, hi);
          panel(cx - doorWidth / 2, openingRight, base + doorHeight, ceiling);
          if (!portal)
            add(
              "door",
              "entry-door",
              [cx, base + doorHeight / 2, fixed],
              [doorWidth, doorHeight, 0.13],
            );
          bays(lo, cx - doorWidth / 2);
        } else bays(lo, hi);
        function bays(lo: number, end: number) {
          // A glazed opening has its own hit volume, with a solid sill and lintel.
          // Exposed edges and wide stretches of masonry stay independently breakable.
          const span = end - lo;
          if (span < 2.2) {
            panel(lo, end, base, ceiling);
            return;
          }
          const panes = Math.max(1, Math.round(span / 8));
          for (let i = 0; i < panes; i++) {
            const start = lo + (span * i) / panes,
              stop = lo + (span * (i + 1)) / panes;
            const inset =
              style === "homes"
                ? Math.min(1.65, (stop - start) * 0.24)
                : Math.min(
                    style === "glass" ? 0.42 : 1.1,
                    (stop - start) * 0.17,
                  );
            const l = start + inset,
              r = stop - inset;
            const sill =
              base + (style === "shops" || style === "glass" ? 0.65 : 1.04);
            const head = Math.min(
              ceiling - 0.26,
              sill +
                (style === "glass"
                  ? 2.85
                  : (style === "shops" && id !== "kiosk") ||
                      style === "works" ||
                      style === "civic"
                    ? 2.2
                    : 1.7),
            );
            panel(start, l, base, ceiling);
            panel(l, r, base, sill);
            panel(l, r, sill, head, true);
            panel(l, r, head, ceiling);
            panel(r, stop, base, ceiling);
          }
        }
      }
      const prev = storeys[index - 1];
      const terraceEntry = !!prev && front < prev.z + prev.d / 2 - 1.6;
      if (room.frame) {
        // Each perimeter truss bears the deck above it. Its braces share one
        // destructible member and leave the front and rear approaches open.
        for (const px of [left + 0.23, right - 0.23]) {
          const truss = add(
            "wall",
            room.frame + "-truss",
            [px, (base + ceiling) / 2, cz],
            [0.46, ceiling - base, d],
          );
          truss.mesh = landmarkFrame(truss);
        }
      } else {
        side("front", !index || terraceEntry, !index && options.frontPortal);
        side("back", false, !index && options.backPortal);
        side("left");
        side("right");
      }

      const upper = storeys[index + 1];
      const access = !!upper || !options.pitch;
      const cover = upper ? "floor" : "roof";
      const deck = (x0: number, x1: number, z0: number, z1: number) => {
        if (x1 - x0 > 0.01 && z1 - z0 > 0.01)
          add(
            cover,
            upper ? "upper-floor" : "flat-roof",
            [(x0 + x1) / 2, top - slab / 2, (z0 + z1) / 2],
            [x1 - x0, slab, z1 - z0],
          );
      };
      let ladderX = Infinity,
        ladderZ = Infinity;
      if (access) {
        const target = upper ?? room;
        // Alternating sides leave a landing at the foot of the next flight.
        ladderX =
          target.x + (index % 2 ? -1 : 1) * Math.max(0, target.w / 2 - 1.55);
        ladderZ = target.z - target.d / 2 + 1.72;
        deck(left, ladderX - 0.92, rear, front);
        deck(ladderX + 0.92, right, rear, front);
        deck(ladderX - 0.92, ladderX + 0.92, rear, ladderZ - 0.9);
        deck(ladderX - 0.92, ladderX + 0.92, ladderZ + 0.9, front);
        const ladder = add(
          "fixture",
          "ladder",
          [ladderX, (top + base) / 2, ladderZ - 0.6],
          [0.78, top - base, 0.085],
        );
        arriving = ladder.ladder = {
          x: ladderX,
          z: ladderZ,
          bottom: base,
          get top() {
            return ladder.solid ? top : base;
          },
          exit: [ladderX, top + 0.08, ladderZ + 1.4],
        };
      } else {
        deck(left, cx, rear, front);
        deck(cx, right, rear, front);
      }

      if (!room.frame && w >= 7 && d >= 10 && !options.theatre) {
        const partitionZ = cz - 0.02 * d,
          opening = 1.56;
        const mid = (left + thick + cx - opening / 2) / 2;
        const length = cx - opening / 2 - left - thick;
        add(
          "wall",
          "partition",
          [mid, (base + ceiling) / 2, partitionZ],
          [length, ceiling - base, 0.15],
        );
        add(
          "wall",
          "partition",
          [2 * cx - mid, (base + ceiling) / 2, partitionZ],
          [length, ceiling - base, 0.15],
        );
        add(
          "door",
          "room-door",
          [cx, base + doorHeight / 2, partitionZ],
          [opening, doorHeight, 0.11],
        );
        add(
          "wall",
          "partition",
          [cx, (base + doorHeight + ceiling) / 2, partitionZ],
          [opening, ceiling - base - doorHeight, 0.15],
        );
      }
      if (!room.frame && w >= 7 && d >= 10 && !options.theatre) {
        add(
          "fixture",
          "framed-print",
          [cx - w * 0.28, base + 1.62, cz - 0.02 * d + 0.12],
          [1.25, 0.9, 0.075],
        );
      }
      const furnishing = (
        kind: string,
        px: number,
        pz: number,
        sw: number,
        sh: number,
        sd: number,
      ) => {
        // Leave the arrival shaft and the step off its lip clear on this floor
        // as well as the approach to the next flight.
        const paths = [[ladderX, ladderZ]];
        if (landing) paths.push([landing.x, landing.z]);
        if (
          paths.some(
            ([lx, lz]) =>
              Math.abs(px - lx) < sw / 2 + 0.46 &&
              pz + sd / 2 > lz - 0.45 &&
              pz - sd / 2 < lz + 1.86,
          )
        )
          return;
        add("furniture", kind, [px, base + sh / 2, pz], [sw, sh, sd]);
      };
      const lx = left + Math.min(w * 0.24, 2.35),
        rx = 2 * cx - lx;
      const near = cz + 0.26 * d,
        far = cz - 0.22 * d;
      if (room.frame) {
        if (room.frame === "steel" && !upper) {
          for (const offset of [-2.6, 2.6]) {
            const sheave = add(
              "furniture",
              "hoist-sheave",
              [cx + offset, top + 2.3, front - 1.4],
              [4.6, 4.6, 0.72],
            );
            sheave.mesh = landmarkFrame(sheave, true);
          }
        }
      } else if (options.theatre && !index) {
        for (let row = 0; row < 3; row++)
          for (const px of [cx - w * 0.24, cx + w * 0.24])
            furnishing(
              "theatre-seats",
              px,
              cz + (row - 1) * 2.45,
              w * 0.27,
              1.06,
              0.88,
            );
        add(
          "fixture",
          "screen",
          [cx, base + 3.1, rear + 0.44],
          [w * 0.62, 3.25, 0.17],
        );
      } else if (w < 6) {
        furnishing("cabinet", left + 0.67, near, 0.66, 1.28, 0.6);
      } else if (style === "homes") {
        furnishing("sofa", lx, near, 2.12, 0.98, 0.93);
        furnishing("bed", rx, far, 1.5, 0.82, 2.12);
        furnishing("cabinet", left + 0.8, far, 0.8, 1.38, 0.65);
      } else if (style === "works") {
        furnishing("workbench", lx, near, 3, 1.05, 1.18);
        furnishing("machine", rx, far, 2.4, 1.87, 1.36);
        furnishing("cabinet", rx, near, 1.25, 1.65, 0.72);
      } else if (style === "shops") {
        furnishing("counter", lx, near, Math.min(3.25, w * 0.34), 1.05, 0.93);
        furnishing("shelving", rx, far, Math.min(2.8, w * 0.27), 1.78, 0.75);
        if (w > 10) furnishing("shelving", lx, far, 2.82, 1.78, 0.75);
      } else {
        furnishing(
          style === "glass" ? "desk" : "bench",
          lx,
          near,
          Math.min(2.8, w * 0.3),
          0.88,
          0.95,
        );
        furnishing(
          style === "glass" ? "cabinet" : "lectern",
          rx,
          far,
          1.14,
          1.2,
          0.82,
        );
      }
      add(
        "fixture",
        "ceiling-light",
        [cx, ceiling - 0.055, near],
        [Math.min(1.75, w * 0.25), 0.11, 0.34],
      );
      if (!index && options.sign) {
        const h = Math.min(0.78, ceiling - base - doorHeight - 0.08);
        add(
          "fixture",
          "sign",
          [cx, base + doorHeight + 0.05 + h / 2, front + 0.08],
          [Math.min(w * 0.68, 11.4), h, 0.19],
        ).sign = options.sign;
      }
      if (!index && options.porch) {
        const width = options.porch;
        const deckDepth = 2.1,
          height = 2.95;
        add(
          "floor",
          "porch-deck",
          [cx, 0.1, front + deckDepth / 2],
          [width, 0.2, deckDepth],
        );
        for (const side of [-1, 1])
          for (const offset of [0.17, deckDepth - 0.17])
            add(
              "wall",
              "porch-column",
              [
                cx + side * (width / 2 - 0.18),
                (height + 0.2) / 2,
                front + offset,
              ],
              [0.22, height - 0.2, 0.22],
            );
        add(
          "roof",
          "porch-canopy",
          [cx, height + 0.12, front + deckDepth / 2 - 0.08],
          [width, 0.24, deckDepth + 0.16],
        );
      }
      if (!upper && options.roofSign) {
        // The letters stand on shallow curb walls at the street edge of the
        // roof, across the building from the hatch and its landing.
        const width = Math.min(11, w * 0.76),
          height = 1.8;
        const px = cx - (w - width) * 0.28,
          pz = front - 0.52;
        add(
          "wall",
          "sign-curb",
          [px, top + height / 2, pz],
          [width, height, 0.22],
        );
        add(
          "fixture",
          "sign",
          [px, top + height * 0.54, pz + 0.17],
          [width + 0.06, height * 0.92, 0.12],
        ).sign = options.roofSign;
      }
      if (!index && options.stoop)
        add("floor", "stoop", [cx, 0.095, front + 0.5], [2.48, 0.19, 1]);
    }
    if (options.pitch) {
      const { bays, rise, ridge } = options.pitch;
      const r = storeys[storeys.length - 1];
      for (let i = 0; i < bays; i++) {
        const w = r.w / bays,
          l = r.x - r.w / 2 + w * i,
          peak = l + w * ridge,
          f = r.z + r.d / 2,
          b = r.z - r.d / 2,
          t = r.top;
        pieces.push({
          p: [l + w / 2, t + rise / 2, r.z],
          s: [w, rise, r.d],
          piece: "roof",
          kind: "county-roof",
          buildingId,
          frontage: r.style,
          solid: true,
          mesh: {
            vertices: [
              l,
              t,
              f,
              l + w,
              t,
              f,
              peak,
              t + rise,
              f,
              l,
              t,
              b,
              l + w,
              t,
              b,
              peak,
              t + rise,
              b,
            ],
            indices: [
              0, 1, 2, 5, 4, 3, 0, 2, 5, 0, 5, 3, 2, 1, 4, 2, 4, 5, 0, 3, 4, 0,
              4, 1,
            ],
          },
        });
      }
    }
  };
  const wing = (
    dx: number,
    dz: number,
    w: number,
    d: number,
    top: number,
    floors: number,
    style: Facade,
  ): Wing => ({ dx, dz, w, d, top, floors, style });
  switch (design) {
    case 0:
      shell("works", [wing(-3, 0, 23, 23, 8, 2, "works")], {
        sign: "IRONWORKS",
        pitch: { bays: 3, rise: 3.7, ridge: 0.86 },
      });
      shell("boiler", [wing(11, -3, 4.6, 5, 21 + tier * 2, 4, "works")]);
      break;
    case 1:
      for (let i = 0; i < 3; i++) {
        const h = 7 + ((tier + i) % 3) * 2;
        shell(
          "house-" + i,
          [wing((i - 1) * 9.2, 0, 8.8, 15 + i, h, 2, "homes")],
          { stoop: true, pitch: { bays: 1, rise: 3.8, ridge: 0.5 } },
        );
      }
      break;
    case 2:
      shell(
        "market",
        [
          wing(0, 0, 29, 23, 4.8, 1, "shops"),
          wing(-6, -3, 15, 15, 16 + 4 * tier, 3 + tier, "homes"),
        ],
        { sign: variation > 0.5 ? "CENTRAL MARKET" : "ARCADE" },
      );
      break;
    case 3:
      shell("cinema", [wing(0, 8, 23, 7, 6.5, 1, "shops")], {
        roofSign: "CINEMA",
        backPortal: true,
      });
      shell(
        "cinema",
        [
          wing(0, -4, 25, 17, 12, 2, "civic"),
          wing(-6, -6, 9, 10, 18 + tier, 1, "civic"),
        ],
        { frontPortal: true, theatre: true },
      );
      break;
    case 4: {
      const h = 27 + tier * 10;
      shell(
        "exchange",
        [
          wing(0, 0, 28, 24, 7, 1, "shops"),
          wing(2, -1, 18, 17, h, 5 + tier * 2, "glass"),
          wing(2, -2, 13, 12, h + 6, 1, "glass"),
        ],
        { sign: "EXCHANGE" },
      );
      break;
    }
    case 5:
      shell("hall", [wing(-4, 0, 19, 22, 9, 2, "civic")], {
        sign: "TOWN HALL",
        pitch: { bays: 1, rise: 4, ridge: 0.5 },
      });
      shell("clock", [
        wing(9, 5, 7, 8, 18, 4, "civic"),
        wing(9, 5, 7, 8, 24, 1, "clock"),
      ]);
      break;
    case 7:
      for (let i = 0; i < 2; i++) {
        const depth = i ? 12 : 15;
        shell(
          "bungalow-" + i,
          [
            wing(
              i ? 7.7 : -7.3,
              i ? 3 : -3,
              i ? 11 : 12.8,
              depth,
              3.6 + ((tier + i) % 2) * 0.6,
              1,
              "homes",
            ),
          ],
          {
            porch: i ? 5.6 : 8.4,
            pitch: { bays: 1, rise: i ? 2.7 : 2.15, ridge: 0.5 },
          },
        );
      }
      break;
    case 8:
      // An L-shaped motor court around a drive-in forecourt. The reception
      // and guest wing have independent front doors and a covered walkway.
      shell("motor-lodge", [wing(0, -6.8, 26, 8.8, 7.8, 2, "homes")], {
        roofSign: "PALM MOTOR LODGE",
        porch: 25,
      });
      shell("reception", [wing(-9.2, 5, 7.6, 9.2, 4, 1, "shops")], {
        sign: "OFFICE",
      });
      break;
    case 9: {
      shell("service-station", [wing(-3, -6.5, 21, 9.8, 4.2, 1, "shops")], {
        sign: "SUNSET GAS",
      });
      const add = (
        piece: Piece,
        kind: string,
        px: number,
        py: number,
        pz: number,
        w: number,
        h: number,
        d: number,
      ) =>
        pieces.push({
          piece,
          kind,
          p: [x + px, py, z + pz],
          s: [w, h, d],
          solid: true,
          frontage: "shops",
          buildingId: pieces[0].buildingId,
        });
      // Two pump islands leave a central drive lane beneath the flat canopy.
      for (const px of [-6.1, 6.1]) {
        add("floor", "pump-island", px, 0.09, 6.8, 1.6, 0.18, 6.7);
        add("wall", "pump-column", px, 2.44, 6.8, 0.46, 4.52, 0.46);
        for (const pz of [4.85, 8.75])
          add("furniture", "gas-pump", px, 1.09, pz, 0.93, 1.82, 0.68);
      }
      add("roof", "station-canopy", 0, 5, 6.8, 20, 0.6, 9.6);
      break;
    }
    case 11:
      shell(
        "ore-headframe",
        [
          wing(0, 0, 22.8, 17.6, 4.8, 1, "works"),
          { ...wing(1.6, -0.8, 13.6, 11.4, 17.2, 2, "works"), frame: "steel" },
          { ...wing(1.6, -0.8, 10.8, 8.6, 23.4, 1, "works"), frame: "steel" },
        ],
        { sign: "MESA ORE HOIST" },
      );
      break;
    case 12:
      shell(
        "fire-lookout",
        [
          wing(0, 0, 11.6, 12.4, 3.8, 1, "homes"),
          { ...wing(0, 0, 9.6, 10, 21.8, 3, "homes"), frame: "timber" },
          wing(0, -0.3, 8.6, 8.8, 25.4, 1, "glass"),
        ],
        {
          sign: "LAUREL FIRE LOOKOUT",
          pitch: { bays: 1, rise: 2.75, ridge: 0.5 },
        },
      );
      break;
    case 15:
      shell(
        "meridian-building",
        [
          wing(0, 0, 28, 24, 9, 2, "civic"),
          wing(0, -0.3, 22, 19, 39, 7, "civic"),
          wing(0, -0.5, 15.5, 15, 51, 3, "civic"),
          wing(0, -1, 10.5, 11, 59, 1, "clock"),
          wing(0, -1, 6.5, 7, 65, 1, "civic"),
        ],
        { sign: "MERIDIAN BUILDING" },
      );
      break;
    case 16:
      shell(
        "bank-tower",
        [
          wing(0, 0, 27, 22, 8.8, 2, "shops"),
          wing(-1.2, 0, 21, 17, 43, 8, "glass"),
          wing(1.5, -1.5, 15, 13, 62, 4, "glass"),
          wing(4, -2, 9.5, 10, 72, 2, "glass"),
        ],
        { sign: "EASTBANK TRUST" },
      );
      break;
    case 13: {
      // Independent shop doors and upper flats line the same pedestrian frontage.
      const names = [
        ["BAKERY", "BOOKS"],
        ["HARDWARE", "FLORIST"],
        ["RECORDS", "COFFEE"],
      ];
      for (const [i, storefront] of names[tier].entries()) {
        const dx = i ? 6.9 : -6.9;
        shell(
          "shop-flat-" + i,
          [
            wing(dx, 0, 13.2, 18, 4.4, 1, "shops"),
            wing(dx, -0.5, 13.2, 17, 11.6 + ((tier + i) % 3), 2, "homes"),
          ],
          { sign: storefront },
        );
      }
      break;
    }
    case 14:
      shell("ranch-house", [wing(-2, -3, 14, 12, 3.9, 1, "homes")], {
        porch: 7.4,
        pitch: { bays: 1, rise: 2.7 + tier * 0.25, ridge: 0.5 },
      });
      break;
    case 10:
      shell(
        "pacific-court",
        [
          wing(0, -1, 25.4, 18, 4.1, 1, "shops"),
          wing(-1.8, -2.5, 20.5, 13.5, 11.8 + 3.8 * tier, 2 + tier, "homes"),
        ],
        { roofSign: "PACIFIC COURT", porch: 18.8 },
      );
      break;
    default:
      shell("kiosk", [wing(-7, -5, 9, 8, 3.8, 1, "shops")], { sign: "KIOSK" });
  }
  return pieces;
}
