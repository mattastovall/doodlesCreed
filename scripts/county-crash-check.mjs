import assert from "node:assert/strict";
import { chromium } from "playwright";

// Start npm run dev, then COUNTY_HARDWARE_GL=1 node scripts/county-crash-check.mjs.
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
    deviceScaleFactor: 1,
  });
  await page.routeWebSocket(
    () => true,
    () => {},
  );
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(new URL("/?mode=county", origin).href);
  await page.waitForFunction(
    () => window.__doodles?.state === "menu",
    {},
    { timeout: 60000 },
  );
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await page.waitForFunction(
    () => window.__doodles?.state === "play",
    {},
    { timeout: 60000 },
  );
  const result = await page.evaluate(async () => {
    const g = window.__doodles,
      renderer = g.render.renderer;
    g.render.adjustCountyResolution = () => {};
    renderer.setPixelRatio(1);
    g.render.resize();
    const waitFrame = () => new Promise(requestAnimationFrame);
    const store = g.city.boxes.find(
      (b) => b.buildingId?.endsWith("/kiosk") && b.kind === "foundation",
    );
    const yaw = Math.PI / 2,
      c = Math.cos(yaw),
      s = Math.sin(yaw);
    const car = g.cars[0];
    // Stage one parked car on the cross street. All subsequent poses, damage, support
    // loss and rubble come from the normal game loop driven by ordinary driving input.
    const start = [
      store.p[0] + s * 26 - c * 3.8,
      0,
      store.p[2] + c * 26 + s * 3.8,
    ];
    car.access = "open";
    car.p = start;
    car.yaw = yaw;
    g.player.reset(start);
    g.useCar();
    await waitFrame();
    if (g.vehicle !== 0) throw Error("car failed to board");
    for (let i = 0; i < 30; i++) await waitFrame();
    const stats = (values) => {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        mean: values.reduce((a, b) => a + b, 0) / values.length,
        p50: sorted[Math.floor(sorted.length / 2)],
        p95: sorted[Math.ceil(0.95 * sorted.length) - 1],
        max: sorted.at(-1),
      };
    };
    const hits = [],
      fallen = new Set(),
      driveMs = [],
      frameMs = [],
      impactFrames = [];
    const timings = {};
    function measure(obj, method) {
      const fn = obj[method].bind(obj),
        samples = [];
      timings[method] = samples;
      obj[method] = (...args) => {
        const t = performance.now();
        try {
          return fn(...args);
        } finally {
          samples.push(performance.now() - t);
        }
      };
    }
    measure(g.wreckage, "detach");
    measure(g.wreckage, "step");
    measure(g.structures.support, "lost");
    measure(g.rubbleView, "add");
    measure(g.structures, "damage");
    const damage = g.structures.damage.bind(g.structures);
    g.structures.damage = (i, amount) => {
      const b = g.city.boxes[i];
      if (b.buildingId === store.buildingId) hits.push(b.kind);
      return damage(i, amount);
    };
    const advance = g.driveWorld.advance.bind(g.driveWorld);
    g.driveWorld.advance = (...args) => {
      const start = performance.now();
      try {
        return advance(...args);
      } finally {
        driveMs.push(performance.now() - start);
      }
    };
    let firstHitFrameMs, firstDetachFrameMs;
    let last = performance.now(),
      topSpeed = 0,
      drift = 0;
    const levels = new Set();
    const begin = g.elapsed,
      deadline = performance.now() + 120000;
    g.keys.add("KeyW");
    while (g.elapsed - begin < 6.5) {
      await waitFrame();
      const now = performance.now(),
        ms = now - last;
      frameMs.push(ms);
      last = now;
      if (hits.length && firstHitFrameMs === undefined) firstHitFrameMs = ms;
      if (timings.detach.length) {
        if (firstDetachFrameMs === undefined) firstDetachFrameMs = ms;
        else impactFrames.push(ms);
      }
      levels.add(Math.round(g.player.position.y * 100));
      topSpeed = Math.max(topSpeed, g.carSpeed);
      for (const [id, cluster] of g.rubbleClusters) {
        if (
          !cluster.indices.some(
            (i) =>
              g.city.boxes[i].buildingId === store.buildingId &&
              g.city.boxes[i].piece === "wall",
          )
        )
          continue;
        fallen.add(id);
        const d = Math.hypot(
          ...cluster.pose.p.map((v, k) => v - cluster.pose.origin[k]),
        );
        drift = Math.max(drift, d);
      }
      if (performance.now() > deadline) throw Error("timed out");
    }
    g.keys.delete("KeyW");
    const end = g.player.position.toArray();
    // A second staged approach is clear of props and exercises the wheel lock in reverse, too.
    g.player.position.set(-320, 0, 0);
    g.player.yaw = 0;
    g.carSpeed = 0;
    g.carSteer = 0;
    g.keys.add("KeyD");
    const checkSteer = async (forward, seconds) => {
      const t = g.elapsed,
        from = g.player.yaw;
      if (forward) g.keys.add(forward);
      while (g.elapsed - t < seconds) {
        if (performance.now() > deadline)
          throw Error("steering check timed out");
        await waitFrame();
      }
      if (forward) g.keys.delete(forward);
      return g.player.yaw - from;
    };
    const atRest = await checkSteer(null, 0.25);
    const forward = await checkSteer("KeyW", 0.8);
    g.carSpeed = 0;
    const reverse = await checkSteer("KeyS", 0.8);
    g.keys.clear();
    const gl = renderer.getContext(),
      ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      gpu: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      store: store.buildingId,
      topSpeed,
      metres: Math.hypot(end[0] - start[0], end[2] - start[2]),
      surfaceLevelsCm: [...levels],
      hits,
      fallenWallAssemblies: fallen.size,
      maxFallenTravel: drift,
      steeringRadians: { atRest, forward, reverse },
      frames: frameMs.length,
      frameMs: stats(frameMs),
      firstHitFrameMs,
      firstDetachFrameMs,
      afterDetachFrameMs: stats(impactFrames),
      componentMs: Object.fromEntries(
        Object.entries(timings).map(([k, v]) => [k, stats(v)]),
      ),
      drivingStepMs: stats(driveMs),
    };
  });
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []);
  assert.deepEqual(result.buffer, [1280, 720]);
  assert.ok(
    result.topSpeed > 13 && result.metres > 24,
    "car never entered the storefront",
  );
  assert.ok(
    result.surfaceLevelsCm.includes(15) && result.surfaceLevelsCm.includes(20),
    "car missed the pavement or shop foundation",
  );
  assert.ok(result.hits.includes("window") && result.hits.includes("exterior"));
  assert.ok(
    result.fallenWallAssemblies > 0 && result.maxFallenTravel > 0.1,
    "a wall section must physically detach and fall",
  );
  assert.ok(
    result.steeringRadians.atRest === 0 &&
      result.steeringRadians.forward < -0.1 &&
      result.steeringRadians.reverse > 0.1,
  );
} finally {
  await browser.close();
}
