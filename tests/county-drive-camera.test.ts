import assert from "node:assert/strict";
import test from "node:test";
import { CountyDriveCamera } from "../src/county-drive-camera.ts";

test("drift camera follows through a wrapped turn, settles on exit and resets on a seat change", () => {
  const camera = new CountyDriveCamera();
  const dt = 1 / 60;
  camera.update(dt, 3.12, 20, 0, false);
  camera.update(dt, -3.12, 20, 0, false);
  assert.ok(camera.heading > 3.12 && camera.heading < Math.PI);
  const vibration = new Set<number>();
  for (let i = 0; i < 45; i++) {
    camera.update(dt, -2.7, 20, 0.65, false);
    vibration.add(camera.vibration);
  }
  assert.ok(camera.boom > 6.5 && camera.zoom > 2 && camera.bank > 0.035);
  assert.equal(vibration.size, 45);
  for (let i = 0; i < 150; i++) camera.update(dt, -2.7, 0, 0, false);
  assert.ok(camera.boom < 5.51 && Math.abs(camera.vibration) < 0.0001);
  camera.reset();
  camera.update(dt, 0, 43, 0, false);
  assert.equal(camera.zoom, 0);
  camera.update(dt, 1, 30, 0.8, true);
  assert.deepEqual(
    [camera.heading, camera.bank, camera.boom, camera.zoom, camera.vibration],
    [1, 0, 6, 0, 0],
  );
});
