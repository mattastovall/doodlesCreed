import assert from "node:assert/strict";
import { test } from "node:test";
import { Spatial } from "../server/spatial.ts";
import { architectureLadders, cityLot } from "../src/county-architecture.ts";
import { CountyStructures } from "../src/county-structures.ts";

test("every county structure has a furnished interior reachable through a street-level door", () => {
  for (let design = 0; design <= 12; design++)
    for (const variation of [0, 0.5, 0.95]) {
      const boxes = cityLot(10, -20, design, variation);
      const spatial = new Spatial(boxes);
      const structures = new CountyStructures(boxes);
      for (const id of new Set(boxes.map((b) => b.buildingId))) {
        const members = boxes.filter((b) => b.buildingId === id);
        const entrance = members.find(
          (b) => b.kind === "entry-door" && b.p[1] < 2,
        )!;
        assert.ok(entrance, id);
        assert.ok(
          members.some((b) => b.piece === "furniture"),
          id,
        );
        assert.ok(
          members.some((b) => b.kind === "window"),
          id,
        );
        const [x, , z] = entrance.p;
        const y = entrance.p[1] - entrance.s[1] / 2 + 0.03;
        const a: [number, number, number] = [x, y, z + 1.15],
          b: [number, number, number] = [x, y, z - 1.15];
        assert.ok(spatial.clear(a), id + " approach");
        assert.ok(spatial.clear(b), id + " interior");
        assert.equal(spatial.movement(a, b, 1.76), false);
        structures.set(boxes.indexOf(entrance), 1);
        assert.ok(spatial.movement(a, b, 1.76), id + " open door");
      }
    }
});

test("each indoor ladder has capsule clearance through its hatch and a standing landing at both ends", () => {
  for (let design = 0; design <= 12; design++)
    for (const variation of [0, 0.5, 0.95]) {
      const pieces = cityLot(0, 0, design, variation);
      const spatial = new Spatial(pieces);
      for (const l of architectureLadders(pieces)) {
        const label = design + "/" + l.x + "," + l.z + "@" + l.top;
        for (let y = l.bottom + 0.02; y < l.top; y += 0.22)
          assert.ok(
            spatial.clear([l.x, y, l.z]),
            label + " obstructed at " + y,
          );
        assert.ok(spatial.clear(l.exit), label + " exit obstruction");
        const [ex, ey, ez] = l.exit;
        const floor = spatial.ray([ex, ey + 0.1, ez], [0, -1, 0], 0.35)?.box;
        assert.ok(
          floor?.piece === "floor" || floor?.piece === "roof",
          label + " exit floor",
        );
        assert.ok(
          spatial.ray([l.x, l.bottom + 0.1, l.z], [0, -1, 0], 0.3),
          label + " missing bottom",
        );
        const fixture = pieces.find((b) => b.ladder === l)!;
        fixture.solid = false;
        assert.equal(l.top, l.bottom);
        fixture.solid = true;
      }
    }
});

test("tower trusses admit sight lines through open bays and intercept shots on their cross braces", () => {
  for (const design of [11, 12]) {
    const truss = cityLot(0, 0, design, 0).find((piece) =>
      piece.kind.endsWith("-truss"),
    )!;
    const spatial = new Spatial([truss]);
    const [x, y, z] = truss.p;
    assert.equal(spatial.ray([x - 2, y, z], [1, 0, 0], 4)?.box, truss);
    assert.ok(!spatial.ray([x - 2, y, z - truss.s[2] * 0.26], [1, 0, 0], 4));
  }
});
