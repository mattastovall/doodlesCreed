import { chromium } from "playwright";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const page = await browser.newPage({
      viewport: { width: 1100, height: 750 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5199");
  await page.waitForSelector("#menu:not(.hidden)", { timeout: 60000 });
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  const results = await page.evaluate(() => {
    const g = window.__doodles;
    g.state = "paused";
    g.loop = () => {};
    const results = [];
    g.player.position.set(0, 200, 0);
    g.player.pitch = 0;
    g.player.yaw = 0;
    for (let weapon = 0; weapon < 4; weapon++) {
      g.combat.collectWeapon(weapon);
      g.setWeapon(weapon);
      g.combat.cooldown = 0;
      g.combat.mags[weapon] = 5;
      g.combat.shotTrails.dispose();
      g.updateVisuals(0);
      g.combat.fire(); // physics shot, before this frame's weapon movement
      g.player.position.x += 0.4;
      g.player.yaw += 0.03;
      g.viewMotion.look(30, 10);
      g.updateVisuals(1 / 60);
      g.combat.renderShots(1 / 60);
      const shot = g.combat.shotTrails.active[0],
        muzzle = g.combat.muzzlePosition();
      const error = shot.from.distanceTo(muzzle);
      if (error > 1e-6) throw Error("Muzzle pose is stale: " + error);
      const from = shot.from.clone();
      g.player.position.x += 0.4;
      g.updateVisuals(1 / 60);
      g.combat.renderShots(1 / 60);
      if (!shot.from.equals(from)) throw Error("Shot was dragged with the gun");
      results.push({ weapon, error, trailLength: shot.mesh.scale.y });
    }
    g.render.draw(g.time);
    return results;
  });
  await page.screenshot({ path: "output/playwright/moving-shot.png" });
  if (errors.length) throw Error(errors.join("\n"));
  console.log("Moving-shot browser checks:", results);
} finally {
  await browser.close();
}
