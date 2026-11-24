import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket, WebSocketServer } from "ws";
import { Rooms } from "../server/rooms.ts";
function next(ws: WebSocket, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", read);
      reject(Error("No " + type));
    }, 3000);
    function read(raw: any) {
      const m = JSON.parse(String(raw));
      if (m.type === type) {
        clearTimeout(timer);
        ws.off("message", read);
        resolve(m);
      }
    }
    ws.on("message", read);
  });
}
async function client(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on("open", r));
  return ws;
}
test("real websocket clients join the same city and invalid rooms return a useful error", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on("listening", r));
  const rooms = new Rooms(wss);
  const port = (wss.address() as any).port;
  const a = await client(port),
    b = await client(port);
  try {
    const ready = next(a, "welcome");
    a.send(JSON.stringify({ type: "create", name: "Alice", seed: "paper" }));
    const room = await ready;
    assert.equal(room.seed, "paper");
    assert.match(room.code, /^[A-Z0-9]{5}$/);
    const err = next(b, "error");
    b.send(JSON.stringify({ type: "join", code: "XXXXX", name: "Bob" }));
    assert.match((await err).message, /exist/i);
    const joined = next(b, "welcome");
    b.send(JSON.stringify({ type: "join", code: room.code, name: "Bob" }));
    const data = await joined;
    assert.equal(data.seed, room.seed);
    assert.notEqual(data.id, room.id);
    const snapshot = await next(a, "snapshot");
    assert.equal(snapshot.players.length, 2);
    const closed = next(a, "snapshot");
    b.close();
    await closed;
    await new Promise((r) => setTimeout(r, 80));
    assert.equal((await next(a, "snapshot")).players.length, 1);
  } finally {
    a.close();
    b.close();
    rooms.dispose();
    wss.close();
  }
});
test("the server owns damage and scores, rejects client-specified damage and blocks shots through buildings", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on("listening", r));
  const rooms = new Rooms(wss),
    port = (wss.address() as any).port,
    a = await client(port),
    b = await client(port);
  try {
    const ra = next(a, "welcome");
    a.send(JSON.stringify({ type: "create", name: "Alice", seed: "paper" }));
    const welcome = await ra;
    const rb = next(b, "welcome");
    b.send(JSON.stringify({ type: "join", name: "Bob", code: welcome.code }));
    await rb;
    const room = rooms.rooms.get(welcome.code)!;
    const [shooter, victim] = [...room.players.values()];
    shooter.owned.push(0);
    shooter.weapon = 0;
    shooter.mags[0] = 30;
    shooter.p = [15, 0.1, 20];
    victim.p = [15, 0.1, 10];
    shooter.yaw = 0;
    shooter.pitch = 0;
    victim.shieldUntil = 0;
    a.send(
      JSON.stringify({ type: "damage", target: victim.id, amount: 99999 }),
    );
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(victim.hp, 100);
    const hit = next(a, "hit");
    a.send(JSON.stringify({ type: "fire", amount: 99999 }));
    await hit;
    assert.ok(victim.hp > 0 && victim.hp < 100);
    const hp = victim.hp;
    a.send(JSON.stringify({ type: "fire" }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(
      victim.hp,
      hp,
      "fire-rate limit must reject rapid repeat shots",
    );
    for (let i = 0; i < 5 && victim.hp > 0; i++) {
      await new Promise((r) => setTimeout(r, 125));
      a.send(JSON.stringify({ type: "fire" }));
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.equal(victim.hp, 0);
    assert.equal(shooter.kills, 1);
    assert.equal(victim.deaths, 1);
    const wall = room.city.boxes.find(
      (b) => b.kind === "wall" && b.s[0] === 0.16 && b.s[1] > 3,
    )!;
    victim.hp = 100;
    victim.p = [wall.p[0] + 2, 0.1, wall.p[2]];
    shooter.p = [wall.p[0] - 2, 0.1, wall.p[2]];
    shooter.yaw = -Math.PI / 2;
    shooter.lastShot = 0;
    a.send(JSON.stringify({ type: "fire" }));
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(
      victim.hp,
      100,
      "front and rear walls block a shot through the building",
    );
  } finally {
    a.close();
    b.close();
    rooms.dispose();
    wss.close();
  }
});

test("crouching replicates body height and moves the server weapon origin down", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on("listening", r));
  const rooms = new Rooms(wss),
    a = await client((wss.address() as any).port);
  try {
    const ready = next(a, "welcome");
    a.send(JSON.stringify({ type: "create", name: "Croucher", seed: "paper" }));
    const welcome = await ready;
    const player = [...rooms.rooms.get(welcome.code)!.players.values()][0];
    player.owned.push(0);
    player.mags[0] = 30;
    const snapshot = next(a, "snapshot");
    a.send(
      JSON.stringify({
        type: "state",
        p: welcome.spawn,
        yaw: 0,
        pitch: 0,
        weapon: 0,
        height: 1.08,
      }),
    );
    const state = await snapshot;
    assert.equal(state.players[0].height, 1.08);
    const shot = next(a, "shot");
    a.send(JSON.stringify({ type: "fire" }));
    const data = await shot;
    assert.ok(Math.abs(data.from[1] - (welcome.spawn[1] + 0.92)) < 0.001);
  } finally {
    a.close();
    rooms.dispose();
    wss.close();
  }
});

test("multiplayer accepts outer-city movement and anchors, then enforces the generated boundary", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on("listening", r));
  const rooms = new Rooms(wss),
    a = await client((wss.address() as any).port);
  try {
    const ready = next(a, "welcome");
    a.send(
      JSON.stringify({
        type: "create",
        name: "Outer runner",
        seed: "notebook",
      }),
    );
    const welcome = await ready;
    const room = rooms.rooms.get(welcome.code)!;
    const [socket, p] = [...room.players.entries()][0];
    p.p = [240, 0.16, 15];
    p.moveCredit = 5;
    p.lastMove = Date.now();
    rooms.handle(socket, {
      type: "state",
      p: [241, 0.16, 15],
      yaw: 0,
      pitch: 0,
      weapon: 0,
      height: 1.76,
      anchor: [260, 20, 15],
    });
    assert.equal(p.p[0], 241);
    assert.deepEqual(p.anchor, [260, 20, 15]);
    p.p = [room.city.bounds - 0.5, 0.16, 15];
    p.moveCredit = 5;
    rooms.handle(socket, {
      type: "state",
      p: [room.city.bounds + 1, 0.16, 15],
      yaw: 0,
      pitch: 0,
    });
    assert.equal(p.p[0], room.city.bounds - 0.5);
  } finally {
    a.close();
    rooms.dispose();
    wss.close();
  }
});

test("a player starts unarmed, acquires only nearby guns, and respawns with fists", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on("listening", r));
  const rooms = new Rooms(wss);
  const ws = await client((wss.address() as any).port);
  try {
    const welcome = next(ws, "welcome");
    ws.send(JSON.stringify({ type: "create", seed: "paper" }));
    const room = rooms.rooms.get((await welcome).code)!;
    const [[socket, player]] = room.players;
    const drop = room.weaponDrops[0];
    const state = () =>
      rooms.handle(socket, {
        type: "state",
        p: player.p,
        yaw: 0,
        pitch: 0,
        weapon: drop.weapon,
      });
    state();
    assert.deepEqual(player.owned, [4]);
    assert.equal(player.weapon, 4);
    assert.equal(player.mags[drop.weapon], 0);
    rooms.handle(socket, {
      type: "state",
      p: drop.p,
      yaw: 0,
      pitch: 0,
      weapon: drop.weapon,
    });
    assert.deepEqual(
      player.owned,
      [4],
      "rejected movement cannot award a pickup",
    );
    player.p = [...drop.p];
    const grant = next(ws, "weapon-pickup");
    state();
    assert.equal((await grant).weapon, drop.weapon);
    assert.deepEqual(player.owned, [4, drop.weapon]);
    state();
    assert.equal(player.weapon, drop.weapon);
    const full = player.mags[drop.weapon];
    rooms.handle(socket, { type: "fire" });
    state();
    assert.equal(
      player.mags[drop.weapon],
      full - 1,
      "standing on a collected gun cannot refill it",
    );
    player.hp = 0;
    player.deadAt = Date.now() - 3000;
    rooms.handle(socket, { type: "respawn" });
    assert.deepEqual(player.owned, [4]);
    assert.equal(player.weapon, 4);
    assert.ok(player.mags.every((n) => n === 0));
  } finally {
    ws.close();
    rooms.dispose();
    wss.close();
  }
});

test("an armed NPC leaves one shared gun which a late joiner can claim", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const rooms = new Rooms(wss);
  const port = (wss.address() as any).port;
  const a = await client(port);
  const b = await client(port);
  try {
    const created = next(a, "welcome");
    a.send(JSON.stringify({ type: "create", name: "One", seed: "paper" }));
    const welcome = await created;
    const room = rooms.rooms.get(welcome.code)!;
    const [player] = room.players.values();
    const victim = {
      ...player,
      id: "target",
      npc: true,
      shieldUntil: 0,
      hp: 1,
    };
    rooms.hurt(room, victim, player, 1);
    assert.equal(room.npcLoot.drops.length, 0);
    victim.hp = 1;
    victim.weapon = 2;
    const spawned = next(a, "npc-loot");
    rooms.hurt(room, victim, player, 1);
    rooms.hurt(room, victim, player, 1);
    const { npcDrops } = await spawned;
    assert.equal(npcDrops.length, 1);
    assert.deepEqual(npcDrops[0].p, victim.p);
    const joined = next(b, "welcome");
    b.send(JSON.stringify({ type: "join", code: welcome.code, name: "Two" }));
    assert.deepEqual((await joined).npcDrops, npcDrops);
    const second = [...room.players.values()][1];
    second.p = [...victim.p];
    const pickup = next(b, "weapon-pickup");
    const removed = next(a, "npc-loot");
    const state = JSON.stringify({
      type: "state",
      p: victim.p,
      yaw: 0,
      pitch: 0,
      weapon: 4,
    });
    b.send(state);
    assert.equal((await pickup).weapon, 2);
    assert.deepEqual((await removed).npcDrops, []);
    a.send(state);
    await next(a, "snapshot");
    assert.deepEqual(player.owned, [4]);
    assert.equal(second.weapon, 2);
    assert.equal(second.mags[2], 14);
  } finally {
    a.close();
    b.close();
    rooms.dispose();
    wss.close();
  }
});
