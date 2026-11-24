import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clearOfLotsAndRoads, dryCountry } from "./county-landcover.ts";
import { terrainHeight } from "./county-plan.ts";
import { randomSeed, type City } from "./world.ts";

// Make each species one instanced draw per visible grove, including bark.
// Dimensions are normalized to the height of the matching trunk collider.
function treeShape(pine: boolean) {
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
    new T.CylinderGeometry(0.012, pine ? 0.024 : 0.045, 0.82, 7).translate(
      0,
      0.41,
      0,
    ),
    0x776a57,
  );
  if (pine) {
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

export function drawRegionalLandscape(group: T.Group, city: City) {
  const random = randomSeed("switchback-underbrush"),
    transform = new T.Object3D();
  const pine = treeShape(true),
    orchard = treeShape(false);
  const yucca = yuccaRosette();
  const blades = new T.MeshLambertMaterial({
    color: 0x849875,
    side: T.DoubleSide,
  });
  const brush = new T.IcosahedronGeometry(1, 0);
  const foliage = new T.MeshLambertMaterial({ vertexColors: true });
  const sage = new T.MeshLambertMaterial({
    color: 0x9b9a79,
    flatShading: true,
  });
  const batches = new Map<
    string,
    { geo: T.BufferGeometry; material: T.Material; matrices: T.Matrix4[] }
  >();
  function place(
    x: number,
    y: number,
    z: number,
    geo: T.BufferGeometry,
    material: T.Material,
    w: number,
    h: number,
    d: number,
  ) {
    const key = geo.id + "/" + Math.floor(x / 360) + "/" + Math.floor(z / 360);
    let batch = batches.get(key);
    if (!batch) {
      batch = { geo, material, matrices: [] };
      batches.set(key, batch);
    }
    transform.position.set(x, y, z);
    transform.rotation.y = random() * Math.PI * 2;
    transform.scale.set(w, h, d);
    transform.updateMatrix();
    batch.matrices.push(transform.matrix.clone());
  }
  for (const b of city.boxes) {
    if (b.kind !== "county-pine" && b.kind !== "county-orchard") continue;
    const h = b.s[1];
    place(
      b.p[0],
      b.p[1] - h / 2,
      b.p[2],
      b.kind === "county-pine" ? pine : orchard,
      foliage,
      h,
      h,
      h,
    );
  }
  for (let i = 0; i < 3800; i++) {
    const x = (random() * 2 - 1) * city.bounds,
      z = (random() * 2 - 1) * city.bounds;
    if (dryCountry(x, z) < 0.15 || !clearOfLotsAndRoads(city.plan, x, z))
      continue;
    if (random() < 0.42) {
      const size = 0.6 + random() * 0.95;
      place(x, terrainHeight(x, z), z, yucca, blades, size, size, size);
      continue;
    }
    const h = 0.22 + random() * 0.48;
    place(
      x,
      terrainHeight(x, z) + h * 0.35,
      z,
      brush,
      sage,
      h * 1.7,
      h,
      h * 1.4,
    );
  }
  for (const { geo, material, matrices } of batches.values()) {
    const mesh = new T.InstancedMesh(geo, material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
}
