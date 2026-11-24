import * as T from "three";
import { VEHICLE_DIMENSIONS } from "./county-vehicle-dimensions.ts";
import type { VehicleKind } from "./county.ts";

// Two draw calls for all marks and smoke, with fixed memory even on a long drive.
export class CountyTires {
  private marks = new T.BufferGeometry();
  private smoke = new T.BufferGeometry();
  private strips = new T.BufferAttribute(new Float32Array(512 * 18), 3);
  private centers = new T.BufferAttribute(new Float32Array(64 * 3), 3);
  private births = new T.BufferAttribute(new Float32Array(64), 1);
  private clock = { value: 0 };
  private tracks = new Map<
    number,
    {
      driver: string;
      previous: T.Vector3[];
      nextPuff: number;
    }
  >();
  private contact = [new T.Vector3(), new T.Vector3()];
  private stripCount = 0;
  private puffCount = 0;
  private lastPuff = -Infinity;

  constructor(group: T.Group) {
    this.marks.setAttribute(
      "position",
      this.strips.setUsage(T.DynamicDrawUsage),
    );
    this.marks.setDrawRange(0, 0);
    const rubber = new T.Mesh(
      this.marks,
      new T.MeshBasicMaterial({
        color: 0x282726,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
        side: T.DoubleSide,
        forceSinglePass: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    rubber.frustumCulled = false;
    this.smoke.setAttribute(
      "position",
      this.centers.setUsage(T.DynamicDrawUsage),
    );
    this.smoke.setAttribute("birth", this.births.setUsage(T.DynamicDrawUsage));
    this.smoke.setDrawRange(0, 0);
    const cloud = new T.Points(
      this.smoke,
      new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { clock: this.clock },
        vertexShader: `
        attribute float birth;
        uniform float clock;
        varying float life;
        void main() {
          float age = max(0.0, clock - birth);
          life = max(0.0, 1.0 - age / 0.8);
          vec3 p = position + vec3(0.22 * age, 0.18 + age * 0.85, 0.);
          vec4 eye = modelViewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * eye;
          gl_PointSize = clamp((100. + age * 370.) / max(1., -eye.z), 1., 70.);
        }
      `,
        fragmentShader: `
        varying float life;
        void main() {
          float alpha = (1. - smoothstep(0.08, 0.5, length(gl_PointCoord - 0.5))) * life * 0.3;
          if (alpha < 0.008) discard;
          gl_FragColor = vec4(0.72, 0.72, 0.70, alpha);
          #include <colorspace_fragment>
        }
      `,
      }),
    );
    cloud.frustumCulled = false;
    group.add(rubber, cloud);
  }

  reset(index: number) {
    this.tracks.delete(index);
  }

  update(dt: number) {
    this.clock.value += dt;
    if (this.clock.value > this.lastPuff + 0.8) this.smoke.setDrawRange(0, 0);
  }

  sample(
    index: number,
    driver: string,
    position: T.Vector3,
    yaw: number,
    kind: VehicleKind,
    reduced: boolean,
  ) {
    let track = this.tracks.get(index);
    const continuing = track?.driver === driver;
    if (!track || !continuing) {
      track = {
        driver,
        previous: [new T.Vector3(), new T.Vector3()],
        nextPuff: 0,
      };
      this.tracks.set(index, track);
    }
    const [width, , , wheelbase] = VEHICLE_DIMENSIONS[kind];
    const c = Math.cos(yaw),
      s = Math.sin(yaw);
    for (let i = 0; i < 2; i++) {
      const side = (i ? 1 : -1) * width * 0.82;
      this.contact[i].set(
        position.x + side * c + wheelbase * 0.5 * s,
        position.y + 0.082,
        position.z - side * s + wheelbase * 0.5 * c,
      );
    }
    const distance = this.contact[0].distanceTo(track.previous[0]);
    if (continuing && distance < 0.32) return;
    const emit = !reduced && this.clock.value >= track.nextPuff;
    for (let i = 0; i < 2; i++) {
      const a = track.previous[i],
        b = this.contact[i];
      if (continuing && distance < 2) {
        const dx = b.x - a.x,
          dz = b.z - a.z;
        const scale = 0.105 / Math.max(0.01, Math.hypot(dx, dz));
        const x = dz * scale,
          z = -dx * scale;
        let offset = (this.stripCount++ % 512) * 6;
        for (const [point, sign] of [
          [a, -1],
          [a, 1],
          [b, 1],
          [a, -1],
          [b, 1],
          [b, -1],
        ] as const)
          this.strips.setXYZ(
            offset++,
            point.x + sign * x,
            point.y,
            point.z + sign * z,
          );
      }
      if (emit) {
        const k = this.puffCount++ % 64;
        this.centers.setXYZ(k, b.x, b.y, b.z);
        this.births.setX(k, this.clock.value);
      }
      a.copy(b);
    }
    this.marks.setDrawRange(0, Math.min(this.stripCount, 512) * 6);
    this.strips.needsUpdate = true;
    if (emit) {
      this.lastPuff = this.clock.value;
      track.nextPuff = this.clock.value + 0.075;
      this.smoke.setDrawRange(0, Math.min(this.puffCount, 64));
      this.centers.needsUpdate = this.births.needsUpdate = true;
    }
  }
}
