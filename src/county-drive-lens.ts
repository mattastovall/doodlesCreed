import type { CityPlan } from "./city-plan.ts";
import { sampleCountyWater } from "./county-hydrology.ts";
import { clearOfLotsAndRoads, countyHabitat } from "./county-landcover.ts";
import { ruralRoad, terrainHeight } from "./county-plan.ts";

type Spray = "grass" | "mud";

function paved(plan: CityPlan, x: number, z: number) {
  if (clearOfLotsAndRoads(plan, x, z)) return false;
  for (const p of plan.parcels)
    if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2)
      return true;
  for (const s of plan.streets) {
    const dx = s.b[0] - s.a[0],
      dz = s.b[2] - s.a[2];
    const ax = x - s.a[0],
      az = z - s.a[2];
    const t = Math.max(
      0,
      Math.min(1, (ax * dx + az * dz) / (dx * dx + dz * dz || 1)),
    );
    const width = s.endWidths
      ? s.endWidths[0] + t * (s.endWidths[1] - s.endWidths[0])
      : s.width;
    const shoulder = ruralRoad(s) ? 0.85 : s.width >= 11 ? 2.25 : 1.45;
    if ((ax - dx * t) ** 2 + (az - dz * t) ** 2 <= (width / 2 + shoulder) ** 2)
      return true;
  }
  return false;
}

export function countyDriveSpray(
  plan: CityPlan,
  x: number,
  z: number,
): Spray | undefined {
  if (paved(plan, x, z)) return;
  const water = sampleCountyWater(x, z);
  if (water) {
    const depth = water.surfaceY - terrainHeight(x, z);
    if (depth > 0.85) return;
    if (depth >= -1.4 && water.shoreDistance < 12) return "mud";
  }
  const site = countyHabitat(x, z);
  if (site.dry < 0.61 && site.slope < 0.65) return "grass";
}

// Small transparent stamps stay fixed on the lens until they evaporate. Each
// irregular drop and torn blade is painted once, with no full-screen redraw.
function paintStamp(ctx: CanvasRenderingContext2D, kind: Spray) {
  for (let n = 0; n < (kind === "mud" ? 10 : 7); n++) {
    const x = 9 + Math.random() * 78,
      y = 6 + Math.random() * 34;
    const scale = n === 0 ? 1 : 0.25 + Math.random() * 0.65;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.rotate(-0.7 + Math.random() * 1.25);
    ctx.beginPath();
    if (kind === "mud") {
      ctx.fillStyle = n % 3 === 0 ? "#53412d" : "#796044";
      ctx.moveTo(-9, 0);
      ctx.bezierCurveTo(-8, -6, -2, -8, 3, -4);
      ctx.bezierCurveTo(8, -2, 15, 0, 15, 2);
      ctx.bezierCurveTo(6, 2, 0, 7, -6, 4);
    } else {
      ctx.fillStyle = n % 3 === 0 ? "#56603b" : "#7c804b";
      ctx.moveTo(-10, 2);
      ctx.quadraticCurveTo(-2, -2, 15, -5);
      ctx.quadraticCurveTo(2, 2, -6, 4);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

export class CountyDriveLens {
  private layer: HTMLDivElement;
  private marks: {
    canvas: HTMLCanvasElement;
    age: number;
    life: number;
    opacity: number;
  }[] = [];
  private lastX = NaN;
  private lastZ = NaN;
  private travel = 0;
  private next = 7;
  private disposed = false;
  constructor(
    private plan: CityPlan,
    host: HTMLElement = document.body,
  ) {
    this.layer = document.createElement("div");
    this.layer.className = "county-drive-lens";
    this.layer.setAttribute("aria-hidden", "true");
    this.layer.style.cssText =
      "position:absolute;inset:0;overflow:hidden;pointer-events:none";
    const world = host.querySelector("#world");
    if (world?.parentElement === host) world.after(this.layer);
    else host.appendChild(this.layer);
  }
  update(
    dt: number,
    x: number,
    z: number,
    speed: number,
    reducedMotion: boolean,
  ) {
    if (this.disposed) return;
    if (reducedMotion) {
      this.clear();
      return;
    }
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.age += Math.max(0, dt);
      if (m.age >= m.life) {
        m.canvas.remove();
        this.marks.splice(i, 1);
      } else {
        const remaining = Math.min(1, (m.life - m.age) / (m.life * 0.8));
        m.canvas.style.opacity = (m.opacity * remaining * remaining).toFixed(3);
      }
    }
    const distance = Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x;
    this.lastZ = z;
    if (
      Math.abs(speed) < 3 ||
      !Number.isFinite(distance) ||
      distance > Math.abs(speed) * Math.min(0.5, dt) * 2 + 1
    ) {
      this.travel = 0;
      return;
    }
    this.travel += distance;
    if (this.travel < this.next) return;
    this.travel = 0;
    const kind = countyDriveSpray(this.plan, x, z);
    this.next =
      kind === "mud"
        ? 6 + Math.random() * 8
        : kind === "grass"
          ? 11 + Math.random() * 16
          : 4;
    if (!kind || this.marks.length >= 8) return;
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 48;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paintStamp(ctx, kind);
    const left = Math.random() < 0.5;
    const opacity =
      (kind === "mud" ? 0.34 : 0.27) * (0.65 + Math.random() * 0.35);
    canvas.style.cssText = `position:absolute;${left ? "left" : "right"}:${Math.random() * 6 - 1}%;top:${28 + Math.random() * 65}%;width:min(${6 + Math.random() * 5}vw,85px);height:auto;opacity:${opacity};transform:rotate(${(left ? -1 : 1) * (12 + Math.random() * 36)}deg)`;
    this.layer.appendChild(canvas);
    this.marks.push({
      canvas,
      age: 0,
      life: (kind === "mud" ? 9 : 5) + Math.random() * 4,
      opacity,
    });
  }
  clear() {
    if (this.marks.length) this.layer.replaceChildren();
    this.marks.length = 0;
    this.travel = 0;
    this.next = 7;
    this.lastX = NaN;
    this.lastZ = NaN;
  }
  dispose() {
    this.clear();
    this.layer.remove();
    this.disposed = true;
  }
}
