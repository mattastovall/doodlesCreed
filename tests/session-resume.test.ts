import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket, WebSocketServer } from "ws";
import { Rooms } from "../server/rooms.ts";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function next(ws: WebSocket, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(type)), 2000);
    const read = (raw: any) => {
      const m = JSON.parse(String(raw));
      if (m.type === type) {
        clearTimeout(timer);
        ws.off("message", read);
        resolve(m);
      }
    };
    ws.on("message", read);
  });
}
test("resume preserves state, rotates credentials, retries lost ACK, and explicit leave removes session", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const rooms = new Rooms(wss, undefined, {
    releaseId: "A",
    workerId: "a",
    workerEpoch: "one",
    resumeMs: 500,
  });
  const clients: WebSocket[] = [];
  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${(wss.address() as any).port}`);
    clients.push(ws);
    await new Promise((r) => ws.once("open", r));
    return ws;
  };
  try {
    const ticket = rooms.reserve({
      type: "duel",
      name: "Runner",
      roomCode: "ABCDE",
    });
    const a = await connect();
    let reply = next(a, "welcome");
    a.send(
      JSON.stringify({
        type: "admit",
        joinTicket: ticket.joinTicket,
        releaseId: "A",
        compact: true,
      }),
    );
    const welcome = await reply;
    const room = rooms.rooms.get(ticket.code)!;
    const player = [...room.players.values()][0];
    player.hp = 41;
    player.mags = [4, 3, 2, 1];
    player.kills = 7;
    player.ready = true;
    player.shieldUntil = 0;
    const pos = [...player.p];
    a.terminate();
    await wait(30);
    assert.equal(rooms.status().resumable, 1);
    assert.equal(rooms.status().unexpectedDisconnects, 1);
    assert.equal(rooms.beginRetirement(), false);
    // A detached avatar remains a target and can die without resetting membership.
    rooms.hurt(room, player, { ...player, id: "attacker", kills: 0 }, 100);
    assert.equal(player.hp, 0);
    const b = await connect();
    player.owned.push(3);
    player.weapon = 3;
    player.lastShot = Date.now();
    reply = next(b, "resumed");
    const attempt = {
      type: "resume",
      sessionId: welcome.sessionId,
      secret: welcome.resumeSecret,
      attemptId: "attempt-1",
      releaseId: "A",
      compact: true,
    };
    b.send(JSON.stringify(attempt));
    const resumed = await reply;
    assert.equal(resumed.id, welcome.id);
    assert.equal(resumed.hp, 0);
    assert.deepEqual(resumed.p, pos);
    assert.deepEqual(resumed.mags, [4, 3, 2, 1]);
    assert.deepEqual(resumed.owned, player.owned);
    assert.equal(resumed.kills, 7);
    assert.ok(resumed.fireRemaining > 0 && resumed.fireRemaining <= 1250);
    assert.equal(resumed.lastShot, player.lastShot);
    assert.notEqual(resumed.resumeSecret, welcome.resumeSecret);
    const c = await connect();
    reply = next(c, "resumed");
    c.send(JSON.stringify(attempt));
    const retry = await reply;
    assert.equal(retry.resumeSecret, resumed.resumeSecret);
    await wait(20);
    assert.equal(room.players.size, 1);
    assert.equal(rooms.status().active, 1);
    assert.equal(rooms.status().resumeSuccess, 2);
    assert.equal(rooms.status().unexpectedDisconnects, 1);
    const d = await connect();
    reply = next(d, "error");
    d.send(JSON.stringify({ ...attempt, attemptId: "replay" }));
    await reply;
    c.send(JSON.stringify({ type: "leave" }));
    await wait(20);
    assert.equal(rooms.status().rooms.length, 0);
    assert.equal(rooms.beginRetirement(), true);
  } finally {
    for (const c of clients) c.terminate();
    rooms.dispose();
    await new Promise<void>((r) => wss.close(() => r()));
  }
});
test("resume window expiration removes retained player and room", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const rooms = new Rooms(wss, undefined, {
    releaseId: "A",
    workerId: "a",
    workerEpoch: "one",
    resumeMs: 20,
  });
  const ws = new WebSocket(`ws://127.0.0.1:${(wss.address() as any).port}`);
  await new Promise((r) => ws.once("open", r));
  try {
    const t = rooms.reserve({
      type: "duel",
      name: "Runner",
      roomCode: "ABCDE",
    });
    const reply = next(ws, "welcome");
    ws.send(
      JSON.stringify({
        type: "admit",
        joinTicket: t.joinTicket,
        releaseId: "A",
      }),
    );
    await reply;
    ws.terminate();
    await wait(80);
    assert.equal(rooms.status().resumable, 0);
    assert.equal(rooms.status().rooms.length, 0);
  } finally {
    ws.terminate();
    rooms.dispose();
    await new Promise<void>((r) => wss.close(() => r()));
  }
});
test("active transport takeover cannot retain loading invulnerability", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const rooms = new Rooms(wss, undefined, {
    releaseId: "A",
    workerId: "a",
    workerEpoch: "one",
  });
  const clients: WebSocket[] = [];
  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${(wss.address() as any).port}`);
    clients.push(ws);
    await new Promise((r) => ws.once("open", r));
    return ws;
  };
  try {
    const t = rooms.reserve({
      type: "duel",
      name: "Loading",
      roomCode: "ABCDE",
    });
    const a = await connect();
    const welcomePromise = next(a, "welcome");
    a.send(
      JSON.stringify({
        type: "admit",
        joinTicket: t.joinTicket,
        releaseId: "A",
        compact: true,
      }),
    );
    const welcome = await welcomePromise;
    const room = rooms.rooms.get(t.code)!,
      p = [...room.players.values()][0];
    assert.equal(p.ready, false);
    assert.equal(p.shieldUntil, Infinity);
    const b = await connect();
    const resumedPromise = next(b, "resumed");
    b.send(
      JSON.stringify({
        type: "resume",
        sessionId: welcome.sessionId,
        secret: welcome.resumeSecret,
        attemptId: "takeover",
        releaseId: "A",
        compact: true,
      }),
    );
    await resumedPromise;
    assert.equal(p.ready, true);
    assert.ok(p.shieldUntil <= Date.now());
    b.send(
      JSON.stringify({ type: "state", p: p.p, yaw: 0, pitch: 0, weapon: 0 }),
    );
    await wait(40);
    assert.ok(p.shieldUntil <= Date.now());
    assert.ok(rooms.status().tickCount > 0);
    rooms.hurt(room, p, { ...p, id: "attacker", kills: 0 }, 10);
    assert.equal(p.hp, 90);
  } finally {
    for (const ws of clients) ws.terminate();
    rooms.dispose();
    await new Promise<void>((r) => wss.close(() => r()));
  }
});
