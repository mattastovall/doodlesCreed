import { roadsidePlaces } from "./county-highways.ts";
import { COUNTY_SETTLEMENTS, terrainHeight } from "./county-plan.ts";
import { countyHabitat } from "./county-landcover.ts";
import { countyWaterBounds, sampleCountyWater } from "./county-hydrology.ts";
import type { City } from "./world.ts";

const waterNames = {
  lake: "Laurel Lake",
  marsh: "Alder Marsh",
  creek: "Alder Creek",
  spring: "Saltbrush Spring",
};
const waterPlaces = [
  { name: waterNames.lake, x: 200, z: 635 },
  { name: waterNames.marsh, x: -170, z: 690 },
  { name: waterNames.spring, x: -335, z: -590 },
];
export const countyPlaces = [
  { name: "Westhaven", x: -320, z: 0, radius: 190 },
  { name: "Eastbank", x: 320, z: 0, radius: 190 },
  ...COUNTY_SETTLEMENTS.map((p) => ({ ...p, radius: 115 })),
  ...waterPlaces.map((p) => ({ ...p, radius: 0, water: true })),
  ...roadsidePlaces.map((p) => ({ ...p, radius: 25, landmark: true })),
];

export function placeName(x: number, z: number, plan: City["plan"]) {
  for (const site of roadsidePlaces)
    if (Math.hypot(site.x - x, site.z - z) < 25) return site.name;
  const water = sampleCountyWater(x, z);
  if (water && water.shoreDistance < 12) return waterNames[water.kind];
  const block = plan.blocks.find(
    (b) =>
      b.district &&
      x >= b.minX - 4 &&
      x <= b.maxX + 4 &&
      z >= b.minZ - 4 &&
      z <= b.maxZ + 4,
  );
  if (block) return (x < 0 ? "Westhaven" : "Eastbank") + " · " + block.district;
  if (z >= -1055 && z <= -876 && x >= 680 && x <= 880)
    return "Red Mesa · Civic District";
  for (const place of countyPlaces)
    if (
      Math.abs(x - place.x) < place.radius &&
      Math.abs(z - place.z) < place.radius
    )
      return place.name;
  if (z < -340) return x < 0 ? "Saltbrush Flats" : "Mesa Country";
  if (z > 350) return "Laurel Highlands";
  if (Math.abs(z) < 75) return "County Highway";
  return "Valley Foothills";
}

const cached = new WeakMap<City, HTMLCanvasElement>();
export function countyAtlas(city: City) {
  const previous = cached.get(city);
  if (previous) return previous;
  const canvas = document.createElement("canvas"),
    extent = city.bounds * 2;
  canvas.width = canvas.height = extent;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(city.bounds, city.bounds);
  // Use the same surveyed terrain and street centerlines as the driving world.
  for (let x = -city.bounds; x < city.bounds; x += 16)
    for (let z = -city.bounds; z < city.bounds; z += 16) {
      const h = terrainHeight(x, z),
        { dry, woods: forest } = countyHabitat(x, z);
      const slope = Math.max(
        -12,
        Math.min(12, (h - terrainHeight(x - 16, z - 16)) * 0.65),
      );
      const band = Math.min(16, Math.floor(Math.max(0, h) / 20) * 2);
      ctx.fillStyle =
        "rgb(" +
        [
          230 + 10 * dry - 37 * forest,
          232 - 12 * dry - 12 * forest,
          216 - 28 * dry - 16 * forest,
        ]
          .map((n) => Math.round(n + slope - band))
          .join(",") +
        ")";
      ctx.fillRect(x, z, 16, 16);
    }
  for (const area of countyWaterBounds)
    for (let x = area.minX; x < area.maxX; x += 4)
      for (let z = area.minZ; z < area.maxZ; z += 4) {
        const water = sampleCountyWater(x + 2, z + 2);
        if (!water) continue;
        const depth = water.surfaceY - terrainHeight(x + 2, z + 2);
        if (depth <= 0) continue;
        ctx.fillStyle =
          depth < 1 ? "#9ecbc5" : depth < 3 ? "#7bb7bf" : "#659eae";
        ctx.fillRect(x, z, 4, 4);
      }
  for (const b of city.plan.parcels) {
    ctx.fillStyle =
      b.floors >= 5 ? "#9caab6" : b.floors > 1 ? "#bbc4ca" : "#ced2c9";
    ctx.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d);
  }
  ctx.lineCap = "round";
  for (const road of city.plan.streets) {
    ctx.lineWidth = road.width * 0.72;
    ctx.strokeStyle = road.endWidths
      ? "#94683e"
      : road.class === "arterial"
        ? "#718199"
        : "#a3adbb";
    ctx.beginPath();
    ctx.moveTo(road.a[0], road.a[2]);
    ctx.lineTo(road.b[0], road.b[2]);
    ctx.stroke();
  }
  ctx.strokeStyle = "#f3c97e";
  ctx.lineWidth = 2;
  for (const road of city.plan.streets) {
    if (!road.endWidths) continue;
    ctx.beginPath();
    ctx.moveTo(road.a[0], road.a[2]);
    ctx.lineTo(road.b[0], road.b[2]);
    ctx.stroke();
  }
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 2.5;
  for (const site of roadsidePlaces) {
    ctx.fillStyle = "#965b3e";
    ctx.fillRect(site.x - 3, site.z - 3, 6, 6);
    ctx.strokeStyle = "#fff9e5";
    ctx.strokeText(site.name, site.x, site.z - 7);
    ctx.fillText(site.name, site.x, site.z - 7);
  }
  cached.set(city, canvas);
  return canvas;
}
