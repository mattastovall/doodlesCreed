import { chromium } from "playwright";
import assert from "node:assert/strict";
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
  for (let weapon = 0; weapon < 4; weapon++) {
    await page.evaluate((weapon) => {
      const g = window.__doodles;
      g.state = "play";
      g.combat.collectWeapon(weapon);
      g.setWeapon(weapon);
      g.combat.mags[weapon] = 1;
      g.player.yaw = 0;
      g.player.pitch = 0;
    }, weapon);
    await page.keyboard.press("KeyR");
    await page.waitForFunction(() => window.__doodles.combat.reloadTime > 0);
    const result = await page.evaluate((weapon) => {
      const g = window.__doodles;
      g.state = "paused";
      g.aiming = true;
      g.combat.reloadTime = [1.45, 1.9, 1.05, 2.4][weapon] * 0.6;
      g.updateVisuals(0.016);
      g.render.draw(g.time);
      return {
        parts: g.weaponMesh.userData.animatedParts.length,
        roll: g.weaponMesh.rotation.z,
      };
    }, weapon);
    assert.ok(result.parts >= 2);
    assert.ok(Math.abs(result.roll) > 0.1);
    await page.screenshot({ path: `output/playwright/reload-${weapon}.png` });
    await page.evaluate(() => {
      const g = window.__doodles;
      g.combat.reloadTime = 0;
      g.aiming = false;
      g.updateVisuals(0.016);
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    "All four R-key reloads animate their parts and weapon pose without browser errors.",
  );
} finally {
  await browser.close();
}
