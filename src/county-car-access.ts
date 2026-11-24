import type { CountyCar } from "./county.ts";
import type { V3 } from "./world.ts";

export const ACCESS_MS = { lockpick: 2400, hotwire: 2000, hijack: 1200 };
export const ACCESS_WINDOW = [0.45, 0.85] as const;
export type AccessAction = keyof typeof ACCESS_MS;
export interface SeatInteraction {
  actor: string;
  action: AccessAction;
  occupant: string | null;
  started: number;
}
export function seatAction(car: CountyCar) {
  if (car.driver) return "hijack";
  if (car.access === "secured") return "secured";
  if (car.access === "locked") return "lockpick";
  if (car.access === "picked") return "hotwire";
  return "enter";
}
export function canReachCar(car: CountyCar, p: V3) {
  return Math.hypot(p[0] - car.p[0], p[1] - car.p[1], p[2] - car.p[2]) < 5;
}
export function startSeatAction(
  car: CountyCar,
  actor: string,
  action: unknown,
  now: number,
) {
  if (car.interaction || action !== seatAction(car)) return false;
  if (action === "enter") car.driver = actor;
  else if (action === "lockpick" || action === "hotwire" || action === "hijack")
    car.interaction = { actor, action, occupant: car.driver, started: now };
  else return false;
  return true;
}
export function advanceSeatAction(
  car: CountyCar,
  eligible: boolean,
  now: number,
  confirm = false,
) {
  const work = car.interaction;
  if (!work) return;
  if (!eligible || work.occupant !== car.driver) {
    delete car.interaction;
    return "canceled";
  }
  const progress = (now - work.started) / ACCESS_MS[work.action];
  if (work.action === "hijack") {
    if (progress < 1) return;
  } else {
    if (!confirm && progress < 1) return;
    if (
      !confirm ||
      progress < ACCESS_WINDOW[0] ||
      progress > ACCESS_WINDOW[1]
    ) {
      delete car.interaction;
      return "missed";
    }
  }
  delete car.interaction;
  if (work.action === "lockpick") car.access = "picked";
  else {
    car.access = "open";
    car.driver = work.actor;
  }
  return work.action;
}
export function besideCar(car: CountyCar): V3 {
  const side = car.kind === "delivery" || car.kind === "taxi" ? 2.2 : -2.2;
  return [
    car.p[0] + side * Math.cos(car.yaw),
    car.p[1],
    car.p[2] - side * Math.sin(car.yaw),
  ];
}
