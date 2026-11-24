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

test("server resolves head, torso, arms and legs with matching damage messages", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once("listening", r));
  const rooms = new Rooms(wss);
  const ws = new WebSocket(`ws://127.0.0.1:${(wss.address() as any).port}`);
  await new Promise((r) => ws.once("open", r));
  try {
    const ready = next(ws, "welcome");
    ws.send(
      JSON.stringify({ type: "create", name: "Hitbox test", seed: "paper" }),
    );
    const welcome = await ready,
      room = rooms.rooms.get(welcome.code)!,
      p = [...room.players.values()][0];
    p.ready = true;
    p.p = [0, 100, 0];
    p.weapon = 0;
    p.owned.push(0);
    p.mags[0] = 30;
    const victim = {
      ...p,
      id: "anatomic-target",
      p: [0, 100, -10],
      hp: 100,
      shieldUntil: 0,
      npc: true,
    } as any;
    room.npcs = [victim];
    for (const [x, y, region, damage] of [
      [0, 1.55, "head", 58],
      [0, 1, "body", 24],
      [0.32, 1.12, "arm", 16],
      [0.12, 0.35, "leg", 18],
    ] as const) {
      victim.hp = 100;
      p.lastShot = 0;
      const delta = [x, y - 1.6, -10],
        len = Math.hypot(...delta);
      p.yaw = Math.atan2(-delta[0], -delta[2]);
      p.pitch = Math.asin(delta[1] / len);
      const impact = next(ws, "impact");
      const response = next(ws, "hit");
      ws.send(JSON.stringify({ type: "fire" }));
      const hit = await response;
      const reaction = await impact;
      assert.equal(reaction.id, victim.id);
      assert.equal(reaction.region, region);
      assert.equal(reaction.damage, damage);
      assert.equal(hit.region, region);
      assert.equal(hit.damage, damage);
      assert.equal(victim.hp, 100 - damage);
    }
  } finally {
    ws.close();
    rooms.dispose();
    wss.close();
  }
});
