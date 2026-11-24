import assert from "node:assert/strict";
import test from "node:test";
import { countyBlocks, countyStreetTree } from "../src/county.ts";
import { planCounty, terrainHeight } from "../src/county-plan.ts";
import { palmGeometry } from "../src/county-palm.ts";

test("street trunks stand on their lot and fitted crowns clear facades and traffic", () => {
  const { plan, lots } = planCounty();
  const boxes = countyBlocks(lots);
  const pieces = boxes.filter((b) => b.piece);
  const trees = boxes.filter((b) => b.kind === "county-tree");
  let fitted = 0;
  for (const { p, s } of trees) {
    const [x, y, z] = p;
    const tree = countyStreetTree(x, z);
    const base = Math.max(0.15, terrainHeight(x, z));
    assert.ok(Math.abs(y - s[1] / 2 - base) < 1e-8);
    assert.equal(s[1], tree.trunkHeight);
    assert.ok(s[0] > 0.17 && s[0] <= tree.diameter + 1e-8);
    assert.equal(s[0], s[2]);
    assert.ok(tree.crownBase > 3.7);
    const radius = (tree.crownRadius * s[0]) / tree.diameter;
    if (radius < tree.crownRadius - 0.01) fitted++;
    for (const b of pieces) {
      if (
        b.p[1] + b.s[1] / 2 < base + tree.crownBase ||
        b.p[1] - b.s[1] / 2 > base + tree.height
      )
        continue;
      const dx = Math.max(0, Math.abs(x - b.p[0]) - b.s[0] / 2),
        dz = Math.max(0, Math.abs(z - b.p[2]) - b.s[2] / 2);
      assert.ok(Math.hypot(dx, dz) > radius);
    }
    for (const street of plan.streets) {
      const dx = street.b[0] - street.a[0],
        dz = street.b[2] - street.a[2];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((x - street.a[0]) * dx + (z - street.a[2]) * dz) /
            (dx * dx + dz * dz || 1),
        ),
      );
      assert.ok(
        Math.hypot(x - street.a[0] - t * dx, z - street.a[2] - t * dz) >
          street.width / 2 + s[0] / 2,
      );
    }
  }
  assert.ok(trees.length > 150 && fitted > 20 && fitted < trees.length);
});

test("both palm meshes use stem dimensions and keep the same mature silhouette", () => {
  const tree = countyStreetTree(0, 0);
  assert.ok(tree.palm);
  const sizes = [false, true].map((far) => {
    const g = palmGeometry(far),
      p = g.getAttribute("position");
    let top = 0,
      spread = 0;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) * tree.trunkHeight;
      const r = Math.hypot(p.getX(i), p.getZ(i)) * tree.diameter;
      top = Math.max(top, y);
      spread = Math.max(spread, r);
      if (y < tree.crownBase) assert.ok(r <= tree.diameter * 0.53);
    }
    g.dispose();
    assert.ok(Math.abs(top - tree.height) < 0.12);
    assert.ok(spread <= tree.crownRadius);
    return spread;
  });
  assert.ok(Math.abs(sizes[0] - sizes[1]) < 0.15);
});
