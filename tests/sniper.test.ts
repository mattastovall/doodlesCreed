import test from "node:test";
import assert from "node:assert/strict";
import { Scene, Vector3, PerspectiveCamera } from "three";
import { Combat } from "../src/combat.ts";
import { Controller, Physics } from "../src/physics.ts";
import { AudioEngine } from "../src/audio.ts";
import { ViewMotion } from "../src/motion.ts";
import { WebSocket, WebSocketServer } from "ws";
import { Rooms } from "../server/rooms.ts";

test("sniper selects, hits a distant NPC, enforces its cycle and reloads five rounds", async () => {
  const ph = await Physics.create([]);
  try {
    const p = new Controller(ph, [0, 0, 0]);
    const c = new Combat(
      new Scene(),
      { nodes: [], links: [], spawns: [[0, 0, 0]], streetNodes: [] } as any,
      p,
      new AudioEngine(),
      false,
    );
    assert.equal(c.switchWeapon(3), false);
    c.collectWeapon(3);
    assert.equal(c.weapon, 3);
    assert.equal(c.mags[3], 5);
    c.bots = [
      {
        p: new Vector3(0, 0, -150),
        hp: 100,
        model: { group: { visible: true } },
      } as any,
    ];
    assert.ok(c.fire());
    assert.equal(c.bots[0].hp <= 0, true);
    assert.equal(c.mags[3], 4);
    assert.equal(c.fire(), false);
    assert.equal(c.mags[3], 4);
    c.bots = [];
    c.reload();
    assert.equal(c.reloadTime, 1.65);
    c.update(2.41, 0, new PerspectiveCamera());
    assert.equal(c.mags[3], 5);
  } finally {
    ph.dispose();
  }
});
test("scope blends to 22 degrees, reverses smoothly, and sniper recoil stays finite", () => {
  const v = new ViewMotion();
  v.shot(3);
  assert.ok(Number.isFinite(v.kick));
  v.update(1 / 60, true, 0, true, false, 82, 22);
  assert.ok(v.fov > 22 && v.fov < 82);
  for (let i = 0; i < 30; i++) v.update(1 / 60, true, 0, true, false, 82, 22);
  assert.ok(Math.abs(v.fov - 22) < 0.01);
  v.update(1 / 60, false, 0, true, false, 82, 22);
  assert.ok(v.fov > 22 && v.fov < 82);
});
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
test("multiplayer sniper owns long-range damage, fire rate, ammo and reload", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on("listening", r));
  const rooms = new Rooms(wss);
  const ws = new WebSocket(`ws://127.0.0.1:${(wss.address() as any).port}`);
  await new Promise((r) => ws.on("open", r));
  try {
    const ready = next(ws, "welcome");
    ws.send(JSON.stringify({ type: "create", name: "Scope", seed: "paper" }));
    const welcome = await ready;
    const room = rooms.rooms.get(welcome.code)!,
      p = [...room.players.values()][0];
    p.ready = true;
    p.weapon = 3;
    p.owned.push(3);
    p.mags[3] = 5;
    p.p = [0, 100, 0];
    p.yaw = 0;
    p.pitch = 0;
    p.lastShot = 0;
    const victim = {
      ...p,
      id: "sniper-target",
      p: [0, 100, -150],
      shieldUntil: 0,
      hp: 100,
      npc: true,
    } as any;
    room.npcs = [victim];
    let response = next(ws, "hit");
    ws.send(JSON.stringify({ type: "fire" }));
    await response;
    assert.equal(victim.hp, 0);
    assert.equal(p.mags[3], 4);
    response = next(ws, "ammo");
    ws.send(JSON.stringify({ type: "fire" }));
    await response;
    assert.equal(p.mags[3], 4);
    response = next(ws, "ammo");
    ws.send(JSON.stringify({ type: "reload" }));
    const reload = await response;
    assert.ok(reload.reloadRemaining > 1500);
    p.reloadUntil = Date.now() - 1;
    await next(ws, "ammo");
    assert.equal(p.mags[3], 5);
  } finally {
    ws.close();
    rooms.dispose();
    wss.close();
  }
});
