import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket, WebSocketServer } from "ws";
import { Rooms, type ReserveRequest } from "../server/rooms.ts";
import { countyWorld, COUNTY } from "../src/county.ts";
import type { V3 } from "../src/world.ts";

function send(ws: WebSocket, message: object) {
  ws.send(JSON.stringify(message));
}
function next(
  ws: WebSocket,
  type: string,
  match = (_: any) => true,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const read = (raw: Buffer) => {
      const m = JSON.parse(String(raw));
      if (m.type !== type || !match(m)) return;
      clearTimeout(timer);
      ws.off("message", read);
      resolve(m);
    };
    const timer = setTimeout(() => {
      ws.off("message", read);
      reject(new Error("Timed out waiting for " + type));
    }, 5000);
    ws.on("message", read);
  });
}
function move(ws: WebSocket, p: V3, yaw = 0, pitch = 0) {
  send(ws, { type: "state", p, yaw, pitch, weapon: 0, height: 1.76 });
}

test("county sessions share usable doors and wall breaches across joins and resume, isolated by room", async () => {
  const city = countyWorld();
  // Exercise a multi-storey factory with an upper floor to collapse.
  const doorIndex = city.boxes.findIndex(
    (b) => b.piece === "door" && b.buildingId?.endsWith("/works"),
  );
  assert.ok(doorIndex >= 0, "County needs an interactive entrance");
  const door = city.boxes[doorIndex];
  const [x, , z] = door.p;
  const floor = door.p[1] - door.s[1] / 2 + 0.04;
  const outside: V3 = [x, floor, z + 1.35];
  const inside: V3 = [x, floor, z - 1.35];
  const wall = city.boxes.find(
    (b) =>
      b.piece === "wall" &&
      Math.abs(b.p[2] - z) < 0.25 &&
      b.buildingId === door.buildingId &&
      b.p[0] > x &&
      b.s[0] > 1 &&
      b.s[1] > 1.9 &&
      b.p[1] - b.s[1] / 2 < floor + 0.5,
  );
  assert.ok(wall, "the entrance needs a neighboring ground-level wall");
  const wallIndex = city.boxes.indexOf(wall);

  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(wss, "listening");
  const address = wss.address();
  assert.ok(address && typeof address === "object");
  const url = `ws://127.0.0.1:${address.port}`;
  const clients: WebSocket[] = [];
  const rooms = new Rooms(
    wss,
    () => {
      const level = countyWorld();
      // Put the first spawn at the entrance. Keep the rest of the level and
      // movement, collision, room, and weapon handlers identical to gameplay.
      level.spawns = [outside, ...level.spawns];
      return level;
    },
    { releaseId: "building-test", workerId: "worker", workerEpoch: "one" },
  );

  async function connect() {
    const ws = new WebSocket(url);
    clients.push(ws);
    await once(ws, "open");
    return ws;
  }
  async function admit(request: ReserveRequest) {
    const ticket = rooms.reserve(request);
    const ws = await connect();
    const welcome = next(ws, "welcome");
    send(ws, {
      type: "admit",
      releaseId: "building-test",
      joinTicket: ticket.joinTicket,
      compact: true,
    });
    return { ws, welcome: await welcome };
  }
  try {
    const host = await admit({
      type: "create",
      seed: COUNTY,
      name: "Builder",
      roomCode: "FIRST",
    });
    const peer = await admit({
      type: "join",
      code: host.welcome.code,
      name: "Neighbor",
    });
    const other = await admit({
      type: "create",
      seed: COUNTY,
      name: "Other room",
      roomCode: "OTHER",
    });
    assert.deepEqual(host.welcome.structures, []);
    assert.deepEqual(peer.welcome.structures, []);
    assert.ok(
      Math.hypot(peer.welcome.spawn[0] - x, peer.welcome.spawn[2] - z) > 3.5,
    );

    const unexpected: unknown[] = [];
    other.ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === "structure" || m.type.startsWith("rubble-"))
        unexpected.push(m);
    });
    move(host.ws, outside);
    move(peer.ws, peer.welcome.spawn);
    send(peer.ws, { type: "door", index: doorIndex, open: true });
    // Pong follows processing of the distant player's interaction.
    const pong = next(peer.ws, "pong");
    send(peer.ws, { type: "ping", time: 1 });
    await pong;
    const blocked = next(host.ws, "correction");
    move(host.ws, inside);
    assert.deepEqual((await blocked).p, outside);

    async function operate(open: boolean) {
      const changes = [host, peer].map(({ ws }) =>
        next(
          ws,
          "structure",
          (m) => m.index === doorIndex && m.state === Number(open),
        ),
      );
      send(host.ws, { type: "door", index: doorIndex, open });
      await Promise.all(changes);
    }
    await operate(true);
    const entered = next(
      peer.ws,
      "snapshot",
      (m) => Math.abs(m.actors[0][2] - inside[2]) < 0.002,
    );
    move(host.ws, inside);
    await entered;
    await operate(false);
    const closedAgain = next(host.ws, "correction");
    move(host.ws, outside);
    assert.deepEqual((await closedAgain).p, inside);
    await operate(true);

    const dx = wall.p[0] - inside[0],
      dz = wall.p[2] - inside[2];
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(wall.p[1] - (inside[1] + 1.6), Math.hypot(dx, dz));
    const shooter = [
      ...rooms.rooms.get(host.welcome.code)!.players.values(),
    ][0];
    shooter.owned.push(0);
    shooter.mags[0] = 30;
    move(host.ws, inside, yaw, pitch);
    // Fire the standard rifle at its normal cadence until the server removes the wall.
    const destroyed = new Set<WebSocket>();
    for (const { ws } of [host, peer])
      ws.on("message", (raw) => {
        const m = JSON.parse(String(raw));
        if (m.type === "structure" && m.index === wallIndex && m.state === 2)
          destroyed.add(ws);
      });
    for (let i = 0; i < 30 && !destroyed.has(host.ws); i++) {
      const shot = next(host.ws, "shot");
      send(host.ws, { type: "fire" });
      await shot;
      await delay(125);
    }
    assert.equal(
      destroyed.size,
      2,
      "both room members received the same wall breach",
    );

    const breachX = wall.p[0] - wall.s[0] / 2 + 0.7;
    const alongside: V3 = [breachX, floor, inside[2]];
    const throughBreach: V3 = [breachX, floor, outside[2]];
    const escaped = next(peer.ws, "snapshot", (m) => {
      const [px, , pz] = m.actors[0];
      return (
        Math.abs(px - breachX) < 0.002 && Math.abs(pz - outside[2]) < 0.002
      );
    });
    move(host.ws, alongside);
    move(host.ws, throughBreach);
    await escaped;

    const changes = (m: any) => new Map<number, number>(m.structures);
    const expected = new Map([
      [doorIndex, 1],
      [wallIndex, 2],
    ]);
    const late = await admit({
      type: "join",
      code: host.welcome.code,
      name: "Late arrival",
    });
    assert.deepEqual(changes(late.welcome), expected);
    const resumed = await connect();
    const restored = next(resumed, "resumed");
    send(resumed, {
      type: "resume",
      releaseId: "building-test",
      sessionId: peer.welcome.sessionId,
      secret: peer.welcome.resumeSecret,
      attemptId: "reconnect",
      compact: true,
    });
    assert.deepEqual(changes(await restored), expected);

    const lateOther = await admit({
      type: "join",
      code: other.welcome.code,
      name: "Other neighbor",
    });
    assert.deepEqual(lateOther.welcome.structures, []);
    assert.deepEqual(unexpected, []);
    move(other.ws, outside);
    const stillClosed = next(other.ws, "correction");
    move(other.ws, inside);
    assert.deepEqual((await stillClosed).p, outside);

    // Remove the remaining supports on the authoritative worker. Failures of
    // the room protocol should be independent of how long it takes to aim at
    // every facade around a building (normal weapon fire is exercised above).
    const room = rooms.rooms.get(host.welcome.code)!;
    const supports = room.city.boxes.filter(
      (b) =>
        b.buildingId === door.buildingId &&
        b.piece === "wall" &&
        b.p[1] - b.s[1] / 2 < 0.6,
    );
    const buildingMember = (index: number) =>
      city.boxes[index]?.buildingId === door.buildingId;
    const spawned = Promise.all(
      [host.ws, resumed].map((ws) =>
        next(
          ws,
          "rubble-spawn",
          (m) =>
            m.indices.length > 4 &&
            m.indices.some(
              (index: number) =>
                buildingMember(index) && city.boxes[index].p[1] > 5,
            ),
        ),
      ),
    );
    for (const b of supports.sort((a, b) => a.p[0] - b.p[0])) {
      if (b.solid) room.structures!.damage(b.pieceId!, 200);
    }
    const [spawn, replicated] = await spawned;
    assert.deepEqual(spawn, replicated);
    assert.ok(spawn.indices.length > 1);
    assert.ok(spawn.indices.every(buildingMember));
    assert.ok(
      spawn.indices.some(
        (i: number) =>
          city.boxes[i].piece === "fixture" ||
          city.boxes[i].piece === "furniture",
      ),
    );
    assert.ok(
      !spawn.indices.includes(wallIndex),
      "the breached wall cannot reappear in the falling assembly",
    );
    const moved = await Promise.all(
      [host.ws, resumed].map((ws) =>
        next(ws, "rubble-poses", (m) =>
          m.poses.some(
            (pose: any) =>
              pose.id === spawn.id &&
              pose.q.some(
                (v: number, axis: number) =>
                  Math.abs(v - spawn.pose.q[axis]) > 0.01,
              ),
          ),
        ),
      ),
    );
    const firstPose = moved[0].poses.find((p: any) => p.id === spawn.id);
    assert.deepEqual(
      moved[1].poses.find((p: any) => p.id === spawn.id),
      firstPose,
    );

    const spectator = await admit({
      type: "join",
      code: host.welcome.code,
      name: "After collapse",
    });
    function verifyAssembly(snapshot: any, expectedIndices: number[]) {
      const rubble = snapshot.rubble.find((r: any) => r.id === spawn.id);
      assert.ok(rubble, "a joining player must receive the existing assembly");
      assert.deepEqual(rubble.indices, expectedIndices);
      assert.equal(rubble.pose.q.length, 4);
      assert.ok(
        rubble.pose.q.some(
          (v: number, axis: number) => Math.abs(v - spawn.pose.q[axis]) > 0.01,
        ),
      );
    }
    verifyAssembly(spectator.welcome, spawn.indices);
    const fitting = spawn.indices.find((i: number) =>
      ["fixture", "furniture"].includes(city.boxes[i].piece!),
    );
    assert.notEqual(fitting, undefined);
    const removed = Promise.all(
      [host.ws, spectator.ws].map((ws) =>
        next(ws, "rubble-remove", (m) => m.index === fitting),
      ),
    );
    room.structures!.damage(fitting, 200);
    await removed;
    const recovered = await connect();
    const rubbleResume = next(recovered, "resumed");
    send(recovered, {
      type: "resume",
      releaseId: "building-test",
      sessionId: late.welcome.sessionId,
      secret: late.welcome.resumeSecret,
      attemptId: "after-collapse",
      compact: true,
    });
    verifyAssembly(
      await rubbleResume,
      spawn.indices.filter((i: number) => i !== fitting),
    );
    assert.deepEqual(unexpected, []);
  } finally {
    for (const ws of clients) ws.terminate();
    rooms.dispose();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }
});

test("a driver's sweep knocks down one citizen and both wire formats agree on injury and notoriety", async () => {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(wss, "listening");
  const address = wss.address();
  assert.ok(address && typeof address === "object");
  const url = "ws://127.0.0.1:" + address.port;
  const rooms = new Rooms(wss, countyWorld);
  const peers: WebSocket[] = [];
  async function join(message: object) {
    const ws = new WebSocket(url);
    peers.push(ws);
    await once(ws, "open");
    const admitted = next(ws, "welcome");
    send(ws, message);
    return { ws, info: await admitted };
  }
  try {
    const host = await join({ type: "create", seed: COUNTY, name: "Driver" });
    const peer = await join({
      type: "join",
      code: host.info.code,
      name: "Witness",
      compact: true,
    });
    const room = rooms.rooms.get(host.info.code)!;
    const humans = [...room.players.values()];
    const driver = humans[0],
      other = humans[1],
      car = room.cars![0];
    car.access = "open"; // This fixture exercises driving after access has been earned.
    assert.equal(driver.notoriety, 0);
    assert.equal(room.ai, null);
    assert.equal(room.npcs.length, 32);
    driver.p = [...car.p];
    const seated = next(host.ws, "vehicle-seat");
    send(host.ws, {
      type: "vehicle",
      action: "enter",
      index: 0,
      driveVersion: 1,
    });
    assert.equal((await seated).car.driver, driver.id);
    let seq = 1;
    async function advance() {
      const ack = next(host.ws, "vehicle-drive");
      send(host.ws, {
        type: "state",
        vehicle: 0,
        drive: { seq, inputs: [5, 5, 5, 5] },
      });
      seq += 4;
      return (await ack).pose;
    }
    let pose = await advance();
    for (let i = 0; i < 55 && pose.speed < 7; i++) {
      await delay(34);
      pose = await advance();
    }
    assert.ok(pose.speed >= 7, "the car gained speed under real drive inputs");
    const walker = room.citizens!.actors.find((a) => a.car === undefined)!;
    // Put a pedestrian in the path of the next accepted movement sample.
    walker.p = [
      car.p[0] - Math.sin(car.yaw) * 2,
      car.p[1],
      car.p[2] - Math.cos(car.yaw) * 2,
    ];
    const actorIndex = humans.length + room.npcs.indexOf(walker);
    const full = next(host.ws, "snapshot", (m) => m.players[actorIndex]?.fall);
    const compact = next(
      peer.ws,
      "snapshot",
      (m) => m.actors[actorIndex]?.[15],
    );
    await delay(36);
    await advance();
    const [a, b] = await Promise.all([full, compact]);
    const victim = a.players[actorIndex];
    assert.deepEqual(victim.fall, b.actors[actorIndex][15]);
    assert.equal(victim.hp, b.actors[actorIndex][5]);
    assert.ok(victim.hp < 100 && victim.hp > 0);
    assert.ok(a.players[0].notoriety > 0);
    assert.equal(a.players[0].notoriety, b.actors[0][13]);
    assert.equal(other.notoriety, 0);
    for (let i = 0; i < 3; i++) {
      await delay(35);
      await advance();
    }
    assert.equal(
      walker.hp,
      victim.hp,
      "one impact cannot deal damage on every substep",
    );
    assert.notDeepEqual(walker.p, victim.p);
    // Exercise the same dead/retry state reached after a lethal attack.
    driver.hp = 0;
    driver.deadAt = Date.now() - 3000;
    const revived = next(host.ws, "respawn");
    send(host.ws, { type: "respawn" });
    await revived;
    assert.equal(driver.notoriety, 0);
  } finally {
    for (const ws of peers) ws.terminate();
    rooms.dispose();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }
});
