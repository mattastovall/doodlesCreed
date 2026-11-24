import assert from "node:assert/strict";
import { chromium } from "playwright";

// Run against the dev server, which exposes the rendered car and camera.
const origin = process.env.COUNTY_TEST_ORIGIN ?? "http://127.0.0.1:4173";
const browser = await chromium.launch(
  process.env.COUNTY_HARDWARE_GL === "1"
    ? {
        channel: "chromium",
        args: [
          "--enable-gpu",
          "--ignore-gpu-blocklist",
          "--use-angle=gl",
          "--ozone-platform=x11",
        ],
      }
    : {},
);
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  await page.routeWebSocket(
    () => true,
    () => {},
  );
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.text().includes("Shader Error")) errors.push(m.text());
  });
  await page.goto(new URL("/?mode=county", origin).href);
  await page.waitForFunction(() => window.__doodles?.state === "menu");
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await page.waitForFunction(() => window.__doodles?.state === "play");
  const parked = await page.evaluate(() => {
    const g = window.__doodles,
      car = g.cars.find((c) => c.access === "locked" && !c.driver);
    // Stage a real pickable car on a clear stretch of the County valley.
    car.p = [0, 0, 0];
    car.yaw = -Math.PI / 2;
    g.player.reset([0, 0, 2.5]);
    g.player.yaw = car.yaw + 1.5;
    return { yaw: car.yaw, p: car.p.slice() };
  });
  async function completeStage(action) {
    await page.keyboard.press("KeyE");
    await page.waitForFunction((action) => {
      const g = window.__doodles,
        car = g.cars[g.nearestCar()];
      return (
        car?.interaction?.action === action &&
        document.getElementById("action").textContent ===
          (action === "lockpick" ? "LOCKPICKING" : "HOTWIRING") +
            " · PRESS E NOW"
      );
    }, action);
    await page.keyboard.press("KeyE");
  }
  await completeStage("lockpick");
  await page.waitForFunction(() => {
    const g = window.__doodles;
    return g.vehicle < 0 && g.cars[g.nearestCar()]?.access === "picked";
  });
  await completeStage("hotwire");
  await page.waitForFunction(() => window.__doodles.vehicle >= 0);
  const entry = await page.evaluate(() => {
    const g = window.__doodles,
      c = g.render.countyCars[g.vehicle];
    return { yaw: c.rotation.y, p: c.position.toArray() };
  });
  assert.ok(
    Math.abs(entry.yaw - parked.yaw) < 0.001,
    "Boarding changed the parked heading",
  );
  assert.ok(
    Math.hypot(entry.p[0] - parked.p[0], entry.p[2] - parked.p[2]) < 0.01,
    "Boarding shifted the parked vehicle",
  );
  await page.keyboard.down("KeyW");
  await page.waitForFunction(() => window.__doodles.carSpeed > 8);
  const result = await page.evaluate(async () => {
    const game = window.__doodles,
      car = game.render.countyCars[game.vehicle],
      camera = game.render.camera;
    const start = car.position.clone(),
      relative = start.clone(),
      frames = [];
    let maxError = 0,
      previous = performance.now();
    for (let i = 0; i < 180; i++) {
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      frames.push(now - previous);
      previous = now;
      relative.copy(camera.position);
      car.worldToLocal(relative);
      maxError = Math.max(
        maxError,
        Math.hypot(relative.x, relative.y - 3.1, relative.z - 6),
      );
    }
    frames.sort((a, b) => a - b);
    return {
      metres: car.position.distanceTo(start),
      maxCameraErrorMetres: maxError,
      meanFPS: (1000 * frames.length) / frames.reduce((a, b) => a + b),
      p95FrameMs: frames[Math.floor(frames.length * 0.95)],
    };
  });
  await page.keyboard.down("KeyD");
  await page.keyboard.down("Space");
  await page.waitForFunction(() => Math.abs(window.__doodles.carSlip) > 0.28);
  const slide = await page.evaluate(() => {
    const g = window.__doodles;
    return {
      slipRadians: g.carSlip,
      tireVertices: g.tires.marks.drawRange.count,
      smokePuffs: g.tires.smoke.drawRange.count,
    };
  });
  assert.ok(slide.tireVertices >= 12 && slide.smokePuffs >= 2);
  await page.keyboard.up("Space");
  await page.keyboard.up("KeyD");
  await page.waitForFunction(() => Math.abs(window.__doodles.carSlip) < 0.06);
  await page.keyboard.up("KeyW");
  // The network test covers the compact packet. Feed its decoded actor shape
  // through the same interpolation/rendering path used by a watching client.
  const observer = await page.evaluate(() => {
    const g = window.__doodles;
    const index = g.cars.findIndex((car, k) => k !== g.vehicle && !car.driver);
    const car = g.cars[index],
      eye = g.render.camera.position;
    const driver = {
      id: "browser-observer-driver",
      npc: false,
      yaw: 0,
      p: [eye.x + 5, 0, eye.z],
      skiddingCar: index,
    };
    car.driver = driver.id;
    g.network.players.push(driver);
    const count = () => g.tires.marks.drawRange.count;
    g.syncCars(1 / 30);
    const start = count();
    const move = () => {
      driver.p[2]--;
      g.syncCars(1 / 30);
    };
    move();
    move();
    const nearby = count();
    driver.npc = true;
    move();
    move();
    const traffic = count();
    driver.npc = false;
    driver.p[0] += 120;
    move();
    move();
    const distant = count();
    car.driver = null;
    g.network.players.pop();
    return {
      nearby: nearby - start,
      traffic: traffic - nearby,
      distant: distant - traffic,
    };
  });
  assert.ok(observer.nearby >= 12);
  assert.equal(observer.traffic, 0);
  assert.equal(observer.distant, 0);
  assert.deepEqual(errors, []);
  assert.ok(result.metres > 15, "The car must travel along the street");
  assert.ok(
    result.maxCameraErrorMetres < 0.005,
    "The chase camera moved relative to the car",
  );
  console.log({ ...result, ...slide, observer });
} finally {
  await browser.close();
}
