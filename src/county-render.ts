import { countySky, countyTextures, coastSun } from "./county-atmosphere.ts";
import { palmGeometry } from "./county-palm.ts";
import { loadFleet } from "./county-car.ts";
import { isCountyPiece } from "./county-architecture.ts";
import { countyBuildings } from "./county-buildings.ts";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "./release-info.ts";
import { inkMaterial, INK } from "./render.ts";
import { elevation, countyCars } from "./county.ts";
import { drawCountyRoads } from "./county-roads.ts";
import { randomSeed, type City } from "./world.ts";

export async function drawCounty(city: City, group: T.Group) {
  const loader = new GLTFLoader();
  async function geometry(name: string) {
    const model = await loader.loadAsync(assetUrl("models/" + name + ".glb"));
    const mesh = model.scene.getObjectByProperty("isMesh", true) as T.Mesh;
    const geo = mesh.geometry;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    return geo;
  }
  const textures = await countyTextures();
  const terrainTint = new T.MeshLambertMaterial({ map: textures.scrubland });
  const normal = new T.Vector3(),
    sun = coastSun;
  group.add(countySky(textures.sky));
  countyBuildings(group, city.boxes.filter(isCountyPiece));
  const [vehicle, lamp, rock] = await Promise.all([
    loadFleet(textures.sky),
    geometry("lamp"),
    geometry("outcrop"),
  ]);
  for (const box of city.boxes) {
    if (box.kind !== "ground") continue;
    const geo = new T.BufferGeometry();
    const [cx, cy, cz] = box.p,
      [w, h, d] = box.s;
    const vertices = box.mesh?.vertices ?? [
      cx - w / 2,
      cy + h / 2,
      cz - d / 2,
      cx - w / 2,
      cy + h / 2,
      cz + d / 2,
      cx + w / 2,
      cy + h / 2,
      cz + d / 2,
      cx + w / 2,
      cy + h / 2,
      cz - d / 2,
    ];
    geo.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
    geo.setIndex(box.mesh?.indices ?? [0, 1, 2, 0, 2, 3]);
    geo.computeVertexNormals();
    const uv: number[] = [];
    for (let i = 0; i < vertices.length; i += 3)
      uv.push(vertices[i] / 18, vertices[i + 2] / 18);
    geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    const hill = new T.Mesh(geo, terrainTint);
    hill.receiveShadow = true;
    group.add(hill);
  }
  const cars = countyCars().map((c, i) => {
    const m = vehicle(
      c.kind,
      c.kind === "taxi" ? 1 : c.kind === "delivery" ? 3 : i,
      c.patrol,
    );
    m.rotation.y = c.yaw;
    m.position.fromArray(c.p);
    group.add(m);
    return m;
  });
  const lightPositions = drawCountyRoads(group, city.plan.streets, textures);
  const rng = randomSeed("county-landscape");
  const matrix = new T.Object3D();
  const lamps = new T.InstancedMesh(
    lamp,
    new T.MeshLambertMaterial({ color: 0x647786 }),
    lightPositions.length,
  );
  lightPositions.forEach((p, i) => {
    matrix.position.fromArray(p);
    matrix.updateMatrix();
    lamps.setMatrixAt(i, matrix.matrix);
  });
  lamps.castShadow = true;
  group.add(lamps);
  const trunkGeo = new T.CylinderGeometry(0.14, 0.24, 3.3, 8);
  const trunkMat = new T.MeshBasicMaterial({ color: 0x776d65 });
  const crown = new T.SphereGeometry(1, 14, 9),
    colors = [];
  const vertex = crown.getAttribute("position"),
    leaf = new T.Color();
  for (let i = 0; i < vertex.count; i++) {
    normal.fromBufferAttribute(crown.attributes.normal, i);
    const { x, y, z } = normal;
    const radius =
      1 +
      0.13 * Math.sin(5 * x + 2 * z) * Math.cos(5 * y - 3 * z) +
      0.08 * Math.sin(7 * z - 4 * y);
    vertex.setXYZ(i, x * radius, y * radius, z * radius);
    const light = normal.dot(sun) + 0.12 * Math.sin(x * 7 + y * 4);
    leaf.setHex(light > 0.55 ? 0x89a476 : light > -0.12 ? 0x618367 : 0x48695d);
    colors.push(leaf.r, leaf.g, leaf.b);
  }
  crown.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  const leafMat = new T.MeshBasicMaterial({ vertexColors: true });
  const cells = new Map<string, typeof city.boxes>();
  for (const tree of city.boxes.filter((b) => b.kind === "county-tree")) {
    const cell = Math.floor(tree.p[0] / 96) + "," + Math.floor(tree.p[2] / 96);
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell)!.push(tree);
  }
  const palm = palmGeometry(),
    palmMat = new T.MeshLambertMaterial({
      vertexColors: true,
      side: T.DoubleSide,
    });
  for (const trees of cells.values()) {
    const palms = trees.filter(
      (b) => Math.sin(b.p[0] * 2.7 + b.p[2] * 0.32) > -0.45,
    );
    if (palms.length) {
      const instances = new T.InstancedMesh(palm, palmMat, palms.length);
      for (const [i, tree] of palms.entries()) {
        matrix.position.set(tree.p[0], 0, tree.p[2]);
        matrix.rotation.set(0, rng() * Math.PI * 2, 0);
        matrix.scale.setScalar(0.86 + rng() * 0.36);
        matrix.updateMatrix();
        instances.setMatrixAt(i, matrix.matrix);
      }
      instances.castShadow = true;
      group.add(instances);
    }
    const broadleaf = trees.filter((b) => !palms.includes(b));
    if (!broadleaf.length) continue;
    const trunks = new T.InstancedMesh(trunkGeo, trunkMat, broadleaf.length),
      leaves = new T.InstancedMesh(crown, leafMat, broadleaf.length);
    broadleaf.forEach(({ p }, i) => {
      matrix.position.set(p[0], 1.65, p[2]);
      matrix.scale.set(1, 1, 1);
      matrix.updateMatrix();
      trunks.setMatrixAt(i, matrix.matrix);
      const slim = rng() > 0.65;
      matrix.position.y = 4.15 + rng() * 0.75;
      matrix.scale.set(slim ? 1.4 : 2.2, slim ? 2.8 : 2.05, slim ? 1.45 : 2);
      matrix.rotation.y = rng() * 6.28;
      matrix.updateMatrix();
      leaves.setMatrixAt(i, matrix.matrix);
    });
    trunks.castShadow = leaves.castShadow = true;
    group.add(trunks, leaves);
  }
  // Low scrub lives off-road, in clusters on the hillsides. Each terrain
  // cell uses one culled draw and contains no new gameplay obstacles.
  const brush = new T.IcosahedronGeometry(1, 0),
    brushMat = new T.MeshLambertMaterial({
      color: 0x819369,
      flatShading: true,
    });
  for (let tx = -800; tx < 800; tx += 160)
    for (let tz = -800; tz < 800; tz += 160) {
      const transforms: T.Matrix4[] = [];
      for (let i = 0; i < 15; i++) {
        const x = tx + rng() * 160,
          z = tz + rng() * 160;
        if (elevation(x, z) < 2) continue;
        for (let j = 0; j < 6; j++) {
          const bx = x + (rng() - 0.5) * 11,
            bz = z + (rng() - 0.5) * 11,
            s = 0.45 + rng();
          matrix.position.set(bx, elevation(bx, bz) + 0.16, bz);
          matrix.rotation.set(0, rng() * 6.28, 0);
          matrix.scale.set(s * 1.45, s * 0.53, s * 0.97);
          matrix.updateMatrix();
          transforms.push(matrix.matrix.clone());
        }
      }
      if (transforms.length) {
        const instances = new T.InstancedMesh(
          brush,
          brushMat,
          transforms.length,
        );
        transforms.forEach((m, i) => instances.setMatrixAt(i, m));
        group.add(instances);
      }
    }
  const stoneMat = new T.MeshLambertMaterial({ color: 0x9e9b88 });
  for (let i = 0; i < 150;) {
    const x = (rng() - 0.5) * 1560,
      z = (rng() - 0.5) * 1560;
    if (elevation(x, z) < 1) continue;
    const stone = new T.Mesh(rock, stoneMat);
    stone.position.set(x, elevation(x, z) - 0.3, z);
    stone.rotation.y = rng() * Math.PI * 2;
    stone.scale.setScalar(
      (2 + rng() * 7) / rock.boundingBox!.getSize(new T.Vector3()).length(),
    );
    group.add(stone);
    i++;
  }
  for (const point of city.beacons) {
    const token = new T.Mesh(
      new T.OctahedronGeometry(0.6),
      inkMaterial("#dfa52b", 0.55),
    );
    token.position.fromArray(point);
    token.position.y += 1.4;
    group.add(token);
    token.name = "county-mark";
  }
  return cars;
}
