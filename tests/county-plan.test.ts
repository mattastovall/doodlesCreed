import assert from "node:assert/strict";
import test from "node:test";
import { Group, Mesh, Texture, Vector3 } from "three";
import { Spatial } from "../server/spatial.ts";
import { CountyDriveWorld } from "../src/county-driving.ts";
import { countyCars, countyWorld } from "../src/county.ts";
import {
  alongStreet,
  elevation,
  terrainHeight,
  COUNTY_SETTLEMENTS,
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
  assert.equal(plan.landmarks.length, 9);
  for (const [town, kind] of [
    ["red-mesa", "ore-headframe"],
    ["laurel", "fire-lookout"],
  ]) {
    const matching = plan.parcels.filter((p) => p.kind === kind);
    assert.equal(matching.length, 1);
    assert.ok(matching[0].blockId.startsWith(town));
    assert.ok(plan.landmarks.some((l) => l.id === town + "-" + kind));
  }
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
  const highway = plan.streets.filter(
    (s) => ruralRoad(s) && !s.id.startsWith("county-road-regional"),
  );
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

test("both regional circuits reach built settlements over driveable grades", () => {
  const { plan, lots } = planCounty();
  for (const { id, x, z } of COUNTY_SETTLEMENTS) {
    const local = plan.streets.filter((s) => s.id.startsWith(id + "-"));
    assert.ok(local.length >= 16);
    assert.equal(
      lots.filter((l) => Math.abs(l.x - x) < 100 && Math.abs(l.z - z) < 70)
        .length,
      8,
    );
    const joins = new Set(local.flatMap((s) => [s.a.join(), s.b.join()]));
    const entries = plan.streets.filter(
      (s) =>
        s.id.startsWith("county-road-regional") &&
        (joins.has(s.a.join()) || joins.has(s.b.join())),
    );
    assert.equal(entries.length, 2);
  }
  const civic = plan.parcels.filter((p) => p.id.startsWith("red-mesa-civic-"));
  assert.equal(civic.length, 9);
  assert.ok(
    civic.some((p) => p.kind === "hall") && civic.some((p) => p.floors >= 7),
  );
  assert.ok(plan.landmarks.some((l) => l.id === "red-mesa-civic-square"));
  for (const parcel of civic)
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        assert.equal(
          terrainHeight(
            parcel.x + (sx * parcel.w) / 2,
            parcel.z + (sz * parcel.d) / 2,
          ),
          0,
        );
  const regional = plan.streets.filter((s) =>
    s.id.startsWith("county-road-regional"),
  );
  assert.ok(Math.max(...regional.map((s) => s.a[1])) >= 30);
  for (const road of regional) {
    const grade =
      Math.abs(road.b[1] - road.a[1]) /
      Math.hypot(road.b[0] - road.a[0], road.b[2] - road.a[2]);
    assert.ok(grade < 0.11);
    for (const side of [-0.5, 0, 0.5])
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const p = alongStreet(road, t, side * road.width);
        assert.ok(Math.abs(p[1] - terrainHeight(p[0], p[2])) < 0.001, road.id);
      }
  }
  const group = new Group();
  drawCountyRoads(group, regional, {
    asphalt: new Texture(),
    concrete: new Texture(),
  });
  for (const [index, clearance] of [0.035, 0.048, 0.06, 0.059].entries()) {
    const pos = (group.children[index] as Mesh).geometry.getAttribute(
      "position",
    );
    for (let i = 0; i < pos.count; i += 3) {
      const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      assert.ok(Math.abs(y - terrainHeight(x, z) - clearance) < 0.001);
    }
  }
});

test("a saloon clears each regional carriageway and a driver can collect the service station car", () => {
  const city = countyWorld(),
    fleet = countyCars(),
    drive = new CountyDriveWorld(city.boxes);
  for (const road of city.plan.streets.filter(
    (s) =>
      s.id.startsWith("county-road-regional") ||
      s.id.startsWith("red-mesa-civic-"),
  )) {
    const dx = road.b[0] - road.a[0],
      dz = road.b[2] - road.a[2];
    const count = Math.ceil(Math.hypot(dx, dz) / 6),
      yaw = Math.atan2(-dx, -dz);
    for (const side of [-1, 1]) {
      let from = alongStreet(road, 0, side * 2.4);
      for (let i = 1; i <= count; i++) {
        const to = alongStreet(road, i / count, side * 2.4);
        assert.ok(drive.legacyClear(from, yaw, to, yaw, "saloon"), road.id);
        from = to;
      }
    }
  }
  for (const place of COUNTY_SETTLEMENTS) {
    const here = fleet.filter(
      (c) =>
        Math.abs(place.x - c.p[0]) < 105 && Math.abs(place.z - c.p[2]) < 65,
    );
    assert.equal(here.filter((c) => c.driver).length, 1);
    const car = here.find((c) => !c.driver && c.access === "open")!;
    assert.ok(car);
    assert.ok(
      drive.legacyClear(
        car.p,
        car.yaw,
        [car.p[0], car.p[1], car.p[2] + 6],
        car.yaw,
        car.kind,
      ),
    );
  }
});
