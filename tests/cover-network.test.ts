import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket, WebSocketServer } from "ws";
import { Rooms } from "../server/rooms.ts";
function next(ws: WebSocket, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error(type)), 5000);
    const read = (raw: any) => {
      const m = JSON.parse(String(raw));
      if (m.type === type) {
        clearTimeout(timeout);
        ws.off("message", read);
        resolve(m);
      }
    };
    ws.on("message", read);
  });
}

test("server accepts valid cover shots and rejects oversized lean", async () => {
  const { Spatial } = await import("../server/spatial.ts");
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const rooms = new Rooms(wss),
    ws = new WebSocket(`ws://127.0.0.1:${(wss.address() as any).port}`);
  await new Promise((r) => ws.once("open", r));
  try {
    const ready = next(ws, "welcome");
    ws.send(
      JSON.stringify({ type: "create", name: "Peek check", seed: "paper" }),
    );
    const w = await ready,
      room = rooms.rooms.get(w.code)!,
      p = [...room.players.values()][0];
    p.owned.push(0);
    p.weapon = 0;
    p.mags[0] = 30;
    p.p = [0, 0, 0];
    p.ready = true;
    p.lastShot = 0;
    room.spatial = new Spatial([
      { p: [-1, 1, -0.8], s: [2.5, 3, 0.2], kind: "wall", solid: true },
    ]);
    const victim = {
      ...p,
      id: "target",
      p: [0.5, 0, -5],
      hp: 100,
      shieldUntil: 0,
      npc: true,
    } as any;
    room.npcs = [victim];
    const serverSocket = [...room.players.keys()][0];
    rooms.handle(serverSocket, {
      type: "state",
      p: [0, 0, 0],
      yaw: 0,
      pitch: 0,
      height: 1.76,
      weapon: 0,
      aiming: true,
      lean: 5,
    });
    assert.equal(p.lean, 0);
    rooms.handle(serverSocket, {
      type: "state",
      p: [0, 0, 0],
      yaw: 0,
      pitch: 0,
      height: 1.76,
      weapon: 0,
      aiming: true,
      lean: 0.5,
    });
    assert.equal(p.lean, 0.5);
    const hit = next(ws, "hit");
    ws.send(JSON.stringify({ type: "fire" }));
    assert.equal((await hit).region, "head");
    assert.ok(victim.hp < 100);
  } finally {
    ws.close();
    rooms.dispose();
    wss.close();
  }
});
