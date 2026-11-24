import { strict as assert } from "node:assert";
import test from "node:test";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket, WebSocketServer } from "ws";
import { Rooms } from "../server/rooms.ts";
import {
  FISTS,
  PUNCHES,
  nextPunch,
  guardRaise,
  punchPose,
  punchHit,
} from "../src/fists.ts";
import { generateCity, type V3 } from "../src/world.ts";

test("each fist move extends a different path and both hands recover to guard", () => {
  const paths = [];
  for (const [move, p] of PUNCHES.entries()) {
    const idle = punchPose(move, 0, p.side);
    const peak = punchPose(move, p.contact, p.side);
    assert.ok(peak.z > 0.2 && punchPose(move, p.contact, -p.side).z < 0);
    assert.deepEqual(punchPose(move, p.duration + 0.001, p.side), idle);
    paths.push([p.side, peak.x, peak.z, peak.roll]);
  }
  assert.equal(new Set(paths.map((p) => p.join(","))).size, 3);
  assert.equal(nextPunch({ move: 1, start: 0 }, 500).move, 2);
  assert.equal(nextPunch({ move: 1, start: 0 }, 2000).move, 0);
});
test("lead hand rises first and early input reaches guard by contact", () => {
  assert.equal(guardRaise(0, -1, 0, 1), 0);
  assert.ok(guardRaise(0.12, -1, 0, 1) > guardRaise(0.12, 1, 0, 1));
  assert.equal(guardRaise(0.45, 1, 0, 1), 1);
  assert.equal(guardRaise(0.12, 1, 0, PUNCHES[0].contact), 1);
});
test("fist sweep selects a single visible opponent within reach", () => {
  const target = (z: number) => ({ p: [0, 0, z] as V3, height: 1.76, yaw: 0 });
  const near = target(-1),
    far = target(-2),
    behind = target(0.9);
  const eye: V3 = [0, 1.6, 0];
  for (let m = 0; m < PUNCHES.length; m++) {
    assert.equal(
      punchHit(eye, 0, 0, m, [far, near, behind], () => null)?.actor,
      near,
    );
    assert.equal(
      punchHit(eye, 0, 0, m, [far, behind], () => null),
      undefined,
    );
    assert.equal(
      punchHit(eye, 0, 0, m, [near], () => ({ distance: 0.4 })),
      undefined,
    );
  }
});
function waitFor(
  ws: WebSocket,
  kind: string,
  match = (m: any) => true,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: Buffer) => {
      const m = JSON.parse(String(raw));
      if (m.type === kind && match(m)) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(m);
      }
    };
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(Error("missing " + kind));
    }, 4000);
    ws.on("message", onMessage);
  });
}
test("two players share a single authoritative punch per swing, with wind-up, cancellation and kills", async () => {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(wss, "listening");
  const address = wss.address();
  assert.ok(address && typeof address === "object");
  const url = "ws://127.0.0.1:" + address.port;
  const rooms = new Rooms(wss, () => ({
    ...generateCity("fists"),
    boxes: [],
    spawns: [
      [0, 0, 0],
      [0, 0, -1.1],
    ],
  }));
  const clients: WebSocket[] = [];
  async function join(m: object) {
    const ws = new WebSocket(url);
    clients.push(ws);
    await once(ws, "open");
    const ready = waitFor(ws, "welcome");
    ws.send(JSON.stringify(m));
    return { ws, info: await ready };
  }
  try {
    const a = await join({ type: "create", name: "A" }),
      b = await join({
        type: "join",
        code: a.info.code,
        name: "B",
        compact: true,
      });
    const room = rooms.rooms.get(a.info.code)!,
      [attacker, victim] = room.players.values();
    const send = (m: object) => a.ws.send(JSON.stringify(m));
    const equip = (weapon: number) =>
      send({ type: "state", p: attacker.p, yaw: 0, pitch: 0, weapon });
    equip(FISTS);
    await waitFor(b.ws, "snapshot", (m) => m.actors[0][8] === FISTS);
    // Complete loading, then expire the fixture spawn shield.
    b.ws.send(JSON.stringify({ type: "state", p: victim.p, yaw: 0, pitch: 0 }));
    await waitFor(b.ws, "snapshot", () => victim.ready === true);
    victim.shieldUntil = 0;
    // Sending a firearm command or reload while unarmed cannot fire a bullet.
    const ammo = attacker.mags.slice();
    send({ type: "fire" });
    send({ type: "reload" });
    const startPunch = () =>
      send({ type: "punch", damage: 900, target: attacker.id });
    const animation = waitFor(
      b.ws,
      "snapshot",
      (m) => m.actors[0][16]?.move === 0,
    );
    const impact = waitFor(b.ws, "impact");
    const hit = waitFor(a.ws, "hit");
    startPunch();
    startPunch();
    await animation;
    assert.equal((await hit).damage, 20);
    const after = await waitFor(b.ws, "snapshot", (m) => m.actors[1][5] === 80);
    assert.equal(after.actors[0][5], 100);
    const reaction = (await impact).reaction;
    assert.equal(reaction.move, 0);
    assert.equal(reaction.region, "head");
    assert.ok(reaction.at > 0);
    assert.deepEqual(
      after.actors[1][17],
      reaction,
      "compact snapshot recovers a missed impact",
    );
    const full = await waitFor(
      a.ws,
      "snapshot",
      (m) => !!m.players.find((p: any) => p.id === victim.id)?.reaction,
    );
    assert.deepEqual(
      full.players.find((p: any) => p.id === victim.id).reaction,
      reaction,
    );
    assert.deepEqual(attacker.mags, ammo);
    await delay(250);
    const cross = waitFor(a.ws, "hit");
    startPunch();
    assert.equal((await cross).damage, 25);
    await delay(300);
    const hook = waitFor(a.ws, "hit");
    startPunch();
    assert.equal((await hook).damage, 30);
    await delay(330);
    startPunch();
    attacker.owned.push(0);
    equip(0);
    await delay(220);
    assert.equal(victim.hp, 25, "holstering cancels pending contact");
    equip(FISTS);
    await delay(220);
    victim.p = [0, 0, -4];
    startPunch();
    await delay(190);
    assert.equal(victim.hp, 25, "a distant player takes no damage");
    victim.p = [0, 0, -1.1];
    await delay(200);
    const lethal = waitFor(a.ws, "hit");
    startPunch();
    assert.equal((await lethal).kill, true);
    assert.equal(attacker.kills, 1);
    assert.equal(victim.deaths, 1);
  } finally {
    for (const ws of clients) ws.close();
    rooms.dispose();
    wss.close();
  }
});
