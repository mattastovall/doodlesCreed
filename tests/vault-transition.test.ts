import { Vector3 } from "three";
import type { Box } from "../src/world.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { Physics, Controller, idleInput } from "../src/physics.ts";
test("vault is a collision-checked transition lasting at most 0.2 seconds and retains momentum", async () => {
  const physics = await Physics.create([
    { p: [0, -0.5, 0], s: [20, 1, 20], solid: true, kind: "ground" },
    { p: [0, 0.6, 2], s: [3, 1.2, 0.6], solid: true, kind: "prop" },
  ]);
  const p = new Controller(physics, [0, 0.03, 3.3]);
  p.velocity.z = -11;
  p.update(1 / 120, { ...idleInput(), forward: 1, jump: true });
  assert.equal(p.traversing, true);
  assert.equal(p.action, "VAULT");
  let time = 0,
    maxDelta = 0;
  let previous = p.position.clone();
  while (p.traversing && time < 0.5) {
    p.update(1 / 120, idleInput());
    time += 1 / 120;
    maxDelta = Math.max(maxDelta, p.position.distanceTo(previous));
    previous.copy(p.position);
  }
  assert.ok(time <= 0.2 + 1e-6, `duration ${time}`);
  assert.ok(maxDelta < 0.3, `single-frame travel ${maxDelta}`);
  assert.ok(p.position.z < 1.4, `landed at ${p.position.z}`);
  assert.ok(p.speed >= 11, "preserve incoming momentum");
  assert.equal(p.traversing, false);
  physics.dispose();
});

test("vaults through intact or already broken glass in either direction, keeping the sill and lintel solid", async () => {
  const pane: Box = {
    p: [0, 1.9, 0],
    s: [3, 1.7, 0.08],
    solid: true,
    kind: "window",
    piece: "fixture",
  };
  const physics = await Physics.create([
    { p: [0, -0.5, 0], s: [12, 1, 12], solid: true, kind: "ground" },
    { p: [0, 0.525, 0], s: [3, 1.05, 0.28], solid: true, kind: "exterior" },
    pane,
    { p: [0, 2.98, 0], s: [3, 0.46, 0.28], solid: true, kind: "exterior" },
  ]);
  try {
    const p = new Controller(physics, [0, 0.02, 1.15]);
    let requests = 0;
    p.onVaultGlass = () => {
      requests++;
    };
    for (const sign of [1, -1]) {
      p.reset([0, 0.02, sign * 1.15]);
      p.yaw = sign === 1 ? 0 : Math.PI;
      p.update(1 / 120, { ...idleInput(), forward: 1, jump: true });
      assert.equal(p.action, "VAULT");
      if (sign === 1) {
        p.update(1 / 120, idleInput());
        assert.ok(p.position.z > 1);
        pane.solid = false;
        physics.updateStructure(pane);
      }
      for (let i = 0; i < 32; i++) p.update(1 / 120, idleInput());
      assert.ok(p.position.z * sign < -0.4, "did not clear the sill");
    }
    assert.equal(requests, 1);
    assert.equal(
      physics.windowAhead(new Vector3(1.45, 0, 1), new Vector3(0, 0, -1)),
      undefined,
    );
  } finally {
    physics.dispose();
  }
});
