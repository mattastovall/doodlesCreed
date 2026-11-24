import { windowPassage } from "../src/window-vault.ts";
import {
  advanceSeatAction,
  besideCar,
  canReachCar,
  startSeatAction,
} from "../src/county-car-access.ts";
import {
  CountyShops,
  cleanRecord,
  wanted,
  endPursuit,
  type CrimeState,
} from "../src/county-crime.ts";
import {
  FISTS,
  PUNCHES,
  nextPunch,
  punchHit,
  punchImpact,
  REACTION_SECONDS,
  type PunchImpact,
  type Punch,
} from "../src/fists.ts";
import {
  CountyDriveWorld,
  DRIVE_DT,
  type DrivePose,
  tiresSkidding,
} from "../src/county-driving.ts";
import { CountyCitizens, type CountyCitizen } from "../src/county-citizens.ts";
import {
  CountyImpacts,
  injuryPoints,
  notorietyAfter,
  shovePosition,
  type CountyFall,
} from "../src/county-incidents.ts";
import { initializeRapier } from "../src/rapier-init.ts";
import type { RubblePose } from "../src/county-rubble.ts";
import { CountyWreckage } from "../src/county-wreckage.ts";
import { CountyStructures } from "../src/county-structures.ts";
import { COUNTY, countyCars, type CountyCar } from "../src/county.ts";
import { insideRust, RUST_SCALE } from "../src/rust-boundary.ts";
import { peekEye, validatedLean } from "../src/cover-peek.ts";
import {
  MAGAZINES,
  newInventory,
  PICKUP_RADIUS,
  weaponPickups,
  type WeaponPickup,
} from "../src/weapon-pickups.ts";
import { RELOAD_SECONDS } from "../src/weapon-balance.ts";
import { actorHit, HIT_MULTIPLIER, type HitRegion } from "../src/actor-hit.ts";
import { randomBytes, randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { Admissions } from "./admission.ts";
import { Sessions } from "./sessions.ts";
import { Spatial } from "./spatial.ts";
import { Npcs, type Npc } from "./npcs.ts";
import { generateCity, distance, type City, type V3 } from "../src/world.ts";
export interface PlayerState {
  id: string;
  name: string;
  p: V3;
  yaw: number;
  pitch: number;
  hp: number;
  kills: number;
  deaths: number;
  weapon: number;
  owned: number[];
  height: number;
  anchor: V3 | null;
  lastMove: number;
  lastShot: number;
  crime?: CrimeState;
  swing?: Punch;
  reaction?: PunchImpact;
  punchPending?: boolean;
  punchReadyAt?: number;
  deadAt: number;
  shieldUntil: number;
  mags: number[];
  reloadUntil: number;
  reloadWeapon: number;
  moveCredit: number;
  npc?: boolean;
  ready?: boolean;
  notoriety?: number;
  fall?: CountyFall;
  lean?: number;
}
export interface WorkerOptions {
  releaseId: string;
  workerId: string;
  workerEpoch: string;
  resumeMs?: number;
}
export interface ReserveRequest {
  type: "public" | "duel" | "create" | "join";
  name: string;
  seed?: string;
  code?: string;
  roomId?: string;
  reservationId?: string;
  roomCode?: string;
}
interface Room {
  weaponDrops: WeaponPickup[];
  citizens?: CountyCitizens;
  shops?: CountyShops;
  incidents?: CountyImpacts;
  structures?: CountyStructures;
  wreckage?: CountyWreckage;
  rubbleUpdates?: Map<number, RubblePose>;
  cars?: CountyCar[];
  driving?: CountyDriveWorld;
  roomId: string;
  code: string;
  seed: string;
  city: City;
  players: Map<WebSocket, PlayerState>;
  created: number;
  public: boolean;
  duel: boolean;
  spatial: Spatial;
  ai: Npcs | null;
  npcs: Npc[];
}
const FIRE_INTERVAL_MS = [110, 700, 240, 1250];
const validVector = (p: unknown): p is V3 =>
  Array.isArray(p) &&
  p.length === 3 &&
  p.every(
    (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1000,
  );
const send = (ws: WebSocket, m: unknown) => {
  if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 32768)
    ws.send(JSON.stringify(m));
};
export class Rooms {
  rooms = new Map<string, Room>();
  memberships = new Map<WebSocket, Room>();
  private admissions = new Admissions();
  private drivers = new WeakMap<
    PlayerState,
    {
      pose: DrivePose;
      skiddingCar?: number;
      seq: number;
      credit: number;
      last: number;
      crashUntil: number;
    }
  >();
  private modernSeat = new WeakSet<PlayerState>();
  private takeWheel(r: Room, p: PlayerState, car: CountyCar) {
    p.punchPending = false;
    r.wreckage?.prepare();
    this.drivers.delete(p);
    if (this.modernSeat.has(p))
      this.drivers.set(p, {
        pose: { p: [...car.p], yaw: car.yaw, speed: 0, steer: 0 },
        seq: 0,
        credit: 0.05,
        last: performance.now(),
        crashUntil: 0,
      });
    p.p = [...car.p];
    p.yaw = car.yaw;
    p.pitch = 0;
  }
  private advanceSeats(r: Room, now: number) {
    r.cars?.forEach((car, index) => {
      const work = car.interaction;
      if (!work) return;
      const pair = [...r.players].find(
        ([, player]) => player.id === work.actor,
      );
      const eligible =
        !!pair &&
        pair[0].readyState === WebSocket.OPEN &&
        pair[1].hp > 0 &&
        canReachCar(car, pair[1].p) &&
        !r.cars!.some((other) => other.driver === work.actor);
      const result = advanceSeatAction(car, eligible, now);
      if (!result) return;
      if (result === "hijack" && work.occupant) {
        r.citizens?.ejectDriver(work.occupant);
        const displaced = [...r.players].find(
          ([, player]) => player.id === work.occupant,
        );
        if (displaced) {
          const [socket, driver] = displaced;
          this.drivers.delete(driver);
          const landing = besideCar(car);
          driver.p = r.spatial.clear(landing, driver.height)
            ? landing
            : [...car.p];
          send(socket, { type: "vehicle-seat", index, car, ejected: driver.p });
        }
      }
      if (pair) {
        const [socket, actor] = pair;
        if (car.driver === actor.id) this.takeWheel(r, actor, car);
        send(socket, {
          type: "vehicle-seat",
          index,
          car,
          result,
          driveVersion: this.drivers.has(actor) ? 1 : undefined,
        });
      }
    });
  }
  private drive(
    ws: WebSocket,
    r: Room,
    p: PlayerState,
    car: CountyCar,
    index: number,
    packet: any,
  ) {
    const driver = this.drivers.get(p)!;
    if (
      packet?.seq === driver.seq &&
      Array.isArray(packet.inputs) &&
      packet.inputs.length === 0
    ) {
      send(ws, {
        type: "vehicle-drive",
        index,
        seq: driver.seq,
        pose: driver.pose,
      });
      return;
    }
    if (
      !packet ||
      !Number.isSafeInteger(packet.seq) ||
      packet.seq <= driver.seq ||
      !Array.isArray(packet.inputs) ||
      !packet.inputs.length ||
      packet.inputs.length > 12 ||
      !packet.inputs.every(
        (v: unknown) =>
          typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 18,
      ) ||
      !Number.isSafeInteger(packet.seq + packet.inputs.length)
    )
      return;
    const now = performance.now(),
      pose = driver.pose;
    driver.credit = Math.min(
      0.18,
      driver.credit + Math.max(0, now - driver.last) / 1000,
    );
    driver.last = now;
    for (const input of packet.inputs) {
      if (driver.credit + 1e-8 < DRIVE_DT) break;
      driver.credit -= DRIVE_DT;
      const from = pose.p;
      const impact = r.driving!.advance(
        pose,
        car.kind,
        input,
        (box, amount) => r.structures!.damage(box.pieceId!, amount),
        car,
      );
      driver.skiddingCar = tiresSkidding(pose, input >= 9) ? index : undefined;
      if (impact) {
        if (now >= driver.crashUntil) this.countyVandalism(p);
        driver.crashUntil = now + 400;
      }
      if (from !== pose.p)
        this.countyCarContact(r, p, index, from, pose.p, pose.yaw, pose.speed);
    }
    driver.seq = packet.seq + packet.inputs.length - 1;
    p.p = car.p = pose.p;
    p.yaw = car.yaw = pose.yaw;
    p.lastMove = Date.now();
    if (p.ready === false) {
      p.ready = true;
      p.shieldUntil = p.lastMove + 3000;
    }
    send(ws, { type: "vehicle-drive", index, seq: driver.seq, pose });
  }
  private sessions: Sessions;
  private closing = false;
  private tickTimes: number[] = [];
  private tickCount = 0;
  private admissionRejections = 0;
  private resumeSuccess = 0;
  private unexpectedDisconnects = 0;
  private reservations = new Map<
    string,
    { request: string; result: ReturnType<Admissions["issue"]> }
  >();
  private publicWorld: { city: City; spatial: Spatial } | null = null;
  private createCredit = 4;
  private createAt = Date.now();
  private lastJoin = new WeakMap<WebSocket, number>();
  private compact = new WeakSet<WebSocket>();
  private timer: NodeJS.Timeout;
  private heartbeat: NodeJS.Timeout;
  private lastTick = performance.now();
  constructor(
    wss: WebSocketServer,
    private levelFactory: (seed: string) => City = generateCity,
    private options?: WorkerOptions,
  ) {
    let ready = false;
    const engine = initializeRapier().then(() => {
      ready = true;
    });
    this.sessions = new Sessions(options?.resumeMs);
    const alive = new WeakSet<WebSocket>();
    wss.on("connection", (ws) => {
      alive.add(ws);
      ws.on("pong", () => alive.add(ws));
      const joinedBy = setTimeout(
        () => {
          if (!this.memberships.has(ws)) ws.close(1008, "Join timeout");
        },
        options ? 5000 : 10000,
      );
      ws.once("close", () => clearTimeout(joinedBy));
      let messages = 0,
        epoch = Date.now();
      ws.on("message", (raw) => {
        if (Date.now() - epoch > 1000) {
          epoch = Date.now();
          messages = 0;
        }
        if (++messages > 90) {
          ws.close(1008, "Too many messages");
          return;
        }
        try {
          const message = JSON.parse(raw.toString());
          if (ready) this.handle(ws, message);
          else
            void engine
              .then(() => {
                if (ws.readyState === WebSocket.OPEN) this.handle(ws, message);
              })
              .catch(() =>
                send(ws, { type: "error", message: "Unable to start match." }),
              );
        } catch {
          send(ws, { type: "error", message: "Invalid game message." });
        }
      });
      ws.on("error", () => this.disconnect(ws));
      ws.on("close", () => this.disconnect(ws));
    });
    this.heartbeat = setInterval(() => {
      for (const ws of wss.clients) {
        if (!alive.has(ws)) {
          ws.terminate();
          continue;
        }
        alive.delete(ws);
        ws.ping();
      }
    }, 15000);
    this.timer = setInterval(() => this.tick(), 1000 / 30);
  }
  private prune() {
    this.admissions.prune();
    for (const session of this.sessions.records.values()) {
      if (session.expiresAt <= Date.now()) this.leave(session.socket);
      else if (session.retry && session.retry.until <= Date.now())
        session.retry = undefined;
    }
    for (const [key, value] of this.reservations)
      if (value.result.expiresAt <= Date.now()) this.reservations.delete(key);
    for (const room of this.rooms.values())
      if (!room.players.size && !this.admissions.count(room.roomId)) {
        room.wreckage?.dispose();
        this.rooms.delete(room.code);
      }
  }
  reserve(request: ReserveRequest) {
    try {
      return this.reserveSeat(request);
    } catch (error) {
      if (this.options) this.admissionRejections++;
      throw error;
    }
  }
  private reserveSeat(request: ReserveRequest) {
    this.prune();
    if (!this.options || this.closing)
      throw new Error("Worker is not accepting admissions.");
    if (!["public", "duel", "create", "join"].includes(request.type))
      throw new Error("Invalid match type.");
    const fingerprint = JSON.stringify(request);
    if (request.reservationId) {
      const previous = this.reservations.get(request.reservationId);
      if (previous) {
        if (previous.request !== fingerprint)
          throw new Error("Reservation ID conflict.");
        return previous.result;
      }
    }
    const available = (r: Room) =>
      r.players.size + this.admissions.count(r.roomId) <
      (r.seed === COUNTY ? 30 : r.public ? 16 : 8);
    let room = request.roomId
      ? [...this.rooms.values()].find((r) => r.roomId === request.roomId)
      : request.type === "join"
        ? this.rooms.get(String(request.code).trim().toUpperCase())
        : request.type === "public" || request.type === "duel"
          ? [...this.rooms.values()].find(
              (r) =>
                (request.type === "public" ? r.public : r.duel) &&
                (request.seed === COUNTY) === (r.seed === COUNTY) &&
                available(r),
            )
          : undefined;
    if (!room && (request.type === "join" || request.roomId))
      throw new Error("Room does not exist.");
    if (!room) {
      if (this.rooms.size >= 64)
        throw new Error("Worker room capacity reached.");
      const code = request.roomCode?.toUpperCase();
      if (!code || !/^[A-Z0-9]{5,12}$/.test(code) || this.rooms.has(code))
        throw new Error("A unique directory room code is required.");
      const seed =
        request.type === "public"
          ? request.seed === COUNTY
            ? COUNTY
            : "public-city-v1"
          : String(request.seed || "paper").slice(0, 40);
      const city = this.levelFactory(seed),
        spatial = new Spatial(city.boxes);
      const ai =
        request.type === "public" && seed !== COUNTY
          ? new Npcs(city, spatial)
          : null;
      room = {
        weaponDrops: weaponPickups(city),
        cars: seed === COUNTY ? countyCars() : undefined,
        roomId: randomUUID(),
        code,
        seed,
        city,
        spatial,
        ai,
        npcs: ai?.actors ?? [],
        public: request.type === "public",
        duel: request.type === "duel",
        players: new Map(),
        created: Date.now(),
      };
      this.initializeStructures(room);
      this.rooms.set(code, room);
    }
    if (!available(room)) throw new Error("Room is full.");
    const result = this.admissions.issue(room.roomId, room.code, request.name);
    if (request.reservationId)
      this.reservations.set(request.reservationId, {
        request: fingerprint,
        result,
      });
    return result;
  }
  status() {
    this.prune();
    const sessions = [...this.sessions.records.values()];
    const sorted = [...this.tickTimes].sort((a, b) => a - b);
    return {
      ...this.options,
      closing: this.closing,
      admissionRejections: this.admissionRejections,
      resumeSuccess: this.resumeSuccess,
      unexpectedDisconnects: this.unexpectedDisconnects,
      active: this.options
        ? sessions.filter((s) => s.expiresAt === Infinity).length
        : this.memberships.size,
      resumable: sessions.filter((s) => s.expiresAt !== Infinity).length,
      pending: this.admissions.count(),
      rooms: [...this.rooms.values()].map((r) => ({
        roomId: r.roomId,
        code: r.code,
        seed: r.seed,
        public: r.public,
        duel: r.duel,
        players: r.players.size,
        capacity: r.seed === COUNTY ? 30 : r.public ? 16 : 8,
      })),
      tickCount: this.tickCount,
      tickP99Ms:
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ??
        0,
      rss: process.memoryUsage().rss,
    };
  }
  beginRetirement() {
    const status = this.status();
    if (
      status.active ||
      status.resumable ||
      status.pending ||
      status.rooms.length
    )
      return false;
    this.closing = true;
    return true;
  }
  private disconnect(ws: WebSocket) {
    if (!this.options) {
      this.leave(ws);
      return;
    }
    const p = this.memberships.get(ws)?.players.get(ws);
    if (p) {
      // Loading invulnerability cannot become a permanent detached shield.
      if (p.crime) this.memberships.get(ws)?.shops?.release(p.id, p.crime);
      if (p.ready === false) {
        p.ready = true;
        p.shieldUntil = Date.now();
      }
      if (this.sessions.bySocket(ws)?.expiresAt === Infinity)
        this.unexpectedDisconnects++;
      this.sessions.detach(ws);
    }
  }
  private initializeStructures(room: Room) {
    if (room.seed !== COUNTY) return;
    if (room.duel) {
      // Duel rooms have the parked fleet and no civilian traffic.
      room.cars = room.cars!.filter((car) => !car.driver);
    } else {
      room.shops = new CountyShops(room.city.boxes);
      room.citizens = new CountyCitizens(room.city, room.cars!, room.spatial);
      room.npcs = room.citizens.actors;
      const incidents = (room.incidents = new CountyImpacts());
      const citizens = room.citizens;
      citizens.onTrafficMove = (driver, car, from, speed, now) => {
        incidents.contact(
          citizens.actors,
          car,
          from,
          car.p,
          car.yaw,
          speed,
          now,
          (a, amount) => this.hurt(room, a, driver, amount),
        );
      };
    }
    room.rubbleUpdates = new Map();
    room.wreckage = new CountyWreckage(room.city.boxes, (m) => {
      if (m.type === "rubble-poses")
        for (const pose of m.poses) room.rubbleUpdates!.set(pose.id, pose);
      else this.broadcast(room, m);
    });
    room.spatial.rubble = room.wreckage;
    room.driving = new CountyDriveWorld(
      room.city.boxes,
      () => room.wreckage!.clusters.values(),
      () => room.cars!,
    );
    room.structures = new CountyStructures(
      room.city.boxes,
      (index, state, _box, detached) => {
        if (!detached)
          this.broadcast(room, { type: "structure", index, state });
      },
      room.wreckage,
    );
  }
  private sessionSnapshot(
    r: Room,
    p: PlayerState,
    sessionId: string,
    resumeSecret: string,
  ) {
    return {
      sessionId,
      resumeSecret,
      releaseId: this.options?.releaseId,
      roomId: r.roomId,
      code: r.code,
      seed: r.seed,
      spawn: p.p,
      public: r.public,
      duel: r.duel,
      tickRate: 30,
      player: { ...p },
      drive:
        this.drivers.has(p) && r.cars?.some((c) => c.driver === p.id)
          ? { seq: this.drivers.get(p)!.seq, pose: this.drivers.get(p)!.pose }
          : undefined,
      ...p,
      rubble: r.wreckage && [...r.wreckage.clusters.values()],
      structures: r.structures && [...r.structures.states],
      sessionExpiresIn: this.sessions.resumeMs,
      reloadRemaining: Math.max(0, p.reloadUntil - Date.now()),
      fireRemaining: Math.max(
        0,
        (p.weapon === FISTS
          ? (p.punchReadyAt ?? 0)
          : p.lastShot + FIRE_INTERVAL_MS[p.weapon]) - Date.now(),
      ),
      sequence: 0,
      wave: r.ai?.waves.snapshot(r.npcs.filter((p) => p.hp > 0).length) ?? null,
    };
  }
  private resume(ws: WebSocket, m: any) {
    this.prune();
    const result = this.sessions.resume(m.sessionId, m.secret, m.attemptId);
    if (!result) {
      send(ws, {
        type: "error",
        message: "Session expired or resume credential invalid.",
      });
      return;
    }
    const { session, secret } = result,
      previous = session.socket;
    const r = this.memberships.get(previous),
      p = r?.players.get(previous);
    if (!r || !p) {
      send(ws, { type: "error", message: "Session ended." });
      return;
    }
    this.memberships.delete(previous);
    r.players.delete(previous);
    if (p.ready === false) {
      p.ready = true;
      p.shieldUntil = Date.now();
    }
    session.socket = ws;
    session.expiresAt = Infinity;
    r.players.set(ws, p);
    this.memberships.set(ws, r);
    if (m.compact === true) this.compact.add(ws);
    if (previous !== ws) previous.close(4001, "Session resumed elsewhere");
    this.resumeSuccess++;
    if (p.crime?.stars) {
      p.crime.arrestAt = 0;
      p.crime.escapeAt = Date.now() + (12 + p.crime.stars * 3) * 1000;
    }
    send(ws, {
      type: "resumed",
      ...this.sessionSnapshot(r, p, session.id, secret),
    });
    this.roster(r);
  }
  lobbies() {
    return [...this.rooms.values()]
      .filter((r) => r.public || r.duel)
      .map((r) => ({
        code: r.code,
        seed: r.seed,
        mode: r.duel ? "duel" : "play",
        players: [...r.players.keys()].filter(
          (ws) => ws.readyState === WebSocket.OPEN,
        ).length,
        capacity: r.seed === COUNTY ? 30 : r.public ? 16 : 8,
      }))
      .filter((r) => r.players > 0)
      .sort((a, b) => b.players - a.players);
  }
  spawn(r: Room, index: number): V3 {
    if (r.city.arena) {
      const safe = r.city.spawns.filter(
        (p) => insideRust(p, 0.7) && r.spatial.clear(p),
      );
      if (!safe.length) throw new Error("Rust has no safe spawn points");
      return [...safe[index % safe.length]];
    }
    if (!r.public || r.seed === COUNTY)
      return [...r.city.spawns[index % r.city.spawns.length]];
    const center = r.city.spawns[0],
      near = r.city.streetNodes
        .filter((i) => distance(r.city.nodes[i], center) > 7)
        .sort(
          (a, b) =>
            distance(r.city.nodes[a], center) -
            distance(r.city.nodes[b], center),
        )
        .slice(0, 15)
        .map((i) => r.city.nodes[i]);
    return [...[center, ...near][index % (near.length + 1)]];
  }
  tick() {
    const stamp = performance.now(),
      dt = Math.min(0.1, (stamp - this.lastTick) / 1000),
      now = Date.now();
    this.lastTick = stamp;
    this.prune();
    for (const r of this.rooms.values()) {
      r.wreckage?.step(dt);
      if (this.tickCount % 2 === 0 && r.rubbleUpdates?.size) {
        this.broadcast(r, {
          type: "rubble-poses",
          poses: [...r.rubbleUpdates.values()],
        });
        r.rubbleUpdates.clear();
      }
      this.advanceSeats(r, now);
      const humans = [...r.players.values()];
      const npcRosterBefore = r.npcs.map((p) => p.id).join(",");
      if (r.citizens) {
        r.incidents!.update(dt, now, r.spatial.ray.bind(r.spatial));
        r.citizens.update(
          dt,
          now,
          humans.filter((p) => p.ready !== false),
          (p, bot, damage, kind) => {
            if (p.hp <= 0 || now < p.shieldUntil) return;
            if (kind === "shove" && !r.cars?.some((c) => c.driver === p.id)) {
              const dest = shovePosition(p.p, bot.p);
              if (
                r.spatial.movement(p.p, dest, p.height) &&
                r.spatial.clear(dest, p.height)
              ) {
                p.p = dest;
                for (const [ws, target] of r.players)
                  if (target === p) send(ws, { type: "correction", p: dest });
              }
            }
            if (damage > 0)
              this.hurt(
                r,
                p,
                bot,
                damage,
                "body",
                undefined,
                kind === "punch" ? 1 : undefined,
              );
          },
          (bot, to) =>
            this.broadcast(r, {
              type: "shot",
              id: bot.id,
              from: [bot.p[0], bot.p[1] + 1.45, bot.p[2]],
              to,
            }),
        );
      }
      r.ai?.update(
        dt,
        now,
        humans.filter((p) => p.ready !== false),
        (target, bot, damage, region) =>
          this.hurt(r, target, bot, damage, region),
        (bot, to) =>
          this.broadcast(r, {
            type: "shot",
            id: bot.id,
            from: [bot.p[0], bot.p[1] + 1.45, bot.p[2]],
            to,
          }),
      );
      if (npcRosterBefore !== r.npcs.map((p) => p.id).join(",")) this.roster(r);
      for (const [ws, p] of r.players) {
        if (
          r.shops &&
          p.crime &&
          ws.readyState === WebSocket.OPEN &&
          p.ready !== false
        ) {
          const rcd = p.crime;
          if (rcd.stars || rcd.shop !== -1) {
            const event = r.shops.update(
              p.id,
              rcd,
              p.p,
              p.height,
              !!r.cars?.some((c) => c.driver === p.id),
              p.hp > 0,
              now,
              r.spatial.ray.bind(r.spatial),
              r.citizens!.actors,
            );
            if (event === "Busted") {
              p.p = [...r.city.spawns[0]];
              p.moveCredit = 0;
              p.shieldUntil = now + 3000;
              p.notoriety = 0;
              send(ws, { type: "correction", p: p.p });
            }
            if (event || !rcd.stars || this.tickCount % 8 === 0)
              send(ws, { type: "crime", record: rcd, event });
          }
        }
        if (p.ready === false && now - p.lastMove > 60000)
          ws.close(1008, "Loading timeout");
        if (
          p.punchPending &&
          p.swing &&
          now >= p.swing.start + PUNCHES[p.swing.move].contact * 1000
        ) {
          p.punchPending = false;
          if (
            p.hp > 0 &&
            p.ready !== false &&
            p.weapon === FISTS &&
            ws.readyState === WebSocket.OPEN &&
            !r.cars?.some((c) => c.driver === p.id)
          ) {
            const actors = [...humans, ...r.npcs].filter(
              (a) =>
                a !== p &&
                a.hp > 0 &&
                now >= a.shieldUntil &&
                a.ready !== false,
            );
            const result = punchHit(
              [p.p[0], p.p[1] + p.height - 0.16, p.p[2]],
              p.yaw,
              p.pitch,
              p.swing.move,
              actors,
              r.spatial.ray.bind(r.spatial),
            );
            if (result) {
              const { actor, hit } = result,
                damage = PUNCHES[p.swing.move].damage;
              this.hurt(
                r,
                actor,
                p,
                damage,
                hit.region,
                hit.side,
                p.swing.move,
              );
              send(ws, {
                type: "hit",
                melee: true,
                head: hit.head,
                region: hit.region,
                damage,
                kill: actor.hp === 0,
                npc: !!actor.npc,
              });
            }
          }
        }
        if (p.reloadUntil && now >= p.reloadUntil) {
          p.mags[p.reloadWeapon] = MAGAZINES[p.reloadWeapon];
          p.reloadUntil = 0;
          send(ws, { type: "ammo", mags: p.mags, reloadRemaining: 0 });
        }
      }
      for (const car of r.cars ?? [])
        if (
          car.driver &&
          !car.driver.startsWith("civilian-") &&
          !humans.some((p) => p.id === car.driver && p.hp > 0)
        )
          car.driver = null;
      this.broadcast(r, {
        type: "snapshot",
        cars: this.tickCount % 3 === 0 ? r.cars : undefined,
        time: now,
        wave:
          r.ai?.waves.snapshot(r.npcs.filter((p) => p.hp > 0).length) ?? null,
        players: [...humans, ...r.npcs].map((p) => ({
          id: p.id,
          name: p.name,
          p: p.p.map((v) => Math.round(v * 1000) / 1000),
          yaw: Math.round(p.yaw * 10000) / 10000,
          pitch: Math.round(p.pitch * 10000) / 10000,
          hp: p.hp,
          kills: p.kills,
          deaths: p.deaths,
          weapon: p.weapon,
          swing:
            p.weapon === FISTS && p.swing && now < (p.punchReadyAt ?? 0)
              ? p.swing
              : undefined,
          height: p.height,
          lean: p.lean ?? 0,
          skiddingCar: this.drivers.get(p)?.skiddingCar,
          anchor: p.anchor,
          npc: !!p.npc,
          notoriety: p.notoriety,
          action: (p as CountyCitizen).action,
          fall: p.fall,
          reaction:
            p.reaction && now - p.reaction.at < REACTION_SECONDS * 1000
              ? p.reaction
              : undefined,
          engaged: p.npc ? (p as Npc).engaged : undefined,
        })),
      });
    }
    this.tickCount++;
    this.tickTimes.push(performance.now() - stamp);
    if (this.tickTimes.length > 900) this.tickTimes.shift();
  }

  private countyVandalism(p: PlayerState) {
    p.notoriety = notorietyAfter(p.notoriety ?? 0, 5);
  }
  private countyCarContact(
    r: Room,
    p: PlayerState,
    index: number,
    from: V3,
    to: V3,
    yaw: number,
    speed: number,
  ) {
    if (!r.citizens || !r.cars?.[index]) return;
    r.incidents!.contact(
      r.citizens.actors,
      r.cars[index],
      from,
      to,
      yaw,
      speed,
      Date.now(),
      (actor, amount) => this.hurt(r, actor, p, amount),
    );
  }
  hurt(
    r: Room,
    victim: PlayerState,
    attacker: PlayerState,
    damage: number,
    region: HitRegion = "body",
    side?: number,
    punchMove?: number,
  ) {
    if (victim.hp <= 0 || Date.now() < victim.shieldUntil) return;
    if (attacker.crime && victim !== attacker && damage > 0) {
      wanted(
        attacker.crime,
        attacker.p,
        Date.now(),
        victim.npc && victim.name === "Police officer" ? 2 : 1,
      );
    }
    const before = victim.hp;
    victim.hp = Math.max(0, victim.hp - damage);
    if (r.citizens && attacker !== victim && !attacker.npc)
      attacker.notoriety = notorietyAfter(
        attacker.notoriety ?? 0,
        injuryPoints(before, victim.hp),
      );
    const yaw = victim.yaw + Math.PI;
    const localX =
      Math.cos(yaw) * (attacker.p[0] - victim.p[0]) -
      Math.sin(yaw) * (attacker.p[2] - victim.p[2]);
    const hitSide = side ?? (localX < 0 ? -1 : 1);
    const reaction =
      punchMove === undefined
        ? undefined
        : punchImpact(
            Date.now(),
            punchMove,
            region,
            hitSide,
            victim.p,
            victim.yaw,
            attacker.p,
          );
    if (reaction) victim.reaction = reaction;
    this.broadcast(r, {
      type: "impact",
      reaction,
      id: victim.id,
      region,
      side: hitSide,
      damage,
    });
    if (!victim.hp) {
      victim.deadAt = Date.now();
      victim.deaths++;
      attacker.kills++;
      this.broadcast(r, {
        type: "kill",
        by: attacker.name,
        victim: victim.name,
      });
    }
  }
  roster(r: Room) {
    this.broadcast(r, {
      type: "roster",
      actors: [...r.players.values(), ...r.npcs].map((p) => ({
        id: p.id,
        name: p.name,
        npc: !!p.npc,
      })),
    });
  }
  broadcast(r: Room, m: any) {
    let full: string | undefined, compact: string | undefined;
    for (const ws of r.players.keys()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (ws.bufferedAmount > 131072) {
        ws.close(1008, "Slow connection");
        continue;
      }
      if (ws.bufferedAmount >= 32768) {
        if (
          m.type === "roster" ||
          m.type === "structure" ||
          m.type === "rubble-spawn" ||
          m.type === "rubble-remove" ||
          (m.type === "rubble-poses" &&
            m.poses.some((p: { sleep: boolean }) => p.sleep))
        )
          ws.close(1008, "Slow connection");
        continue;
      }
      if (m.type === "snapshot" && this.compact.has(ws)) {
        compact ??= JSON.stringify({
          type: "snapshot",
          time: m.time,
          wave: m.wave,
          cars: m.cars,
          actors: m.players.map((p: any) => [
            ...p.p,
            p.yaw,
            p.pitch,
            p.hp,
            p.kills,
            p.deaths,
            p.weapon,
            p.height,
            p.anchor,
            p.lean ?? 0,
            p.engaged ? 1 : 0,
            ...(r.citizens ||
            p.swing ||
            p.reaction ||
            p.skiddingCar !== undefined
              ? [p.notoriety ?? 0, p.action ?? null, p.fall ?? null]
              : []),
            ...(p.swing || p.reaction || p.skiddingCar !== undefined
              ? [p.swing ?? null]
              : []),
            ...(p.reaction || p.skiddingCar !== undefined
              ? [p.reaction ?? null]
              : []),
            ...(p.skiddingCar === undefined ? [] : [p.skiddingCar]),
          ]),
        });
        ws.send(compact);
      } else {
        full ??= JSON.stringify(m);
        ws.send(full);
      }
    }
  }
  leave(ws: WebSocket) {
    const r = this.memberships.get(ws);
    if (!r) return;
    const leaving = r.players.get(ws);
    if (leaving?.crime) r.shops?.release(leaving.id, leaving.crime);
    const driver = leaving?.id;
    for (const c of r.cars ?? []) if (c.driver === driver) c.driver = null;
    r.players.delete(ws);
    this.memberships.delete(ws);
    const session = this.sessions.bySocket(ws);
    if (session) this.sessions.records.delete(session.id);
    if (!r.players.size && !this.admissions.count(r.roomId)) {
      r.wreckage?.dispose();
      this.rooms.delete(r.code);
    } else this.roster(r);
  }
  handle(ws: WebSocket, m: any) {
    if (!m || typeof m.type !== "string") return;
    if (this.options && !this.memberships.has(ws)) {
      if (m.releaseId !== this.options.releaseId) {
        this.admissionRejections++;
        send(ws, { type: "error", message: "Release mismatch." });
        return;
      }
      if (m.type === "resume") {
        this.resume(ws, m);
        return;
      }
      if (m.type !== "admit") {
        this.admissionRejections++;
        send(ws, { type: "error", message: "Admission required." });
        return;
      }
      const ticket = this.admissions.consume(m.joinTicket);
      if (!ticket) {
        this.admissionRejections++;
        send(ws, {
          type: "error",
          message: "Admission expired or already used.",
        });
        return;
      }
      m = {
        ...m,
        type: "join",
        code: ticket.code,
        name: ticket.name,
        mapScale: m.mapScale ?? RUST_SCALE,
      };
    }
    // Detached transports are fenced even when their close event has not arrived.
    const attached = this.sessions.bySocket(ws);
    if (attached && attached.expiresAt !== Infinity) return;
    if (m.type === "ping" && Number.isFinite(m.time)) {
      send(ws, { type: "pong", time: m.time });
      return;
    }
    if (
      m.type === "create" ||
      m.type === "join" ||
      m.type === "public" ||
      m.type === "duel"
    ) {
      if (this.memberships.has(ws)) return;
      if (Date.now() - (this.lastJoin.get(ws) ?? 0) < 3000) {
        send(ws, {
          type: "error",
          message: "Please wait a moment before joining again.",
        });
        return;
      }
      let r: Room | undefined;
      if (m.type === "public" || m.type === "duel")
        r = [...this.rooms.values()].find((r) =>
          m.type === "duel"
            ? r.duel &&
              (r.seed === COUNTY) === (m.seed === COUNTY) &&
              r.players.size < (r.seed === COUNTY ? 30 : 8)
            : r.public &&
              (r.seed === COUNTY) === (m.seed === COUNTY) &&
              r.players.size < (r.seed === COUNTY ? 30 : 16),
        );
      if (
        m.type === "create" ||
        ((m.type === "public" || m.type === "duel") && !r)
      ) {
        const now = Date.now();
        this.createCredit = Math.min(
          4,
          this.createCredit + (now - this.createAt) / 500,
        );
        this.createAt = now;
        if (this.rooms.size >= 64 || this.createCredit < 1) {
          send(ws, {
            type: "error",
            message: "All rooms are busy. Please try again.",
          });
          return;
        }
        this.createCredit--;
        let code = "";
        do {
          code = randomBytes(4).toString("hex").slice(0, 5).toUpperCase();
        } while (this.rooms.has(code));
        const seed =
          m.type === "public"
            ? m.seed === COUNTY
              ? COUNTY
              : "public-city-v1"
            : String(m.seed || "paper").slice(0, 40);
        if (m.type === "public" && seed !== COUNTY && !this.publicWorld) {
          const city = this.levelFactory(seed);
          this.publicWorld = { city, spatial: new Spatial(city.boxes) };
        }
        const city =
            m.type === "public" && seed !== COUNTY
              ? this.publicWorld!.city
              : this.levelFactory(seed),
          spatial =
            m.type === "public" && seed !== COUNTY
              ? this.publicWorld!.spatial
              : new Spatial(city.boxes);
        const ai =
          m.type === "public" && seed !== COUNTY
            ? new Npcs(city, spatial)
            : null;
        r = {
          weaponDrops: weaponPickups(city),
          cars: seed === COUNTY ? countyCars() : undefined,
          roomId: randomUUID(),
          code,
          seed,
          city,
          spatial,
          ai,
          npcs: ai?.actors ?? [],
          public: m.type === "public",
          duel: m.type === "duel",
          players: new Map(),
          created: Date.now(),
        };
        this.initializeStructures(r);
        this.rooms.set(code, r);
      } else if (m.type === "join")
        r = this.rooms.get(String(m.code).trim().toUpperCase());
      if (!r) {
        send(ws, {
          type: "error",
          message: "That room does not exist. Check the five-character code.",
        });
        return;
      }
      if (r.players.size >= (r.seed === COUNTY ? 30 : r.public ? 16 : 8)) {
        send(ws, { type: "error", message: "That room is full (8 players)." });
        return;
      }
      if (r.city.arena && m.mapScale !== RUST_SCALE) {
        send(ws, {
          type: "error",
          message:
            "Rust was updated. Refresh this page before joining so your map matches the server.",
        });
        return;
      }
      this.leave(ws);
      const p: PlayerState = {
        id: randomUUID(),
        name: String(m.name || "Runner")
          .replace(/[<>\u0000-\u001f]/g, "")
          .slice(0, 16),
        p: this.spawn(r, r.players.size),
        yaw: 0,
        pitch: 0,
        hp: 100,
        kills: 0,
        deaths: 0,
        ...newInventory(),
        height: 1.76,
        anchor: null,
        lastMove: Date.now(),
        lastShot: 0,
        deadAt: 0,
        ready: m.compact !== true,
        notoriety: r.citizens ? 0 : undefined,
        crime: r.shops ? cleanRecord() : undefined,
        shieldUntil: m.compact === true ? Infinity : Date.now() + 3000,
        reloadUntil: 0,
        reloadWeapon: 0,
        moveCredit: 3,
      };
      this.lastJoin.set(ws, Date.now());
      if (m.compact === true) this.compact.add(ws);
      r.players.set(ws, p);
      this.memberships.set(ws, r);
      const credentials = this.options ? this.sessions.create(ws) : undefined;
      send(ws, {
        ...(credentials
          ? this.sessionSnapshot(
              r,
              p,
              credentials.session.id,
              credentials.secret,
            )
          : {}),
        type: "welcome",
        rubble: r.wreckage && [...r.wreckage.clusters.values()],
        structures: r.structures && [...r.structures.states],
        id: p.id,
        code: r.code,
        seed: r.seed,
        spawn: p.p,
        public: r.public,
        duel: r.duel,
        tickRate: 30,
      });
      this.roster(r);
      return;
    }
    const r = this.memberships.get(ws),
      p = r?.players.get(ws);
    if (!r || !p) return;
    if (m.type === "leave") {
      this.leave(ws);
      return;
    }
    const vehicle = r.cars?.find((c) => c.driver === p.id);
    if (m.type === "buy-aid") {
      if (
        !vehicle &&
        p.hp > 0 &&
        p.hp < 100 &&
        p.ready !== false &&
        r.shops &&
        p.crime &&
        r.shops.buyAid(p.crime, p.p, p.height, r.spatial.ray.bind(r.spatial))
      ) {
        p.hp = 100;
        send(ws, {
          type: "crime",
          record: p.crime,
          event: "First aid · health restored",
        });
      }
      return;
    }
    if (m.type === "rob") {
      if (r.shops && p.crime && p.hp > 0 && p.ready !== false) {
        const event = r.shops.start(
          p.id,
          p.crime,
          p.p,
          p.height,
          !!vehicle,
          Date.now(),
          r.spatial.ray.bind(r.spatial),
        );
        if (event) send(ws, { type: "crime", record: p.crime, event });
      }
      return;
    }
    if (m.type === "vault-glass" && r.structures) {
      const pane = Number.isInteger(m.index)
        ? r.city.boxes[m.index]
        : undefined;
      if (!pane?.solid || vehicle || p.hp <= 0 || p.ready === false) return;
      const dir: V3 = [-Math.sin(p.yaw), 0, -Math.cos(p.yaw)];
      const route = windowPassage(pane, p.p, dir);
      if (
        route &&
        r.spatial.ray(route.origin, dir, route.travel + 0.06)?.box === pane &&
        r.spatial.clear(route.target, 1.12)
      ) {
        r.structures.damage(m.index, 30);
        this.countyVandalism(p);
      }
      return;
    }
    if (m.type === "door" && r.structures) {
      if (
        !vehicle &&
        p.hp > 0 &&
        p.ready !== false &&
        Number.isInteger(m.index) &&
        typeof m.open === "boolean"
      ) {
        const occupants = [...r.players.values(), ...r.npcs].filter(
          (a) => a.hp > 0,
        );
        r.structures.operate(
          m.index,
          m.open,
          [p.p[0], p.p[1] + p.height - 0.15, p.p[2]],
          occupants,
          r.spatial.ray.bind(r.spatial),
        );
      }
      return;
    }
    if (m.type === "vehicle" && r.cars) {
      const car = Number.isInteger(m.index) ? r.cars[m.index] : undefined;
      const action = m.action ?? (vehicle ? "exit" : "enter");
      let result;
      if (car && p.hp > 0) {
        if (action === "exit" && vehicle === car) {
          car.driver = null;
          this.drivers.delete(p);
        }
        if (
          action === "confirm" &&
          !vehicle &&
          car.interaction?.actor === p.id &&
          car.interaction.started === m.started &&
          car.interaction.action !== "hijack"
        ) {
          result = advanceSeatAction(
            car,
            canReachCar(car, p.p),
            Date.now(),
            true,
          );
          if (car.driver === p.id) this.takeWheel(r, p, car);
        }
        if (
          !vehicle &&
          canReachCar(car, p.p) &&
          !r.cars.some((other) => other.interaction?.actor === p.id) &&
          startSeatAction(car, p.id, action, Date.now())
        ) {
          if (m.driveVersion === 1) this.modernSeat.add(p);
          else this.modernSeat.delete(p);
          if (car.driver === p.id) this.takeWheel(r, p, car);
        }
      }
      send(ws, {
        type: "vehicle-seat",
        driveVersion: this.drivers.has(p) ? 1 : undefined,
        index: m.index,
        result,
        car: car ?? null,
      });
      return;
    }
    if (vehicle && m.type === "fire") return;
    if (m.type === "state" && p.hp > 0) {
      // A movement sample belongs to the seat the sender had when it was taken.
      // Ignore walking samples in transit when boarding and driving samples after exit.
      if (
        r.cars &&
        (vehicle ? r.cars[m.vehicle] !== vehicle : (m.vehicle ?? -1) !== -1)
      )
        return;
      if (vehicle?.interaction?.action === "hijack") return;
      if (vehicle && this.drivers.has(p)) {
        this.drive(ws, r, p, vehicle, m.vehicle, m.drive);
        return;
      }
      if (
        !validVector(m.p) ||
        !Number.isFinite(m.yaw) ||
        !Number.isFinite(m.pitch)
      )
        return;
      const now = Date.now(),
        dt = Math.min(0.5, (now - p.lastMove) / 1000);
      const displacement = Math.hypot(
        ...m.p.map((v: number, i: number) => v - p.p[i]),
      );
      p.moveCredit = Math.min(8, p.moveCredit + dt * 65);
      p.lastMove = now;
      if (
        (r.city.arena && !insideRust(m.p, 0.25)) ||
        displacement > p.moveCredit ||
        !(vehicle && r.driving
          ? r.driving.legacyClear(p.p, p.yaw, m.p, m.yaw, vehicle.kind, vehicle)
          : r.spatial.movement(p.p, m.p, p.height)) ||
        m.p[1] < -5 ||
        m.p[1] > r.city.flightCeiling ||
        Math.abs(m.p[0]) > r.city.bounds ||
        Math.abs(m.p[2]) > r.city.bounds
      ) {
        send(ws, { type: "correction", p: p.p });
        return;
      }
      if (p.ready === false) {
        p.ready = true;
        p.shieldUntil = now + 3000;
      }
      p.moveCredit -= displacement;
      p.p = m.p;
      if (vehicle) {
        vehicle.p = [...p.p];
        vehicle.yaw = m.yaw;
      }
      p.yaw = m.yaw;
      p.pitch = Math.max(-1.5, Math.min(1.5, m.pitch));
      let nextWeapon = p.owned.includes(m.weapon) ? m.weapon : p.weapon;
      if (!vehicle && ws.bufferedAmount < 32768) {
        const drop = r.weaponDrops.find(
          (site) =>
            !p.owned.includes(site.weapon) &&
            distance(site.p, p.p) <= PICKUP_RADIUS,
        );
        if (drop) {
          p.owned.push(drop.weapon);
          p.mags[drop.weapon] = MAGAZINES[drop.weapon];
          nextWeapon = drop.weapon;
          send(ws, { type: "weapon-pickup", weapon: drop.weapon });
        }
      }
      if (nextWeapon !== p.weapon) {
        p.reloadUntil = 0;
        p.swing = undefined;
        p.punchPending = false;
      }
      p.weapon = nextWeapon;
      p.height = Number.isFinite(m.height)
        ? Math.max(1.08, Math.min(1.76, m.height))
        : 1.76;
      p.lean =
        m.aiming === true
          ? validatedLean(
              [p.p[0], p.p[1] + p.height - 0.16, p.p[2]],
              p.yaw,
              p.pitch,
              m.lean,
              r.spatial.ray.bind(r.spatial),
            )
          : 0;
      p.anchor = !r.city.arena && validVector(m.anchor) ? m.anchor : null;
      p.lastMove = now;
      return;
    }
    if (
      m.type === "reload" &&
      p.weapon !== FISTS &&
      p.hp > 0 &&
      !p.reloadUntil &&
      p.mags[p.weapon] < MAGAZINES[p.weapon]
    ) {
      p.reloadWeapon = p.weapon;
      p.reloadUntil = Date.now() + RELOAD_SECONDS[p.weapon] * 1000;
      send(ws, {
        type: "ammo",
        mags: p.mags,
        reloadRemaining: Math.max(0, p.reloadUntil - Date.now()),
      });
      return;
    }
    if (m.type === "respawn" && p.hp <= 0 && Date.now() - p.deadAt > 2200) {
      if (r.duel) {
        for (const survivor of r.players.values()) {
          if (survivor !== p && survivor.hp > 0) survivor.hp = 100;
        }
      }
      p.p = this.spawn(r, Math.floor(Math.random() * 16));
      p.hp = 100;
      p.swing = undefined;
      p.punchPending = false;
      p.punchReadyAt = 0;
      if (r.citizens) p.notoriety = 0;
      if (p.crime) {
        r.shops?.release(p.id, p.crime);
        endPursuit(p.crime, false);
        send(ws, { type: "crime", record: p.crime });
      }
      Object.assign(p, newInventory());
      p.reloadUntil = 0;
      p.moveCredit = 3;
      p.shieldUntil = Date.now() + 2500;
      p.lastMove = Date.now();
      send(ws, { type: "respawn", p: p.p });
      return;
    }
    if (
      m.type === "punch" &&
      p.weapon === FISTS &&
      p.hp > 0 &&
      p.ready !== false &&
      !vehicle &&
      !p.reloadUntil
    ) {
      const now = Date.now();
      // Allow small packet timing variations without shortening the server's attack cycle.
      const ready = p.punchReadyAt ?? 0;
      if (p.punchPending || now + 45 < ready || now - p.lastShot < 110) return;
      const swing = nextPunch(p.swing, Math.max(now, ready));
      p.swing = swing;
      p.punchPending = true;
      p.punchReadyAt = swing.start + PUNCHES[swing.move].duration * 1000;
      return;
    }
    if (
      m.type === "fire" &&
      p.weapon !== FISTS &&
      p.hp > 0 &&
      p.ready !== false
    ) {
      const now = Date.now(),
        damages = [24, 14, 35, 90];
      if (
        now < (p.punchReadyAt ?? 0) ||
        now - p.lastShot < FIRE_INTERVAL_MS[p.weapon] ||
        p.reloadUntil ||
        p.mags[p.weapon] <= 0
      ) {
        send(ws, {
          type: "ammo",
          mags: p.mags,
          reloadRemaining: Math.max(0, p.reloadUntil - Date.now()),
        });
        return;
      }
      p.mags[p.weapon]--;
      p.lastShot = now;
      if (r.citizens) p.notoriety = notorietyAfter(p.notoriety ?? 0, 2);
      const dir: V3 = [
          -Math.sin(p.yaw) * Math.cos(p.pitch),
          Math.sin(p.pitch),
          -Math.cos(p.yaw) * Math.cos(p.pitch),
        ],
        baseEye: V3 = [p.p[0], p.p[1] + p.height - 0.16, p.p[2]],
        origin = peekEye(
          baseEye,
          p.yaw,
          validatedLean(
            baseEye,
            p.yaw,
            p.pitch,
            p.lean ?? 0,
            r.spatial.ray.bind(r.spatial),
          ),
        );
      const rays = p.weapon === 1 ? 7 : 1;
      let endpoint: V3 = origin.map((v, i) => v + dir[i] * 70) as V3;
      for (let pellet = 0; pellet < rays; pellet++) {
        const d: V3 = [...dir];
        if (rays > 1) {
          d[0] += (Math.random() - 0.5) * 0.13;
          d[1] += (Math.random() - 0.5) * 0.13;
          d[2] += (Math.random() - 0.5) * 0.13;
          const len = Math.hypot(...d);
          for (let k = 0; k < 3; k++) d[k] /= len;
        }
        const maxRange = p.weapon === 3 ? 220 : 90;
        const surface = r.spatial.ray(origin, d, maxRange);
        let nearest = surface?.distance ?? maxRange,
          victim: PlayerState | undefined,
          head = false,
          region: HitRegion = "body",
          hitSide = 1;
        for (const other of [...r.players.values(), ...r.npcs]) {
          if (other === p || other.hp <= 0 || now < other.shieldUntil) continue;
          const hit = actorHit(
            origin,
            d,
            other.p,
            other.height,
            nearest,
            other.yaw + Math.PI,
            other.lean ?? 0,
          );
          if (hit) {
            nearest = hit.distance;
            victim = other;
            head = hit.head;
            region = hit.region;
            hitSide = hit.side;
          }
        }
        endpoint = origin.map((v, i) => v + d[i] * nearest) as V3;
        if (!victim && surface?.box.pieceId !== undefined)
          r.structures?.damage(surface.box.pieceId, damages[p.weapon]);
        if (victim) {
          const damage = Math.round(damages[p.weapon] * HIT_MULTIPLIER[region]);
          this.hurt(r, victim, p, damage, region, hitSide);
          send(ws, {
            type: "hit",
            head,
            region,
            damage,
            kill: victim.hp === 0,
            npc: !!victim.npc,
          });
        }
      }
      this.broadcast(r, { type: "shot", id: p.id, from: origin, to: endpoint });
    }
  }
  dispose() {
    clearInterval(this.timer);
    clearInterval(this.heartbeat);
    for (const room of this.rooms.values()) room.wreckage?.dispose();
    this.rooms.clear();
    this.memberships.clear();
    this.sessions.records.clear();
    this.admissions.tickets.clear();
    this.reservations.clear();
  }
}
