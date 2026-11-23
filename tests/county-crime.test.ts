import test from "node:test";
import assert from "node:assert/strict";
import { CountyShops, cleanRecord, wanted } from "../src/county-crime.ts";
import { CountyCitizens } from "../src/county-citizens.ts";
import { countyWorld, countyCars } from "../src/county.ts";
import { Spatial } from "../server/spatial.ts";
import type { V3 } from "../src/world.ts";

function setup() {
  const world = countyWorld(),
    shops = new CountyShops(world.boxes),
    q = new Spatial(world.boxes);
  const t = shops.tills[0],
    p: V3 = [t.box.p[0], 0.21, t.box.p[2] + t.box.s[2] / 2 + 0.7];
  assert.ok(q.clear(p, 1.76));
  return { world, shops, t, p, ray: q.ray.bind(q), q };
}
test("a usable County counter has a single take which banks after escape", () => {
  const { shops, t, p, ray } = setup(),
    r = cleanRecord(),
    second = cleanRecord();
  assert.ok(shops.tills.length > 1);
  assert.equal(shops.start("one", r, p, 1.76, true, 1, ray), undefined);
  assert.equal(
    shops.start("one", r, p, 1.76, false, 1, () => true),
    undefined,
  );
  assert.equal(
    shops.start("one", r, p, 1.76, false, 1, ray),
    "Alarm triggered",
  );
  assert.equal(
    shops.start("two", second, p, 1.76, false, 10, ray),
    "Someone is already at this till",
  );
  shops.update("one", r, p, 1.76, false, true, 3000, ray, []);
  assert.equal(r.take, 0);
  assert.equal(r.stars, 1);
  shops.update("one", r, p, 1.76, false, true, 3002, ray, []);
  assert.equal(r.take, t.value);
  assert.equal(r.cash, 0);
  assert.equal(
    shops.start("two", second, p, 1.76, false, 9000, ray),
    "This till is empty",
  );
  shops.update("one", r, p, 1.76, false, true, r.escapeAt + 1, ray, []);
  assert.equal(r.cash, t.value);
  assert.equal(r.take, 0);
  assert.equal(r.stars, 0);
  assert.ok(shops.buyAid(r, p, 1.76, ray));
  assert.equal(r.cash, t.value - 100);
});
test("arrest requires sustained officer contact and forfeits only unbanked cash", () => {
  const { world, shops, p, ray, q } = setup(),
    r = cleanRecord();
  r.cash = 100;
  r.take = 250;
  wanted(r, p, 1);
  const police = new CountyCitizens(world, countyCars(), q).actors.filter(
    (a) => a.name === "Police officer",
  );
  assert.equal(police.length, 6);
  const cop = police.find((a) => a.car === undefined)!;
  cop.targetId = "one";
  cop.p = [...p];
  shops.update("one", r, p, 1.76, false, true, 100, ray, police);
  assert.ok(r.arrestAt > 100);
  const end = r.arrestAt;
  shops.update("one", r, p, 1.76, true, true, end, ray, police);
  assert.equal(r.arrestAt, 0);
  shops.update("one", r, p, 1.76, false, true, end + 1, ray, police);
  assert.equal(
    shops.update("one", r, p, 1.76, false, true, r.arrestAt + 1, ray, police),
    "Busted",
  );
  assert.equal(r.take, 0);
  assert.equal(r.cash, 100);
  assert.equal(r.stars, 0);
});
test("destroyed tills and leaving the counter cancel collection", () => {
  const { shops, p, t, ray } = setup(),
    r = cleanRecord();
  shops.start("one", r, p, 1.76, false, 1, ray);
  shops.update(
    "one",
    r,
    [p[0] + 10, p[1], p[2]],
    1.76,
    false,
    true,
    4000,
    ray,
    [],
  );
  assert.equal(r.shop, -1);
  assert.equal(r.take, 0);
  shops.start("two", r, p, 1.76, false, 4001, ray);
  t.box.solid = false;
  shops.update("two", r, p, 1.76, false, true, 8000, ray, []);
  assert.equal(r.take, 0);
  assert.equal(r.shop, -1);
});

test("an on-duty officer ignores bystanders, pursues a visible suspect and arrests after contact", () => {
  const { world, shops, q } = setup(),
    ai = new CountyCitizens(world, countyCars(), q);
  const officer = ai.actors.find(
    (a) => a.name === "Police officer" && a.car === undefined,
  )!;
  ai.actors.splice(0, ai.actors.length, officer);
  const p: V3 = [
    officer.p[0] - Math.sin(officer.yaw) * 3,
    officer.p[1],
    officer.p[2] - Math.cos(officer.yaw) * 3,
  ];
  const r = cleanRecord(),
    suspect = { id: "suspect", p, hp: 100, height: 1.76, crime: r };
  const bystander = {
    id: "bystander",
    hp: 100,
    height: 1.76,
    p: [officer.p[0] + 2, officer.p[1], officer.p[2] + 2] as V3,
  };
  wanted(r, p, 1000);
  let busted = false;
  for (let tick = 0; tick < 150; tick++) {
    const now = 1000 + (tick * 1000) / 30;
    ai.update(
      1 / 30,
      now,
      [bystander, suspect],
      () => assert.fail("low-level arrest must not injure"),
      () => assert.fail(),
    );
    if (tick === 0) assert.equal(officer.targetId, suspect.id);
    if (
      shops.update(
        suspect.id,
        r,
        p,
        1.76,
        false,
        true,
        now,
        q.ray.bind(q),
        ai.actors,
      ) === "Busted"
    ) {
      busted = true;
      break;
    }
  }
  assert.ok(busted);
  assert.equal(r.stars, 0);
});
