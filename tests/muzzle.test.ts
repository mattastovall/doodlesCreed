import test from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Scene, Vector3 } from "three";
import { buildWeapon } from "../src/actors.ts";
import { Combat } from "../src/combat.ts";
import { Controller, Physics } from "../src/physics.ts";
import { AudioEngine } from "../src/audio.ts";
import { disposeGroup } from "../src/render.ts";
test("every weapon muzzle stays ahead of the camera through turns and aiming poses", () => {
  for (let weapon = 0; weapon < 4; weapon++)
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const camera = new PerspectiveCamera();
      camera.position.set(10, 4, 20);
      camera.rotation.set(0.2, yaw, 0, "YXZ");
      const gun = buildWeapon(weapon);
      camera.add(gun);
      try {
        for (const ads of [false, true]) {
          gun.position.set(
            ads ? 0 : 0.3,
            ads ? -0.05 : -0.3,
            weapon === 2 ? -0.38 : -0.68,
          );
          gun.scale.setScalar(0.68);
          camera.updateMatrixWorld(true);
          const muzzle = gun
            .getObjectByName("muzzle")!
            .getWorldPosition(new Vector3());
          const direction = camera.getWorldDirection(new Vector3());
          assert.ok(muzzle.clone().sub(camera.position).dot(direction) > 0.5);
        }
      } finally {
        disposeGroup(gun);
      }
    }
});
test("shot visuals start at the supplied muzzle while hits stay aligned to the aim ray", async () => {
  const ph = await Physics.create([]);
  try {
    const p = new Controller(ph, [0, 0, 0]);
    const c = new Combat(
      new Scene(),
      { nodes: [], links: [], spawns: [[0, 0, 0]], streetNodes: [] } as any,
      p,
      new AudioEngine(),
      false,
    );
    c.collectWeapon(3);
    const muzzle = new Vector3(0.3, 1.3, -1.2);
    c.muzzlePosition = () => muzzle.clone();
    c.burst = () => {};
    c.fire();
    assert.equal(
      c.shotTrails.active.length,
      0,
      "must defer until visual pose is ready",
    );
    muzzle.x = 0.6; // Simulate bob/look changing between physics and rendering.
    c.renderShots(1 / 60);
    const shot = c.shotTrails.active[0];
    assert.ok(shot.from.equals(muzzle));
    assert.equal(shot.to.x, 0);
    assert.equal(shot.to.z, -220);
    assert.ok(
      shot.mesh.scale.y <= 14,
      "short streak instead of lingering beam",
    );
    const first = shot.mesh.position.clone();
    c.renderShots(1 / 60);
    assert.ok(shot.mesh.position.distanceTo(first) > 20);
    assert.ok(
      shot.from.equals(muzzle),
      "flight trajectory must not follow later gun motion",
    );
    c.dispose();
  } finally {
    ph.dispose();
  }
});
