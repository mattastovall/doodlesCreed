import assert from "node:assert/strict";
import test from "node:test";
import type { CityPlan } from "../src/city-plan.ts";
import { countyDriveSpray } from "../src/county-drive-lens.ts";
import { alongStreet, planCounty } from "../src/county-plan.ts";

test("traffic lanes, shoulders, street junctions and paved lot aprons generate no spray", () => {
  const { plan } = planCounty();
  for (const s of plan.streets) {
    for (const t of [0, 0.5, 1]) {
      const width = s.endWidths
        ? s.endWidths[0] + (s.endWidths[1] - s.endWidths[0]) * t
        : s.width;
      const [x, , z] = alongStreet(s, t, width / 2 + 0.72);
      assert.equal(countyDriveSpray(plan, x, z), undefined, s.id);
    }
  }
  for (const p of plan.parcels)
    assert.equal(
      countyDriveSpray(plan, p.x + p.w * 0.48, p.z - p.d * 0.48),
      undefined,
      p.id,
    );
});

test("tapered rural shoulders end at the actual pavement before grass begins", () => {
  const plan: CityPlan = {
    streets: [
      {
        id: "county-road-test",
        a: [190, 0, 716],
        b: [230, 0, 716],
        width: 18,
        endWidths: [8, 18],
        class: "arterial",
      },
    ],
    blocks: [],
    parcels: [],
    landmarks: [],
    bridges: [],
  };
  assert.equal(countyDriveSpray(plan, 192, 720.5), undefined);
  assert.equal(countyDriveSpray(plan, 192, 721.7), "grass");
  assert.equal(countyDriveSpray(plan, 227, 724), undefined);
});
test("damp shore soils produce mud while dry grass, deep water and desert differ", () => {
  const { plan } = planCounty();
  assert.equal(countyDriveSpray(plan, 200, 716), "grass");
  assert.equal(countyDriveSpray(plan, 200, 690), "mud");
  assert.equal(countyDriveSpray(plan, 200, 635), undefined);
  assert.equal(countyDriveSpray(plan, -760, -690), undefined);
});
