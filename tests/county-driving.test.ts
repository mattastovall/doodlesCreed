import { terrainHeight } from "../src/county-plan.ts";
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
  assert.ok(launch > 9 && launch < 9.4);
  assert.ok(run("delivery", 0, w, 120) < launch);
  assert.ok(run("coupe", 25, w, 120) - 25 < launch);
  assert.ok(run("coupe", 20, neutral, 120) > 18);
  assert.equal(run("coupe", 20, driveInput(1, 0, true), 300), 0);
  const reverse = driveInput(-1, 0, false);
  assert.ok(run("coupe", 10, reverse, 60) > 0);
  assert.ok(run("coupe", 0, reverse, 240) < -4);
});

test("handbrake rotates the chassis across its trajectory, replays mid-slide, and recovers grip", () => {
  const world = new CountyDriveWorld([]);
  const drift = car(20),
    corner = car(20);
  const handbrake = driveInput(1, 1, true);
  for (let i = 0; i < 100; i++) {
    world.advance(drift, "coupe", handbrake);
    world.advance(corner, "coupe", driveInput(1, 1, false));
  }
  assert.ok(drift.speed > 17);
  assert.ok(Math.abs(drift.slip!) > 0.5 && Math.abs(corner.slip!) < 0.1);
  assert.ok(Math.abs(drift.yaw) > Math.abs(corner.yaw) * 2);
  const server: DrivePose = JSON.parse(JSON.stringify(drift));
  const before = [...drift.p];
  world.advance(drift, "coupe", handbrake);
  world.advance(server, "coupe", handbrake);
  const heading = Math.atan2(before[0] - drift.p[0], before[2] - drift.p[2]);
  assert.ok(Math.abs(heading - (drift.yaw - drift.slip!)) < 0.02);
  for (let i = 0; i < 75; i++) {
    world.advance(drift, "coupe", w);
    world.advance(server, "coupe", w);
  }
  assert.deepEqual(server, drift);
  assert.ok(Math.abs(drift.slip!) < 0.02);
});

test("sideways momentum collides with a wall beside the chassis", () => {
  const wall = block([-318.45, 1, 0], [0.1, 2, 12]);
  const world = new CountyDriveWorld([wall]);
  const pose = car(15);
  pose.slip = 0.85;
  for (let i = 0; i < 20; i++) world.advance(pose, "coupe", neutral);
  assert.equal(pose.speed, 0);
  assert.equal(pose.slip, 0);
  assert.ok(pose.p[0] < -319.45);
});
test("a car can ford the lake margin and reverse back out at the deep-water limit", () => {
  const world = new CountyDriveWorld([]);
  const pose = car(12);
  pose.p = [200, terrainHeight(200, 745), 745];
  for (let i = 0; i < 1000; i++) world.advance(pose, "saloon", w);
  const wetZ = pose.p[2];
  assert.ok(wetZ < 720 && wetZ > 635);
  assert.equal(pose.speed, 0);
  assert.ok(22 - pose.p[1] > 0.6 && 22 - pose.p[1] <= 0.85);
  for (let i = 0; i < 300; i++)
    world.advance(pose, "saloon", driveInput(-1, 0, false));
  assert.ok(pose.p[2] > wetZ + 5);
});

test("lifting off tightens a fast grip corner and countersteering catches a handbrake slide", () => {
  const world = new CountyDriveWorld([]);
  const power = car(20),
    lift = car(20),
    drift = car(20);
  for (let tick = 0; tick < 90; tick++) {
    world.advance(power, "coupe", driveInput(1, 1, false));
    world.advance(lift, "coupe", driveInput(0, 1, false));
    world.advance(drift, "coupe", driveInput(1, 1, true));
  }
  assert.ok(Math.abs(lift.yaw) > Math.abs(power.yaw) * 1.35);
  assert.ok(Math.abs(lift.slip!) < 0.15 && lift.speed > 19);
  assert.ok(Math.abs(drift.slip!) > 0.5);
  const catchSlide = structuredClone(drift);
  for (let tick = 0; tick < 18; tick++) {
    world.advance(catchSlide, "coupe", driveInput(1, -1, false));
    world.advance(drift, "coupe", w);
  }
  assert.ok(Math.abs(catchSlide.slip!) < Math.abs(drift.slip!) * 0.7);
});
