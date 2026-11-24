import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { regionalUnderbrush } from "./county-landcover.ts";
import { randomSeed, type City } from "./world.ts";

// Make each species one instanced draw per visible grove, including bark.
// Dimensions are normalized to the height of the matching trunk collider.
function treeShape(pine: boolean, distant = false) {
  const pieces: T.BufferGeometry[] = [];
  const add = (geo: T.BufferGeometry, color: number) => {
    geo.deleteAttribute("uv");
    const tint = new T.Color(color),
      colors: number[] = [];
    for (let i = 0; i < geo.attributes.position.count; i++)
      colors.push(tint.r, tint.g, tint.b);
    geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    pieces.push(geo);
  };
  add(
    new T.CylinderGeometry(
      0.012,
      pine ? 0.024 : 0.045,
      0.82,
      distant ? 4 : 7,
    ).translate(0, 0.41, 0),
    0x776a57,
  );
  if (distant && pine) {
    add(new T.ConeGeometry(0.225, 0.58, 6).translate(0, 0.43, 0), 0x476858);
    add(new T.ConeGeometry(0.145, 0.55, 6).translate(0, 0.75, 0), 0x668968);
  } else if (distant) {
    add(
      new T.SphereGeometry(1, 7, 4)
        .scale(0.54, 0.36, 0.54)
        .translate(0, 0.7, 0),
      0x80935f,
    );
  } else if (pine) {
    for (let layer = 0; layer < 5; layer++) {
      const height = 0.37 - layer * 0.02,
        radius = 0.21 - layer * 0.029;
      const geo = new T.ConeGeometry(radius, height, 13, 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i),
          y = pos.getY(i),
          z = pos.getZ(i);
        const phase = Math.atan2(z, x) + layer * 0.7;
        const scale =
          1 + 0.16 * Math.sin(phase * 5) + 0.09 * Math.cos(phase * 3);
        pos.setXYZ(
          i,
          x * scale,
          y + (0.035 * Math.sin(phase * 5) * Math.hypot(x, z)) / radius,
          z * scale,
        );
      }
      geo.rotateY(layer * 1.72).translate(0, 0.3 + layer * 0.15, 0);
      geo.computeVertexNormals();
      add(geo, [0x37594e, 0x476858, 0x53755d, 0x668968, 0x70926d][layer]);
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const a = i * 2.4,
        r = i === 4 ? 0 : 0.19;
      add(
        new T.SphereGeometry(0.36, 9, 6)
          .scale(1, 0.8, 1)
          .translate(r * Math.cos(a), i === 4 ? 0.79 : 0.63, r * Math.sin(a)),
        [0x718454, 0x84975d, 0x779063, 0x6f865a, 0x99a974][i],
      );
    }
  }
  const geo = mergeGeometries(pieces)!;
  for (const piece of pieces) piece.dispose();
  return geo;
}

// Folded, tapered blades catch two different light angles on each leaf.
function yuccaRosette() {
  const points: number[] = [];
  for (let i = 0; i < 22; i++) {
    const a = i * 2.39996,
      length = 0.55 + 0.32 * Math.sin(i * 4.1) ** 2;
    const x = Math.cos(a),
      z = Math.sin(a),
      width = 0.085;
    const height = 0.35 + 0.65 * (i / 21);
    const spread = length * (1.12 - (0.65 * i) / 21);
    const l = [
      spread * 0.38 * x - width * z,
      height * 0.27,
      spread * 0.38 * z + width * x,
    ];
    const r = [
      spread * 0.38 * x + width * z,
      height * 0.27,
      spread * 0.38 * z - width * x,
    ];
    const fold = [spread * 0.37 * x, height * 0.36, spread * 0.37 * z];
    const tip = [spread * x, height, spread * z];
    points.push(
      0,
      0,
      0,
      ...l,
      ...fold,
      0,
      0,
      0,
      ...fold,
      ...r,
      ...l,
      ...tip,
      ...fold,
      ...fold,
      ...tip,
      ...r,
    );
  }
  const shape = new T.BufferGeometry();
  shape.setAttribute("position", new T.Float32BufferAttribute(points, 3));
  shape.computeVertexNormals();
  return shape;
}

// Paired opaque meshes use the same coverage threshold. Instance distance
// drives the blend so a grove does not switch all its trees at once.
const canopyFadeStart = 115,
  canopyFadeEnd = 170;
function canopyMaterial(distant: boolean) {
  const material = new T.MeshLambertMaterial({ vertexColors: true });
  material.customProgramCacheKey = () =>
    distant ? "canopy-far" : "canopy-near";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      "varying float canopyFade;\n" +
      shader.vertexShader.replace(
        "#include <project_vertex>",
        `#include <project_vertex>
       float treeRange = length((modelMatrix * instanceMatrix[3]).xz - cameraPosition.xz);
       canopyFade = smoothstep(${canopyFadeStart}.0, ${canopyFadeEnd}.0, treeRange);
       if (${distant ? "canopyFade <= 0.0" : "canopyFade >= 1.0"}) gl_Position = vec4(2.0, 0.0, 0.0, 1.0);`,
      );
    shader.fragmentShader =
      "varying float canopyFade;\n" +
      shader.fragmentShader.replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
       float threshold = fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy),vec2(0.06711056,0.00583715))));
       if (threshold ${distant ? ">=" : "<"} canopyFade) discard;`,
      );
  };
  return material;
}

function fernShape() {
  const pos: number[] = [];
  for (let j = 0; j < 7; j++) {
    const angle = j * 2.4,
      dx = Math.cos(angle),
      dz = Math.sin(angle);
    const length = 0.65 + 0.24 * Math.cos(j) ** 2;
    for (let k = 1; k <= 6; k++) {
      const t = k / 7,
        x = dx * t * length,
        z = dz * t * length;
      const y = 0.48 * Math.sin(t * 2.1);
      const span = 0.15 * Math.sin(Math.PI * t);
      for (const side of [-1, 1])
        pos.push(
          x,
          y,
          z,
          x + dx * 0.1 - dz * side * span,
          y + 0.055,
          z + dz * 0.1 + dx * side * span,
          x + dx * 0.14,
          y + 0.045,
          z + dz * 0.14,
        );
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// Marsh stems end in dark seed heads above the leaves. Meadow grasses splay
// lower and wider, so adjoining habitats read by silhouette as well as hue.
function grassTuft(reeds: boolean) {
  const points: number[] = [],
    colors: number[] = [];
  function triangle(a: number[], b: number[], c: number[], tint: T.Color) {
    points.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) colors.push(tint.r, tint.g, tint.b);
  }
  const base = new T.Color(reeds ? 0x708149 : 0x92915d),
    tip = new T.Color(reeds ? 0xa9ac65 : 0xc2b577),
    seed = new T.Color(0x674f36);
  for (let i = 0; i < (reeds ? 15 : 11); i++) {
    const a = i * 2.39996,
      dx = Math.cos(a),
      dz = Math.sin(a);
    const radius = 0.09 + (i % 4) * 0.061,
      x = dx * radius,
      z = dz * radius;
    const upright = reeds && i % 4 === 0;
    const spread = upright ? 0.07 : (reeds ? 0.21 : 0.45) + (i % 3) * 0.07;
    const height =
      (reeds ? 0.95 : 0.43) + (i % 5) * 0.07 + (upright ? 0.45 : 0);
    const w = upright ? 0.016 : 0.045;
    const left = [x - dz * w, 0, z + dx * w],
      right = [x + dz * w, 0, z - dx * w];
    const midX = x + dx * spread * 0.3,
      midZ = z + dz * spread * 0.3;
    const l = [midX - dz * w, height * 0.67, midZ + dx * w];
    const r = [midX + dz * w, height * 0.67, midZ - dx * w];
    const endX = x + dx * spread,
      endZ = z + dz * spread;
    triangle(left, right, l, base);
    triangle(right, r, l, base);
    triangle(l, r, [endX, height, endZ], tip);
    if (upright) {
      const h = height - 0.12;
      // Two crossed faces keep the seed head distinct from every direction.
      for (const [wx, wz] of [
        [0.029, 0],
        [0, 0.029],
      ]) {
        const lb = [endX - wx, h, endZ - wz],
          rb = [endX + wx, h, endZ + wz];
        const lt = [endX - wx, h + 0.21, endZ - wz],
          rt = [endX + wx, h + 0.21, endZ + wz];
        triangle(lb, rb, lt, seed);
        triangle(rb, rt, lt, seed);
      }
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(points, 3));
  geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export function drawRegionalLandscape(group: T.Group, city: City) {
  const random = randomSeed("switchback-foliage-appearance");
  const transform = new T.Object3D();
  const pine = treeShape(true),
    orchard = treeShape(false);
  const distantPine = treeShape(true, true),
    distantOrchard = treeShape(false, true);
  const nearMaterial = canopyMaterial(false),
    farMaterial = canopyMaterial(true);
  const yucca = yuccaRosette(),
    sage = new T.IcosahedronGeometry(1, 0),
    fern = fernShape(),
    reeds = grassTuft(true),
    grass = grassTuft(false);
  const tuft = new T.MeshLambertMaterial({
    vertexColors: true,
    side: T.DoubleSide,
  });
  const blades = new T.MeshLambertMaterial({
    color: 0x849875,
    side: T.DoubleSide,
  });
  const brush = new T.MeshLambertMaterial({
    color: 0x9b9a79,
    flatShading: true,
  });
  const fronds = new T.MeshLambertMaterial({
    color: 0x607e4f,
    side: T.DoubleSide,
  });
  const batches = new Map<
    string,
    { geo: T.BufferGeometry; material: T.Material; matrices: T.Matrix4[] }
  >();
  function add(geo: T.BufferGeometry, material: T.Material, tile: number) {
    const key =
      geo.id +
      "/" +
      Math.floor(transform.position.x / tile) +
      "/" +
      Math.floor(transform.position.z / tile);
    let batch = batches.get(key);
    if (!batch) {
      batch = { geo, material, matrices: [] };
      batches.set(key, batch);
    }
    batch.matrices.push(transform.matrix.clone());
  }
  for (const b of city.boxes) {
    if (b.kind !== "county-pine" && b.kind !== "county-orchard") continue;
    const h = b.s[1],
      conifer = b.kind === "county-pine";
    transform.position.set(b.p[0], b.p[1] - h / 2, b.p[2]);
    transform.rotation.y = random() * Math.PI * 2;
    transform.scale.setScalar(h);
    transform.updateMatrix();
    add(conifer ? pine : orchard, nearMaterial, 128);
    add(conifer ? distantPine : distantOrchard, farMaterial, 448);
  }
  for (const { kind, size, x, y, z } of regionalUnderbrush(
    city.plan,
    city.bounds,
  )) {
    transform.position.set(x, y + (kind === "sage" ? size * 0.35 : 0), z);
    transform.rotation.y = random() * Math.PI * 2;
    if (kind === "sage") transform.scale.set(size * 1.7, size, size * 1.4);
    else transform.scale.setScalar(size);
    transform.updateMatrix();
    if (kind === "yucca") add(yucca, blades, 192);
    else if (kind === "sage") add(sage, brush, 192);
    else if (kind === "fern") add(fern, fronds, 192);
    else add(kind === "reed" ? reeds : grass, tuft, 192);
  }
  for (const { geo, material, matrices } of batches.values()) {
    const mesh = new T.InstancedMesh(geo, material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.computeBoundingSphere();
    const { center, radius } = mesh.boundingSphere!;
    const far = material === farMaterial;
    mesh.name = far
      ? "canopy-far"
      : material === nearMaterial
        ? "canopy-near"
        : "ground-cover";
    mesh.userData[far ? "farCenter" : "detailCenter"] = [center.x, center.z];
    mesh.userData.detailRange = far
      ? canopyFadeStart - radius
      : (material === nearMaterial ? canopyFadeEnd : 125) + radius;
    group.add(mesh);
  }
}
