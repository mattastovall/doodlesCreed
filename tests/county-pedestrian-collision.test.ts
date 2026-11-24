import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { Physics } from "../src/physics.ts";
import { Spatial } from "../server/spatial.ts";
import {
  insideVehicle,
  vehicleEntersRunner,
} from "../src/county-pedestrian-collision.ts";
import { exitCarPosition } from "../src/county-car-access.ts";
import type { CountyCar } from "../src/county.ts";

test("walking physics slides along a turned vehicle, lands on its roof, and follows its current position", async () => {
  const physics = await Physics.create([]);
  const car: CountyCar = {
    kind: "saloon",
    p: [0, 0, 0],
    yaw: Math.PI / 2,
    driver: null,
  };
  physics.walkingFleet = () => [car];
  try {
    const p = new Vector3(-1, 0, 3);
    physics.move(p, new Vector3(2, 0, -4), 1.76);
    assert.ok(p.z > 1.37 && p.z < 1.39);
    assert.ok(Math.abs(p.x - 1) < 0.001);
    const roof = new Vector3(0, 3, 0);
    assert.ok(physics.move(roof, new Vector3(0, -4, 0), 1.76).grounded);
    assert.ok(Math.abs(roof.y - 1.45) < 0.002);
    assert.equal(physics.clear(new Vector3(0, 0, 0)), false);
    car.p = [10, 0, 0];
    assert.equal(physics.clear(new Vector3(0, 0, 0)), true);
    assert.equal(physics.clear(new Vector3(10, 0, 0)), false);
    physics.move(p, new Vector3(0, 0, -3), 1.76);
    assert.ok(p.z < 0);
  } finally {
    physics.dispose();
  }
});

test("server detects complete crossings, allows rooftop travel and exits to an unblocked side", () => {
  const spatial = new Spatial([]);
  const car: CountyCar = {
    kind: "minivan",
    p: [0, 0, 0],
    yaw: Math.PI / 4,
    driver: "driver",
  };
  const fleet = [car];
  assert.equal(spatial.movement([-4, 0, 0], [4, 0, 0], 1.76, fleet), false);
  assert.equal(spatial.movement([-4, 1.8, 0], [4, 1.8, 0], 1.76, fleet), true);
  const exit = exitCarPosition(car, (p) => p[0] > 0)!;
  assert.ok(exit[0] > 0);
  assert.equal(insideVehicle(car, exit, 1.76), false);
  assert.equal(spatial.movement(exit, [4, 0, -4], 1.76, fleet), true);
  assert.equal(
    exitCarPosition(car, () => false),
    undefined,
  );
});

test("moving vehicle hulls stop at a standing runner and exempt seated drivers and NPC impact targets", () => {
  const car: CountyCar = {
    kind: "saloon",
    p: [0, 0, 0],
    yaw: 0,
    driver: "driver",
  };
  const next: CountyCar = { ...car, p: [0, 0, 0.3] };
  const runner = {
    id: "runner",
    hp: 100,
    p: [0, 0, 3] as [number, number, number],
    height: 1.76,
  };
  assert.ok(vehicleEntersRunner(car, next, [runner], car.driver));
  assert.equal(
    vehicleEntersRunner(car, next, [{ ...runner, npc: true }], car.driver),
    false,
  );
  assert.equal(
    vehicleEntersRunner(car, next, [{ ...runner, id: "driver" }], car.driver),
    false,
  );
});
