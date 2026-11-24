import { vehicleEntersRunner } from "./county-pedestrian-collision.ts";
import { FISTS } from "./fists.ts";
import { besideCar } from "./county-car-access.ts";
import type { CrimeState } from "./county-crime.ts";
import type { Npc } from "../server/npcs.ts";
import { movementYaw } from "./actor-hit.ts";
import type { Street } from "./city-plan.ts";
import {
  alongStreet,
  COUNTY_SETTLEMENTS,
  ruralRoad,
  terrainHeight,
  TOWNS,
} from "./county-plan.ts";
import type { CountyCar } from "./county.ts";
import { VEHICLE_DIMENSIONS } from "./county-vehicle-dimensions.ts";
import { distance, randomSeed, type City, type V3 } from "./world.ts";

export interface CountyCitizen extends Npc {
  civilian: true;
  action: "idle" | "shove" | "melee" | "shoot";
  car?: number;
  downUntil?: number;
}
interface Person {
  id: string;
  p: V3;
  hp: number;
  height: number;
  notoriety?: number;
  crime?: CrimeState;
  shieldUntil?: number;
  downUntil?: number;
}
interface Queries {
  ray(o: V3, d: V3, limit: number): unknown;
  clear(p: V3, height: number): boolean;
  movement(a: V3, b: V3, height: number): boolean;
}
export type CitizenAction = "shove" | "punch" | "shot" | "ram";
interface Route {
  report?: V3;
  road: Street;
  dir: number;
  entering: boolean;
  goal: V3;
  seat?: number;
  reverseUntil: number;
  poseUntil: number;
  pace: number;
  random: () => number;
  checkAt: number;
  actionAt: number;
  blockedFor: number;
  healAt: number;
  lastHealth: number;
  respawnAt: number;
}
type Hurt<T extends Person> = (
  target: T,
  bot: CountyCitizen,
  damage: number,
  kind: CitizenAction,
) => void;
const horizontal = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const lane = (s: Street) => Math.min(s.width * 0.21, 2.8);
function onRoute(s: Street, dir: number, t: number, driving: boolean): V3 {
  const p = alongStreet(
    s,
    dir === 1 ? t : 1 - t,
    dir * (driving ? lane(s) : s.width / 2 + 0.72),
  );
  p[1] += driving ? 0.08 : 0.16;
  return p;
}
function setGoal(route: Route, driving: boolean, entering: boolean) {
  const s = route.road;
  const inset = Math.min(0.24, (s.width / 2 + 1) / horizontal(s.a, s.b));
  route.goal = onRoute(s, route.dir, entering ? inset : 1 - inset, driving);
  route.entering = entering;
  route.checkAt = 0;
}
function newCitizen(id: string, name: string, p: V3): CountyCitizen {
  return {
    id,
    name,
    p,
    npc: true,
    civilian: true,
    action: "idle",
    yaw: 0,
    pitch: 0,
    hp: 100,
    kills: 0,
    deaths: 0,
    weapon: name === "Police officer" ? 2 : FISTS,
    height: 1.76,
    anchor: null,
    lastMove: 0,
    lastShot: 0,
    deadAt: 0,
    shieldUntil: 0,
    owned: name === "Police officer" ? [FISTS, 2] : [FISTS],
    mags: [30, 8, 14, 5],
    reloadUntil: 0,
    reloadWeapon: 0,
    moveCredit: 0,
    node: 0,
    path: [],
    thinkAt: 0,
  };
}

// Test a point against an oriented car body, with an optional safety margin.
function nearCar(p: V3, car: CountyCar, margin: number) {
  const x = p[0] - car.p[0],
    z = p[2] - car.p[2];
  if (
    Math.abs(x) > 4 + margin ||
    Math.abs(z) > 4 + margin ||
    Math.abs(p[1] - car.p[1]) > 2.1
  )
    return false;
  const [width, length] = VEHICLE_DIMENSIONS[car.kind];
  const sin = Math.sin(car.yaw),
    cos = Math.cos(car.yaw);
  return (
    Math.abs(x * cos - z * sin) < width + margin &&
    Math.abs(x * sin + z * cos) < length + margin
  );
}

export class CountyCitizens {
  readonly actors: CountyCitizen[] = [];
  onTrafficMove?: (
    driver: CountyCitizen,
    car: CountyCar,
    from: V3,
    speed: number,
    now: number,
  ) => void;
  private routes = new Map<string, Route>();
  private junctions = new Map<string, Street[]>();
  constructor(
    city: City,
    private cars: CountyCar[],
    private queries: Queries,
  ) {
    const streets = city.plan.streets;
    for (const s of streets) {
      for (const point of [s.a, s.b]) {
        const key = point.join(",");
        if (!this.junctions.has(key)) this.junctions.set(key, []);
        this.junctions.get(key)!.push(s);
      }
    }
    const villageStreets = COUNTY_SETTLEMENTS.map(({ id }) =>
      streets.filter((s) => s.id.startsWith(id + "-main-")),
    );
    for (const [district, town] of TOWNS.entries()) {
      const random = randomSeed(city.seed + "-neighbors-" + town);
      const local = streets.filter((s) =>
        s.id.startsWith(town < 0 ? "mill-" : "terrace-"),
      );
      const byCinema = local
        .slice()
        .sort(
          (a, b) =>
            horizontal(alongStreet(a, 0.5), city.spawns[district * 15]) -
            horizontal(alongStreet(b, 0.5), city.spawns[district * 15]),
        );
      const shuffled = local
        .map((road) => ({ road, rank: random() }))
        .sort((a, b) => a.rank - b.rank);
      for (let i = 0; i < 12; i++) {
        const outskirts = villageStreets[i - 9];
        const s = outskirts?.length
          ? outskirts[(district * 2 + 1) % outskirts.length]
          : i < 3
            ? byCinema[i]
            : shuffled[i].road;
        const dir = i % 2 ? -1 : 1;
        const p = onRoute(s, dir, 0.22 + random() * 0.56, false);
        this.add(
          "civilian-walker-" + (district * 12 + i),
          i === 1 || i === 9 ? "Police officer" : "Pedestrian",
          s,
          dir,
          p,
        );
      }
    }
    for (const [index, car] of cars.entries()) {
      if (!car.driver?.startsWith("civilian-driver-")) continue;
      // Factory places the seats on their lanes. Recover the directed edge
      // from the physical pose so the world and rendering use identical slots.
      let min = Infinity,
        closest = streets[0],
        direction = 1;
      for (const s of streets) {
        const dx = s.b[0] - s.a[0],
          dz = s.b[2] - s.a[2],
          len2 = dx * dx + dz * dz;
        const dir =
          dx * -Math.sin(car.yaw) + dz * -Math.cos(car.yaw) >= 0 ? 1 : -1;
        const t = Math.min(
          1,
          Math.max(
            0,
            ((car.p[0] - s.a[0]) * dx + (car.p[2] - s.a[2]) * dz) / len2,
          ),
        );
        const d = horizontal(car.p, alongStreet(s, t, dir * lane(s)));
        if (d < min) {
          closest = s;
          min = d;
          direction = dir;
        }
      }
      this.add(
        car.driver,
        car.patrol ? "Police officer" : "Motorist",
        closest,
        direction,
        [...car.p],
        index,
      );
    }
  }
  private add(
    id: string,
    name: string,
    road: Street,
    dir: number,
    p: V3,
    car?: number,
  ) {
    const random = randomSeed(id);
    const actor = newCitizen(id, name, p);
    actor.car = car;
    const route: Route = {
      road,
      dir,
      goal: p,
      seat: car,
      reverseUntil: 0,
      poseUntil: 0,
      entering: false,
      pace: car === undefined ? 1.25 + random() * 0.65 : 7.5 + random() * 3,
      random,
      checkAt: 0,
      actionAt: 0,
      blockedFor: 0,
      healAt: 0,
      lastHealth: 100,
      respawnAt: 0,
    };
    setGoal(route, car !== undefined, false);
    actor.yaw = movementYaw(
      dir * (road.b[0] - road.a[0]),
      dir * (road.b[2] - road.a[2]),
      0,
    );
    this.routes.set(id, route);
    this.actors.push(actor);
  }
  private nextRoad(route: Route, driving: boolean) {
    if (route.entering) {
      setGoal(route, driving, false);
      return;
    }
    const end = route.dir === 1 ? route.road.b : route.road.a;
    const options = this.junctions
      .get(end.join(","))!
      .filter((s) => s !== route.road && (driving || !ruralRoad(s)));
    if (route.report && options.length) {
      const report = route.report;
      options.sort((a, b) => {
        const exit = (s: Street) => (horizontal(s.a, end) < 0.01 ? s.b : s.a);
        return horizontal(exit(a), report) - horizontal(exit(b), report);
      });
      route.road = options[0];
    } else
      route.road = options.length
        ? options[Math.floor(route.random() * options.length)]
        : route.road;
    route.dir =
      route.road.a === end || horizontal(route.road.a, end) < 0.01 ? 1 : -1;
    setGoal(route, driving, true);
  }
  private visible(a: CountyCitizen, b: Person) {
    const eye: V3 = [a.p[0], a.p[1] + 1.45, a.p[2]];
    const to: V3 = [b.p[0], b.p[1] + b.height * 0.58, b.p[2]];
    const len = distance(eye, to);
    return !this.queries.ray(
      eye,
      to.map((v, i) => (v - eye[i]) / Math.max(len, 0.01)) as V3,
      Math.max(0, len - 0.12),
    );
  }
  private target<T extends Person>(
    a: CountyCitizen,
    players: T[],
    now: number,
  ) {
    let target: T | undefined,
      best = Infinity;
    for (const p of players) {
      const police = a.name === "Police officer";
      const level = police ? (p.crime?.stars ?? 0) * 35 : (p.notoriety ?? 0);
      if (
        level <= 30 ||
        !p.hp ||
        (p.shieldUntil ?? 0) > now ||
        (p.downUntil ?? 0) > now
      )
        continue;
      const d = distance(a.p, p.p);
      const radius =
        level > 75 ? 31 : level > 50 ? 15 : a.car === undefined ? 5 : 17;
      if (
        d >= (police ? 48 + level * 0.2 : radius) ||
        d >= best ||
        !this.visible(a, p)
      )
        continue;
      target = p;
      best = d;
    }
    return target;
  }
  update<T extends Person>(
    dt: number,
    now: number,
    players: T[],
    hurt: Hurt<T>,
    shot: (a: CountyCitizen, to: V3) => void,
  ) {
    dt = Math.min(dt, 0.12);
    for (const a of this.actors) {
      const route = this.routes.get(a.id)!;
      a.vx = 0;
      a.vz = 0;
      if (now >= route.poseUntil) a.action = "idle";
      if (a.hp <= 0) {
        a.action = "idle";
        a.engaged = false;
        a.targetId = undefined;
        if (!route.respawnAt)
          route.respawnAt = now + 18000 + route.random() * 8000;
        if (a.car !== undefined) this.leaveCar(a, route);
        if (now < route.respawnAt) continue;
        const seat =
          route.seat === undefined ? undefined : this.cars[route.seat];
        if (
          seat &&
          !seat.driver &&
          !players.some((p) => p.hp > 0 && distance(p.p, seat.p) < 12)
        ) {
          seat.driver = a.id;
          a.car = route.seat;
          a.p = [...seat.p];
          a.yaw = seat.yaw;
          route.pace = 8.5;
        } else {
          const local = this.junctions.get(route.road.a.join(","))!;
          const spawn = [route.road, ...local]
            .map((road) => ({ road, p: onRoute(road, 1, 0.4, false) }))
            .find(
              ({ p }) =>
                this.queries.clear(p, a.height) &&
                !players.some((v) => v.hp > 0 && distance(p, v.p) < 12) &&
                !this.cars.some((c) => nearCar(p, c, 0.35)) &&
                !this.actors.some(
                  (b) => b !== a && b.hp > 0 && distance(b.p, p) < 1.2,
                ),
            );
          if (!spawn) continue;
          a.p = spawn.p;
          route.road = spawn.road;
          route.dir = 1;
        }
        a.hp = 100;
        a.weapon = a.name === "Police officer" ? 2 : FISTS;
        a.owned = a.weapon === FISTS ? [FISTS] : [FISTS, 2];
        a.deadAt = 0;
        a.downUntil = 0;
        a.fall = undefined;
        route.respawnAt = 0;
        route.lastHealth = 100;
        route.blockedFor = 0;
        route.reverseUntil = 0;
        route.actionAt = now + 1000;
        setGoal(route, a.car !== undefined, false);
      }
      if (a.hp < route.lastHealth) route.healAt = now + 12000;
      if (a.hp < 100 && now >= route.healAt && (a.downUntil ?? 0) <= now) {
        a.hp = Math.min(100, a.hp + 5);
        route.healAt = now + 1000;
      }
      route.lastHealth = a.hp;
      if (
        a.car !== undefined &&
        (this.cars[a.car].driver !== a.id || (a.downUntil ?? 0) > now)
      )
        this.leaveCar(a, route);
      if ((a.downUntil ?? 0) > now) {
        a.action = "idle";
        a.engaged = false;
        a.targetId = undefined;
        continue;
      }
      if (
        a.car !== undefined &&
        this.cars[a.car].interaction?.action === "hijack"
      )
        continue;
      const target = this.target(a, players, now);
      a.targetId = target?.id;
      a.engaged =
        !!target && (target.notoriety ?? 0) > 75 && a.car === undefined;
      const police = a.name === "Police officer";
      if (
        police &&
        target &&
        a.car !== undefined &&
        distance(target.p, a.p) < 10 &&
        !this.cars.some((c) => c.driver === target.id)
      )
        this.leaveCar(a, route);
      // Dispatch to the reported location even before the suspect comes into sight.
      const report =
        police && !target
          ? players
              .filter((p) => p.hp > 0 && p.crime?.stars && p.crime.alert)
              .sort(
                (a1, b1) =>
                  horizontal(a.p, a1.crime!.alert!) -
                  horizontal(a.p, b1.crime!.alert!),
              )[0]?.crime?.alert
          : undefined;
      route.report =
        report && horizontal(a.p, report) < 190 ? report : undefined;
      if (a.car !== undefined && this.cars[a.car].patrol)
        this.cars[a.car].responding = !!(target || route.report);
      if (a.car === undefined)
        this.walk(a, route, target, players, dt, now, hurt, shot);
      else this.drive(a, route, target, players, dt, now, hurt);
    }
  }
  ejectDriver(id: string) {
    const a = this.actors.find((actor) => actor.id === id);
    if (!a || a.car === undefined) return;
    const car = this.cars[a.car];
    const landing = besideCar(car);
    this.leaveCar(a, this.routes.get(id)!);
    if (this.queries.clear(landing, a.height)) a.p = landing;
  }
  private leaveCar(a: CountyCitizen, r: Route) {
    const car = this.cars[a.car!];
    if (car.patrol) car.responding = false;
    if (car.driver === a.id) car.driver = null;
    a.car = undefined;
    r.pace = 1.6;

    setGoal(r, false, false);
  }
  private walk<T extends Person>(
    a: CountyCitizen,
    r: Route,
    target: T | undefined,
    players: T[],
    dt: number,
    now: number,
    hurt: Hurt<T>,
    shot: (a: CountyCitizen, to: V3) => void,
  ) {
    const d = target ? distance(a.p, target.p) : Infinity;
    const police = a.name === "Police officer";
    const armed = police
      ? (target?.crime?.stars ?? 0) >= 3
      : (target?.notoriety ?? 0) > 75;
    if (armed && a.weapon === FISTS) {
      a.weapon = 2;
      a.owned.push(2);
    }
    if (police && target && d < 1.5 && !armed) {
      a.yaw = movementYaw(target.p[0] - a.p[0], target.p[2] - a.p[2], a.yaw);
      return;
    }
    if (target && ((!police && d < 1.7) || (armed && d < 30))) {
      a.yaw = movementYaw(target.p[0] - a.p[0], target.p[2] - a.p[2], a.yaw);
      if (now < r.actionAt) return;
      if (d >= 1.7) {
        const to: V3 = [
          target.p[0],
          target.p[1] + target.height * 0.58,
          target.p[2],
        ];
        a.action = "shoot";
        r.poseUntil = now + 500;
        shot(a, to);
        a.lastShot = now;
        hurt(target, a, 9, "shot");
        r.actionAt = now + 1500 + r.random() * 850;
      } else {
        const punch = (target.notoriety ?? 0) > 50;
        a.action = punch ? "melee" : "shove";
        r.poseUntil = now + 450;
        hurt(target, a, punch ? 9 : 0, punch ? "punch" : "shove");
        r.actionAt = now + (punch ? 1300 : 3400);
      }
      return;
    }
    const search =
      r.report && horizontal(a.p, r.report) < 22 ? r.report : undefined;
    if (!target && search && horizontal(a.p, search) < 1) return;
    const goal = target?.p ?? search ?? r.goal;
    if (!target && !search && horizontal(a.p, goal) < 0.5) {
      this.nextRoad(r, false);
      return;
    }
    const len = Math.max(0.001, horizontal(a.p, goal));
    const dx = (goal[0] - a.p[0]) / len,
      dz = (goal[2] - a.p[2]) / len;
    const step = Math.min(
      len,
      (target ? (police ? 4.7 : 3.1) : r.report ? 3.8 : r.pace) * dt,
    );
    const from = a.p;
    const next: V3 = [from[0] + dx * step, from[1], from[2] + dz * step];
    next[1] = terrainHeight(next[0], next[2]) + 0.16;
    const clearance = 0.48;
    const obstruction =
      this.cars.some(
        (c) =>
          nearCar(next, c, clearance) &&
          (!nearCar(from, c, clearance) ||
            horizontal(next, c.p) <= horizontal(from, c.p)),
      ) ||
      this.actors.some(
        (b) =>
          b !== a &&
          b.hp > 0 &&
          b.car === undefined &&
          distance(b.p, next) < 0.7 &&
          distance(b.p, next) < distance(b.p, from),
      ) ||
      players.some(
        (p) =>
          p !== target &&
          p.hp > 0 &&
          distance(p.p, next) < 0.77 &&
          distance(p.p, next) < distance(p.p, from),
      );
    if (obstruction || !this.passable(a, r, next, dx, dz, now, false)) {
      this.blocked(r, dt, now, false);
      return;
    }
    r.blockedFor = 0;
    a.vx = (dx * step) / Math.max(0.001, dt);
    a.vz = (dz * step) / Math.max(0.001, dt);
    a.p = next;
    a.lastMove = now;
    a.yaw = movementYaw(dx, dz, a.yaw);
  }
  private drive<T extends Person>(
    a: CountyCitizen,
    r: Route,
    target: T | undefined,
    players: T[],
    dt: number,
    now: number,
    hurt: Hurt<T>,
  ) {
    const car = this.cars[a.car!];
    const otherCar = target && this.cars.find((c) => c.driver === target.id);
    const ram =
      !!target &&
      (target.notoriety ?? 0) > 75 &&
      Math.abs(target.p[1] - car.p[1]) < 2.5;
    let goal = r.goal;
    const pursuing = a.name === "Police officer" && !!target;
    if (target && (ram || otherCar || pursuing)) {
      const lead = ram || pursuing ? 0 : 5.5;
      goal = [
        target.p[0] - Math.sin(otherCar?.yaw ?? 0) * lead,
        target.p[1],
        target.p[2] - Math.cos(otherCar?.yaw ?? 0) * lead,
      ];
    }
    const len = horizontal(car.p, goal);
    if (goal === r.goal && len < 1.4) {
      this.nextRoad(r, true);
      return;
    }
    if (goal !== r.goal && !ram && len < 1.8) return;
    const desired = movementYaw(
      goal[0] - car.p[0],
      goal[2] - car.p[2],
      car.yaw,
    );
    const turn = Math.atan2(
      Math.sin(desired - car.yaw),
      Math.cos(desired - car.yaw),
    );
    const yaw = car.yaw + Math.max(-2.5 * dt, Math.min(2.5 * dt, turn));
    const reversing = now < r.reverseUntil;
    const gear = reversing ? -1 : 1;
    const dx = -Math.sin(yaw) * gear,
      dz = -Math.cos(yaw) * gear;
    const pace =
      (reversing ? 2.2 : pursuing ? 19 : ram ? 14 : r.pace) *
      Math.max(0.31, 1 - Math.abs(turn) * 0.58);
    const step = Math.min(len, pace * dt);
    const next: V3 = [car.p[0] + dx * step, 0.08, car.p[2] + dz * step];
    next[1] += terrainHeight(next[0], next[2]);
    const [, length] = VEHICLE_DIMENSIONS[car.kind];
    const nose: V3 = [next[0] + dx * length, next[1], next[2] + dz * length];
    if (
      ram &&
      target &&
      now >= r.actionAt &&
      (nearCar(target.p, car, 0.45) ||
        horizontal(nose, target.p) < 1.35 ||
        (otherCar && nearCar(nose, otherCar, 0.8)))
    ) {
      hurt(target, a, 22, "ram");
      r.actionAt = now + 2600;
    }
    const blocked =
      vehicleEntersRunner(
        car,
        { p: next, yaw, kind: car.kind },
        players,
        car.driver,
      ) ||
      this.cars.some(
        (c) => c !== car && (nearCar(nose, c, 0.72) || nearCar(next, c, 0.72)),
      ) ||
      [...players, ...this.actors].some(
        (p) =>
          p !== a &&
          p.hp > 0 &&
          !(ram && p === target) &&
          (!("car" in p) || p.car === undefined) &&
          distance(p.p, nose) < 1.65,
      );
    if (blocked || !this.passable(a, r, next, dx, dz, now, true)) {
      this.blocked(r, dt, now, true);
      return;
    }
    const previous = car.p;
    car.p = next;
    car.yaw = yaw;
    a.p = [...next];
    a.yaw = yaw;
    a.lastMove = now;
    r.blockedFor = 0;
    this.onTrafficMove?.(a, car, previous, step / Math.max(dt, 0.001), now);
  }
  private passable(
    a: CountyCitizen,
    r: Route,
    next: V3,
    dx: number,
    dz: number,
    now: number,
    driving: boolean,
  ) {
    if (now < r.checkAt) return true;
    const margin = driving ? 2.25 : 0,
      look = driving ? 2.25 : 0.8;
    for (const side of driving ? [-0.85, 0.85] : [0]) {
      const from: V3 = [
        next[0] + dx * margin + dz * side,
        next[1],
        next[2] + dz * margin - dx * side,
      ];
      const ahead: V3 = [from[0] + dx * look, from[1], from[2] + dz * look];
      if (
        !this.queries.clear(from, a.height) ||
        !this.queries.clear(ahead, a.height) ||
        !this.queries.movement(from, ahead, a.height)
      )
        return false;
    }
    r.checkAt = now + (driving ? 130 : 195);
    return true;
  }
  private blocked(r: Route, dt: number, now: number, driving: boolean) {
    r.blockedFor += dt;
    if (r.blockedFor < (driving ? 2.2 : 0.9)) return;
    if (driving) r.reverseUntil = now + 1050;
    r.dir = -r.dir;
    setGoal(r, driving, false);
    r.blockedFor = 0;
  }
}
