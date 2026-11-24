import type { CountyCar } from "./county.ts";
import { VEHICLE_DIMENSIONS } from "./county-vehicle-dimensions.ts";
import type { V3 } from "./world.ts";

type Hull = Pick<CountyCar, "p" | "yaw" | "kind">;
const RADIUS = 0.33;

function hullFrame(car: Hull, feet: V3, height: number) {
  const [width, length, roof] = VEHICLE_DIMENSIONS[car.kind];
  const cos = Math.cos(car.yaw),
    sin = Math.sin(car.yaw);
  const dx = feet[0] - car.p[0],
    dz = feet[2] - car.p[2];
  const offset: V3 = [
    dx * cos - dz * sin,
    feet[1] - car.p[1] - (roof - height) / 2,
    dx * sin + dz * cos,
  ];
  const half: V3 = [width + RADIUS, (roof + height) / 2, length + RADIUS];
  return { offset, half, cos, sin };
}

export function insideVehicle(car: Hull, feet: V3, height: number) {
  if (Math.abs(feet[0] - car.p[0]) > 3.5 || Math.abs(feet[2] - car.p[2]) > 3.5)
    return false;
  const { offset, half } = hullFrame(car, feet, height);
  return offset.every((v, i) => Math.abs(v) < half[i] - 0.0001);
}

// Sweep a runner's feet through each nearby oriented hull expanded by the runner's
// width and standing/crouched height. Slab intersection also catches a complete
// crossing in one network sample and supports walking on the roof.
export function vehicleSweep(
  cars: readonly Hull[],
  feet: V3,
  delta: V3,
  height: number,
) {
  let first: { t: number; normal: V3 } | undefined;
  for (const car of cars) {
    if (
      Math.abs(car.p[0] - feet[0] - delta[0] / 2) >
        3.5 + Math.abs(delta[0]) / 2 ||
      Math.abs(car.p[2] - feet[2] - delta[2] / 2) > 3.5 + Math.abs(delta[2]) / 2
    )
      continue;
    const { offset, half, cos, sin } = hullFrame(car, feet, height);
    const local: V3 = [
      delta[0] * cos - delta[2] * sin,
      delta[1],
      delta[0] * sin + delta[2] * cos,
    ];
    let near = -Infinity,
      far = Infinity,
      axis = 0;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(local[i]) < 1e-10) {
        if (Math.abs(offset[i]) >= half[i] - 1e-6) far = -Infinity;
        continue;
      }
      const t0 = (-half[i] - offset[i]) / local[i],
        t1 = (half[i] - offset[i]) / local[i];
      const entry = Math.min(t0, t1);
      if (entry > near) {
        near = entry;
        axis = i;
      }
      far = Math.min(far, Math.max(t0, t1));
    }
    // A corrected or newly received vehicle pose can already overlap the runner.
    // Leave that hull escapable; entry from clear space is always checked.
    if (
      near < -1e-6 ||
      near > 1 ||
      far <= Math.max(near, 0) ||
      (first && near >= first.t)
    )
      continue;
    const sign = -Math.sign(local[axis]);
    const normal: V3 =
      axis === 0
        ? [sign * cos, 0, -sign * sin]
        : axis === 1
          ? [0, sign, 0]
          : [sign * sin, 0, sign * cos];
    first = { t: Math.max(0, near), normal };
  }
  return first;
}

export interface Pedestrian {
  p: V3;
  height: number;
  id: string;
  hp: number;
  npc?: boolean;
}

// Vehicle steps are already limited to a fraction of the runner's width.
// Existing overlaps may separate, including the seated owner during replay.
export function vehicleEntersRunner(
  from: Hull,
  to: Hull,
  runners: Iterable<Pedestrian>,
  owner: string | null,
) {
  for (const runner of runners)
    if (
      runner.hp > 0 &&
      !runner.npc &&
      runner.id !== owner &&
      insideVehicle(to, runner.p, runner.height) &&
      !insideVehicle(from, runner.p, runner.height)
    )
      return true;
  return false;
}
