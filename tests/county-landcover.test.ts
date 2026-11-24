import assert from "node:assert/strict";
import test from "node:test";
import { Group, InstancedMesh, Matrix4 } from "three";
import {
  clearOfLotsAndRoads,
  countyHabitat,
  regionalTrees,
  regionalUnderbrush,
} from "../src/county-landcover.ts";
import { sampleCountyWater } from "../src/county-hydrology.ts";
import { drawRegionalLandscape } from "../src/county-landscape.ts";
import { LIMIT, planCounty, terrainHeight } from "../src/county-plan.ts";
import type { City } from "../src/world.ts";

test("regional plants share terrain, road caps, parcel and landmark clearances", () => {
  const { plan } = planCounty();
  const trees = regionalTrees(plan, LIMIT),
    plants = regionalUnderbrush(plan, LIMIT);
  assert.deepEqual(trees, regionalTrees(plan, LIMIT));
  assert.deepEqual(plants, regionalUnderbrush(plan, LIMIT));
  assert.ok(trees.length > 800);
  assert.deepEqual(
    new Set(plants.map((p) => p.kind)),
    new Set(["fern", "yucca", "sage", "grass", "reed"]),
  );
  for (const p of plants.filter((p) => p.kind === "reed")) {
    const water = sampleCountyWater(p.x, p.z);
    assert.ok(water && Math.abs(water.shoreDistance) <= 13);
    assert.ok(p.y >= water.surfaceY - 0.35 && p.y <= water.surfaceY + 2.4);
  }
  for (const { p, s, solid } of trees) {
    assert.equal(solid, true);
    const water = sampleCountyWater(p[0], p[2]);
    assert.ok(!water || terrainHeight(p[0], p[2]) >= water.surfaceY);

    assert.ok(Math.abs(p[1] - s[1] / 2 - terrainHeight(p[0], p[2])) < 1e-8);
  }
  for (const p of [
    ...trees.map((b) => b.p),
    ...plants.map((p) => [p.x, p.y, p.z]),
  ]) {
    const [x, , z] = p;
    assert.equal(clearOfLotsAndRoads(plan, x, z), true);
    for (const { a, b, width } of plan.streets) {
      const dx = b[0] - a[0],
        dz = b[2] - a[2];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz || 1),
        ),
      );
      assert.ok(
        Math.hypot(x - a[0] - t * dx, z - a[2] - t * dz) >= width / 2 + 6,
      );
    }
    for (const lot of plan.parcels)
      assert.ok(
        Math.abs(x - lot.x) >= lot.w / 2 + 6 ||
          Math.abs(z - lot.z) >= lot.d / 2 + 6,
      );
    for (const mark of plan.landmarks)
      assert.ok(
        Math.abs(x - mark.p[0]) >= mark.size[0] / 2 + 6 ||
          Math.abs(z - mark.p[2]) >= mark.size[2] / 2 + 6,
      );
  }
  const radius = (i: number) =>
    trees[i].kind === "county-orchard" ? 4 : 4.2 + trees[i].s[1] * 0.23;
  for (let i = 0; i < trees.length; i++)
    for (let j = 0; j < i; j++) {
      const [x, , z] = trees[i].p,
        other = trees[j].p;
      assert.ok(
        Math.hypot(x - other[0], z - other[2]) >= radius(i) + radius(j),
      );
    }
});

test("far canopy instances preserve every trunk transform at a lower triangle count", () => {
  const { plan } = planCounty(),
    boxes = regionalTrees(plan, LIMIT);
  const group = new Group();
  drawRegionalLandscape(group, { plan, boxes, bounds: LIMIT } as City);
  const matrix = new Matrix4();
  function levels(name: string) {
    const transforms: string[] = [];
    let triangles = 0;
    for (const mesh of group.children as InstancedMesh[]) {
      assert.ok(mesh.isInstancedMesh);
      if (mesh.name !== name) continue;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        transforms.push(matrix.elements.join(","));
      }
      triangles += (mesh.count * mesh.geometry.index!.count) / 3;
    }
    return { transforms: transforms.sort(), triangles };
  }
  const near = levels("canopy-near"),
    far = levels("canopy-far");
  assert.equal(near.transforms.length, boxes.length);
  assert.deepEqual(far.transforms, near.transforms);
  assert.ok(far.triangles < near.triangles / 6);
});

test("ecotones vary across the same latitude while the named regions retain their climate", () => {
  assert.ok(countyHabitat(-810, -820).dry > countyHabitat(0, 880).dry + 0.45);
  assert.ok(
    countyHabitat(0, 880).woods > countyHabitat(780, -820).woods + 0.35,
  );
  const woods = Array.from(
    { length: 50 },
    (_, i) => countyHabitat(-1000 + 40 * i, 300).woods,
  );
  assert.ok(Math.max(...woods) - Math.min(...woods) > 0.45);
});
