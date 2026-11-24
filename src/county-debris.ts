import * as T from "three";
import type { Box } from "./world.ts";

// Shards are short-lived visual feedback. Only the architectural components
// enter the simulation or travel over the network.
export class CountyDebris {
  private mesh: T.InstancedMesh;
  private slots = Array.from({ length: 96 }, () => ({
    position: new T.Vector3(),
    velocity: new T.Vector3(),
    size: new T.Vector3(),
    age: 0.8,
  }));
  private next = 0;
  private pose = new T.Object3D();
  constructor(group: T.Group) {
    this.mesh = new T.InstancedMesh(
      new T.BoxGeometry(1, 1, 1),
      new T.MeshBasicMaterial(),
      this.slots.length,
    );
    this.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    group.add(this.mesh);
  }
  break(box: Box, eye: T.Vector3) {
    if (eye.distanceToSquared(this.pose.position.fromArray(box.p)) > 75 * 75)
      return;
    const glass = box.kind === "window";
    for (let i = 0; i < (glass ? 14 : 8); i++) {
      const s = this.slots[this.next++ % this.slots.length];
      s.age = 0;
      s.position.fromArray(box.p);
      for (let k = 0; k < 3; k++)
        s.position.setComponent(
          k,
          s.position.getComponent(k) + (Math.random() - 0.5) * box.s[k] * 0.84,
        );
      s.velocity.set(
        (Math.random() - 0.5) * 4,
        1 + Math.random() * 2,
        (Math.random() - 0.5) * 4,
      );
      s.size.set(
        0.08 + Math.random() * 0.22,
        0.05 + Math.random() * 0.12,
        glass ? 0.012 : 0.06 + Math.random() * 0.18,
      );
    }
  }
  update(dt: number) {
    let count = 0;
    for (const s of this.slots) {
      if (s.age >= 0.8) continue;
      s.age += dt;
      s.velocity.y -= 12 * dt;
      s.position.addScaledVector(s.velocity, dt);
      this.pose.position.copy(s.position);
      this.pose.scale
        .copy(s.size)
        .multiplyScalar(Math.min(1, Math.max(0, (0.8 - s.age) * 4)));
      this.pose.rotation.set(3 * s.age, 4 * s.age + count, 2 * s.age);
      this.pose.updateMatrix();
      this.mesh.setMatrixAt(count, this.pose.matrix);
      count++;
    }
    if (count && !this.mesh.instanceColor) {
      const c = new T.Color();
      for (let i = 0; i < this.slots.length; i++)
        this.mesh.setColorAt(
          i,
          c.setHex([0xe9e9e5, 0xb5c2d4, 0x92a2ba][i % 3]),
        );
    }
    this.mesh.count = count;
    if (count) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
