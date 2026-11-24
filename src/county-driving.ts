import { sampleCountyWater } from "./county-hydrology.ts";
import {
  vehicleEntersRunner,
  type Pedestrian,
} from "./county-pedestrian-collision.ts";
import { Box3, Matrix4, Quaternion, Vector3 } from "three";
import { OBB } from "three/examples/jsm/math/OBB.js";
import { terrainHeight as terrain, LIMIT } from "./county-plan.ts";
import { contactParts } from "./county-rubble.ts";
import type { RubbleCluster } from "./county-wreckage.ts";
import type { CountyCar, VehicleKind } from "./county.ts";
import type { Box, V3 } from "./world.ts";

import { VEHICLE_DIMENSIONS as dimensions } from "./county-vehicle-dimensions.ts";
export const DRIVE_DT = 1 / 120;
export interface DrivePose {
  p: V3;
  yaw: number;
  speed: number;
  steer: number;
  /** Signed angle between the chassis and its direction of travel. */
  slip?: number;
}
export function tiresSkidding(pose: DrivePose, handbrake: boolean) {
  return (
    Math.abs(pose.speed) >= 4 && (handbrake || Math.abs(pose.slip ?? 0) >= 0.19)
  );
}

export function driveInput(throttle: number, side: number, brake: boolean) {
  return throttle + 1 + 3 * (side + 1) + (brake ? 9 : 0);
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
// Launch acceleration (m/s²), power per unit mass (W/kg), forward limit (m/s),
// and maximum front-wheel lock (radians). The same tune runs during server replay.
const handling: Record<VehicleKind, [number, number, number, number]> = {
  saloon: [7.8, 199, 54, 0.59],
  coupe: [9.4, 278, 61, 0.61],
  minivan: [6.1, 142, 47, 0.59],
  delivery: [5.2, 107, 41, 0.57],
  taxi: [7.2, 175, 51, 0.6],
};
const massKg: Record<VehicleKind, number> = {
  saloon: 1500,
  coupe: 1350,
  delivery: 1050,
  minivan: 1900,
  taxi: 1550,
};
const CELL = 8;
const key = (x: number, z: number) => x * 4096 + z;
const vector = (p: V3) => new Vector3(...p);
const axisY = new Vector3(0, 1, 0);
export class CountyDriveWorld {
  private cells = new Map<number, Box[]>();
  private rubbleBounds = new WeakMap<
    number[],
    { radius: number; members: Box3[] }
  >();
  private hull = new OBB();
  private trafficHull = new OBB();
  private rotation = new Matrix4();
  private inv = new Quaternion();
  private q = new Quaternion();
  private origin = new Vector3();
  constructor(
    private boxes: Box[],
    private rubble: () => Iterable<RubbleCluster> = () => [],
    private cars: () => readonly CountyCar[] = () => [],
    private runners?: () => Iterable<Pedestrian>,
  ) {
    for (const b of boxes) {
      if (
        !b.solid ||
        b.kind === "ground" ||
        b.p[1] - b.s[1] / 2 > terrain(b.p[0], b.p[2]) + 2.7
      )
        continue;
      // Index the swept reach of the longest car. Hinged doors can swing their full width.
      const reach = 3.45 + (b.piece === "door" ? Math.max(b.s[0], b.s[2]) : 0);
      for (
        let x = Math.floor((b.p[0] - b.s[0] / 2 - reach) / CELL);
        x <= Math.floor((b.p[0] + b.s[0] / 2 + reach) / CELL);
        x++
      )
        for (
          let z = Math.floor((b.p[2] - b.s[2] / 2 - reach) / CELL);
          z <= Math.floor((b.p[2] + b.s[2] / 2 + reach) / CELL);
          z++
        ) {
          const k = key(x, z),
            list = this.cells.get(k);
          if (list) list.push(b);
          else this.cells.set(k, [b]);
        }
    }
  }

  private rubbleBlocks(
    from: V3,
    to: V3,
    yaw: number,
    w: number,
    l: number,
    h: number,
  ) {
    // Use the same bounded set of real members as the falling assembly's contact solver.
    for (const c of this.rubble()) {
      let bounds = this.rubbleBounds.get(c.indices);
      if (!bounds) {
        const members = [],
          origin = vector(c.pose.origin);
        let radius = 0;
        for (const i of contactParts(new Set(c.indices), this.boxes)) {
          const b = this.boxes[i];
          if (
            b.piece === "fixture" ||
            b.piece === "furniture" ||
            b.piece === "door"
          )
            continue;
          const centre = vector(b.p),
            size = vector(b.s);
          radius = Math.max(
            radius,
            centre.distanceTo(origin) + size.length() / 2,
          );
          members.push(new Box3().setFromCenterAndSize(centre, size));
        }
        bounds = { radius, members };
        this.rubbleBounds.set(c.indices, bounds);
      }
      const { pose } = c;
      if (
        !bounds.members.length ||
        Math.hypot(
          to[0] - pose.p[0],
          to[1] + h / 2 - pose.p[1],
          to[2] - pose.p[2],
        ) >
          bounds.radius + 3.4
      )
        continue;
      this.inv.fromArray(pose.q).conjugate();
      this.origin.fromArray(pose.origin);
      this.q.setFromAxisAngle(axisY, yaw).premultiply(this.inv);
      this.hull.rotation.setFromMatrix4(
        this.rotation.makeRotationFromQuaternion(this.q),
      );
      this.hull.halfSize.set(w, (h - 0.22) / 2, l);
      const local = (p: V3) =>
        this.hull.center
          .set(
            p[0] - pose.p[0],
            p[1] + (h + 0.22) / 2 - pose.p[1],
            p[2] - pose.p[2],
          )
          .applyQuaternion(this.inv)
          .add(this.origin);
      for (const member of bounds.members) {
        local(to);
        if (!this.hull.intersectsBox3(member)) continue;
        local(from);
        // A moving slab can land across a parked car. Preserve the path out of
        // existing overlap without teleporting either body or imparting impulses.
        if (!this.hull.intersectsBox3(member)) return true;
      }
    }
    return false;
  }

  private trafficBlocks(
    own: CountyCar,
    from: V3,
    to: V3,
    fromYaw: number,
    yaw: number,
  ) {
    const [w, l, h] = dimensions[own.kind];
    for (const other of this.cars()) {
      if (
        other === own ||
        Math.abs(to[0] - other.p[0]) > 6 ||
        Math.abs(to[2] - other.p[2]) > 6
      )
        continue;
      const [ow, ol, oh] = dimensions[other.kind];
      this.trafficHull.center.set(other.p[0], other.p[1] + oh / 2, other.p[2]);
      this.trafficHull.halfSize.set(ow, oh / 2, ol);
      this.trafficHull.rotation.setFromMatrix4(
        this.rotation.makeRotationY(other.yaw),
      );
      this.hull.rotation.setFromMatrix4(this.rotation.makeRotationY(yaw));
      this.hull.halfSize.set(w, h / 2, l);
      this.hull.center.set(to[0], to[1] + h / 2, to[2]);
      if (!this.hull.intersectsOBB(this.trafficHull)) continue;
      this.hull.rotation.setFromMatrix4(this.rotation.makeRotationY(fromYaw));
      this.hull.center.set(from[0], from[1] + h / 2, from[2]);
      if (!this.hull.intersectsOBB(this.trafficHull)) return true;
    }
    return false;
  }

  // Each fixed step covers at most 51 cm. Expand the oriented hull by its
  // translation and angular sweep about the midpoint, then SAT-test all four axes.
  advance(
    state: DrivePose,
    kind: VehicleKind,
    input: number,
    damage?: (box: Box, amount: number) => void,
    own?: CountyCar,
  ) {
    const dt = DRIVE_DT,
      wheelbase = dimensions[kind][3];
    const throttle = (input % 3) - 1,
      side = (Math.floor(input / 3) % 3) - 1,
      brake = input >= 9;
    const [launch, power, limit, lock] = handling[kind];
    const previous = state.speed;
    const magnitude = Math.abs(previous);
    const water = sampleCountyWater(state.p[0], state.p[2]);
    const immersion = water ? Math.max(0, water.surfaceY - state.p[1]) : 0;
    const resistance =
      0.18 + 0.00105 * magnitude * magnitude + immersion * magnitude * 0.85;
    const slowing = throttle * previous < 0;
    let speed: number;
    const slide = brake && side !== 0 && previous > 5;
    if (brake || slowing || !throttle) {
      // Opposite throttle brakes to a complete stop before engaging reverse.
      // With steering lock the rear tires slide while the front axle keeps pulling.
      let braking = 0.35;
      if (slide) braking = throttle > 0 ? 1.4 : 3.8;
      else if (brake) braking = 9.8;
      else if (slowing) braking = previous > 0 ? 12.4 : 8.2;
      speed =
        Math.sign(previous) *
        Math.max(0, magnitude - (resistance + braking) * dt);
    } else {
      const top = throttle > 0 ? limit : 7;
      const thrust =
        throttle > 0 ? Math.min(launch, power / Math.max(1, magnitude)) : 3.1;
      const taper = clamp((top - magnitude) / 4, 0, 1);
      speed =
        throttle * Math.max(0, magnitude + (thrust * taper - resistance) * dt);
    }
    // Full parking lock at low speed. Limit lateral acceleration as speed rises,
    // including while the wheel returns from a previously tight turn.
    // Fast bends are primarily grip turns. Unloading the throttle gives the
    // front axle more bite; the service brake tightens the line further.
    const pace = clamp((magnitude - 6) / 14, 0, 1);
    const frontLoad = throttle === 0 ? 4.8 : slowing ? 6 : 0;
    const grip = slide ? 31 : 8.6 + pace * (4.4 + frontLoad);
    const maxSteer = Math.atan(
      1 / Math.hypot(1 / Math.tan(lock), (speed * speed) / (wheelbase * grip)),
    );
    const target = -side * maxSteer;
    const rate =
      (!side || state.steer * target < 0 ? 3.7 : 2.25) /
      (1 + 0.029 * magnitude);
    state.steer = clamp(
      state.steer + clamp(target - state.steer, -rate * dt, rate * dt),
      -maxSteer,
      maxSteer,
    );
    state.speed = speed;
    if (!speed) {
      state.slip = 0;
      return false;
    }
    const distance = (previous + speed) * 0.5 * dt,
      turn = (distance * Math.tan(state.steer)) / wheelbase;
    // As the chassis rotates, the contact patches gradually redirect its momentum.
    // Locking the rear axle lets the velocity retain its old heading for longer.
    const oldSlip = state.slip ?? 0;
    // Countersteering catches a slide faster than waiting for the rear axle
    // to come back into line. Both paths keep the existing travel direction.
    const countersteering = side !== 0 && side * oldSlip > 0;
    // A loaded rear tire regains lateral grip progressively on release. Use
    // the existing slip and speed so replay can resume at any point in a drift.
    const driftLoad =
      clamp((Math.abs(oldSlip) - 0.16) / 0.4, 0, 1) *
      clamp((speed - 5) / 10, 0, 1);
    const recovery = slide
      ? 0.95
      : countersteering
        ? 9.8
        : 7.2 - 3.3 * driftLoad;
    const nextSlip = clamp(
      (oldSlip + turn) * Math.exp(-recovery * dt),
      -0.92,
      0.92,
    );
    const mid = state.yaw + (turn - oldSlip - nextSlip) / 2,
      s = Math.sin(mid),
      c = Math.cos(mid);
    const from = state.p,
      dx = -s * distance,
      dz = -c * distance;
    const to: V3 = [from[0] + dx, from[1], from[2] + dz];
    const impact = this.sweep(state, kind, to, state.yaw + turn, damage, own);
    state.slip = state.speed ? nextSlip : 0;
    return impact;
  }

  // Older clients report poses. Check a bounded path with the same hull, with
  // no authority to damage anything or generate pedestrian contact events.
  legacyClear(
    from: V3,
    yaw: number,
    to: V3,
    nextYaw: number,
    kind: VehicleKind,
    own?: CountyCar,
  ) {
    const distance = Math.hypot(to[0] - from[0], to[2] - from[2]);
    const turn = Math.atan2(Math.sin(nextYaw - yaw), Math.cos(nextYaw - yaw));
    if (distance > 8 || Math.abs(turn) > 0.24 + 0.4 * distance) return false;
    const count = Math.max(
      1,
      Math.ceil(distance / 0.32),
      Math.ceil(Math.abs(turn) / 0.04),
    );
    const state: DrivePose = { p: [...from], yaw, speed: 1, steer: 0 };
    for (let i = 1; i <= count; i++) {
      const t = i / count;
      this.sweep(
        state,
        kind,
        [
          from[0] + (to[0] - from[0]) * t,
          from[1],
          from[2] + (to[2] - from[2]) * t,
        ],
        yaw + turn * t,
        undefined,
        own,
      );
      if (!state.speed) return false;
    }
    return Math.abs(to[1] - state.p[1]) < 0.4;
  }

  private sweep(
    state: DrivePose,
    kind: VehicleKind,
    to: V3,
    yaw: number,
    damage?: (box: Box, amount: number) => void,
    own?: CountyCar,
  ) {
    const [w, l, h] = dimensions[kind],
      from = state.p,
      speed = state.speed;
    const dx = to[0] - from[0],
      dz = to[2] - from[2],
      turn = yaw - state.yaw;
    const mid = state.yaw + turn / 2,
      s = Math.sin(mid),
      c = Math.cos(mid);
    if (Math.abs(to[0]) > LIMIT - 3 || Math.abs(to[2]) > LIMIT - 3) {
      state.speed = 0;
      return false;
    }
    const nearby =
      this.cells.get(
        key(Math.floor(from[0] / CELL), Math.floor(from[2] / CELL)),
      ) ?? [];
    let ground = terrain(to[0], to[2]);
    const stepHeight = 0.32;
    for (const b of nearby) {
      if (!b.solid || (b.piece && b.piece !== "floor")) continue;
      const top = b.p[1] + b.s[1] / 2;
      if (
        top <= ground ||
        top > from[1] + stepHeight ||
        b.p[1] - b.s[1] / 2 > ground + 0.05
      )
        continue;
      const x = Math.abs(to[0] - b.p[0]),
        z = Math.abs(to[2] - b.p[2]);
      if (x < b.s[0] / 2 && z < b.s[2] / 2) ground = top;
    }
    const water = sampleCountyWater(to[0], to[2]);
    if (water && water.surfaceY - ground > 0.85) {
      const previousWater = sampleCountyWater(from[0], from[2]);
      if (
        !previousWater ||
        water.surfaceY - ground > previousWater.surfaceY - from[1] + 1e-6
      ) {
        state.speed = 0;
        return false;
      }
    }
    to[1] = ground;
    const margin = (Math.hypot(w, l) * Math.abs(turn)) / 2;
    const wide = w + Math.abs(dx * c - dz * s) / 2 + margin,
      long = l + Math.abs(dx * s + dz * c) / 2 + margin;
    const absS = Math.abs(s),
      absC = Math.abs(c);
    const cx = from[0] + dx / 2,
      cz = from[2] + dz / 2;
    if (
      (own && this.trafficBlocks(own, from, to, state.yaw, yaw)) ||
      (this.runners &&
        vehicleEntersRunner(
          { p: from, yaw: state.yaw, kind },
          { p: to, yaw, kind },
          this.runners(),
          own?.driver ?? null,
        ))
    ) {
      state.speed = 0;
      return false;
    }
    const contacts: Box[] = [];
    for (const b of nearby) {
      if (!b.solid) continue;
      const bottom = b.p[1] - b.s[1] / 2,
        top = b.p[1] + b.s[1] / 2;
      if (
        bottom >= Math.max(ground, from[1]) + h ||
        top <= Math.min(ground, from[1]) + 0.2
      )
        continue;
      if (
        (!b.piece || b.piece === "floor") &&
        top <= ground + stepHeight &&
        bottom <= ground + 0.05
      )
        continue;
      const x = b.p[0] - cx,
        z = b.p[2] - cz,
        bw = b.s[0] / 2,
        bl = b.s[2] / 2;
      if (
        Math.abs(x) >= bw + wide * absC + long * absS ||
        Math.abs(z) >= bl + wide * absS + long * absC ||
        Math.abs(x * c - z * s) >= wide + bw * absC + bl * absS ||
        Math.abs(x * s + z * c) >= long + bw * absS + bl * absC
      )
        continue;
      contacts.push(b);
    }
    const energyPerSpeedSquared = massKg[kind] / 2000; // kinetic energy in kJ
    const energy = energyPerSpeedSquared * speed * speed;
    // Brittle glazing, doors and fittings yield first. A wall consumes more
    // kinetic energy; damage the actual supporting member to invoke structural failure.
    const cost = (b: Box) =>
      b.kind === "window"
        ? 3
        : b.piece === "fixture"
          ? 5
          : b.piece === "door" || b.piece === "furniture"
            ? 11
            : 42;
    contacts.sort((a, b) => cost(a) - cost(b));
    let remaining = energy,
      impact = false;
    for (const b of contacts) {
      if (!b.solid) continue; // losing an adjacent support can detach this already
      const loss = cost(b);
      if (!damage || !b.piece || remaining < loss * 1.25) {
        state.speed = 0;
        return impact;
      }
      damage(b, Math.max(150, remaining));
      if (b.solid) {
        state.speed = 0;
        return impact;
      }
      remaining -= loss;
      impact = true;
    }
    if (this.rubbleBlocks(from, to, state.yaw + turn, w, l, h)) {
      state.speed = 0;
      return impact;
    }
    state.p = to;
    state.yaw += turn;
    state.speed =
      Math.sign(speed) * Math.sqrt(remaining / energyPerSpeedSquared);
    return impact;
  }
}
