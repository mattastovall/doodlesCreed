import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket, WebSocketServer } from "ws";
import { Rooms } from "../server/rooms.ts";
import { COUNTY } from "../src/county.ts";
import { generateLevel } from "../src/levels.ts";
import { driveInput } from "../src/county-driving.ts";

test("County drivers advance only from timed, owned input; a real crash is broadcast, replayed packets cannot add motion", async () => {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(wss, "listening");
  const rooms = new Rooms(wss, generateLevel);
  const ws = new WebSocket(
    "ws://127.0.0.1:" + (wss.address() as { port: number }).port,
  );
  let observer: WebSocket | undefined;
  const observed: any[] = [];
  const messages: any[] = [];
  ws.on("message", (raw) => messages.push(JSON.parse(String(raw))));
  try {
    await once(ws, "open");
    ws.send(JSON.stringify({ type: "create", seed: COUNTY }));
    const joinDeadline = Date.now() + 10000;
    while (!messages.some((m) => m.type === "welcome")) {
      assert.ok(Date.now() < joinDeadline, "timed out joining test room");
      await delay(10);
    }
    const r = [...rooms.rooms.values()][0],
      [socket, p] = [...r.players][0],
      car = r.cars![0];
    observer = new WebSocket(ws.url);
    observer.on("message", (raw) => observed.push(JSON.parse(String(raw))));
    await once(observer, "open");
    observer.send(
      JSON.stringify({ type: "join", code: r.code, compact: true }),
    );
    car.access = "open"; // This fixture exercises driving after access has been earned.
    const f = r.city.boxes.find(
      (b) => b.kind === "foundation" && b.buildingId?.endsWith("/kiosk"),
    )!;
    const yaw = Math.PI / 2,
      s = Math.sin(yaw),
      c = Math.cos(yaw);
    car.p = [f.p[0] + s * 26 - c * 3.8, 0, f.p[2] + c * 26 + s * 3.8];
    car.yaw = yaw;
    p.p = [...car.p];
    rooms.handle(socket, {
      type: "vehicle",
      action: "enter",
      index: 0,
      driveVersion: 1,
    });
    assert.equal(car.driver, p.id);
    const state = {
      type: "state",
      vehicle: 0,
      p: [700, 45, 700],
      yaw: 2.4,
      pitch: 0,
    };
    const start = car.p;
    rooms.handle(socket, state);
    rooms.handle(socket, {
      ...state,
      vehicle: 1,
      drive: { seq: 1, inputs: [5] },
    });
    rooms.handle(socket, { ...state, drive: { seq: 1, inputs: [NaN] } });
    assert.deepEqual(car.p, start);
    const input = driveInput(1, 0, false);
    const first = {
      ...state,
      drive: { seq: 1, inputs: Array(12).fill(input) },
    };
    rooms.handle(socket, first);
    const firstP = car.p;
    rooms.handle(socket, first);
    assert.deepEqual(car.p, firstP);
    assert.ok(Math.hypot(firstP[0] - start[0], firstP[2] - start[2]) < 0.2);
    let seq = 13;
    for (
      let i = 0;
      i < 200 &&
      !messages.some(
        (m) =>
          m.type === "structure" && r.city.boxes[m.index].kind === "window",
      );
      i++
    ) {
      await delay(35);
      // A brief straight handbrake pull is visible to observers even without steering.
      const code = i >= 40 && i < 44 ? driveInput(1, 0, true) : input;
      rooms.handle(socket, {
        ...state,
        drive: { seq, inputs: [code, code, code, code] },
      });
      seq += 4;
    }
    await delay(50);
    assert.ok(messages.some((m) => m.type === "vehicle-drive" && m.seq >= 13));
    const roster = observed.filter((m) => m.type === "roster").at(-1);
    const actorIndex = roster.actors.findIndex(
      (actor: any) => actor.id === p.id,
    );
    assert.ok(actorIndex >= 0);
    assert.ok(
      observed.some(
        (m) => m.type === "snapshot" && m.actors[actorIndex]?.[18] === 0,
      ),
    );
    const snapshots = messages.filter((m) => m.type === "snapshot");
    assert.ok(
      snapshots.some((m) =>
        m.players.some(
          (actor: any) => actor.id === p.id && actor.skiddingCar === 0,
        ),
      ),
    );
    assert.ok(
      snapshots.every((m) =>
        m.players.every(
          (actor: any) => !actor.npc || actor.skiddingCar === undefined,
        ),
      ),
    );
    assert.equal(
      snapshots.at(-1).players.find((actor: any) => actor.id === p.id)
        .skiddingCar,
      undefined,
    );
    assert.ok(
      messages.some(
        (m) =>
          m.type === "structure" && r.city.boxes[m.index].kind === "window",
      ),
    );
    assert.ok(
      messages.some(
        (m) =>
          m.type === "rubble-spawn" &&
          m.indices.some((i: number) => r.city.boxes[i].piece === "wall"),
      ),
    );
    assert.ok(Math.hypot(car.p[0] - start[0], car.p[2] - start[2]) > 20);
    rooms.handle(socket, { type: "vehicle", action: "exit", index: 0 });
    const parked = [...car.p];
    rooms.handle(socket, { ...state, drive: { seq, inputs: [input] } });
    assert.deepEqual(car.p, parked);
  } finally {
    observer?.close();
    ws.close();
    rooms.dispose();
    wss.close();
  }
});
