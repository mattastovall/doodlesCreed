import assert from "node:assert/strict";
import test from "node:test";
import { Scene, PerspectiveCamera } from "three";
import { Spatial } from "../server/spatial.ts";
import { AudioEngine } from "../src/audio.ts";
import { Combat } from "../src/combat.ts";
import { COUNTY } from "../src/county.ts";
import { FISTS } from "../src/fists.ts";
import { generateLevel } from "../src/levels.ts";
import { Controller, Physics } from "../src/physics.ts";
import { PICKUP_RADIUS, weaponPickups } from "../src/weapon-pickups.ts";
import { distance } from "../src/world.ts";

for (const seed of [COUNTY, "rust", "city:paper"])
  test(seed + " offers all four guns at clear sites away from spawn", () => {
    const city = generateLevel(seed);
    const spatial = new Spatial(city.boxes);
    const drops = weaponPickups(city);
    assert.deepEqual(
      new Set(drops.map((d) => d.weapon)),
      new Set([0, 1, 2, 3]),
    );
    for (const { p } of drops) {
      assert.ok(spatial.clear(p));
      assert.ok(
        city.spawns.every((spawn) => distance(spawn, p) > PICKUP_RADIUS),
      );
    }
  });

test("solo pickup unlocks and equips the gun on foot", async () => {
  const physics = await Physics.create([]);
  const city = generateLevel("rust");
  const player = new Controller(physics, city.spawns[0]);
  const combat = new Combat(
    new Scene(),
    city,
    player,
    new AudioEngine(),
    false,
  );
  try {
    const camera = new PerspectiveCamera();
    const drop = combat.weaponDrops[0];
    assert.equal(combat.weapon, FISTS);
    assert.equal(combat.switchWeapon(drop.weapon), false);
    player.reset(drop.p);
    combat.update(1 / 60, 1, camera, false);
    assert.deepEqual(combat.owned, [FISTS]);
    combat.update(1 / 60, 2, camera);
    assert.equal(combat.weapon, drop.weapon);
    assert.ok(combat.mags[drop.weapon] > 0);
    combat.update(1 / 60, 3, camera);
    assert.equal(drop.mesh.visible, false);
    assert.ok(combat.switchWeapon(FISTS));
  } finally {
    combat.dispose();
    physics.dispose();
  }
});
