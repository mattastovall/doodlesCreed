import { windowPassage } from "./window-vault.ts";
import { PlayerRubble } from "./player-rubble.ts";
import type { RubbleCluster } from "./county-wreckage.ts";
import type { RubblePose } from "./county-rubble.ts";
import { initializeRapier } from "./rapier-init.ts";
import type { Ladder } from "./rust.ts";
import type { MovingHook } from "./aerial.ts";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { type Box, type V3, worldRay } from "./world.ts";
import { routeRope } from "./rope-path.ts";
export const GRAPPLE_RANGE = 120;
const WORLD_GROUPS = 0xffffffff;
export class Physics {
  world: RAPIER.World;
  controller: RAPIER.KinematicCharacterController;
  collider: RAPIER.Collider;
  private rubble: PlayerRubble;
  private hasMeshes = false;
  private triangleBoxes = new Map<string, Box>();
  private structureColliders = new Map<Box, RAPIER.Collider>();
  private boxHandles = new Map<number, Box>();
  private clearanceCells = new Map<string, Box[]>();
  constructor(public boxes: Box[]) {
    this.hasMeshes = boxes.some((b) => b.mesh);
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.rubble = new PlayerRubble(this.world, boxes);
    for (const b of boxes)
      if (b.solid) {
        const c = this.world.createCollider(
          b.mesh
            ? RAPIER.ColliderDesc.trimesh(
                new Float32Array(b.mesh.vertices),
                new Uint32Array(b.mesh.indices),
              )
            : RAPIER.ColliderDesc.cuboid(
                b.s[0] / 2,
                b.s[1] / 2,
                b.s[2] / 2,
              ).setTranslation(...b.p),
        );
        this.boxHandles.set(c.handle, b);
        if (b.piece) this.structureColliders.set(b, c);
        for (
          let x = Math.floor((b.p[0] - b.s[0] / 2) / 16);
          x <= Math.floor((b.p[0] + b.s[0] / 2) / 16);
          x++
        )
          for (
            let z = Math.floor((b.p[2] - b.s[2] / 2) / 16);
            z <= Math.floor((b.p[2] + b.s[2] / 2) / 16);
            z++
          ) {
            const key = x + "," + z;
            if (!this.clearanceCells.has(key)) this.clearanceCells.set(key, []);
            this.clearanceCells.get(key)!.push(b);
          }
      }
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.33).setTranslation(0, 3, 0),
    );
    this.controller = this.world.createCharacterController(0.018);
    this.controller.enableAutostep(0.36, 0.15, false);
    this.controller.enableSnapToGround(0.22);
    this.controller.setSlideEnabled(true);
    this.world.step();
  }
  static async create(boxes: Box[]) {
    await initializeRapier();
    return new Physics(boxes);
  }
  move(pos: Vector3, delta: Vector3, height: number) {
    if (this.rubble.prepareMovement(pos, delta, height))
      this.queriesDirty = true;
    this.refreshQueries();
    this.collider.setShape(
      new RAPIER.Capsule(Math.max(0.1, height / 2 - 0.33), 0.33),
    );
    this.collider.setTranslation({ x: pos.x, y: pos.y + height / 2, z: pos.z });
    this.controller.computeColliderMovement(
      this.collider,
      delta,
      undefined,
      WORLD_GROUPS,
      (c) => c.handle !== this.collider.handle,
    );
    const m = this.controller.computedMovement();
    pos.add(new Vector3(m.x, m.y, m.z));
    let wall: Vector3 | null = null;
    for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
      const c = this.controller.computedCollision(i);
      if (c && Math.abs(c.normal1.y) < 0.4)
        wall = new Vector3(c.normal1.x, c.normal1.y, c.normal1.z);
    }
    return { grounded: this.controller.computedGrounded(), wall, moved: m };
  }
  clear(pos: Vector3, height = 1.76) {
    this.refreshQueries();
    if (this.hasMeshes || this.structureColliders.size || this.rubble.size) {
      const center = new Vector3(pos.x, pos.y + height / 2 + 0.02, pos.z);
      const capsule = new RAPIER.Capsule(Math.max(0.1, height / 2 - 0.35), 0.3);
      return (
        !this.rubble.overlaps(center, capsule) &&
        !this.world.intersectionWithShape(
          center,
          { x: 0, y: 0, z: 0, w: 1 },
          capsule,
          RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC,
          WORLD_GROUPS,
          this.collider,
        )
      );
    }
    for (
      let x = Math.floor((pos.x - 0.31) / 16);
      x <= Math.floor((pos.x + 0.31) / 16);
      x++
    )
      for (
        let z = Math.floor((pos.z - 0.31) / 16);
        z <= Math.floor((pos.z + 0.31) / 16);
        z++
      )
        for (const b of this.clearanceCells.get(x + "," + z) || [])
          if (
            Math.abs(pos.x - b.p[0]) < b.s[0] / 2 + 0.31 &&
            Math.abs(pos.z - b.p[2]) < b.s[2] / 2 + 0.31 &&
            pos.y + height > b.p[1] - b.s[1] / 2 + 0.03 &&
            pos.y < b.p[1] + b.s[1] / 2 - 0.02
          )
            return false;
    return true;
  }
  windowAhead(pos: Vector3, dir: Vector3) {
    if (!this.structureColliders.size) return;
    const feet = pos.toArray() as V3,
      heading = dir.toArray() as V3;
    let nearest: { box: Box; target: V3; travel: number } | undefined;
    for (
      let x = Math.floor((pos.x - 1.7) / 16);
      x <= Math.floor((pos.x + 1.7) / 16);
      x++
    )
      for (
        let z = Math.floor((pos.z - 1.7) / 16);
        z <= Math.floor((pos.z + 1.7) / 16);
        z++
      )
        for (const box of this.clearanceCells.get(x + "," + z) ?? []) {
          const route = windowPassage(box, feet, heading);
          if (!route || (nearest && nearest.travel <= route.travel)) continue;
          const first = this.ray(
            new Vector3(...route.origin),
            dir,
            route.travel + 0.06,
          );
          if (box.solid ? first?.box !== box : !!first) continue;
          if (this.clear(new Vector3(...route.target), 1.12))
            nearest = { box, ...route };
        }
    return nearest;
  }
  ray(o: Vector3, d: Vector3, max = 65) {
    this.refreshQueries();
    const hit = this.world.castRayAndGetNormal(
      new RAPIER.Ray(o, d),
      max,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC,
      WORLD_GROUPS,
      this.collider,
    );
    const fallen = this.rubble.ray(o, d, hit?.timeOfImpact ?? max);
    if (fallen) return fallen;
    if (!hit) return null;
    let box = this.boxHandles.get(hit.collider.handle);
    if (box?.mesh && !box.piece && hit.featureId !== undefined) {
      const key = hit.collider.handle + ":" + hit.featureId;
      let surface = this.triangleBoxes.get(key);
      if (!surface) {
        const m = box.mesh,
          t = (hit.featureId % (m.indices.length / 3)) * 3;
        const lo = [Infinity, Infinity, Infinity],
          hi = [-Infinity, -Infinity, -Infinity];
        for (let j = 0; j < 3; j++)
          for (let k = 0; k < 3; k++) {
            const v = m.vertices[m.indices[t + j] * 3 + k];
            lo[k] = Math.min(lo[k], v);
            hi[k] = Math.max(hi[k], v);
          }
        surface = {
          ...box,
          p: lo.map((v, i) => (v + hi[i]) / 2) as V3,
          s: lo.map((v, i) => Math.max(0.03, hi[i] - v)) as V3,
        };
        this.triangleBoxes.set(key, surface);
      }
      box = surface;
    }
    return box
      ? {
          distance: hit.timeOfImpact,
          box,
          point: o.clone().addScaledVector(d, hit.timeOfImpact).toArray() as V3,
        }
      : null;
  }
  addRubble(c: RubbleCluster) {
    this.rubble.add(c);
  }
  poseRubble(pose: RubblePose) {
    this.rubble.pose(pose);
  }
  removeRubblePart(index: number) {
    if (this.rubble.remove(index)) this.queriesDirty = true;
  }
  clearRubble() {
    if (this.rubble.clear()) this.queriesDirty = true;
  }
  updateStructure(box: Box) {
    const collider = this.structureColliders.get(box);
    if (!collider) return;
    // Clearing query membership takes effect immediately. The old static
    // bounds can stay in the BVH when hundreds of pieces detach in one tick.
    collider.setCollisionGroups(box.solid ? WORLD_GROUPS : 0);
    if (box.solid && box.piece === "door") {
      collider.setShape(
        new RAPIER.Cuboid(box.s[0] / 2, box.s[1] / 2, box.s[2] / 2),
      );
      collider.setTranslation({ x: box.p[0], y: box.p[1], z: box.p[2] });
      this.queriesDirty = true;
    }
  }
  private queriesDirty = false;
  private refreshQueries() {
    if (this.queriesDirty) {
      this.world.step();
      this.queriesDirty = false;
    }
  }
  dispose() {
    this.world.free();
  }
}
export interface MovementInput {
  forward: number;
  side: number;
  sprint: boolean;
  crouch: boolean;
  jump: boolean;
  boost?: boolean;
  grapple: boolean;
  reel: boolean;
}
export const idleInput = (): MovementInput => ({
  forward: 0,
  side: 0,
  sprint: false,
  crouch: false,
  jump: false,
  boost: false,
  grapple: false,
  reel: false,
});
export class Controller {
  position = new Vector3();
  velocity = new Vector3();
  yaw = 0;
  pitch = 0;
  grounded = false;
  airActionReady = true;
  resetRevision = 0;
  height = 1.76;
  action = "AIR";
  anchor: { x: number; y: number; z: number } | null = null;
  ladders: Ladder[] = [];
  private activeLadder: Ladder | null = null;
  private ladderCooldown = 0;
  movingHooks: () => MovingHook[] = () => [];
  movingAnchor: string | null = null;
  private anchorVelocity = new Vector3();
  grappleEnabled = true;
  jumpHeightScale = 1;
  grappleHit(): { point: V3; distance: number; movingId?: string } | null {
    if (!this.grappleEnabled) return null;
    const wall = this.physics.ray(this.eye, this.forward, GRAPPLE_RANGE);
    let best: { point: V3; distance: number; movingId?: string } | null =
      wall?.box.kind === "boundary" ? null : wall;
    for (const hook of this.movingHooks()) {
      const delta = new Vector3(...hook.position).sub(this.eye);
      const along = delta.dot(this.forward);
      const perpendicular = delta.lengthSq() - along * along;
      if (along <= 2 || perpendicular > hook.radius * hook.radius) continue;
      const distance =
        along - Math.sqrt(hook.radius * hook.radius - perpendicular);
      const centerDistance = delta.length();
      const blocked = this.physics.ray(
        this.eye,
        delta.clone().divideScalar(centerDistance),
        centerDistance - 0.08,
      );
      if (
        !blocked &&
        distance <= GRAPPLE_RANGE &&
        (!best || distance < best.distance)
      )
        best = { point: hook.position, distance, movingId: hook.id };
    }
    return best;
  }
  private checkRope() {
    if (!this.anchor) return false;
    if (this.movingAnchor) {
      const target = this.movingHooks().find((h) => h.id === this.movingAnchor);
      if (!target) {
        this.releaseGrapple(false, false);
        return true;
      }
      this.anchor = new Vector3(...target.position);
      this.anchorVelocity.fromArray(target.velocity);
    }
    const path = routeRope(
      this.eye,
      new Vector3(this.anchor.x, this.anchor.y, this.anchor.z),
      this.ropePath,
      this.physics.ray.bind(this.physics),
    );
    if (!path) return true;
    this.ropePath = path;
    return false;
  }
  ropePath: Vector3[] = [];
  ropeLength = 0;
  wall: Vector3 | null = null;
  wallTime = 0;
  airTime = 0;
  actionTime = 0;
  slide = 0;
  coyote = 0;
  stamina = 1;
  travel = 0;
  vaults = 0;
  wallruns = 0;
  hooks = 0;
  private mantle: {
    target: Vector3;
    start: Vector3;
    elapsed: number;
    duration: number;
    pane?: Box;
    wait?: number;
  } | null = null;
  private grappleWas = false;
  private jumpWas = false;
  private boostWas = false;
  private crouchWas = false;
  private wallCooldown = 0;
  constructor(
    public physics: Physics,
    start: V3,
  ) {
    this.position.fromArray(start);
  }
  get traversing() {
    return this.mantle !== null;
  }
  get traversalProgress() {
    return this.mantle
      ? Math.min(1, this.mantle.elapsed / this.mantle.duration)
      : 0;
  }
  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }
  get eye() {
    return this.position.clone().add(new Vector3(0, this.height - 0.16, 0));
  }
  get forward() {
    return new Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
  }
  reset(start: V3) {
    this.activeLadder = null;
    this.ladderCooldown = 0;
    this.resetRevision++;
    this.position.fromArray(start);
    this.velocity.set(0, 0, 0);
    this.anchor = null;
    this.ropePath = [];
    this.movingAnchor = null;
    this.anchorVelocity.set(0, 0, 0);
    this.mantle = null;
    this.slide = 0;
    this.height = 1.76;
    this.stamina = 1;
    this.grounded = false;
    this.action = "AIR";
    this.jumpWas = false;
    this.boostWas = false;
    this.airActionReady = true;
    this.grappleWas = false;
    this.crouchWas = false;
    this.coyote = 0;
    this.airTime = 0;
    this.wallTime = 0;
    this.wall = null;
    this.wallCooldown = 0;
    this.actionTime = 0;
  }
  releaseGrapple(launch = false, accelerate = true) {
    if (!this.anchor) return;
    this.anchor = null;
    this.ropePath = [];
    this.movingAnchor = null;
    this.anchorVelocity.set(0, 0, 0);
    if (accelerate) {
      const speed = this.velocity.length();
      // Keep the swing dominant. Bound the extra impulse so repeated releases
      // cannot turn a fast swing into an increasingly long launch.
      const impulse = this.velocity
        .clone()
        .multiplyScalar(0.12)
        .addScaledVector(this.forward, speed * 0.08)
        .clampLength(0, 6);
      this.velocity.add(impulse);
      this.velocity.clampLength(0, 52);
    }
    if (launch) this.velocity.y = Math.max(this.velocity.y, 5.5);
    this.action = "RELEASE";
    this.actionTime = 0.6;
  }
  onVaultGlass?: (box: Box) => void;
  private traverse(dir: Vector3) {
    const passage = this.physics.windowAhead(this.position, dir);
    if (passage && (!passage.box.solid || this.onVaultGlass)) {
      this.height = 1.08;
      this.mantle = {
        target: new Vector3(...passage.target),
        start: this.position.clone(),
        elapsed: 0,
        duration: 0.24,
        pane: passage.box,
        wait: 0,
      };
      this.velocity.addScaledVector(dir, 2.5);
      this.velocity.y = 0;
      this.grounded = false;
      this.action = "VAULT";
      this.actionTime = 0.24;
      if (passage.box.solid) this.onVaultGlass!(passage.box);
      return true;
    }
    const origin = this.position.clone().add(new Vector3(0, 0.65, 0));
    const hit = this.physics.ray(origin, dir, 1.65);
    if (!hit) return false;
    let top = hit.box.p[1] + hit.box.s[1] / 2;
    if (hit.box.mesh) {
      const above = new Vector3(...hit.point).addScaledVector(dir, 0.8);
      above.y = this.position.y + 2.55;
      const ledge = this.physics.ray(above, new Vector3(0, -1, 0), 2.2);
      if (!ledge) return false;
      top = ledge.point[1];
    }
    const dy = top - this.position.y;
    if (dy < 0.45 || dy > 2.5) return false;
    const target = new Vector3(...hit.point).addScaledVector(
      dir,
      hit.box.mesh ? 0.8 : Math.min(hit.box.s[0], hit.box.s[2]) + 0.7,
    );
    target.y = top + 0.07;
    if (!this.physics.clear(target)) {
      target.copy(new Vector3(...hit.point).addScaledVector(dir, 0.6));
      target.y = top + 0.07;
      if (!this.physics.clear(target)) return false;
    }
    if (dy < 1.45) {
      this.velocity.addScaledVector(dir, 2.5);
      this.velocity.y = 0;
      this.mantle = {
        target,
        start: this.position.clone(),
        elapsed: 0,
        duration: 0.18,
      };
      this.action = "VAULT";
      this.vaults++;
    } else {
      this.mantle = {
        target,
        start: this.position.clone(),
        elapsed: 0,
        duration: 0.2,
      };
      this.action = "MANTLE";
      this.velocity.y = 0;
    }
    this.grounded = false;
    this.actionTime = this.mantle!.duration;
    this.anchor = null;
    this.ropePath = [];
    this.movingAnchor = null;
    this.anchorVelocity.set(0, 0, 0);
    return true;
  }
  update(dt: number, input: MovementInput) {
    dt = Math.min(dt, 1 / 30);
    this.actionTime -= dt;
    this.wallCooldown -= dt;
    this.ladderCooldown -= dt;
    const boost = !!input.boost && !this.boostWas;
    this.boostWas = !!input.boost;
    const jump = input.jump && !this.jumpWas,
      hook = this.grappleEnabled && input.grapple && !this.grappleWas;
    this.jumpWas = input.jump;
    this.grappleWas = input.grapple;
    const forward = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)),
      right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = forward
      .clone()
      .multiplyScalar(input.forward)
      .addScaledVector(right, input.side);
    if (wish.lengthSq() > 1) wish.normalize();
    const old = this.position.clone();
    if (this.activeLadder && this.activeLadder.top <= this.activeLadder.bottom)
      this.activeLadder = null;
    if (this.activeLadder && (jump || hook || input.forward < -0.1)) {
      this.activeLadder = null;
      this.ladderCooldown = 0.4;
      if (jump) this.velocity.y = 7 * Math.sqrt(this.jumpHeightScale);
    }
    if (
      !this.activeLadder &&
      this.ladderCooldown <= 0 &&
      input.forward > 0.1 &&
      !this.anchor &&
      !jump &&
      !hook
    )
      this.activeLadder =
        this.ladders.find(
          (l) =>
            Math.hypot(this.position.x - l.x, this.position.z - l.z) < 1.1 &&
            this.position.y >= l.bottom - 0.4 &&
            this.position.y < l.top - 0.1,
        ) ?? null;
    if (this.activeLadder) {
      const l = this.activeLadder;
      this.velocity.set(0, 0, 0);
      this.action = "CLIMB";
      this.grounded = false;
      const goal =
        this.position.y < l.top + 0.05
          ? new Vector3(l.x, l.top + 0.08, l.z)
          : new Vector3(...l.exit);
      if (this.position.y >= l.top + 0.05) goal.y = l.top + 0.08;
      const delta = goal.sub(this.position);
      delta.clampLength(0, 5.5 * dt);
      this.physics.move(this.position, delta, this.height);
      if (
        Math.hypot(this.position.x - l.exit[0], this.position.z - l.exit[2]) <
          0.15 &&
        this.position.y >= l.top
      ) {
        this.activeLadder = null;
        this.ladderCooldown = 0.4;
      }
      return;
    }

    const ropeBlocked = this.checkRope();
    if (hook && !this.mantle && (!ropeBlocked || this.anchor)) {
      if (this.anchor) this.releaseGrapple();
      else if (this.stamina > 0.15) {
        const h = this.grappleHit();
        if (h && h.distance > 2) {
          this.anchor = new Vector3(...h.point);
          this.movingAnchor = h.movingId ?? null;
          this.ropeLength = h.distance;
          this.stamina -= 0.12;
          this.hooks++;
          // Attaching changes the rope constraint, not the player momentum.
        }
      }
    }
    if (this.mantle) {
      const m = this.mantle;
      if (m.pane?.solid) {
        // Keep the collider until the room confirms the break.
        m.wait = (m.wait ?? 0) + dt;
        if (m.wait >= 0.7) {
          this.mantle = null;
          this.actionTime = 0;
          this.action = "AIR";
        }
        return;
      }
      if (m.pane && !m.elapsed) this.vaults++;
      m.elapsed += dt;
      const t = Math.min(1, m.elapsed / m.duration),
        u = Math.max(0, (t - 0.38) / 0.62);
      const desired = m.start.clone().lerp(m.target, u * u * (3 - 2 * u));
      desired.y =
        m.start.y +
        (m.target.y - m.start.y) * Math.min(1, t / 0.38) +
        Math.sin(t * Math.PI) * 0.15;
      this.physics.move(this.position, desired.sub(this.position), this.height);
      if (t >= 1) {
        this.mantle = null;
        this.action = "AIR";
        this.actionTime = 0;
      }
      return;
    }
    if (input.crouch && !this.crouchWas && this.grounded && this.speed > 7) {
      this.slide = 1.15;
      this.velocity.multiplyScalar(1.08);
    }
    this.crouchWas = input.crouch;
    this.slide = Math.max(0, this.slide - dt);
    const crouch = input.crouch || this.slide > 0;
    this.height = crouch
      ? 1.08
      : this.height < 1.76 && !this.physics.clear(this.position, 1.76)
        ? 1.08
        : 1.76;
    if (this.grounded) {
      this.coyote = 0.12;
      this.airTime = 0;
      this.wallTime = 0;
    } else {
      this.coyote -= dt;
      this.airTime += dt;
    }
    if (jump) {
      if (this.anchor) this.releaseGrapple(true);
      else if (input.forward > 0 && this.traverse(forward)) {
      } else if (this.grounded || this.coyote > 0) {
        // Scale jump height with takeoff speed (height is proportional to impulse squared).
        // Full sprint doubles standing height; carried momentum caps at triple height.
        this.velocity.y =
          11.4 *
          Math.sqrt(
            this.jumpHeightScale * (1 + Math.min(this.speed, 26.4) / 13.2),
          );
        this.grounded = false;
        this.coyote = 0;
        this.slide = 0;
      } else if (this.wall && this.wallCooldown <= 0) {
        this.velocity.addScaledVector(this.wall, 9);
        this.velocity.y = 9 * Math.sqrt(this.jumpHeightScale);
        this.wallCooldown = 0.3;
        this.wallTime = 0;
        this.action = "WALL JUMP";
        this.actionTime = 0.55;
      } else if (this.airActionReady) {
        this.velocity.y = Math.max(
          this.velocity.y,
          11.4 *
            Math.sqrt(
              this.jumpHeightScale * (1 + Math.min(this.speed, 26.4) / 13.2),
            ),
        );
        this.airActionReady = false;
        this.action = "DOUBLE JUMP";
        this.actionTime = 0.55;
      }
    }
    if (boost && !jump && !this.grounded && this.airActionReady) {
      this.releaseGrapple(false, false);
      const direction =
        wish.lengthSq() > 0 ? wish.clone().normalize() : forward;
      this.velocity.addScaledVector(direction, 12);
      this.velocity.y = Math.max(this.velocity.y, 3.5);
      this.airActionReady = false;
      this.coyote = 0;
      this.action = "AIR BOOST";
      this.actionTime = 0.55;
    }
    const sp = this.speed;
    if (this.grounded) {
      const friction = this.slide > 0 ? 0.6 : wish.lengthSq() > 0 ? 2.2 : 13;
      this.velocity.x *= Math.max(0, 1 - friction * dt);
      this.velocity.z *= Math.max(0, 1 - friction * dt);
    }
    const max = crouch && this.slide <= 0 ? 4 : input.sprint ? 13.2 : 8;
    if (wish.lengthSq() > 0) {
      const current = this.velocity.dot(wish),
        add = Math.max(
          0,
          Math.min(
            (this.grounded ? max : 10) - current,
            (this.grounded ? 72 : 12) * dt,
          ),
        );
      this.velocity.addScaledVector(wish, add);
    }
    // Faster arcs, with jump impulse scaled to preserve reachable ledges.
    let gravity = 36;
    const wallL = this.physics.ray(this.eye, right, 0.65),
      wallR = this.physics.ray(this.eye, right.clone().negate(), 0.65);
    if (
      !this.grounded &&
      input.forward > 0.1 &&
      sp > 6 &&
      this.airTime > 0.12 &&
      this.wallTime < 1.3 &&
      !this.anchor &&
      ((wallL?.box.kind !== "boundary" && wallL) ||
        (wallR?.box.kind !== "boundary" && wallR)) &&
      this.wallCooldown <= 0
    ) {
      this.wall = right
        .clone()
        .multiplyScalar(wallL && wallL.box.kind !== "boundary" ? -1 : 1);
      this.wallTime += dt;
      gravity = 3.2;
      this.velocity.y = Math.max(this.velocity.y, -1.2);
      if (this.action !== "WALL RUN") this.wallruns++;
      this.action = "WALL RUN";
    } else if (this.actionTime <= 0)
      this.action = this.anchor
        ? "SWING"
        : this.grounded
          ? this.slide > 0
            ? "SLIDE"
            : sp > 9
              ? "SPRINT"
              : "RUN"
          : "AIR";
    this.velocity.y -= gravity * dt;
    if (this.anchor) {
      this.stamina -= dt * 0.055;
      const contact =
        this.ropePath[0] ??
        new Vector3(this.anchor.x, this.anchor.y, this.anchor.z);
      const to = contact.clone().sub(this.eye),
        dir = to.clone().normalize();
      let len = to.length();
      for (let i = 1; i < this.ropePath.length; i++)
        len += this.ropePath[i - 1].distanceTo(this.ropePath[i]);
      if (input.reel) this.ropeLength = Math.max(3, this.ropeLength - dt * 14);
      // Slack rope exerts no force. Reeling is the only powered pull.
      if (input.reel) this.velocity.addScaledVector(dir, dt * 32);
      const radial =
        this.velocity.dot(dir) -
        (this.ropePath.length > 1 ? 0 : this.anchorVelocity.dot(dir));
      const remainingSlack = this.ropeLength - len;
      if (remainingSlack < 0 || -radial * dt > remainingSlack) {
        // Cancel outward velocity at the rope boundary, retaining tangential
        // swing momentum. Correct stretch without a spring oscillation.
        const required =
          remainingSlack < 0
            ? Math.min(10, -remainingSlack * 18)
            : -remainingSlack / dt;
        if (radial < required)
          this.velocity.addScaledVector(dir, required - radial);
      }
      if (this.stamina <= 0) this.releaseGrapple(false, false);
    } else
      this.stamina = Math.min(
        1,
        this.stamina + dt * (this.grounded ? 0.35 : 0.15),
      );
    const horizontal = this.speed;
    if (horizontal > 52) {
      this.velocity.x *= 52 / horizontal;
      this.velocity.z *= 52 / horizontal;
    }
    this.velocity.clampLength(0, 52);
    this.velocity.y = Math.max(-45, Math.min(35, this.velocity.y));
    const delta = this.velocity.clone().multiplyScalar(dt);
    const result = this.physics.move(this.position, delta, this.height);
    this.grounded = result.grounded;
    if (this.grounded) this.airActionReady = true;
    if (result.wall) this.wall = result.wall;
    else if (this.action !== "WALL RUN") this.wall = null;
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    if (delta.y > 0.001 && result.moved.y < delta.y * 0.4)
      this.velocity.y = Math.min(0, this.velocity.y);
    if (Math.abs(result.moved.x) < Math.abs(delta.x) * 0.25)
      this.velocity.x *= 0.35;
    if (Math.abs(result.moved.z) < Math.abs(delta.z) * 0.25)
      this.velocity.z *= 0.35;
    if (this.checkRope() && this.anchor) {
      // A route search limit must not break the hook or let the cable tunnel.
      this.position.copy(old);
      this.velocity.set(0, 0, 0);
      this.checkRope();
    }
    this.travel += old.distanceTo(this.position);
  }
}
