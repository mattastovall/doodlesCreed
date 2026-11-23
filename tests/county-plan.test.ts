import assert from "node:assert/strict";
import test from "node:test";
import { Group, Mesh, Texture, Vector3 } from "three";
import { Spatial } from "../server/spatial.ts";
import { countyWorld } from "../src/county.ts";
import {
  alongStreet,
  elevation,
  planCounty,
  ruralRoad,
} from "../src/county-plan.ts";
import { drawCountyRoads } from "../src/county-roads.ts";
import type { Street } from "../src/city-plan.ts";

test("county growth repeats by seed and changes street connectivity and parcels between seeds", () => {
  const { plan, lots } = planCounty();
  assert.deepEqual(planCounty().plan, plan);
  const alternate = planCounty("upper-valley").plan;
  for (const prefix of ["mill-", "terrace-"]) {
    const ids = (streets: Street[]) =>
      streets
        .filter((s) => s.id.startsWith(prefix))
        .map((s) => s.id)
        .sort();
    assert.notDeepEqual(ids(alternate.streets), ids(plan.streets));
  }
  assert.notDeepEqual(
    alternate.blocks.map((b) => b.id),
    plan.blocks.map((b) => b.id),
  );
  assert.equal(plan.landmarks.length, 6);
  assert.deepEqual(
    plan.landmarks.map((p) => p.id),
    alternate.landmarks.map((p) => p.id),
  );
  const widthClasses = new Set(plan.streets.map((s) => s.width));
  assert.ok(widthClasses.size >= 4);
  const frontages = new Set(plan.streets.map((s) => s.id));
  assert.ok(plan.parcels.every((p) => frontages.has(p.streetId)));
  assert.ok(new Set(lots.map((l) => Math.round(l.w))).size >= 8);
  for (const town of [-320, 320]) {
    const landUses = lots.filter((l) => l.town === town).map((l) => l.choice);
    assert.ok(landUses.includes(town < 0 ? 0 : 4));
  }
  const highway = plan.streets.filter(ruralRoad);
  for (const s of highway) {
    for (const side of [-1, 1]) {
      const p = alongStreet(s, 0.5, (side * s.width) / 2);
      assert.equal(elevation(p[0], p[2]), 0);
    }
  }
  const pass = highway.filter((s) => Math.abs(s.a[0]) < 140);
  assert.ok(
    Math.max(...pass.map((s) => s.a[2])) -
      Math.min(...pass.map((s) => s.a[2])) >
      45,
  );
});

test("all county street navigation joins one walkable network through both towns and the pass", () => {
  const city = countyWorld(),
    spatial = new Spatial(city.boxes);
  const map = city.nodes.map(() => [] as number[]);
  for (const [a, b] of city.links) {
    assert.ok(spatial.movement(city.nodes[a], city.nodes[b], 1.76));
    map[a].push(b);
    map[b].push(a);
  }
  assert.ok(city.nodes.every((p) => spatial.clear(p)));
  const reached = new Set([0]),
    queue = [0];
  for (const node of queue)
    for (const next of map[node]) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  assert.equal(reached.size, city.nodes.length);
});

test("the asphalt batch follows oblique streets at their surveyed width", () => {
  const s: Street = {
    a: [0, 0, 0],
    b: [30, 0, 40],
    class: "local",
    width: 8,
    id: "oblique",
  };
  const group = new Group();
  try {
    drawCountyRoads(group, [s], {
      asphalt: new Texture(),
      concrete: new Texture(),
    });
    const mesh = group.children[1] as Mesh;
    const positions = mesh.geometry.getAttribute("position");
    const vertices = [0, 1, 2].map((i) =>
      new Vector3().fromBufferAttribute(positions, i),
    );
    const long = vertices[1].clone().sub(vertices[0]);
    const cross = vertices[2].clone().sub(vertices[1]);
    assert.ok(Math.abs(long.x - 30) < 1e-4 && Math.abs(long.z - 40) < 1e-4);
    assert.ok(Math.abs(long.dot(cross)) < 0.001);
    assert.ok(Math.abs(cross.length() - 8) < 1e-4);
    assert.ok(long.cross(cross).y > 0);
  } finally {
    group.children.forEach((object) => {
      const mesh = object as Mesh;
      mesh.geometry.dispose();
      if (!Array.isArray(mesh.material)) mesh.material.dispose();
    });
  }
});
