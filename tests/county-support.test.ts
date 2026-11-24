import { test } from "node:test";
import assert from "node:assert/strict";
import { CountySupport } from "../src/county-support.ts";
import { cityLot } from "../src/county-architecture.ts";
import type { Box, V3 } from "../src/world.ts";

const part = (
  piece: NonNullable<Box["piece"]>,
  kind: string,
  p: V3,
  s: V3,
): Box => ({ piece, kind, p, s, solid: true, buildingId: "warehouse" });
const remove = (solver: CountySupport, boxes: Box[], index: number) => {
  boxes[index].solid = false;
  return solver.lost(index);
};

test("a surviving pier cannot balance an overhanging storey; connected roof, fittings and furniture fall with the floor", () => {
  const boxes = [
    part("floor", "foundation", [0, 0.1, 0], [10, 0.2, 8]),
    part("wall", "pier", [-4, 2.1, 0], [1, 3.8, 7]),
    part("wall", "pier", [4, 2.1, 0], [1, 3.8, 7]),
    part("floor", "upper-floor", [0, 4.1, 0], [10, 0.2, 8]),
    part("wall", "exterior", [-4, 6.1, 0], [1, 3.8, 7]),
    part("wall", "exterior", [4, 6.1, 0], [1, 3.8, 7]),
    part("roof", "flat-roof", [0, 8.1, 0], [10, 0.2, 8]),
    part("furniture", "desk", [0, 4.7, 0], [2, 1, 1]),
    part("fixture", "ceiling-light", [0, 3.95, 0], [1, 0.1, 1]),
  ];
  const s = new CountySupport(boxes),
    groups = remove(s, boxes, 2);
  assert.deepEqual(
    groups.map((g) => g.indices),
    [[3, 4, 5, 6, 7, 8]],
  );
  assert.ok(groups[0].direction[0] > 0.9, "falls away from the remaining pier");
  assert.ok(boxes[1].solid);
  assert.ok(boxes[3].solid, "the solver reports geometry without mutating it");
  assert.deepEqual(
    s.lost(2),
    [],
    "a released body is never reclaimed by the standing frame",
  );
});

test("removing a wall detaches its framed print and hinged leaf while a freestanding item stays planted", () => {
  const boxes = [
    part("floor", "foundation", [0, 0.1, 0], [10, 0.2, 8]),
    part("wall", "partition", [-2, 2.1, 0], [2, 3.8, 0.2]),
    part("fixture", "framed-print", [-2, 1.8, 0.14], [1, 0.6, 0.06]),
    part("door", "room-door", [0, 1.4, 0], [2, 2.4, 0.13]),
    part("furniture", "bench", [2, 0.7, 2], [2, 1, 1]),
  ];
  const s = new CountySupport(boxes);
  const groups = remove(s, boxes, 1);
  assert.deepEqual(groups.flatMap((g) => g.indices).sort(), [2, 3]);
  assert.deepEqual(
    remove(s, boxes, 0).flatMap((g) => g.indices),
    [4],
  );
});

test("glazing falls from a broken sill, while grounded jambs stay standing", () => {
  const boxes = [
    part("wall", "sill", [0, 0.6, 0], [3, 1.2, 0.24]),
    part("wall", "exterior", [-2, 2, 0], [1, 4, 0.24]),
    part("fixture", "window", [0, 2, 0], [3, 1.6, 0.08]),
  ];
  assert.deepEqual(
    remove(new CountySupport(boxes), boxes, 0).flatMap((g) => g.indices),
    [2],
  );
});

test("all generated shells are initially supported and destroying a furnishing cannot move an intact shell", () => {
  for (let d = 0; d <= 12; d++)
    for (const variation of [0, 0.5, 0.96]) {
      const boxes = cityLot(0, 0, d, variation),
        s = new CountySupport(boxes);
      for (const id of new Set(boxes.map((b) => b.buildingId))) {
        const item = boxes.findIndex(
          (b) => b.buildingId === id && b.piece === "furniture",
        );
        assert.deepEqual(remove(s, boxes, item), [], id);
      }
    }
});

test("an offset upper-storey load can tip a slab whose own centre still lies over a pier", () => {
  const boxes = [
    part("wall", "pier", [-4, 2, 0], [0.6, 4, 6]),
    part("wall", "pier", [0, 2, 0], [0.6, 4, 6]),
    part("floor", "upper-floor", [0, 4.1, 0], [10, 0.2, 6]),
    part("wall", "tower", [-3.2, 7.2, 0], [2.4, 6, 5]),
  ];
  const groups = remove(new CountySupport(boxes), boxes, 0);
  assert.deepEqual(
    groups.map((g) => g.indices),
    [[2, 3]],
  );
  assert.ok(groups[0].direction[0] < -0.9);
});

test("storey boundaries retain ceiling mounts and offset wall brackets", () => {
  const boxes = [
    part("wall", "exterior", [0, 1.5, 0], [4, 3, 0.2]),
    part("roof", "flat-roof", [0, 3.11, 0], [4, 0.2, 2]),
    // A recessed fitting can have a small mounting gap across the 3 m bucket edge.
    part("fixture", "ceiling-light", [0, 2.93, 0.5], [1, 0.08, 0.2]),
    part("fixture", "framed-print", [0, 1.6, 0.44], [1, 0.6, 0.05]),
  ];
  const solver = new CountySupport(boxes);
  assert.deepEqual(
    remove(solver, boxes, 1).flatMap((g) => g.indices),
    [2],
  );
  assert.deepEqual(
    remove(solver, boxes, 0).flatMap((g) => g.indices),
    [3],
  );
});

test("losing a ground-level tower truss brings down the upper landmark assembly", () => {
  for (const [design, upperKind] of [
    [11, "hoist-sheave"],
    [12, "county-roof"],
  ] as const) {
    const pieces = cityLot(0, 0, design, 0.55);
    const side = pieces.findIndex((p) => p.kind.endsWith("-truss"));
    const solver = new CountySupport(pieces);
    const lost = remove(solver, pieces, side).flatMap((group) => group.indices);
    assert.ok(
      lost.some((i) => pieces[i].kind === upperKind),
      upperKind,
    );
    assert.ok(lost.some((i) => pieces[i].kind === "ladder"));
    assert.ok(!lost.some((i) => pieces[i].kind === "foundation"));
  }
});
