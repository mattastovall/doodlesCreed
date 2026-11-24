import assert from "node:assert/strict";
import test from "node:test";
import {
  countyWaterBounds,
  sampleCountyWater,
} from "../src/county-hydrology.ts";
import { alongStreet, planCounty, terrainHeight } from "../src/county-plan.ts";

function depth(x: number, z: number) {
  const water = sampleCountyWater(x, z);
  return water ? water.surfaceY - terrainHeight(x, z) : -Infinity;
}

test("a continuous downhill watercourse connects the high spring run to the lake and marsh", () => {
  const controls = [
    [290, 410],
    [267, 441],
    [280, 477],
    [312, 501],
    [312, 532],
    [284, 550],
    [269, 584],
    [236, 605],
    [200, 635],
    [128, 637],
    [90, 644],
    [69, 668],
    [42, 676],
    [10, 663],
    [-25, 669],
    [-50, 682],
    [-82, 681],
    [-110, 670],
    [-141, 677],
    [-170, 690],
  ];
  let previous = Infinity;
  for (const [i, [x, z]] of controls.entries()) {
    const [ax, az] = controls[Math.max(0, i - 1)];
    for (let step = 0; step <= 10; step++) {
      const xx = ax + ((x - ax) * step) / 10,
        zz = az + ((z - az) * step) / 10;
      const water = sampleCountyWater(xx, zz)!;
      assert.ok(depth(xx, zz) > 0.5);
      assert.ok(water.surfaceY <= previous + 1e-9);
      previous = water.surfaceY;
    }
  }
  assert.ok(depth(200, 635) > 8);
  assert.equal(sampleCountyWater(-335, -590)?.kind, "spring");
  assert.ok(depth(-335, -590) > 4);
  assert.equal(sampleCountyWater(-170, 690)?.kind, "marsh");
});

test("every water mesh fits within its bounds and its outer bank is dry on the collision triangles", () => {
  for (const { minX, maxX, minZ, maxZ } of countyWaterBounds) {
    for (let z: number = minZ; z <= maxZ; z += 4)
      for (let x: number = minX; x <= maxX; x += 4) {
        const water = sampleCountyWater(x, z);
        if (x === minX || x === maxX || z === minZ || z === maxZ)
          assert.equal(water, undefined);
        if (water && water.shoreDistance > 15) assert.ok(depth(x, z) < 0);
      }
  }
});

test("all street edges, parcels and roadside landmarks remain outside water and banks", () => {
  const { plan } = planCounty();
  for (const street of plan.streets) {
    for (let i = 0; i <= 8; i++)
      for (const sign of [-1, 1]) {
        const [x, , z] = alongStreet(
          street,
          i / 8,
          sign * (street.width / 2 + 4),
        );
        assert.equal(sampleCountyWater(x, z), undefined, street.id);
      }
  }
  const pads = [
    ...plan.parcels,
    ...plan.landmarks.map(({ p, size }) => ({
      x: p[0],
      z: p[2],
      w: size[0],
      d: size[2],
    })),
  ];
  for (const { x, z, w, d } of pads)
    for (const sx of [-0.5, 0, 0.5])
      for (const sz of [-0.5, 0, 0.5])
        assert.equal(sampleCountyWater(x + w * sx, z + d * sz), undefined);
});
