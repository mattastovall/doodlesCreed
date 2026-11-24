import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket, WebSocketServer } from "ws";
import { generateLevel } from "../src/levels.ts";
import { Rooms } from "../server/rooms.ts";
const delay = (n: number) => new Promise((r) => setTimeout(r, n));
async function connect(port: number) {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const messages: any[] = [];
  ws.on("message", (r) => messages.push(JSON.parse(String(r))));
  await new Promise((r) => ws.once("open", r));
  return { ws, messages };
}
async function until(fn: () => any) {
  for (let i = 0; i < 60; i++) {
    const v = fn();
    if (v) return v;
    await delay(25);
  }
  throw Error("message timeout");
}
test("default public joins share one server-owned NPC simulation and reconnect to populated lobby", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const rooms = new Rooms(wss);
  const a = await connect((wss.address() as any).port),
    b = await connect((wss.address() as any).port);
  try {
    a.ws.send(JSON.stringify({ type: "public", name: "A", seed: "untrusted" }));
    b.ws.send(JSON.stringify({ type: "public", name: "B", seed: "different" }));
    const wa = await until(() => a.messages.find((m) => m.type === "welcome")),
      wb = await until(() => b.messages.find((m) => m.type === "welcome"));
    assert.equal(wa.code, wb.code);
    assert.equal(wa.seed, wb.seed);
    assert.equal(wa.public, true);
    const snapshot = await until(() =>
      a.messages.find(
        (m) =>
          m.type === "snapshot" &&
          m.players.filter((p: any) => !p.npc).length === 2,
      ),
    );
    assert.equal(snapshot.players.filter((p: any) => p.npc).length, 4);
    const room = rooms.rooms.get(wa.code)!;
    const bot = room.npcs[0];
    const hp = bot.hp;
    a.ws.send(
      JSON.stringify({ type: "damage", target: bot.id, amount: 99999 }),
    );
    await delay(60);
    assert.equal(bot.hp, hp);
  } finally {
    a.ws.close();
    b.ws.close();
    rooms.dispose();
    wss.close();
  }
});
test("server ammunition, reload time and movement budget cannot be bypassed by packet spam", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const rooms = new Rooms(wss);
  const a = await connect((wss.address() as any).port);
  try {
    a.ws.send(JSON.stringify({ type: "create", name: "A" }));
    const wa = await until(() => a.messages.find((m) => m.type === "welcome"));
    const room = rooms.rooms.get(wa.code)!;
    const p = [...room.players.values()][0];
    p.owned.push(0);
    p.weapon = 0;
    p.mags[0] = 1;
    p.lastShot = 0;
    rooms.handle(a.ws, { type: "fire" }); // real membership socket is server side below
    const serverSocket = [...room.players.keys()][0];
    rooms.handle(serverSocket, { type: "fire" });
    assert.equal(p.mags[0], 0);
    p.lastShot = 0;
    rooms.handle(serverSocket, { type: "fire" });
    assert.equal(p.mags[0], 0);
    rooms.handle(serverSocket, { type: "reload" });
    assert.ok(p.reloadUntil > Date.now());
    p.lastShot = 0;
    rooms.handle(serverSocket, { type: "fire" });
    assert.equal(p.mags[0], 0);
    const start = [...p.p];
    p.moveCredit = 3;
    const movementStart = Date.now();
    p.lastMove = movementStart;
    for (let i = 0; i < 40; i++)
      rooms.handle(serverSocket, {
        type: "state",
        p: [p.p[0] + 1, p.p[1], p.p[2]],
        yaw: 0,
        pitch: 0,
        weapon: 0,
      });
    assert.ok(
      Math.abs(p.p[0] - start[0]) <=
        3.1 + ((Date.now() - movementStart) / 1000) * 55,
      "per-packet tolerance must not permit unlimited travel",
    );
  } finally {
    a.ws.close();
    rooms.dispose();
    wss.close();
  }
});

test("server NPCs attack real players and stay defeated until wave clear", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const rooms = new Rooms(wss);
  const a = await connect((wss.address() as any).port);
  try {
    a.ws.send(JSON.stringify({ type: "public", name: "Target" }));
    const wa = await until(() => a.messages.find((m) => m.type === "welcome"));
    const room = rooms.rooms.get(wa.code)!;
    const human = [...room.players.values()][0],
      bot = room.npcs[0];
    human.p = [bot.p[0], bot.p[1], bot.p[2] + 2];
    human.shieldUntil = 0;
    bot.thinkAt = Date.now() + 10000;
    bot.path = [];
    bot.lastShot = 0;
    const acquired = Date.now();
    room.ai!.update(
      1 / 30,
      acquired,
      [human],
      () => {},
      () => {},
    );
    assert.equal(human.hp, 100, "newly spotted targets get a reaction window");
    for (let frame = 1; frame <= 100; frame++)
      room.ai!.update(
        1 / 30,
        acquired + (frame * 1000) / 30,
        [human],
        (target, attacker, damage) =>
          rooms.hurt(room, target, attacker, damage),
        () => {},
      );
    assert.ok(human.hp < 100, "server NPC must aim before inflicting damage");
    bot.hp = 0;
    bot.deadAt = Date.now() - 7000;
    room.ai!.update(
      1 / 30,
      Date.now(),
      [human],
      () => {},
      () => {},
    );
    assert.equal(bot.hp, 0, "dead NPCs must not respawn during a wave");
    // Place both actors on the same clear street for a server-resolved headshot.
    human.p = [bot.p[0], bot.p[1], bot.p[2] + 2];
    human.yaw = 0;
    human.pitch = 0;
    human.hp = 100;
    human.owned.push(0);
    human.weapon = 0;
    human.mags[0] = 30;
    human.lastShot = 0;
    bot.shieldUntil = 0;
    bot.hp = 1;
    rooms.handle([...room.players.keys()][0], { type: "fire" });
    assert.equal(bot.hp, 0, "human shot must kill the server NPC");
    assert.equal(human.kills, 1);
    const kill = await until(() => a.messages.find((m) => m.type === "kill"));
    assert.ok(kill, "server broadcasts the shared kill");
  } finally {
    a.ws.close();
    rooms.dispose();
    wss.close();
  }
});

test("public matchmaking overflows full rooms and NPC state remains isolated", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const rooms = new Rooms(wss);
  const clients: Awaited<ReturnType<typeof connect>>[] = [];
  try {
    for (let i = 0; i < 17; i++) {
      const c = await connect((wss.address() as any).port);
      clients.push(c);
      c.ws.send(JSON.stringify({ type: "public", name: "P" + i }));
      await until(() => c.messages.find((m) => m.type === "welcome"));
    }
    const first = clients[0].messages.find((m) => m.type === "welcome"),
      last = clients[16].messages.find((m) => m.type === "welcome");
    assert.notEqual(first.code, last.code);
    assert.equal(first.seed, last.seed);
    const a = rooms.rooms.get(first.code)!,
      b = rooms.rooms.get(last.code)!;
    assert.equal(a.players.size, 16);
    assert.equal(b.players.size, 1);
    a.npcs[0].hp = 1;
    assert.equal(b.npcs[0].hp, 100);
  } finally {
    clients.forEach((c) => c.ws.close());
    rooms.dispose();
    wss.close();
  }
});

test("loading clients cannot fight until their first valid state, and reload completion is replicated", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const rooms = new Rooms(wss),
    a = await connect((wss.address() as any).port);
  try {
    a.ws.send(JSON.stringify({ type: "public", compact: true }));
    const welcome = await until(() =>
      a.messages.find((m) => m.type === "welcome"),
    );
    const room = rooms.rooms.get(welcome.code)!;
    const [ws, p] = [...room.players.entries()][0];
    p.owned.push(0);
    p.weapon = 0;
    p.mags[0] = 30;
    assert.equal(p.ready, false);
    rooms.handle(ws, { type: "fire" });
    assert.equal(p.mags[0], 30);
    rooms.hurt(room, p, room.npcs[0], 100);
    assert.equal(p.hp, 100);
    rooms.handle(ws, { type: "state", p: p.p, yaw: 0, pitch: 0, weapon: 0 });
    assert.equal(p.ready, true);
    assert.ok(Number.isFinite(p.shieldUntil));
    rooms.handle(ws, { type: "fire" });
    assert.equal(p.mags[0], 29);
    rooms.handle(ws, { type: "reload" });
    p.reloadUntil = Date.now() - 1;
    rooms.tick();
    const ammo = await until(() =>
      a.messages.find((m) => m.type === "ammo" && m.reloadRemaining === 0),
    );
    assert.equal(ammo.mags[0], 30);
  } finally {
    a.ws.close();
    rooms.dispose();
    wss.close();
  }
});

test("public wave two spawns new actors and sends wave metadata with compact rosters", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const rooms = new Rooms(wss);
  const a = await connect((wss.address() as any).port);
  try {
    a.ws.send(
      JSON.stringify({ type: "public", name: "Wave tester", compact: true }),
    );
    const welcome = await until(() =>
      a.messages.find((m) => m.type === "welcome"),
    );
    const room = rooms.rooms.get(welcome.code)!;
    const human = [...room.players.values()][0];
    human.ready = true;
    human.shieldUntil = Date.now() + 60000;
    room.npcs.forEach((n) => (n.hp = 0));
    room.ai!.waves.nextIn = 0.0000001;
    rooms.tick();
    rooms.tick();
    const snapshot = await until(() =>
      a.messages.find(
        (m) =>
          m.type === "snapshot" && m.wave?.number === 2 && m.wave.alive > 0,
      ),
    );
    assert.equal(snapshot.wave.alive + snapshot.wave.queued, 7);
    const roster = a.messages.filter((m) => m.type === "roster").at(-1);
    assert.equal(roster.actors.length, snapshot.actors.length);
    assert.ok(roster.actors.some((p: any) => p.npc));
  } finally {
    a.ws.close();
    rooms.dispose();
    wss.close();
  }
});

test("Rust rejects mismatched maps and keeps every join/respawn slot inside its perimeter", async () => {
  const { generateRust, RUST_SCALE } = await import("../src/rust.ts");
  const { insideRust } = await import("../src/rust-boundary.ts");
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const rooms = new Rooms(wss, generateRust);
  const a = await connect((wss.address() as any).port),
    b = await connect((wss.address() as any).port);
  try {
    a.ws.send(
      JSON.stringify({ type: "public", name: "Old tab", mapScale: 1.1 }),
    );
    const error = await until(() => a.messages.find((m) => m.type === "error"));
    assert.match(error.message, /Refresh/);
    assert.ok(!a.messages.some((m) => m.type === "welcome"));
    b.ws.send(
      JSON.stringify({
        type: "public",
        name: "Current tab",
        mapScale: RUST_SCALE,
      }),
    );
    const welcome = await until(() =>
      b.messages.find((m) => m.type === "welcome"),
    );
    const room = rooms.rooms.get(welcome.code)!;
    for (let i = 0; i < 32; i++) {
      const p = rooms.spawn(room, i);
      assert.ok(insideRust(p, 0.7));
      assert.ok(room.spatial.clear(p));
    }
    b.ws.send(
      JSON.stringify({
        type: "state",
        p: [50, 1, 0],
        yaw: 0,
        pitch: 0,
        height: 1.76,
        weapon: 0,
      }),
    );
    const correction = await until(() =>
      b.messages.find((m) => m.type === "correction"),
    );
    assert.ok(insideRust(correction.p, 0.7));
  } finally {
    a.ws.close();
    b.ws.close();
    rooms.dispose();
    wss.close();
  }
});

test("boarding keeps the parked pose across late walking packets and old driving packets after exit", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const rooms = new Rooms(wss, generateLevel),
    a = await connect((wss.address() as any).port);
  try {
    a.ws.send(JSON.stringify({ type: "public", seed: "switchback-county" }));
    const welcome = await until(() =>
      a.messages.find((m) => m.type === "welcome"),
    );
    const room = rooms.rooms.get(welcome.code)!,
      [socket, runner] = [...room.players][0],
      car = room.cars![0],
      parked = [...car.p];
    car.access = "open"; // This fixture exercises driving after access has been earned.
    const facing = car.yaw + 1.8,
      heading = car.yaw;
    runner.moveCredit = 6;
    runner.p = [car.p[0] - 2, car.p[1], car.p[2]];
    const walking = {
      type: "state",
      p: [...runner.p],
      yaw: facing,
      pitch: 0,
      vehicle: -1,
    };
    rooms.handle(socket, walking);
    rooms.handle(socket, { type: "vehicle", action: "enter", index: 0 });
    rooms.handle(socket, walking);
    assert.equal(car.driver, runner.id);
    assert.equal(
      car.yaw,
      heading,
      "a walking camera packet rotated a parked car",
    );
    assert.deepEqual(car.p, parked);
    assert.equal(runner.yaw, heading);
    rooms.handle(socket, { type: "vehicle", action: "enter", index: 0 });
    assert.equal(car.driver, runner.id);
    const driving = {
      type: "state",
      p: [car.p[0], car.p[1], car.p[2] - 0.15],
      yaw: heading + 0.03,
      pitch: 0,
      vehicle: 0,
    };
    rooms.handle(socket, driving);
    assert.equal(car.yaw, driving.yaw);
    rooms.handle(socket, { type: "vehicle", action: "exit", index: 0 });
    rooms.handle(socket, { ...driving, yaw: 2.9 });
    assert.equal(car.driver, null);
    assert.equal(car.yaw, driving.yaw);
    assert.equal(runner.yaw, driving.yaw);
  } finally {
    a.ws.close();
    rooms.dispose();
    wss.close();
  }
});
