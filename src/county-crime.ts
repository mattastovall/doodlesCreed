import { isCountyPiece, type CountyPiece } from "./county-architecture.ts";
import type { CountyCitizen } from "./county-citizens.ts";
import { distance, type Box, type V3 } from "./world.ts";

export const TILL_SECONDS = 3;
const RESTOCK_MS = 90000;
export interface CrimeState {
  cash: number;
  take: number;
  stars: number;
  escapeAt: number;
  arrestAt: number;
  shop: number;
  finishAt: number;
  alert?: V3;
}
export const cleanRecord = (): CrimeState => ({
  cash: 0,
  take: 0,
  stars: 0,
  escapeAt: 0,
  arrestAt: 0,
  shop: -1,
  finishAt: 0,
});
export function wanted(record: CrimeState, p: V3, now: number, level = 1) {
  record.stars = Math.min(6, record.stars + level);
  record.alert = [...p];
  record.escapeAt = now + escapeTime(record.stars);
}
const escapeTime = (stars: number) => (12 + stars * 3) * 1000;
export function endPursuit(r: CrimeState, escaped: boolean) {
  if (escaped) r.cash += r.take;
  const cash = r.cash;
  Object.assign(r, cleanRecord(), { cash, alert: undefined });
}
type Ray = (o: V3, d: V3, len: number) => unknown;
export interface Till {
  index: number;
  box: CountyPiece;
  name: string;
  value: number;
}
export class CountyShops {
  readonly tills: Till[] = [];
  private closing = new Map<number, number>();
  private owners = new Map<number, string>();
  constructor(boxes: Box[]) {
    const names = new Map<string, string>();
    for (const b of boxes)
      if (isCountyPiece(b) && b.sign) names.set(b.buildingId, b.sign);
    const seen = new Set<string>();
    for (const [index, b] of boxes.entries()) {
      if (
        !isCountyPiece(b) ||
        b.kind !== "counter" ||
        seen.has(b.buildingId) ||
        b.p[1] > 2
      )
        continue;
      seen.add(b.buildingId);
      this.tills.push({
        index,
        box: b,
        name: names.get(b.buildingId) ?? "Corner shop",
        value: 180 + (index % 12) * 25,
      });
    }
  }
  near(p: V3) {
    return this.tills.find((t) => t.box.solid && distance(p, t.box.p) < 3.1);
  }
  private reachable(t: Till, p: V3, height: number, ray: Ray) {
    if (!t.box.solid || distance(p, t.box.p) >= 3.1) return false;
    const o: V3 = [p[0], p[1] + height - 0.16, p[2]];
    const tip: V3 = [
      t.box.p[0],
      t.box.p[1] + t.box.s[1] / 2 + 0.15,
      t.box.p[2],
    ];
    const len = distance(o, tip);
    return (
      len < 0.1 ||
      !ray(o, tip.map((v, i) => (v - o[i]) / len) as V3, len - 0.08)
    );
  }
  buyAid(r: CrimeState, p: V3, height: number, ray: Ray) {
    const t = this.near(p);
    if (!t || !this.reachable(t, p, height, ray) || r.stars || r.cash < 100)
      return false;
    r.cash -= 100;
    return true;
  }
  start(
    id: string,
    r: CrimeState,
    p: V3,
    height: number,
    seated: boolean,
    now: number,
    ray: Ray,
  ) {
    if (seated || r.shop !== -1) return;
    const t = this.near(p);
    if (!t || !this.reachable(t, p, height, ray)) return;
    if ((this.closing.get(t.index) ?? 0) > now) return "This till is empty";
    if (this.owners.has(t.index)) return "Someone is already at this till";
    this.owners.set(t.index, id);
    r.shop = t.index;
    r.finishAt = now + TILL_SECONDS * 1000;
    wanted(r, p, now);
    return "Alarm triggered";
  }
  release(id: string, r: CrimeState) {
    if (this.owners.get(r.shop) === id) this.owners.delete(r.shop);
    r.shop = -1;
    r.finishAt = 0;
  }
  update(
    id: string,
    r: CrimeState,
    p: V3,
    height: number,
    seated: boolean,
    alive: boolean,
    now: number,
    ray: Ray,
    officers: CountyCitizen[],
  ) {
    if (!alive) {
      this.release(id, r);
      endPursuit(r, false);
      return;
    }
    let message: string | undefined;
    if (r.shop !== -1) {
      const t = this.tills.find((t) => t.index === r.shop);
      if (seated || !t || !this.reachable(t, p, height, ray)) {
        this.release(id, r);
        message = "Robbery interrupted";
      } else if (now >= r.finishAt) {
        this.closing.set(t.index, now + RESTOCK_MS);
        r.take += t.value;
        this.release(id, r);
        message = "Take $" + t.value + " · lose the police";
      }
    }
    if (!r.stars) return message;
    let spotted = false,
      close = false;
    for (const a of officers) {
      if (
        a.name !== "Police officer" ||
        a.targetId !== id ||
        !a.hp ||
        (a.downUntil ?? 0) > now
      )
        continue;
      spotted = true;
      if (!seated && a.car === undefined && distance(a.p, p) < 1.85)
        close = true;
    }
    if (spotted) {
      r.escapeAt = now + escapeTime(r.stars);
      r.alert = [...p];
    }
    if (close) {
      r.arrestAt ||= now + 1850;
      if (now >= r.arrestAt) {
        this.release(id, r);
        endPursuit(r, false);
        return "Busted";
      }
    } else r.arrestAt = 0;
    if (now >= r.escapeAt) {
      const take = r.take;
      this.release(id, r);
      endPursuit(r, true);
      return take ? "Escaped · $" + take + " banked" : "Lost the police";
    }
    return message;
  }
}
