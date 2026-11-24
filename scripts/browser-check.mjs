import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
await mkdir("output/playwright", { recursive: true });
const result = { checks: [], errors: [], screenshots: [] };
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 850 },
  recordVideo: {
    dir: "output/playwright/video",
    size: { width: 1280, height: 850 },
  },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const mark = (s) => {
  result.checks.push(s);
  console.log("PASS", s);
};
const get = (fn) => page.evaluate(fn);
async function waitSim(p, seconds) {
  const end = await p.evaluate((s) => window.__doodles.elapsed + s, seconds);
  await p.waitForFunction((end) => window.__doodles.elapsed >= end, end, {
    timeout: 30000,
  });
}
async function snap(name) {
  await page.screenshot({ path: `output/playwright/${name}.png` });
  result.screenshots.push(name + ".png");
}
async function resume(p) {
  if (await p.locator("#resume").isVisible())
    await p.locator("#resume").click();
  await p.waitForFunction(
    () => window.__doodles.state === "play" && document.pointerLockElement,
    { timeout: 15000 },
  );
  await p.waitForTimeout(200);
}
try {
  await page.goto(process.env.GAME_URL || "http://127.0.0.1:4173", {
    waitUntil: "networkidle",
  });
  await page.waitForSelector("#menu:not(.hidden)", { timeout: 60000 });
  await snap("01-menu");
  mark("Main menu renders the procedural 3D city");
  await page.locator("#help").click();
  assert.match(await page.locator("#dialog-content").innerText(), /Wall jump/);
  await page.locator("#help-done").click();
  mark("Controls dialog opens and closes");
  await page.locator("#settings").click();
  await page.locator("#volume").focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await page.locator("#settings-done").click();
  assert.equal(
    await get(() => JSON.parse(localStorage.getItem("dc.settings")).volume),
    0.25,
  );
  mark("Settings persist to local storage");
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await resume(page);
  await get(() => {
    window.__doodles.player.yaw = 0;
    window.__doodles.player.pitch = 0;
  });
  await waitSim(page, 0.3);
  assert.equal(await get(() => window.__doodles.combat.bots.length), 0);
  await snap("02-street");
  mark("Free roam starts in first person with pointer lock and no enemies");
  const before = await get(() => window.__doodles.player.position.toArray());
  await page.keyboard.down("KeyW");
  await page.keyboard.down("ShiftLeft");
  await waitSim(page, 1.1);
  const moved = await get(() => ({
    p: window.__doodles.player.position.toArray(),
    speed: window.__doodles.player.speed,
  }));
  assert.ok(moved.p[2] < before[2] - 6);
  assert.ok(moved.speed > 10);
  mark("W + Shift builds sprint speed and moves through the city");
  await page.keyboard.down("KeyC");
  await waitSim(page, 0.15);
  assert.equal(await get(() => window.__doodles.player.action), "SLIDE");
  assert.ok(await get(() => window.__doodles.player.height < 1.2));
  await page.keyboard.up("KeyC");
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ShiftLeft");
  mark("Crouch enters a momentum-preserving slide");
  await get(() => {
    const g = window.__doodles;
    g.player.reset([15, 0.04, 0]);
    g.player.yaw = 0;
    g.player.pitch = 0;
  });
  await waitSim(page, 0.3);
  await page.keyboard.down("Space");
  await waitSim(page, 0.12);
  assert.ok(await get(() => window.__doodles.player.position.y > 0.7));
  await page.keyboard.up("Space");
  mark("Space produces an actual airborne jump");
  await get(() => {
    const g = window.__doodles;
    g.player.reset([10.5, 0.02, 22.5]);
    g.player.yaw = 0;
    g.player.pitch = 0;
    g.player.velocity.z = -11;
  });
  await page.keyboard.down("KeyW");
  await page.keyboard.down("Space");
  await waitSim(page, 0.15);
  assert.ok(await get(() => window.__doodles.player.vaults > 0));
  await snap("03-vault");
  await page.keyboard.up("Space");
  await waitSim(page, 0.7);
  await page.keyboard.up("KeyW");
  assert.ok(await get(() => window.__doodles.player.position.z < 21));
  mark("Space vaults a physical low barrier");
  await get(() => {
    const g = window.__doodles,
      b = g.city.buildings.find((b) => b.facing === 0 && b.floors >= 3);
    g.player.reset([b.x, 0.2, b.z + b.d / 2 + 6]);
    g.player.yaw = 0;
    g.player.pitch = Math.atan2(b.height - 0.12 - 1.8, 6);
  });
  await waitSim(page, 0.1);
  await page.keyboard.down("KeyQ");
  await waitSim(page, 0.65);
  assert.ok(await get(() => !!window.__doodles.player.anchor));
  assert.ok(await get(() => window.__doodles.player.position.y > 1));
  await snap("04-grapple");
  await page.keyboard.up("KeyQ");
  await page.keyboard.down("Space");
  await waitSim(page, 0.1);
  assert.equal(await get(() => window.__doodles.player.anchor), null);
  await page.keyboard.up("Space");
  mark("Q attaches and reels a grapple; Space launches off the rope");
  await get(() => {
    const g = window.__doodles,
      b = g.city.buildings.find((b) => b.facing === 0 && b.floors >= 3);
    g.player.reset(b.entrance);
    g.player.yaw = 0;
    g.player.pitch = 0;
  });
  await page.keyboard.down("KeyW");
  await waitSim(page, 0.9);
  await page.keyboard.up("KeyW");
  assert.ok(
    await get(() => {
      const g = window.__doodles,
        b = g.city.buildings.find((b) => b.facing === 0 && b.floors >= 3);
      return g.player.position.z < b.z + b.d / 2;
    }),
  );
  await snap("05-interior");
  mark("The front entrance is physically walkable");
  const rooftop = await get(() => {
    const g = window.__doodles,
      b = g.city.buildings.find((b) => b.facing === 0 && b.floors >= 3);
    g.player.reset(b.entrance);
    const route = [b.inside, ...b.route];
    for (const v of route) {
      for (let i = 0; i < 1600; i++) {
        const dx = v[0] - g.player.position.x,
          dz = v[2] - g.player.position.z;
        if (
          Math.hypot(dx, dz) < 0.24 &&
          Math.abs(v[1] - g.player.position.y) < 0.45
        )
          break;
        g.player.yaw = Math.atan2(-dx, -dz);
        g.player.update(1 / 120, {
          forward: 1,
          side: 0,
          sprint: false,
          crouch: false,
          jump: false,
          grapple: false,
          reel: false,
        });
      }
    }
    g.player.yaw = -0.6;
    g.player.pitch = -0.08;
    g.player.velocity.set(0, 0, 0);
    return { y: g.player.position.y, roof: b.height };
  });
  assert.ok(rooftop.y >= rooftop.roof - 0.1);
  await snap("06-rooftop");
  mark("Physical controller follows interior stairs from entrance to rooftop");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#resume");
  assert.equal(await get(() => window.__doodles.state), "paused");
  await page.locator("#main-menu").click();
  await page.locator("#contract-mode").click();
  await page.locator("#play").click();
  await resume(page);
  await get(() => {
    const g = window.__doodles;
    for (const weapon of [1, 0]) {
      const drop = g.combat.weaponDrops.find((d) => d.weapon === weapon);
      g.player.reset(drop.p);
      g.step(1 / 120);
    }
    g.player.reset(g.city.spawns[0]);
  });
  await page.mouse.down();
  await get(() => {
    const g = window.__doodles;
    g.combat.bots[0].p.set(15, 0.16, 16);
    const t = g.combat.bots[0].p.clone();
    t.y += 1.4;
    const dir = t.sub(g.player.eye);
    g.player.yaw = Math.atan2(-dir.x, -dir.z);
    g.player.pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
  });
  await waitSim(page, 1.5);
  await page.mouse.up();
  await get(() => {
    window.__doodles.player.yaw = 0;
    window.__doodles.player.pitch = 0;
  });
  assert.ok(await get(() => window.__doodles.combat.kills >= 1));
  assert.ok(await get(() => window.__doodles.combat.mags[0] < 30));
  await snap("07-combat");
  mark(
    "Mouse fire hits and eliminates an NPC, consumes ammunition and awards score",
  );
  await page.keyboard.press("KeyR");
  await waitSim(page, 1.6);
  assert.equal(await get(() => window.__doodles.combat.mags[0]), 30);
  await page.keyboard.press("Digit2");
  assert.equal(await get(() => window.__doodles.combat.weapon), 1);
  mark("Reload restores the magazine; number keys change weapon");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#resume");
  const paused = await get(() => window.__doodles.elapsed);
  await page.waitForTimeout(300);
  assert.equal(await get(() => window.__doodles.elapsed), paused);
  await page.locator("#resume").click();
  mark("Escape pauses solo simulation and Resume restores input");
  await get(() => window.__doodles.combat.damage(200));
  await page.waitForSelector("#retry");
  assert.equal(await get(() => window.__doodles.state), "dead");
  await page.locator("#retry").click();
  await resume(page);
  assert.equal(await get(() => window.__doodles.combat.hp), 100);
  mark("Death and retry reset the run");
  await get(() => {
    const g = window.__doodles;
    g.combat.kills = 6;
    g.collected = new Set([0, 1, 2]);
    g.player.reset(g.city.spawns[0]);
  });
  await page.waitForSelector("#retry");
  assert.equal(await get(() => window.__doodles.state), "complete");
  await page.locator("#retry").click();
  await resume(page);
  assert.equal(await get(() => window.__doodles.district), 2);
  mark("Completed-objective fixture extracts and generates district two");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#main-menu");
  await page.locator("#main-menu").click();
  await page.locator("#online").click();
  await page.locator("#player-name").fill("Bluebird");
  await page.locator("#create-room").click();
  await page.waitForSelector("#enter-room", { timeout: 30000 });
  const code = await get(() => window.__doodles.network.code);
  await snap("08-room");
  await page.locator("#enter-room").click();
  await resume(page);
  const context2 = await browser.newContext({
    viewport: { width: 1000, height: 700 },
  });
  const second = await context2.newPage();
  second.on("pageerror", (e) => errors.push(e.message));
  await second.goto(process.env.GAME_URL || "http://127.0.0.1:4173", {
    waitUntil: "networkidle",
  });
  await second.waitForSelector("#menu:not(.hidden)", { timeout: 60000 });
  await second.locator("#online").click();
  await second.locator("#player-name").fill("Marginalia");
  await second.locator("#room-input").fill(code);
  await second.locator("#join-room").click();
  await second.waitForSelector("#hud:not(.hidden)", { timeout: 30000 });
  await resume(second);
  await second.waitForFunction(
    () => window.__doodles.network.players.length === 2,
  );
  assert.equal(
    await second.evaluate(() => window.__doodles.seed),
    await get(() => window.__doodles.seed),
  );
  assert.equal(await second.evaluate(() => window.__doodles.remotes.size), 1);
  mark(
    "Two independent browser clients join one room with the same city and remote avatars",
  );
  await page.bringToFront();
  if (await get(() => window.__doodles.state === "paused"))
    await page.locator("#resume").click();
  await resume(page);
  await get(() => {
    window.__doodles.player.yaw = 0;
    window.__doodles.player.pitch = 0;
  });
  const start = await get(() => window.__doodles.player.position.z);
  await page.keyboard.down("KeyW");
  await page.keyboard.down("ShiftLeft");
  await waitSim(page, 0.8);
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ShiftLeft");
  await page.waitForTimeout(250);
  const id = await get(() => window.__doodles.network.id);
  const remoteZ = await second.evaluate(
    (id) => window.__doodles.network.players.find((p) => p.id === id).p[2],
    id,
  );
  assert.ok(remoteZ < start - 3);
  await page.keyboard.down("Tab");
  await snap("09-multiplayer");
  await page.keyboard.up("Tab");
  mark(
    "Real keyboard movement replicates to the second browser; scoreboard lists both players",
  );
  await context2.close();
  await page.waitForFunction(
    () => window.__doodles.network.players.length === 1,
  );
  mark("Disconnect removes the departed player");
  assert.deepEqual(errors, []);
  mark("No browser runtime or WebGL errors");
  result.fps = await get(() => window.__doodles.fps);
  result.errors = errors;
} catch (e) {
  result.errors = [...errors, e.stack];
  console.error(e);
  await snap("failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await context.close();
  const video = page.video();
  if (video)
    await copyFile(await video.path(), "output/playwright/gameplay.webm");
  await browser.close();
  await writeFile(
    "output/playwright/browser-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
}
