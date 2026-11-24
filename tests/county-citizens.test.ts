import assert from "node:assert/strict";
import test from "node:test";
import { CountyCitizens, type CitizenAction } from "../src/county-citizens.ts";
import { countyCars, countyWorld, parkedCars } from "../src/county.ts";
import { Spatial } from "../server/spatial.ts";
import { distance, type V3 } from "../src/world.ts";

const city = countyWorld();
const spatial = new Spatial(city.boxes);
const noop = () => {};
function setup() {
  const cars = countyCars(),
    ai = new CountyCitizens(city, cars, spatial);
  return { cars, ai };
}
function player(id: string, p: V3, notoriety: number) {
  return { id, p, hp: 100, height: 1.76, notoriety };
}

test("both towns retain their parked fleet while deterministic citizens walk and drive interconnected streets", () => {
  const { cars, ai } = setup(),
    repeat = setup();
  assert.deepEqual(cars.slice(0, 30), parkedCars());
  assert.deepEqual(ai.actors, repeat.ai.actors);
  const starts = ai.actors.map((a) => [...a.p] as V3),
    traveled = starts.map(() => 0);
  for (const a of ai.actors) assert.ok(spatial.clear(a.p));
  for (let i = 0; i < 900; i++) {
    const last = ai.actors.map((a) => a.p);
    ai.update(1 / 30, (i * 1000) / 30, [], noop, noop);
    repeat.ai.update(1 / 30, (i * 1000) / 30, [], noop, noop);
    ai.actors.forEach((a, j) => (traveled[j] += distance(last[j], a.p)));
  }
  assert.deepEqual(ai.actors, repeat.ai.actors);
  assert.deepEqual(cars, repeat.cars);
  assert.equal(ai.actors.length, 32);
  assert.deepEqual(cars.slice(0, 30), parkedCars());
  ai.actors.forEach((a, i) => {
    assert.ok(
      traveled[i] > (a.car === undefined ? 25 : 80),
      a.id + " traveled " + traveled[i],
    );
    if (a.car !== undefined) {
      assert.equal(cars[a.car].driver, a.id);
      assert.deepEqual(cars[a.car].p, a.p);
    }
  });
});

test("reactions use the individual player's notoriety, sight line and opportunity", () => {
  for (const [level, range, expected] of [
    [30, 1, null],
    [31, 1, "shove"],
    [50, 1, "shove"],
    [51, 1, "punch"],
    [75, 9, null],
    [76, 9, "shot"],
  ] as const) {
    const { ai } = setup(),
      a = ai.actors[0];
    ai.actors.splice(1);
    const innocent = player("neighbor", [a.p[0], a.p[1], a.p[2] + 0.25], 0);
    // Stay on the same open sidewalk for the distant shot.
    const target = player(
      "offender",
      [
        a.p[0] - Math.sin(a.yaw) * range,
        a.p[1],
        a.p[2] - Math.cos(a.yaw) * range,
      ],
      level,
    );
    const actions: CitizenAction[] = [],
      shots: V3[] = [];
    ai.update(
      1 / 30,
      1000,
      [innocent, target],
      (p, bot, damage, kind) => {
        assert.equal(p.id, target.id);
        assert.equal(bot, a);
        assert.equal(damage > 0, kind !== "shove");
        actions.push(kind);
      },
      (_bot, to) => shots.push(to),
    );
    assert.deepEqual(actions, expected ? [expected] : []);
    assert.equal(shots.length, expected === "shot" ? 1 : 0);
  }
  const cars = countyCars(),
    ai = new CountyCitizens(city, cars, {
      ray: () => true,
      clear: () => false,
      movement: () => false,
    });
  const a = ai.actors[0],
    origin = [...a.p];
  ai.actors.splice(1);
  ai.update(
    1 / 30,
    1200,
    [player("hidden", [a.p[0] + 1, a.p[1], a.p[2]], 100)],
    () => assert.fail(),
    () => assert.fail(),
  );
  assert.deepEqual(a.p, origin);
  assert.equal(a.targetId, undefined);
});

test("drivers brake for calm pedestrians and active human car ownership survives civilian recovery", () => {
  const { ai, cars } = setup();
  const a = ai.actors.find((c) => c.car !== undefined)!,
    slot = a.car!,
    car = cars[slot];
  ai.actors.splice(0, ai.actors.length, a);
  const start = [...car.p] as V3;
  const p = player(
    "human",
    [
      car.p[0] - 2.3 * Math.sin(car.yaw),
      car.p[1],
      car.p[2] - 2.3 * Math.cos(car.yaw),
    ],
    30,
  );
  ai.update(1 / 30, 1000, [p], () => assert.fail(), noop);
  assert.deepEqual(car.p, start);
  p.notoriety = 100;
  const hits: CitizenAction[] = [];
  ai.update(
    1 / 30,
    1100,
    [p],
    (target, _bot, _damage, k) => {
      assert.equal(target, p);
      hits.push(k);
    },
    noop,
  );
  ai.update(1 / 30, 1200, [p], (_t, _b, _d, k) => hits.push(k), noop);
  assert.deepEqual(hits, ["ram"]);
  a.hp = 0;
  ai.update(1 / 30, 1300, [], noop, noop);
  assert.equal(car.driver, null);
  car.driver = p.id;
  const stopped = [...car.p];
  ai.update(1 / 30, 30000, [], noop, noop);
  assert.equal(a.hp, 100);
  assert.equal(a.car, undefined);
  assert.equal(car.driver, p.id);
  assert.deepEqual(car.p, stopped);
});

test("a knocked-down citizen suspends activity, then walks and heals without changing identity", () => {
  const { ai } = setup(),
    a = ai.actors[0],
    original = [...a.p];
  a.hp = 65;
  a.downUntil = 6000;
  ai.update(1 / 30, 1000, [], noop, noop);
  assert.deepEqual(a.p, original);
  assert.equal(a.hp, 65);
  ai.update(1 / 30, 7000, [], noop, noop);
  assert.notDeepEqual(a.p, original);
  assert.equal(a.hp, 65);
  ai.update(1 / 30, 13000, [], noop, noop);
  assert.equal(a.hp, 70);
  const count = ai.actors.length;
  a.hp = 0;
  ai.update(1 / 30, 14000, [], noop, noop);
  ai.update(1 / 30, 41000, [], noop, noop);
  assert.equal(a.hp, 100);
  assert.equal(ai.actors[0], a);
  assert.equal(ai.actors.length, count);
});

test("a driver cuts in front of a notorious motorist while ordinary traffic stays in its lane", () => {
  function trajectory(level: number) {
    const { cars, ai } = setup();
    const a = ai.actors.find((a) => a.car !== undefined)!;
    ai.actors.splice(0, ai.actors.length, a);
    const c = cars[a.car!],
      forward = [-Math.sin(c.yaw), -Math.cos(c.yaw)],
      side = [Math.cos(c.yaw), -Math.sin(c.yaw)];
    const start = [...c.p] as V3;
    const other = player(
      "driver",
      [
        start[0] + 6 * side[0] + 3 * forward[0],
        start[1],
        start[2] + 6 * side[1] + 3 * forward[1],
      ],
      level,
    );
    cars[0] = { p: other.p, yaw: c.yaw, kind: "taxi", driver: other.id };
    for (let i = 1; i <= 18; i++)
      ai.update(
        1 / 30,
        1000 + (i * 1000) / 30,
        [other],
        () => assert.fail(),
        noop,
      );
    return (c.p[0] - start[0]) * side[0] + (c.p[2] - start[2]) * side[1];
  }
  assert.ok(Math.abs(trajectory(30)) < 0.01);
  assert.ok(trajectory(31) > 1);
});

test("nearby civilian and human drivers share a seated mesh that moves through the door during hijacking", async () => {
  const { CountyCarModel } = await import("../src/county-car.ts");
  const { Group, Mesh, MeshBasicMaterial } = await import("three");
  const template = new Group(),
    coat = new MeshBasicMaterial();
  template.userData = {
    seat: [-0.37, 1.16, 0.375],
    wheelRadius: 0.34,
    doorSide: -1,
  };
  for (const tier of ["near", "street", "far"]) {
    const level = new Group(),
      door = new Group();
    level.name = tier;
    door.name = tier + "_door";
    level.add(door);
    template.add(level);
    if (tier === "near")
      for (const name of ["dial0", "dial1"]) {
        const dial = new Group();
        dial.name = name;
        level.add(dial);
      }
  }
  const a = new CountyCarModel(template, coat, coat),
    b = new CountyCarModel(template, coat, coat);
  const seated = a.getObjectByName("civilian-driver")!,
    other = b.getObjectByName("civilian-driver")!;
  assert.ok(seated instanceof Mesh && other instanceof Mesh);
  assert.equal(seated.geometry, other.geometry);
  assert.equal(seated.material, other.material);
  assert.equal(seated.parent?.name, "near");
  assert.deepEqual(seated.position.toArray(), template.userData.seat);
  a.update("civilian-driver-0", 1, 5);
  assert.ok(seated.visible);
  assert.equal(other.visible, false);
  a.update("civilian-driver-0", 2, 12);
  assert.equal(seated.visible, false);
  a.update("human", 3, 2);
  assert.ok(seated.visible, "an approaching player can see the occupied seat");
  a.update("human", 3.1, 2, 0, false, false, undefined, true);
  assert.equal(seated.visible, false, "keep the driver's cockpit view clear");
  a.update("human", 3.5, 2, 0, false, false, 0.8, true);
  assert.ok(seated.visible);
  assert.ok(seated.position.x < template.userData.seat[0] - 1.5);
  assert.ok(Math.abs(a.getObjectByName("near_door")!.rotation.y) > 1);
  a.update("civilian-driver-0", 4, 2);
  assert.ok(seated.visible);
  assert.deepEqual(seated.position.toArray(), template.userData.seat);
  a.update(null, 5, 2);
  assert.equal(seated.visible, false);
  coat.dispose();
});
