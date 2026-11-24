import assert from "node:assert/strict";
import test from "node:test";
import { ViewMotion, sensitivityScale } from "../src/motion.ts";
test("raised and lowered ground eases within 150ms without delaying jumps", () => {
  const m = new ViewMotion();
  m.trackHeight(1.6, true, 0, 1 / 120);
  m.trackHeight(1.9, true, 0, 1 / 120);
  assert.ok(m.eyeY > 1.6 && m.eyeY < 1.7);
  for (let i = 0; i < 18; i++) m.trackHeight(1.9, true, 0, 1 / 120);
  assert.ok(Math.abs(m.eyeY - 1.9) < 0.02);
  m.trackHeight(1.7, true, 0, 1 / 120);
  assert.ok(m.eyeY > 1.8);
  for (let i = 0; i < 90; i++) m.trackHeight(1.7, true, 0, 1 / 120);
  const before = m.eyeY;
  m.trackHeight(1.8, false, 0, 1 / 120);
  assert.ok(m.eyeY - before >= 0.1 - 1e-6);
  m.trackHeight(8, true, 1, 1 / 120);
  assert.equal(m.eyeY, 8);
});
test("ADS reverses from current blend and sensitivity follows rendered FOV", () => {
  const m = new ViewMotion();
  m.update(1 / 60, true, 8, true, false, 82);
  assert.ok(m.ads > 0 && m.ads < 0.5);
  const a = m.ads;
  m.update(1 / 60, false, 8, true, false, 82);
  assert.ok(m.ads < a && m.ads > 0);
  for (let i = 0; i < 30; i++) m.update(1 / 60, true, 0, true, false, 82);
  assert.ok(m.ads > 0.99);
  assert.ok(Math.abs(m.fov - 57) < 0.05);
  assert.equal(sensitivityScale(82, 82), 1);
  assert.ok(sensitivityScale(57, 82) < 0.65);
});
test("shots add bounded recoil, damp stride and preserve phase; ADS settles look sway fast", () => {
  const m = new ViewMotion();
  m.update(0.1, false, 8, true, false, 82);
  const phase = m.phase;
  m.shot(0);
  const first = m.kick;
  m.shot(0);
  assert.ok(m.kick > first);
  assert.equal(m.phase, phase);
  assert.ok(m.fireWeight > 0.9);
  m.look(20, 10);
  for (let i = 0; i < 12; i++) m.update(1 / 60, true, 0, true, false, 82);
  assert.ok(Math.abs(m.swayX) < 0.0001);
  assert.ok(Math.abs(m.swayY) < 0.0001);
  assert.ok(m.kick < 0.05);
});

test("stance changes and flickering stair contacts never bypass height smoothing", () => {
  const m = new ViewMotion();
  m.trackHeight(1.6, true, 0, 1 / 120);
  m.trackHeight(0.92, true, 0, 1 / 120, 0);
  assert.ok(
    Math.abs(m.eyeY - 1.6) < 0.12,
    "crouch must not pop by the offset clamp",
  );
  for (let i = 0; i < 30; i++) m.trackHeight(0.92, true, 0, 1 / 120, 0);
  const before = m.eyeY;
  m.trackHeight(1.6, false, 0, 1 / 120, 0);
  assert.ok(
    m.eyeY - before < 0.12,
    "lost contact must not snap the standing eye height",
  );
});

test("speed lens ramps by movement mode and respects reduced motion and aiming", () => {
  const view = new ViewMotion();
  const settle = (
    speed: number,
    mode: "run" | "swing" | "chase" | "cockpit",
    reduce = false,
    aim = false,
  ) => {
    for (let i = 0; i < 120; i++)
      view.update(1 / 60, aim, speed, true, reduce, 82, 57, mode);
    return view.fov;
  };
  assert.ok(Math.abs(settle(13.2, "run") - 88) < 0.01);
  assert.ok(Math.abs(settle(34, "swing") - 96) < 0.01);
  assert.ok(Math.abs(settle(38, "chase") - 98) < 0.01);
  assert.ok(Math.abs(settle(38, "cockpit") - 92) < 0.01);
  assert.equal(settle(38, "chase", true), 82);
  assert.ok(Math.abs(settle(13, "run", false, true) - 57) < 0.01);
});
