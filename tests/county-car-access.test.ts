import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { Rooms } from "../server/rooms.ts";
import {
  ACCESS_MS,
  advanceSeatAction,
  seatAction,
  startSeatAction,
} from "../src/county-car-access.ts";
import { COUNTY, parkedCars } from "../src/county.ts";
import { generateLevel } from "../src/levels.ts";

test("parked fleet has a deterministic 40% lockpick allocation and timed, ordered access", () => {
  const fleet = parkedCars();
  assert.deepEqual(fleet, parkedCars());
  assert.equal(
    fleet.filter((c) => c.access === "locked").length,
    fleet.length * 0.4,
  );
  assert.ok(
    fleet.every((c) => c.access === "locked" || c.access === "secured"),
  );
  const secured = fleet.find((c) => c.access === "secured")!;
  for (const attempt of ["enter", "hotwire", "lockpick", "hijack", "secured"])
    assert.equal(startSeatAction(secured, "a", attempt, 0), false);
  const car = fleet.find((c) => c.access === "locked")!;
  assert.equal(startSeatAction(car, "a", "hotwire", 0), false);
  assert.ok(startSeatAction(car, "a", "lockpick", 0));
  assert.equal(startSeatAction(car, "b", "lockpick", 20), false);
  assert.equal(advanceSeatAction(car, true, ACCESS_MS.lockpick - 1), undefined);
  assert.equal(advanceSeatAction(car, false, ACCESS_MS.lockpick), "canceled");
  assert.equal(seatAction(car), "lockpick");
  startSeatAction(car, "a", "lockpick", 1000);
  assert.equal(advanceSeatAction(car, true, 1110, true), "missed");
  startSeatAction(car, "a", "lockpick", 1200);
  assert.equal(
    advanceSeatAction(car, true, 1200 + ACCESS_MS.lockpick),
    "missed",
  );
  startSeatAction(car, "a", "lockpick", 2000);
  assert.equal(
    advanceSeatAction(car, true, 2000 + ACCESS_MS.lockpick * 0.6, true),
    "lockpick",
  );
  assert.equal(seatAction(car), "hotwire");
  assert.equal(car.driver, null);
  startSeatAction(car, "a", "hotwire", 4000);
  assert.equal(
    advanceSeatAction(car, true, 4000 + ACCESS_MS.hotwire * 0.6, true),
    "hotwire",
  );
  assert.equal(car.driver, "a");
  car.driver = null;
  assert.equal(seatAction(car), "enter");
});

test("room owns civilian and player hijacks, rejects competing claims, distance and stale driver packets", async () => {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(wss, "listening");
  const rooms = new Rooms(wss, generateLevel);
  const url = "ws://127.0.0.1:" + (wss.address() as { port: number }).port;
  const clients: WebSocket[] = [];
  async function join(packet: object) {
    const ws = new WebSocket(url);
    clients.push(ws);
    await once(ws, "open");
    const joined = new Promise<any>((resolve) => {
      ws.on("message", (raw) => {
        const m = JSON.parse(String(raw));
        if (m.type === "welcome") resolve(m);
      });
    });
    ws.send(JSON.stringify(packet));
    return joined;
  }
  try {
    const welcome = await join({ type: "create", seed: COUNTY });
    await join({ type: "join", code: welcome.code });
    const room = rooms.rooms.get(welcome.code)!;
    const [[firstSocket, first], [secondSocket, second]] = [...room.players];
    const cars = room.cars!;
    const index = cars.findIndex((c) =>
      c.driver?.startsWith("civilian-driver-"),
    );
    const car = cars[index];
    const citizen = room.citizens!.actors.find((a) => a.id === car.driver)!;
    const hijack = {
      type: "vehicle",
      action: "hijack",
      driveVersion: 1,
      index,
    };
    const finish = () => {
      car.interaction!.started -= ACCESS_MS.hijack;
      rooms.tick();
    };
    second.p = [car.p[0] + 20, car.p[1], car.p[2]];
    rooms.handle(secondSocket, hijack);
    assert.equal(cars[index].interaction, undefined);
    first.p = [...car.p];
    second.p = [...car.p];
    rooms.handle(firstSocket, hijack);
    rooms.handle(secondSocket, hijack);
    assert.equal(car.driver, citizen.id);
    assert.equal(car.interaction?.actor, first.id);
    finish();
    assert.equal(car.driver, first.id);
    assert.equal(citizen.car, undefined);
    rooms.handle(secondSocket, hijack);
    assert.equal(car.interaction?.actor, second.id);
    const position = [...car.p];
    rooms.handle(firstSocket, {
      type: "state",
      vehicle: index,
      drive: { seq: 1, inputs: [5, 5, 5] },
    });
    assert.deepEqual(car.p, position);
    finish();
    assert.equal(car.driver, second.id);
    assert.notDeepEqual(first.p, car.p);
    rooms.handle(firstSocket, {
      type: "state",
      vehicle: index,
      drive: { seq: 10, inputs: [5, 5, 5] },
    });
    assert.deepEqual(car.p, position);
    const secured = cars.findIndex((c) => c.access === "secured");
    first.p = [...cars[secured].p];
    rooms.handle(firstSocket, {
      type: "vehicle",
      action: "enter",
      index: secured,
      access: "open",
    });
    assert.equal(cars[secured].driver, null);
    const locked = cars.findIndex((c) => c.access === "locked");
    const parked = cars[locked];
    first.p = [...parked.p];
    const request = (action: string, started?: number) =>
      rooms.handle(firstSocket, {
        type: "vehicle",
        index: locked,
        action,
        started,
        driveVersion: 1,
      });
    request("lockpick");
    request("confirm", -1);
    assert.equal(parked.interaction?.actor, first.id);
    request("confirm", parked.interaction!.started);
    assert.equal(parked.access, "locked");
    for (const stage of ["lockpick", "hotwire"] as const) {
      request(stage);
      parked.interaction!.started = Date.now() - ACCESS_MS[stage] * 0.6;
      request("confirm", parked.interaction!.started);
    }
    assert.equal(parked.access, "open");
    assert.equal(parked.driver, first.id);
    // Isolate the network seat and walking checks from buildings and terrain.
    first.p = parked.p = [120, 40, 120];
    parked.yaw = 0;
    request("exit");
    assert.equal(parked.driver, null);
    const outside = [...first.p];
    assert.ok(Math.abs(outside[0] - parked.p[0]) > 2);
    const walk = (p: number[]) =>
      rooms.handle(firstSocket, {
        type: "state",
        vehicle: -1,
        p,
        yaw: 0,
        pitch: 0,
      });
    first.moveCredit = 8;
    walk([2 * parked.p[0] - outside[0], outside[1], outside[2]]);
    assert.deepEqual(
      first.p,
      outside,
      "a single on-foot sample cannot cross the chassis",
    );
    walk([outside[0], outside[1], outside[2] + 0.5]);
    assert.equal(
      first.p[2],
      outside[2] + 0.5,
      "the exited driver can immediately walk alongside the car",
    );
  } finally {
    clients.forEach((ws) => ws.close());
    rooms.dispose();
    wss.close();
  }
});
