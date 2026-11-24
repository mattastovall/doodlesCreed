import assert from "node:assert/strict";
import { test } from "node:test";
import * as T from "three";
import { CountyTires } from "../src/county-tires.ts";

test("rear wheels lay paired strips during slip, break tracks on grip, and bound the effects", () => {
  const group = new T.Group(),
    fx = new CountyTires(group);
  const [marks, smoke] = group.children as [T.Mesh, T.Points];
  const position = new T.Vector3();
  const sample = (reduced = false) =>
    fx.sample(0, "local", position, 0, "saloon", reduced);
  sample();
  position.z--;
  sample();
  assert.equal(marks.geometry.drawRange.count, 12);
  assert.equal(smoke.geometry.drawRange.count, 2);
  const vertices = marks.geometry.getAttribute("position");
  assert.ok(vertices.getX(0) < 0 && vertices.getX(6) > 0);
  fx.reset(0);
  position.z--;
  sample(true);
  assert.equal(marks.geometry.drawRange.count, 12);
  for (let i = 0; i < 600; i++) {
    position.z--;
    fx.update(0.05);
    sample();
  }
  assert.equal(marks.geometry.drawRange.count, 512 * 6);
  assert.equal(smoke.geometry.drawRange.count, 64);
  fx.update(1);
  assert.equal(smoke.geometry.drawRange.count, 0);
});

test("nearby drivers share geometry and retain separate rear-wheel tracks across seat changes", () => {
  const group = new T.Group(),
    fx = new CountyTires(group);
  const [marks, smoke] = group.children as [T.Mesh, T.Points];
  const local = new T.Vector3(0, 0, 0),
    remote = new T.Vector3(12, 0, 0);
  for (let i = 0; i < 2; i++) {
    fx.sample(2, "local", local, 0, "coupe", false);
    fx.sample(5, "remote", remote, 0, "taxi", false);
    local.z--;
    remote.z--;
  }
  assert.equal(marks.geometry.drawRange.count, 24);
  assert.equal(smoke.geometry.drawRange.count, 4);
  const vertices = marks.geometry.getAttribute("position");
  for (let i = 0; i < 12; i++) assert.ok(Math.abs(vertices.getX(i)) < 2);
  for (let i = 12; i < 24; i++) assert.ok(Math.abs(vertices.getX(i) - 12) < 2);
  fx.sample(5, "another driver", remote, 0, "taxi", false);
  assert.equal(marks.geometry.drawRange.count, 24);
  fx.reset(5);
  fx.sample(2, "local", local, 0, "coupe", false);
  assert.equal(marks.geometry.drawRange.count, 36);
  assert.equal(group.children.length, 2);
});
