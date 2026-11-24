import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CountyDriveWorld,
  driveInput,
  type DrivePose,
} from "../src/county-driving.ts";
import type { Box, V3 } from "../src/world.ts";

const w = driveInput(1, 0, false),
  neutral = driveInput(0, 0, false);
const car = (speed: number, yaw = 0): DrivePose => ({
  p: [-320, 0, 0],
  yaw,
  speed,
  steer: 0,
});
const block = (p: V3, s: V3, kind = "exterior"): Box => ({
  p,
  s,
  kind,
  solid: true,
  piece: kind === "window" ? "fixture" : "wall",
});
test("the bumper strikes glazing and supports across its width, with speed loss and vertical clearance", () => {
  const glass = block([-319.1, 1.05, -2.6], [0.08, 0.8, 0.08], "window");
  const wall = block([-320, 0.41, -2.6], [5, 0.82, 0.2]);
  const lintel = block([-320, 2.55, -2.6], [5, 1.2, 0.2]);
  const behind = block([-320, 1, 3.2], [5, 2, 0.2]);
  const beside = block([-318.7, 1, -2.6], [0.25, 2, 0.2]);
  const city = new CountyDriveWorld([wall, glass, lintel, behind, beside]);
  const slow = car(2);
  for (let i = 0; i < 80; i++)
    city.advance(slow, "saloon", w, () =>
      assert.fail("a parking-speed hit caused damage"),
    );
  assert.equal(slow.speed, 0);
  const fast = car(30);
  const hit = new Set<Box>();
  for (let i = 0; i < 8; i++)
    city.advance(fast, "saloon", neutral, (b, energy) => {
      assert.ok(energy >= 150);
      hit.add(b);
      b.solid = false;
    });
  assert.deepEqual(hit, new Set([glass, wall]));
  assert.ok(fast.p[2] < -1 && fast.speed > 20 && fast.speed < 30);
});
test("bicycle response changes with speed, wheelbase and reversing; curbs rise and descend", () => {
  const curb: Box = {
    p: [-320, 0.075, -4],
    s: [20, 0.15, 3],
    kind: "pavement",
    solid: true,
  };
  const city = new CountyDriveWorld([curb]);
  const pose = car(8),
    levels = new Set<number>();
  for (let i = 0; i < 160; i++) {
    city.advance(pose, "taxi", w);
    levels.add(pose.p[1]);
  }
  assert.deepEqual(levels, new Set([0, 0.15]));
  assert.equal(pose.p[1], 0);
  const rest = car(0);
  city.advance(rest, "saloon", driveInput(0, 1, false));
  assert.equal(rest.yaw, 0);
  const turn = (speed: number, kind: "saloon" | "delivery") => {
    const r = car(speed);
    const steer = driveInput(0, 1, false);
    city.advance(r, kind, steer);
    assert.ok(Math.abs(r.steer) < 0.04);
    for (let i = 0; i < 60; i++) city.advance(r, kind, steer);
    return r;
  };
  assert.ok(turn(8, "saloon").yaw < 0 && turn(-8, "saloon").yaw > 0);
  assert.ok(
    Math.abs(turn(8, "delivery").yaw) > Math.abs(turn(8, "saloon").yaw),
  );
  assert.ok(
    Math.abs(turn(25, "saloon").steer) < Math.abs(turn(8, "saloon").steer),
  );
});
test("large fallen sections block new contacts but permit escape from an existing overlap", () => {
  const b = block([-320, 1, -3], [5, 2, 0.2]);
  b.solid = false;
  const pose = {
    id: 1,
    p: [-320, 1, -3] as V3,
    origin: [...b.p] as V3,
    q: [0, 0, 0, 1] as [number, number, number, number],
    sleep: false,
  };
  const city = new CountyDriveWorld([b], () => [{ id: 1, indices: [0], pose }]);
  const approaching = car(20);
  for (let i = 0; i < 30; i++) city.advance(approaching, "coupe", w);
  assert.ok(approaching.p[2] > -1 && approaching.speed === 0);
  const trapped = car(-8);
  trapped.p[2] = -3;
  for (let i = 0; i < 90; i++)
    city.advance(trapped, "coupe", driveInput(-1, 0, false));
  assert.ok(trapped.p[2] > 1 && trapped.speed < 0);
});

test("parked and in-motion civilian chassis stop the driver at the bumper and permit backing out", () => {
  const own = {
    kind: "saloon" as const,
    p: [-320, 0, 0] as V3,
    yaw: 0,
    driver: "local",
  };
  const other = {
    kind: "delivery" as const,
    p: [-320, 0, -7] as V3,
    yaw: Math.PI / 2,
    driver: "civilian-driver-0",
  };
  const city = new CountyDriveWorld(
    [],
    () => [],
    () => [own, other],
  );
  const pose = car(21);
  for (let i = 0; i < 75; i++) city.advance(pose, "saloon", w, undefined, own);
  assert.equal(pose.speed, 0);
  assert.ok(pose.p[2] > -3.9 && pose.p[2] < -3.2);
  other.driver = "";
  other.p = [...pose.p]; // Traffic can be moved between authoritative samples.
  for (let i = 0; i < 240; i++)
    city.advance(pose, "saloon", driveInput(-1, 0, false), undefined, own);
  assert.ok(pose.p[2] > 0 && pose.speed < 0);
});

test("fleet launch, coasting, service brake and reverse use distinct responses", () => {
  const world = new CountyDriveWorld([]);
  const run = (
    kind: "coupe" | "delivery",
    speed: number,
    input: number,
    steps: number,
  ) => {
    const pose = car(speed);
    for (let i = 0; i < steps; i++) world.advance(pose, kind, input);
    return pose.speed;
  };
  const launch = run("coupe", 0, w, 120);
  assert.ok(launch > 6 && launch < 7);
  assert.ok(run("delivery", 0, w, 120) < launch);
  assert.ok(run("coupe", 25, w, 120) - 25 < launch);
  assert.ok(run("coupe", 20, neutral, 120) > 18);
  assert.equal(run("coupe", 20, driveInput(1, 0, true), 300), 0);
  const reverse = driveInput(-1, 0, false);
  assert.ok(run("coupe", 10, reverse, 60) > 0);
  assert.ok(run("coupe", 0, reverse, 240) < -4);
});
