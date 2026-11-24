import test from "node:test";
import assert from "node:assert/strict";
import { Physics, Controller, idleInput } from "../src/physics.ts";
const floor = {
  p: [0, -0.5, 0],
  s: [100, 1, 100],
  solid: true,
  kind: "ground",
} as any;
async function fixture(extra: any[] = []) {
  const p = await Physics.create([floor, ...extra]);
  const c = new Controller(p, [0, 0.03, 5]);
  return { p, c };
}
function frames(c: Controller, n: number, i = {}) {
  for (let j = 0; j < n; j++) c.update(1 / 120, { ...idleInput(), ...i });
}
test("player lands, accelerates while sprinting, jumps and retains air momentum", async () => {
  const { p, c } = await fixture();
  frames(c, 60);
  assert.ok(c.grounded);
  frames(c, 100, { forward: 1, sprint: true });
  assert.ok(c.speed > 10);
  c.update(1 / 120, { ...idleInput(), jump: true, forward: 1 });
  assert.ok(c.velocity.y > 8);
  const speed = c.speed;
  frames(c, 12);
  assert.ok(c.speed > speed * 0.95);
  p.dispose();
});
test("high speed movement cannot tunnel through a thin wall", async () => {
  const { p, c } = await fixture([
    { p: [0, 3, 0], s: [20, 6, 0.2], solid: true, kind: "wall" },
  ]);
  frames(c, 60);
  c.velocity.z = -80;
  frames(c, 20, { forward: 1 });
  assert.ok(c.position.z > 0.4);
  p.dispose();
});
test("vault clears a waist-high obstacle without deleting forward speed", async () => {
  const { p, c } = await fixture([
    { p: [0, 0.6, 2], s: [3, 1.2, 0.6], solid: true, kind: "prop" },
  ]);
  frames(c, 60);
  c.position.z = 3.3;
  c.velocity.z = -11;
  c.update(1 / 120, { ...idleInput(), forward: 1, jump: true });
  assert.equal(c.action, "VAULT");
  frames(c, 80, { forward: 1, sprint: true });
  assert.ok(c.position.z < 1.3);
  p.dispose();
});
test("grapple detachment preserves momentum and gives an upward release", async () => {
  const { p, c } = await fixture();
  c.velocity.set(12, 2, -9);
  c.anchor = { x: 0, y: 18, z: -15 };
  c.ropeLength = 20;
  c.releaseGrapple(true);
  assert.ok(c.speed >= 15);
  assert.ok(c.velocity.y >= 5);
  assert.equal(c.anchor, null);
  p.dispose();
});
test("reset clears held action latches so a fresh jump or vault is accepted", async () => {
  const { p, c } = await fixture([
    { p: [0, 0.6, 2], s: [3, 1.2, 0.6], solid: true, kind: "prop" },
  ]);
  frames(c, 60);
  c.update(1 / 120, { ...idleInput(), jump: true });
  c.reset([0, 0.03, 3.3]);
  c.velocity.z = -11;
  c.update(1 / 120, { ...idleInput(), forward: 1, jump: true });
  assert.equal(c.action, "VAULT");
  p.dispose();
});
test("immersed players paddle at the waterline and fall again after leaving the water", async () => {
  const { p, c } = await fixture();
  for (let frame = 0; frame < 450; frame++)
    c.update(1 / 120, { ...idleInput(), forward: 1 }, 4);
  assert.equal(c.action, "SWIM");
  assert.ok(Math.abs(c.position.y - 3) < 0.15);
  assert.ok(c.speed > 1 && c.speed < 6);
  frames(c, 240);
  assert.ok(c.grounded);
  p.dispose();
});
