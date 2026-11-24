import * as T from "three";
import type { CountyPiece, Facade } from "./county-architecture.ts";
import type { Box, PieceState, V3 } from "./world.ts";

const ink = 0x475a82,
  slate = 0x8295ad,
  linen = 0xe9e8dd,
  white = 0xf8f7eb;
const wood = 0xb1a999;
function tile(
  draw: (c: CanvasRenderingContext2D) => void,
  transparent = false,
  w = 128,
  h = 128,
) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  return new T.MeshLambertMaterial({
    map,
    vertexColors: true,
    transparent,
    depthWrite: !transparent,
  });
}
function surface(style: Facade) {
  return tile((c) => {
    c.fillStyle = style === "glass" ? "#b3bfce" : "#f1efe3";
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = style === "glass" ? "#9aa9bf" : "#d9dacf";
    if (style === "works" || style === "civic") {
      const course = style === "works" ? 16 : 32;
      for (let y = 0; y < 128; y += course) {
        c.fillRect(0, y, 128, 1);
        for (let x = ((y / course) % 2) * 32; x < 128; x += 64)
          c.fillRect(x, y, 1, course);
      }
    } else if (style === "homes") {
      for (let y = 8; y < 128; y += 16) c.fillRect(0, y, 128, 2);
    }
    c.fillStyle = "#c5c9cb";
    c.fillRect(0, 123, 128, 5);
    c.fillStyle = "#fffdf0";
    c.fillRect(0, 1, 128, 3);
  });
}
// Continuous world-space planks and tiles carry across the separate slabs
// around a hatch. Their physical scale stays fixed across different floor sizes.
function flooring(planks: boolean) {
  const mat = tile((c) => {
    c.fillStyle = planks ? "#dfd7c5" : "#e3e4dc";
    c.fillRect(0, 0, 128, 128);
    const rows = planks ? 8 : 4;
    for (let i = 0; i < rows; i++) {
      const y = (i * 128) / rows,
        shift = planks ? (i * 47) % 128 : 0;
      c.fillStyle =
        i % 3 === 0 ? "rgba(119,126,135,.07)" : "rgba(255,251,229,.12)";
      c.fillRect(0, y, 128, 128 / rows);
      c.fillStyle = planks ? "#b8b4a5" : "#bcc4c5";
      c.fillRect(0, y, 128, 1);
      for (let x = shift; x < 128; x += planks ? 128 : 32)
        c.fillRect(x, y, 1, 128 / rows);
      if (planks) {
        c.fillStyle = "rgba(128,125,107,.14)";
        c.fillRect((i * 13) % 60, y + 5, 34, 0.7);
      }
    }
  });
  mat.map!.wrapS = mat.map!.wrapT = T.RepeatWrapping;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>",
      "#include <uv_vertex>\nvMapUv = (instanceMatrix * vec4(position, 1.0)).xz * 0.52;",
    );
  };
  return mat;
}
function wallPrint(house: boolean) {
  return tile((c) => {
    c.fillStyle = "#65748c";
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = "#f2efdf";
    c.fillRect(3, 3, 122, 122);
    c.fillStyle = house ? "#c1d0ce" : "#7f98b0";
    c.fillRect(11, 12, 106, 94);
    if (house) {
      c.fillStyle = "#ede8ca";
      c.beginPath();
      c.arc(88, 32, 10, 0, Math.PI * 2);
      c.fill();
      for (const [height, shade] of [
        [54, "#9aabb6"],
        [76, "#758b9b"],
        [90, "#637889"],
      ] as const) {
        c.fillStyle = shade;
        c.beginPath();
        c.moveTo(11, 106);
        for (let i = 0; i <= 106; i += 2)
          c.lineTo(11 + i, height + 8 * Math.sin(i / 19 + height / 6));
        c.lineTo(117, 106);
        c.fill();
      }
    } else {
      c.strokeStyle = "#dce6e4";
      c.lineWidth = 1.5;
      for (const [x, y, w, h] of [
        [21, 22, 84, 72],
        [27, 29, 30, 24],
        [66, 29, 31, 20],
        [27, 62, 46, 23],
        [79, 61, 18, 23],
      ])
        c.strokeRect(x, y, w, h);
    }
    c.fillStyle = "#8994a1";
    c.fillRect(42, 113, 44, 1.5);
  });
}
function glazing(style: Facade) {
  return tile((c) => {
    const fill = (
      x: number,
      y: number,
      w: number,
      h: number,
      colour: string,
    ) => {
      c.fillStyle = colour;
      c.fillRect(x, y, w, h);
    };
    const sky = c.createLinearGradient(0, 0, 0, 128);
    sky.addColorStop(0, "rgba(56,109,147,.66)");
    sky.addColorStop(0.52, "rgba(147,187,202,.45)");
    sky.addColorStop(0.7, "rgba(245,206,168,.48)");
    sky.addColorStop(1, "rgba(58,94,115,.36)");
    c.fillStyle = sky;
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = "rgba(231,244,246,.27)";
    c.beginPath();
    c.moveTo(12, 0);
    c.lineTo(62, 0);
    c.lineTo(2, 89);
    c.lineTo(2, 15);
    c.fill();
    if (style === "clock") {
      for (const [radius, colour] of [
        [49, "#687994"],
        [45, "#f5f1dc"],
      ] as const) {
        c.fillStyle = colour;
        c.beginPath();
        c.arc(64, 64, radius, 0, Math.PI * 2);
        c.fill();
      }
      c.save();
      c.translate(64, 64);
      for (let i = 0; i < 12; i++) {
        c.rotate(Math.PI / 6);
        fill(-1, -41, 2, 6, "#455675");
      }
      fill(-2, -31, 4, 32, "#455675");
      c.rotate(1.9);
      fill(-2, -24, 4, 25, "#455675");
      c.restore();
    } else {
      const panes = style === "works" ? 5 : style === "glass" ? 2 : 3;
      for (let i = 1; i < panes; i++)
        fill((128 * i) / panes - 0.85, 0, 1.7, 128, "#6c7c99");
      fill(0, style === "civic" ? 38 : 46, 128, 2.5, "#798ba1");
    }
    fill(0, 0, 128, 4, "#5d7292");
    fill(0, 0, 2.5, 128, "#6d809a");
    fill(125.5, 0, 2.5, 128, "#6d809a");
    fill(0, 123, 128, 5, "#798ba1");
  }, true);
}
function doorTile(interior: boolean) {
  return tile((c) => {
    const fill = (
      x: number,
      y: number,
      w: number,
      h: number,
      colour: string,
    ) => {
      c.fillStyle = colour;
      c.fillRect(x, y, w, h);
    };
    fill(0, 0, 128, 128, "#536780");
    fill(4, 3, 120, 122, interior ? "#b3ad9f" : "#859aaf");
    fill(12, 10, 104, 62, "#677b91");
    fill(16, 13, 96, 55, interior ? "#c9c3b3" : "#c1d1d8");
    if (!interior) {
      fill(62, 13, 3, 55, "#7e91a6");
      fill(16, 39, 96, 2, "#7e91a6");
    }
    for (const x of [12, 68]) {
      fill(x, 82, 48, 35, "#6f8092");
      fill(x + 3, 84, 42, 29, interior ? "#bab5a6" : "#9aacbb");
    }
    fill(104, 71, 9, 13, "#4d607c");
    fill(94, 75, 18, 3, "#f3f1d8");
  });
}
function signTile(name: string) {
  return tile(
    (c) => {
      const marquees: Record<string, string> = {
        CINEMA: "#8c303e",
        "SUNSET GAS": "#bf4a29",
        "PALM MOTOR LODGE": "#2f817b",
        "PACIFIC COURT": "#467887",
        OFFICE: "#3f7d75",
        IRONWORKS: "#675446",
      };
      c.fillStyle = marquees[name] ?? "#34485c";
      c.fillRect(0, 0, 512, 64);
      c.fillStyle = "#eeeede";
      c.fillRect(5, 3, 502, 2);
      c.fillRect(5, 59, 502, 2);
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.font = "bold 39px sans-serif";
      c.fillText(name, 256, 33, 480);
    },
    false,
    512,
    64,
  );
}

function shadeFaces(geometry: T.BufferGeometry) {
  const normals = geometry.getAttribute("normal");
  const colors: number[] = [];
  for (let i = 0; i < normals.count; i++) {
    const light =
      normals.getY(i) * 0.7 - normals.getX(i) * 0.42 + normals.getZ(i) * 0.28;
    const shade =
      light > 0.45 ? 1 : light > 0 ? 0.97 : light > -0.45 ? 0.93 : 0.88;
    colors.push(shade, shade, Math.min(1, shade + 0.04));
  }
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  return geometry;
}
function pieceGeometry(box: CountyPiece) {
  const shape = box.mesh!,
    positions: number[] = [];
  for (const index of shape.indices)
    for (let a = 0; a < 3; a++)
      positions.push((shape.vertices[index * 3 + a] - box.p[a]) / box.s[a]);
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return shadeFaces(geo);
}

interface Part {
  box: CountyPiece;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  tint: number;
  facing?: CountyPiece["face"] | "top";
}
interface Batch {
  center: [number, number];
  far: boolean;
  geometry: T.BufferGeometry;
  material: T.MeshLambertMaterial;
  parts: Part[];
}
interface Binding {
  mesh: T.InstancedMesh;
  initial: Float32Array;
  index: number;
}

export function countyBuildings(group: T.Group, pieces: CountyPiece[]) {
  const cube = shadeFaces(new T.BoxGeometry());
  const geometries = new Map([["box", cube as T.BufferGeometry]]);
  geometries.set("elevation", shadeFaces(new T.PlaneGeometry()));
  const materials = new Map([
    ["plain", new T.MeshLambertMaterial({ vertexColors: true })],
  ]);
  const batches = new Map<string, Batch>();
  const refs = new Map<CountyPiece, Binding[]>();
  function material(key: string, build: () => T.MeshLambertMaterial) {
    if (!materials.has(key)) materials.set(key, build());
    return key;
  }
  const buildings = new Map<
    string,
    { wall: number; roof: number; trim: number; district: [number, number] }
  >();
  const finishes: Record<Facade, number[][]> = {
    homes: [
      [0xffe8c3, 0xb86548, 0x61877e],
      [0xf0ba9e, 0x985447, 0xf7dec1],
      [0xc0d6bc, 0x766859, 0xfaeaca],
      [0xdfc49e, 0xa35b3e, 0x577c7e],
    ],
    works: [
      [0xca9979, 0x707b7d, 0x87523d],
      [0xc9beb1, 0x677476, 0x93765c],
    ],
    shops: [
      [0xf4d9ae, 0x9b8472, 0x408f86],
      [0xffcbac, 0x987e74, 0xb95448],
      [0xddd7b9, 0x857e78, 0x47748d],
    ],
    glass: [[0xb5ccd4, 0x688195, 0x647c8e]],
    civic: [[0xe6d3ad, 0xa17762, 0xaf8457]],
    clock: [[0xd0cbb4, 0x7b8988, 0xb49a6e]],
  };
  for (const box of pieces) {
    let building = buildings.get(box.buildingId);
    if (!building) {
      let hash = 0;
      for (const char of box.buildingId)
        hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
      const palette = finishes[box.frontage];
      const [wall, roof, trim] = palette[(hash >>> 0) % palette.length];
      building = {
        wall,
        roof,
        trim,
        district: [Math.floor(box.p[0] / 88), Math.floor(box.p[2] / 88)],
      };
      buildings.set(box.buildingId, building);
    }
    const { wall, roof, trim, district } = building;
    const shape = box.closedDoor ?? box;
    const [x, y, z] = shape.p,
      [w, h, d] = shape.s;
    function part(
      tint: number,
      px = x,
      py = y,
      pz = z,
      sw = w,
      sh = h,
      sd = d,
      mat = "plain",
      geo = "box",
      far = false,
      facing?: Part["facing"],
    ) {
      const key = district + "/" + mat + "/" + geo + "/" + far;
      let batch = batches.get(key);
      if (!batch) {
        batch = {
          center: [(district[0] + 0.5) * 88, (district[1] + 0.5) * 88],
          far,
          geometry: geometries.get(geo)!,
          material: materials.get(mat)!,
          parts: [],
        };
        batches.set(key, batch);
      }
      batch.parts.push({
        box,
        x: px,
        y: py,
        z: pz,
        w: sw,
        h: sh,
        d: sd,
        tint,
        facing,
      });
    }
    // Furniture components use normalized coordinates within their gameplay
    // bounds, so edges, legs and fittings disappear with the object that owns them.
    function detail(
      tint: number,
      a: number,
      b: number,
      c: number,
      sw: number,
      sh: number,
      sd: number,
    ) {
      part(tint, x + a * w, y + b * h, z + c * d, sw * w, sh * h, sd * d);
    }
    function legs() {
      for (const a of [-0.42, 0.42])
        for (const c of [-0.39, 0.39])
          detail(ink, a, -0.07, c, 0.065, 0.86, 0.11);
    }
    if (box.mesh) {
      const key =
        box.kind === "county-roof"
          ? "pitch-" + box.frontage
          : box.kind + "-" + box.s.map((n) => n.toFixed(3)).join("-");
      const color =
        box.kind === "steel-truss"
          ? 0x944e33
          : box.kind === "timber-truss"
            ? 0x7d5435
            : box.kind === "hoist-sheave"
              ? 0x484642
              : roof;
      if (!geometries.has(key)) geometries.set(key, pieceGeometry(box));
      part(color, x, y, z, w, h, d, "plain", key);
      part(color, x, y, z, w, h, d, "plain", key, true);
    } else if (box.piece === "door") {
      if (box.kind === "entry-door")
        part(0x615d54, x, y, z, w, h, d, "plain", "elevation", true, "front");
      const inside = box.kind === "room-door";
      const mat = material(box.kind, () => doorTile(inside));
      part(white, x, y, z, w, h, d, mat);
    } else if (box.sign) {
      const mat = material("sign-" + box.sign, () => signTile(box.sign!));
      part(white, x, y, z, w, h, d, mat);
    } else
      switch (box.kind) {
        case "exterior": {
          const mat = material("surface-" + box.frontage, () =>
            surface(box.frontage),
          );
          part(
            box.frontage === "glass" ? 0xb6c9cf : wall,
            x,
            y,
            z,
            w,
            h,
            d,
            mat,
          );
          break;
        }
        case "window": {
          // Recessed sills and projecting brows catch the lateral sun. Each is
          // bound to its own pane so the storefront breaks apart coherently.
          const across = box.face === "front" || box.face === "back";
          const outside = box.face === "front" || box.face === "right" ? 1 : -1;
          if (box.frontage !== "works" && box.frontage !== "clock") {
            const awning = box.frontage === "shops",
              lip = awning ? 0.42 : 0.14;
            part(
              awning ? trim : linen,
              x + (across ? 0 : outside * lip * 0.5),
              y + h * 0.49,
              z + (across ? outside * lip * 0.5 : 0),
              w + (across ? 0.12 : lip),
              awning ? 0.13 : 0.1,
              d + (across ? lip : 0.12),
            );
            part(0xe2ddd3, x, y - h * 0.48, z, w + 0.1, 0.095, d + 0.1);
          }
          if (
            box.frontage === "homes" &&
            box.face === "front" &&
            box.buildingId.includes("/bungalow-")
          ) {
            for (const side of [-1, 1])
              part(
                trim,
                x + side * (w / 2 + 0.25),
                y,
                z + 0.14,
                0.44,
                h + 0.08,
                0.085,
              );
          }
          const mat = material("window-" + box.frontage, () =>
            glazing(box.frontage),
          );
          part(white, x, y, z, w, h, d, mat);
          break;
        }
        case "foundation":
        case "upper-floor":
        case "flat-roof":
        case "stoop": {
          const deck = box.kind === "flat-roof";
          part(deck ? slate : 0xb9bdc2, x, y - h * 0.045, z, w, h * 0.91, d);
          const planks = box.frontage === "homes" && !deck;
          const mat = material(planks ? "floorboards" : "floor-tiles", () =>
            flooring(planks),
          );
          part(
            deck ? 0xd4dce1 : white,
            x,
            y + h * 0.455,
            z,
            w,
            h * 0.09,
            d,
            mat,
          );
          break;
        }
        case "sign-curb":
          part(ink);
          break;
        case "porch-column":
          part(linen);
          break;
        case "porch-deck":
        case "pump-island":
          part(0xbdafa0);
          break;
        case "porch-canopy":
        case "station-canopy": {
          const color = box.kind === "station-canopy" ? 0xc14933 : trim;
          part(color);
          detail(linen, 0, 0.29, 0, 1.005, 0.22, 1.005);
          break;
        }
        case "pump-column":
          part(0xd7d2bc);
          break;
        case "gas-pump":
          detail(0xb54935, 0, -0.2, 0, 1, 0.6, 1);
          detail(linen, 0, 0.29, 0, 1, 0.42, 1);
          detail(ink, 0, 0.31, 0, 0.73, 0.17, 1.03);
          break;
        case "partition":
          part(linen);
          detail(slate, 0, -0.45, 0, 1, 0.1, 1.04);
          break;
        case "ladder":
          for (const a of [-0.45, 0.45]) detail(ink, a, 0, 0, 0.1, 1, 1);
          for (let dy = 0.25; dy < h; dy += 0.33)
            part(slate, x, y - h / 2 + dy, z, w, 0.053, d);
          break;
        case "ceiling-light":
          part(slate);
          detail(0xfffbe0, 0, -0.22, 0, 0.94, 0.56, 0.8);
          break;
        case "framed-print": {
          const house = box.frontage === "homes";
          const mat = material(house ? "landscape-print" : "floor-plan", () =>
            wallPrint(house),
          );
          part(white, x, y, z, w, h, d, mat);
          break;
        }
        case "screen":
          part(ink);
          detail(white, 0, 0, 0.46, 0.97, 0.93, 0.08);
          break;
        case "sofa":
        case "theatre-seats":
        case "bench": {
          const fabric =
            box.kind === "bench"
              ? wood
              : box.kind === "sofa"
                ? 0x869aaa
                : 0x8990a9;
          detail(ink, 0, -0.35, 0, 0.91, 0.3, 0.78);
          detail(fabric, 0, 0.1, -0.39, 1, 0.8, 0.22);
          const seats = box.kind === "theatre-seats" ? 4 : 2;
          for (let i = 0; i < seats; i++)
            detail(
              fabric,
              (i + 0.5) / seats - 0.5,
              -0.025,
              0.03,
              0.98 / seats,
              0.3,
              0.83,
            );
          for (const a of [-0.47, 0.47])
            detail(slate, a, 0.05, 0.04, 0.06, 0.34, 0.82);
          break;
        }
        case "bed":
          detail(wood, 0, -0.32, 0, 1, 0.36, 1);
          detail(white, 0, -0.03, 0, 0.96, 0.26, 0.98);
          detail(slate, 0, 0.14, 0.16, 0.97, 0.1, 0.64);
          detail(linen, 0, 0.26, -0.32, 0.76, 0.22, 0.23);
          detail(wood, 0, 0, -0.48, 1, 1, 0.04);
          break;
        case "desk":
        case "workbench":
        case "lectern":
          legs();
          detail(
            box.kind === "workbench" ? slate : wood,
            0,
            0.41,
            0,
            1,
            0.18,
            1,
          );
          detail(linen, -0.23, 0.1, 0, 0.35, 0.45, 0.75);
          break;
        case "counter":
        case "cabinet":
          detail(slate, 0, -0.07, 0, 0.95, 0.86, 0.92);
          detail(linen, 0, 0.43, 0, 1, 0.14, 1);
          for (const a of [-0.23, 0.23]) {
            detail(0xa8b4c0, a, -0.06, 0.465, 0.44, 0.74, 0.04);
            detail(ink, a + 0.13, 0.09, 0.489, 0.055, 0.11, 0.018);
          }
          break;
        case "shelving":
          for (const a of [-0.475, 0.475]) detail(slate, a, 0, 0, 0.05, 1, 1);
          for (const b of [-0.44, -0.04, 0.45])
            detail(wood, 0, b, 0, 0.96, 0.07, 1);
          for (const b of [-0.28, 0.12])
            for (let i = 0; i < 4; i++)
              detail(
                i % 2 ? slate : linen,
                i * 0.22 - 0.33,
                b,
                0,
                0.16,
                0.25,
                0.65,
              );
          break;
        case "machine":
          detail(ink, 0, -0.38, 0, 1, 0.24, 1);
          detail(slate, -0.18, -0.04, 0, 0.51, 0.52, 0.83);
          detail(0xabbcc5, 0.25, 0.04, 0, 0.39, 0.91, 0.72);
          detail(ink, 0.23, 0.27, 0.38, 0.28, 0.22, 0.05);
          break;
        default:
          part(linen);
      }
    // The street elevation uses one outward-facing quad per breakable panel.
    // Retain the original piece binding so distant damage matches close views.
    if (box.face) {
      const across = box.face === "front" || box.face === "back";
      const direction = box.face === "front" || box.face === "right" ? 1 : -1;
      part(
        box.kind === "window"
          ? 0x7896a0
          : box.frontage === "glass"
            ? 0xb6c9cf
            : wall,
        x + (across ? 0 : (direction * w) / 2),
        y,
        z + (across ? (direction * d) / 2 : 0),
        across ? w : d,
        h,
        1,
        "plain",
        "elevation",
        true,
        box.face,
      );
    } else if (!box.mesh && (box.piece === "roof" || box.piece === "floor")) {
      if (box.kind.endsWith("canopy"))
        part(
          box.kind === "station-canopy" ? 0xc14933 : trim,
          x,
          y,
          z,
          w,
          h,
          d,
          "plain",
          "box",
          true,
        );
      else
        part(
          0xb1aaa1,
          x,
          y + h / 2,
          z,
          w,
          d,
          1,
          "plain",
          "elevation",
          true,
          "top",
        );
    } else if (box.kind === "sign-curb") {
      part(0x38746f, x, y, z, w, h, d, "plain", "box", true);
    } else if (box.kind.endsWith("column")) {
      part(linen, x, y, z, w, h, d, "plain", "box", true);
    }
  }
  const transform = new T.Object3D(),
    tint = new T.Color();
  for (const batch of batches.values()) {
    const mesh = new T.InstancedMesh(
      batch.geometry,
      batch.material,
      batch.parts.length,
    );
    mesh.userData[batch.far ? "farCenter" : "detailCenter"] = batch.center;
    mesh.userData.detailRange = 125;
    mesh.visible = !batch.far;
    mesh.receiveShadow = true;
    mesh.castShadow =
      !batch.far &&
      !batch.material.transparent &&
      batch.parts.some(
        (p) =>
          p.box.piece === "roof" ||
          p.box.piece === "wall" ||
          p.box.piece === "floor" ||
          p.box.piece === "door",
      );
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    batch.parts.forEach((p, i) => {
      transform.position.set(p.x, p.y, p.z);
      transform.rotation.set(
        p.facing === "top" ? -Math.PI / 2 : 0,
        p.facing === "back"
          ? Math.PI
          : p.facing === "right"
            ? Math.PI / 2
            : p.facing === "left"
              ? -Math.PI / 2
              : 0,
        0,
      );
      transform.scale.set(p.w, p.h, p.d);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      mesh.setColorAt(i, tint.setHex(p.tint));
    });
    mesh.computeBoundingSphere();
    // Keep cell culling valid for doors that swing outside their closed bounds.
    mesh.boundingSphere!.radius += 2.5;
    const initial = new Float32Array(mesh.instanceMatrix.array);
    batch.parts.forEach(({ box }, index) => {
      let bindings = refs.get(box);
      if (!bindings) {
        bindings = [];
        refs.set(box, bindings);
      }
      bindings.push({ mesh, initial, index });
    });
    group.add(mesh);
  }
  const original = new T.Matrix4(),
    swing = new T.Matrix4(),
    pivot = new T.Matrix4();
  const animate = new Map<CountyPiece, { angle: number; target: number }>();
  const lastDoorAngle = new Map<CountyPiece, number>();
  function apply(box: CountyPiece, hidden: boolean, angle = 0) {
    group.userData.shadowDirty = true;
    if (!hidden && box.closedDoor) lastDoorAngle.set(box, angle);
    if (angle && box.closedDoor) {
      const { p, s } = box.closedDoor,
        hx = p[0] - s[0] / 2,
        hz = p[2];
      swing
        .makeTranslation(hx, 0, hz)
        .multiply(pivot.makeRotationY(angle))
        .multiply(pivot.makeTranslation(-hx, 0, -hz));
    }
    for (const { mesh, index, initial } of refs.get(box)!) {
      original.fromArray(initial, index * 16);
      if (hidden) original.scale(zero);
      else if (angle) original.premultiply(swing);
      mesh.setMatrixAt(index, original);
      mesh.instanceMatrix.addUpdateRange(index * 16, 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
  const zero = new T.Vector3(0, 0, 0);
  for (const box of pieces) {
    let angle = box.closedDoor && box.s[2] > box.s[0] ? Math.PI / 2 : 0;
    if (!box.solid || angle) apply(box, !box.solid, angle);
    box.onPieceState = (state: PieceState) => {
      if (!box.closedDoor || state === 2) {
        animate.delete(box);
        apply(box, state === 2);
        if (state === 2) angle = 0;
        return;
      }
      const target = state === 1 ? Math.PI / 2 : 0;
      const current = animate.get(box)?.angle ?? angle;
      animate.set(box, { angle: current, target });
      apply(box, false, current);
      angle = target;
    };
  }
  // Rubble instances share the intact batches' shaded geometry, material and
  // colours. The body pose moves only their parent, even for an entire storey.
  interface RubbleDrawing {
    root: T.Group;
    members: Set<number>;
    meshes: T.InstancedMesh[];
  }
  const rubble = new Map<number, RubbleDrawing>();
  const moving = new Map<
    number,
    { id: number; slots: { mesh: T.InstancedMesh; slot: number }[] }
  >();
  const vertexColor = new T.Color();
  const despawn = (id: number) => {
    const cluster = rubble.get(id);
    if (!cluster) return;
    for (const i of cluster.members) moving.delete(i);
    cluster.root.removeFromParent();
    for (const m of cluster.meshes) m.dispose();
    rubble.delete(id);
  };
  group.userData.rubbleClear = () => {
    for (const id of rubble.keys()) despawn(id);
  };
  group.userData.rubbleDespawn = despawn;
  group.userData.rubbleSpawn = (
    id: number,
    indices: number[],
    boxes: Box[],
  ) => {
    if (rubble.has(id)) return;
    const cluster: RubbleDrawing = {
      root: new T.Group(),
      members: new Set(),
      meshes: [],
    };
    cluster.root.name = "county-rubble-" + id;
    // This parent transforms world-authored instance coordinates. Its position
    // is the pivot offset, not the world-space location of the fallen building.
    cluster.root.userData.rubble = true;
    const batches = new Map<
      T.InstancedMesh,
      { i: number; binding: Binding; box: CountyPiece }[]
    >();
    for (const i of indices) {
      const box = boxes[i] as CountyPiece;
      const bindings = refs.get(box);
      if (!bindings || moving.has(i)) continue;
      cluster.members.add(i);
      moving.set(i, { id, slots: [] });
      for (const binding of bindings) {
        if (binding.mesh.userData.farCenter) continue;
        let batch = batches.get(binding.mesh);
        if (!batch) {
          batch = [];
          batches.set(binding.mesh, batch);
        }
        batch.push({ i, binding, box });
      }
    }
    for (const [source, items] of batches) {
      const mesh = new T.InstancedMesh(
        source.geometry,
        source.material,
        items.length,
      );
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      items.forEach(({ i, binding, box }, slot) => {
        original.fromArray(binding.initial, binding.index * 16);
        const angle =
          box.closedDoor && box.s[2] > box.s[0]
            ? Math.PI / 2
            : lastDoorAngle.get(box);
        if (angle && box.closedDoor) {
          const { p, s } = box.closedDoor,
            hx = p[0] - s[0] / 2,
            hz = p[2];
          swing
            .makeTranslation(hx, 0, hz)
            .multiply(pivot.makeRotationY(angle))
            .multiply(pivot.makeTranslation(-hx, 0, -hz));
          original.premultiply(swing);
        }
        mesh.setMatrixAt(slot, original);
        source.getColorAt(binding.index, vertexColor);
        mesh.setColorAt(slot, vertexColor);
        moving.get(i)!.slots.push({ mesh, slot });
      });
      mesh.computeBoundingSphere();
      cluster.root.add(mesh);
      cluster.meshes.push(mesh);
    }
    if (!cluster.members.size) return;
    group.add(cluster.root);
    rubble.set(id, cluster);
  };
  const offset = new T.Vector3();
  group.userData.rubblePose = (pose: {
    id: number;
    origin: V3;
    p: V3;
    q: [number, number, number, number];
    sleep: boolean;
  }) => {
    const root = rubble.get(pose.id)?.root;
    if (!root) return;
    root.quaternion.fromArray(pose.q);
    offset.fromArray(pose.origin).applyQuaternion(root.quaternion);
    root.position.fromArray(pose.p).sub(offset);
  };
  group.userData.rubbleRemove = (index: number) => {
    const entry = moving.get(index);
    if (!entry) return;
    for (const { mesh, slot } of entry.slots) {
      mesh.getMatrixAt(slot, original);
      mesh.setMatrixAt(slot, original.scale(zero));
      mesh.instanceMatrix.addUpdateRange(slot * 16, 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
    moving.delete(index);
    const cluster = rubble.get(entry.id)!;
    cluster.members.delete(index);
    if (!cluster.members.size) despawn(entry.id);
  };
  group.userData.updateDoors = (dt: number) => {
    for (const [box, rotation] of animate) {
      const delta = rotation.target - rotation.angle;
      rotation.angle += Math.sign(delta) * Math.min(Math.abs(delta), dt * 8);
      apply(box, false, rotation.angle);
      if (rotation.angle === rotation.target) animate.delete(box);
    }
  };
}
