import { combatStep, shotDelay } from "../src/enemy-movement.ts";
import { actorHit, movementYaw, type HitRegion } from "../src/actor-hit.ts";
import { distance, type City, type V3 } from "../src/world.ts";
import type { PlayerState } from "./rooms.ts";
import {
  chooseNpcSpawn,
  outsideNpcRadius,
  type Observer,
} from "../src/npc-presence.ts";
import { Waves } from "../src/waves.ts";
import { Spatial } from "./spatial.ts";
export interface Npc extends PlayerState {
  npc: true;
  node: number;
  path: number[];
  thinkAt: number;
  aimSince?: number;
  targetId?: string;
  lastKnown?: V3;
  shotsFired?: number;
  engaged?: boolean;
  nextShot?: number;
  lateralSign?: number;
  blockedUntil?: number;
  vx?: number;
  vz?: number;
}
export class Npcs {
  actors: Npc[] = [];
  private graph: number[][];
  waves = new Waves();
  private serial = 0;
  private spawnNodes: number[] = [];
  constructor(
    private city: City,
    private spatial: Spatial,
  ) {
    this.graph = city.nodes.map(() => []);
    for (const [a, b] of city.links) {
      this.graph[a].push(b);
      this.graph[b].push(a);
    }
    this.spawnNodes = city.nodes.map((_, i) => i);
    const observers = [
      {
        p: city.spawns[0],
        eye: [
          city.spawns[0][0],
          city.spawns[0][1] + 1.6,
          city.spawns[0][2],
        ] as V3,
      },
    ];
    for (let i = 0; i < 4; i++) this.spawn(observers);
    this.waves.spawned = this.actors.length;
  }
  private spawn(observers: Observer[]) {
    const i = this.serial++;
    const node = chooseNpcSpawn(
      this.city.nodes,
      this.spawnNodes,
      observers,
      this.actors.filter((b) => b.hp > 0).map((b) => b.p),
      i,
      (eye, to) => {
        const len = distance(eye, to);
        const dir = to.map((v, k) => (v - eye[k]) / len) as V3;
        return !!this.spatial.ray(eye, dir, len - 0.2);
      },
      (p) => this.spatial.clear(p),
    );
    if (node === null) return false;
    this.actors.push({
      id: "npc-" + i,
      name: "Ink runner",
      p: [...this.city.nodes[node]],
      yaw: 0,
      pitch: 0,
      hp: 100,
      kills: 0,
      deaths: 0,
      weapon: 0,
      height: 1.76,
      anchor: null,
      lastMove: Date.now(),
      lastShot: Date.now(),
      deadAt: 0,
      shieldUntil: 0,
      owned: [0],
      mags: [30, 8, 14],
      reloadUntil: 0,
      reloadWeapon: 0,
      moveCredit: 0,
      npc: true,
      node,
      path: [],
      thinkAt: 0,
    });
    return true;
  }
  private nearest(p: V3) {
    let best = 0,
      score = Infinity;
    this.city.nodes.forEach((n, i) => {
      const d = distance(n, p) + Math.abs(n[1] - p[1]) * 3;
      if (d < score) {
        score = d;
        best = i;
      }
    });
    return best;
  }
  private path(start: number, end: number) {
    const queue = [end],
      prev = new Map<number, number>();
    prev.set(end, -1);
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i];
      if (n === start) break;
      for (const next of this.graph[n])
        if (!prev.has(next)) {
          prev.set(next, n);
          queue.push(next);
        }
    }
    const out: number[] = [];
    let n = start;
    while (prev.has(n) && prev.get(n)! >= 0 && out.length < 100) {
      n = prev.get(n)!;
      out.push(n);
    }
    return out;
  }
  update(
    dt: number,
    now: number,
    players: PlayerState[],
    hurt: (
      target: PlayerState,
      bot: Npc,
      damage: number,
      region?: HitRegion,
    ) => void,
    shot: (bot: Npc, to: V3) => void,
  ) {
    const living = players.filter((p) => p.hp > 0);
    if (!living.length) return;
    const observers = living.map((p) => ({
      p: p.p,
      eye: [p.p[0], p.p[1] + p.height - 0.16, p.p[2]] as V3,
    }));
    for (let i = this.actors.length - 1; i >= 0; i--)
      if (
        this.actors[i].hp > 0 &&
        outsideNpcRadius(this.actors[i].p, observers)
      ) {
        this.actors.splice(i, 1);
        this.waves.spawned--;
      }
    const oldWave = this.waves.number;
    this.waves.update(dt, this.actors.filter((b) => b.hp > 0).length, () =>
      this.spawn(observers),
    );
    if (this.waves.number !== oldWave) this.actors.splice(0);
    const settings = this.waves.settings;
    for (const bot of this.actors) {
      if (bot.hp <= 0) continue;
      const visible = (p: PlayerState) => {
        const eye: V3 = [bot.p[0], bot.p[1] + 1.45, bot.p[2]];
        const aim: V3 = [p.p[0], p.p[1] + p.height * 0.55, p.p[2]];
        const len = distance(eye, aim);
        return (
          len < 45 &&
          !this.spatial.ray(
            eye,
            aim.map((v, i) => (v - eye[i]) / Math.max(0.001, len)) as V3,
            len,
          )
        );
      };
      // Keep a target until it disappears; prefer someone actually visible.
      const candidates = [...living].sort(
        (a, b) => distance(a.p, bot.p) - distance(b.p, bot.p),
      );
      const retained = living.find((p) => p.id === bot.targetId);
      const target =
        retained && visible(retained)
          ? retained
          : (candidates.find(visible) ?? retained ?? candidates[0]);
      if (!target) continue;
      const sees = visible(target),
        range = distance(bot.p, target.p);
      if (bot.targetId !== target.id) {
        bot.aimSince = undefined;
        bot.targetId = target.id;
      }
      if (sees || !bot.lastKnown || range < 10) bot.lastKnown = [...target.p];
      const serial = Number(bot.id.slice(4));
      const engage =
        sees && range <= 32 && Math.abs(target.p[1] - bot.p[1]) < 1.5;
      bot.engaged = sees;
      if (sees) bot.aimSince ??= now;
      else bot.aimSince = undefined;
      // Replan at a reached waypoint, never from a different nearest node mid-edge.
      if (
        now >= bot.thinkAt &&
        (!bot.path.length || distance(bot.p, this.city.nodes[bot.node]) < 0.12)
      ) {
        bot.thinkAt = now + settings.reaction;
        let goal = this.nearest(bot.lastKnown!);
        if (sees && range < 6) {
          const exits = this.graph[bot.node];
          if (exits.length)
            goal = exits.reduce((a, b) =>
              distance(this.city.nodes[a], target.p) >
              distance(this.city.nodes[b], target.p)
                ? a
                : b,
            );
        }
        bot.path = this.path(bot.node, goal);
      }
      const previousPosition = [...bot.p];
      if (engage) {
        const dx = target.p[0] - bot.p[0],
          dz = target.p[2] - bot.p[2],
          len = Math.max(0.01, Math.hypot(dx, dz));
        const step = combatStep(
          serial,
          now / 1000,
          range,
          bot.hp,
          10 + (serial % 4) * 2.5,
        );
        const side = step.side * (bot.lateralSign ?? 1),
          scale = settings.speed / Math.max(1, Math.hypot(step.forward, side));
        const blend = 1 - Math.exp(-7 * dt);
        bot.vx =
          (bot.vx ?? 0) * (1 - blend) +
          ((scale * (dx * step.forward - dz * side)) / len) * blend;
        bot.vz =
          (bot.vz ?? 0) * (1 - blend) +
          ((scale * (dz * step.forward + dx * side)) / len) * blend;
        const next: V3 = [
          bot.p[0] + bot.vx * dt,
          bot.p[1],
          bot.p[2] + bot.vz * dt,
        ];
        const floor = this.spatial.ray(
          [next[0], next[1] + 0.5, next[2]],
          [0, -1, 0],
          1,
        );
        const clear =
          floor &&
          this.spatial.movement(bot.p, next, bot.height) &&
          !this.actors.some(
            (o) =>
              o !== bot &&
              o.hp > 0 &&
              distance(next, o.p) < 0.8 &&
              distance(next, o.p) < distance(bot.p, o.p),
          );
        if (clear) {
          next[1] += 0.5 - floor.distance;
          bot.p = next;
        } else if (now >= (bot.blockedUntil ?? 0)) {
          bot.lateralSign = -(bot.lateralSign ?? 1);
          bot.blockedUntil = now + 650;
          bot.vx = bot.vz = 0;
        }
      } else {
        bot.vx = bot.vz = 0;
      }
      const next = bot.path[0];
      if (next !== undefined && !engage) {
        const dest = this.city.nodes[next],
          len = distance(bot.p, dest),
          step = Math.min(len, dt * settings.speed);
        if (len > 0.001) {
          const proposed = bot.p.map(
            (v, i) => v + ((dest[i] - v) * step) / len,
          ) as V3;
          const crowded = this.actors.some(
            (other) =>
              other !== bot &&
              other.hp > 0 &&
              distance(proposed, other.p) < 0.8 &&
              distance(proposed, other.p) < distance(bot.p, other.p),
          );
          const nearPlayer = living.some((p) => distance(proposed, p.p) < 2);
          if (
            !crowded &&
            !nearPlayer &&
            this.spatial.movement(bot.p, proposed, bot.height)
          )
            bot.p = proposed;
          else if (crowded && now >= bot.thinkAt) {
            // Take an unoccupied adjacent branch instead of pushing into a queue.
            const exit = this.graph[bot.node].find(
              (i) =>
                i !== next &&
                this.actors.every(
                  (o) =>
                    o === bot ||
                    o.hp <= 0 ||
                    distance(this.city.nodes[i], o.p) > 0.9,
                ),
            );
            if (exit !== undefined)
              bot.path = [
                exit,
                ...this.path(exit, this.nearest(bot.lastKnown!)),
              ];
            bot.thinkAt = now + 700;
          }
        }
        if (distance(bot.p, dest) < 0.04) {
          bot.node = next;
          bot.path.shift();
        }
      }
      const eye: V3 = [bot.p[0], bot.p[1] + 1.45, bot.p[2]],
        to: V3 = [target.p[0], target.p[1] + target.height * 0.55, target.p[2]],
        len = distance(eye, to),
        dir = to.map((v, i) => (v - eye[i]) / Math.max(0.001, len)) as V3;
      const moving = distance(bot.p, previousPosition as V3) > 0.001;
      const desiredYaw =
        moving && !engage
          ? movementYaw(
              bot.p[0] - previousPosition[0],
              bot.p[2] - previousPosition[2],
              bot.yaw,
            )
          : sees
            ? Math.atan2(-dir[0], -dir[2])
            : bot.yaw;
      const turn = Math.atan2(
        Math.sin(desiredYaw - bot.yaw),
        Math.cos(desiredYaw - bot.yaw),
      );
      bot.yaw += Math.max(-dt * 7, Math.min(dt * 7, turn));
      bot.pitch = Math.asin(dir[1]);
      const aimYaw = Math.atan2(-dir[0], -dir[2]);
      const aligned =
        Math.abs(
          Math.atan2(Math.sin(aimYaw - bot.yaw), Math.cos(aimYaw - bot.yaw)),
        ) < 0.16;
      if (
        sees &&
        aligned &&
        (!moving || engage) &&
        bot.aimSince !== undefined &&
        now - bot.aimSince >= settings.reaction &&
        len < 36 &&
        now >= (bot.nextShot ?? bot.lastShot + settings.shotInterval) &&
        now > target.shieldUntil
      ) {
        bot.lastShot = now;
        // Deterministic spread gives early waves misses, while tracers and damage agree.
        const n = (bot.shotsFired = (bot.shotsFired ?? 0) + 1);
        bot.nextShot =
          now +
          1000 * shotDelay(n, this.waves.number, settings.shotInterval / 1000);
        const phase = n * 2.399963 + Number(bot.id.slice(4)) * 1.7;
        const spread =
          Math.max(0.008, 0.033 - this.waves.number * 0.002) *
          len *
          (0.24 + 0.76 * Math.abs(Math.sin(phase * 0.73)));
        const aim: V3 = [
          to[0] + dir[2] * Math.cos(phase) * spread,
          to[1] + Math.sin(phase) * spread * 0.5,
          to[2] - dir[0] * Math.cos(phase) * spread,
        ];
        const shotLen = distance(eye, aim),
          shotDir = aim.map((v, i) => (v - eye[i]) / shotLen) as V3;
        const wall = this.spatial.ray(eye, shotDir, 36);
        const hit = actorHit(
          eye,
          shotDir,
          target.p,
          target.height,
          wall?.distance ?? 36,
          target.yaw + Math.PI,
          target.lean ?? 0,
        );
        const end = eye.map(
          (v, i) => v + shotDir[i] * (hit?.distance ?? wall?.distance ?? 36),
        ) as V3;
        shot(bot, end);
        if (hit)
          hurt(
            target,
            bot,
            Math.round(settings.damage * hit.multiplier),
            hit.region,
          );
      }
    }
  }
}
