import { FISTS } from "./fists.ts";
import { distance, type City, type V3 } from "./world.ts";

export const MAGAZINES = [30, 8, 14, 5, 0];
export const PICKUP_RADIUS = 1.8;
export interface WeaponPickup {
  p: V3;
  weapon: number;
}
export function newInventory() {
  return { weapon: FISTS, owned: [FISTS], mags: MAGAZINES.map(() => 0) };
}
// Each player can collect each weapon once per life. Choose navigable sites
// near different spawn areas without granting a gun on the spawn point itself.
export function weaponPickups(city: City): WeaponPickup[] {
  const sites: WeaponPickup[] = [];
  const candidates = (
    city.streetNodes.length
      ? city.streetNodes.map((i) => city.nodes[i])
      : city.nodes
  ).filter((p) => city.spawns.every((spawn) => distance(p, spawn) > 4));
  for (let i = 0; i < 8; i++) {
    const spawn = city.spawns[Math.floor((i * city.spawns.length) / 8)];
    let best: V3 | undefined;
    let nearest = Infinity;
    for (const p of candidates) {
      const d = distance(p, spawn);
      if (d >= nearest || sites.some((s) => distance(s.p, p) < 6)) continue;
      best = p;
      nearest = d;
    }
    if (best) sites.push({ p: best, weapon: [2, 0, 1, 3][i % 4] });
  }
  return sites;
}

export interface DroppedWeapon extends WeaponPickup {
  id: number;
  expiresAt: number;
}

export class NpcLoot {
  drops: DroppedWeapon[] = [];
  revision = 0;
  private serial = 0;
  spawn(p: V3, weapon: number, now: number) {
    if (!Number.isInteger(weapon) || weapon < 0 || weapon >= FISTS) return;
    this.revision++;
    if (this.drops.length >= 32) this.drops.shift();
    this.drops.push({
      id: ++this.serial,
      p: [...p],
      weapon,
      expiresAt: now + 60000,
    });
  }
  expire(now: number) {
    while (this.drops.length && this.drops[0].expiresAt <= now) {
      this.drops.shift();
      this.revision++;
    }
  }
  collect(p: V3, owned: number[], now: number) {
    this.expire(now);
    const index = this.drops.findIndex(
      (drop) =>
        !owned.includes(drop.weapon) && distance(p, drop.p) <= PICKUP_RADIUS,
    );
    if (index < 0) return;
    this.revision++;
    return this.drops.splice(index, 1)[0];
  }
}
